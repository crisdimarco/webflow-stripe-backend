import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
app.use(express.json());
app.use(cors({
    origin: "https://gran-bar.webflow.io", // Sostituisci con il tuo dominio Webflow
    methods: "GET,POST,OPTIONS",
    allowedHeaders: "Content-Type,Authorization",
    credentials: true
}));

const PORT = process.env.PORT || 10000;

// 📌 **Configurazione Airtable**
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID; 
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID; 

const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

const airtableHeaders = {
    "Authorization": `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
};

// ✅ **Rotta per controllare la disponibilità basata sulla fascia oraria e data**
app.get("/check-availability/:pickupTime/:pickupDate", async (req, res) => {
    try {
        const pickupTime = req.params.pickupTime;
        const pickupDate = req.params.pickupDate;

        console.log(`📊 Controllo disponibilità per il ${pickupDate} alle ${pickupTime}`);

        // 📌 Recupera gli ordini esistenti filtrando per data e orario
        const airtableResponse = await fetch(
            `${AIRTABLE_URL}?filterByFormula=AND({Orario di Ritiro}="${pickupTime}", {Data Ritiro}="${pickupDate}")`,
            {
                method: "GET",
                headers: airtableHeaders,
            }
        );

        const airtableResult = await airtableResponse.json();

        if (airtableResult.error) {
            console.error("❌ Errore nel recupero dei dati da Airtable:", airtableResult.error);
            return res.status(500).json({ error: airtableResult.error });
        }

        let totalProductsBooked = 0;
        airtableResult.records.forEach((record) => {
            totalProductsBooked += parseInt(record.fields["Quantità"], 10);
        });

        console.log(`📊 Totale prodotti prenotati per ${pickupDate} alle ${pickupTime}:`, totalProductsBooked);

        // Definizione dei limiti per fascia oraria
        const limitPerTimeSlot = {
            "9.00": 50,
            "9.30": 30,
            "10.00": 40,
            "10.30": 20,
        };

        const maxAllowed = limitPerTimeSlot[pickupTime] || 1000; // Default alto se non specificato

        res.json({ totalProductsBooked, maxAllowed });
    } catch (error) {
        console.error("❌ Errore nel recupero della disponibilità:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ **Rotta per creare la sessione Stripe**
app.post("/create-checkout-session", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "https://gran-bar.webflow.io");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

    try {
        const { items, orderNumber, pickupDate, pickupTime, termsAccepted } = req.body;

        console.log("Dati ricevuti dal frontend:", req.body);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: items.map(item => ({
                price_data: {
                    currency: "eur",
                    product_data: { name: item.name },
                    unit_amount: Math.round(item.price * 100),
                },
                quantity: item.quantity,
            })),
            mode: "payment",
            metadata: {
                orderNumber,
                pickupDate,
                pickupTime,
                items: JSON.stringify(items),
                termsAccepted: termsAccepted,
            },
            success_url: "https://gran-bar.webflow.io/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: "https://gran-bar.webflow.io/cancel",
        });

        console.log("✅ Sessione creata:", session);
        res.json({ url: session.url });

    } catch (error) {
        console.error("❌ Errore nella creazione della sessione Stripe:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ **Rotta per recuperare la sessione Stripe e inviare dati a Airtable**
app.get("/checkout-session/:sessionId", async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        console.log("💳 Dati della sessione di pagamento:", session);

        // 📌 **Prendiamo nome ed email da Stripe**
        const customerName = session.customer_details?.name || "Nome non disponibile";
        const customerEmail = session.customer_details?.email || "Email non disponibile";

        // 📌 **Estrarre i dati della sessione**
        const orderData = {
            orderNumber: session.metadata.orderNumber,
            customerName,
            customerEmail,
            amountPaid: (session.amount_total / 100).toFixed(2),
            pickupDate: session.metadata.pickupDate,
            pickupTime: session.metadata.pickupTime,
            termsAccepted: session.metadata.termsAccepted || "Non specificato",
            items: JSON.parse(session.metadata.items),
        };

        console.log("📦 Dati ordine da inviare a Airtable:", orderData);

        // 📌 **Invia ogni prodotto come un record su Airtable**
        const airtableRecords = orderData.items.map(item => ({
            fields: {
                "Numero Ordine": orderData.orderNumber,
                "Nome Cliente": orderData.customerName,
                "Email Cliente": orderData.customerEmail,
                "Data Ritiro": orderData.pickupDate,
                "Orario di Ritiro": String(orderData.pickupTime),
                "Nome Prodotto": item.name,
                "Quantità": item.quantity,
                "Totale Pagamento": parseFloat(orderData.amountPaid),
                "Accettazione Termini": orderData.termsAccepted,
            }
        }));

        const airtableResponse = await fetch(AIRTABLE_URL, {
            method: "POST",
            headers: airtableHeaders,
            body: JSON.stringify({ records: airtableRecords }), // Invio multiplo
        });

        const airtableResult = await airtableResponse.json();
        console.log("📤 Dati inviati a Airtable:", airtableResult);

        if (airtableResult.error) {
            console.error("❌ Errore nell'invio ad Airtable:", airtableResult.error);
        }

        res.json(orderData); // ✅ Ritorniamo i dati alla pagina success

    } catch (error) {
        console.error("❌ Errore nel recupero della sessione o invio a Airtable:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ **Avvio del server**
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server in esecuzione su porta ${PORT}`);
});

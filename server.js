import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 10000;

// ✅ **Configurazione CORS dinamica**
const allowedOrigins = [
    "https://www.gran-bar.it",
    "https://gran-bar-6108bf3b205aa5d212cc988270c94b.webflow.io"
];

app.use((req, res, next) => {
    console.log("🌍 Richiesta ricevuta da:", req.headers.origin);
    next();
});

app.use(express.json());

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    next();
});

// 📌 **Configurazione Airtable**
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID;

const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

const airtableHeaders = {
    "Authorization": `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
};

// ✅ **Rotta di test per verificare il server**
app.get("/", (req, res) => {
    res.send("✅ Il server è attivo!");
});

// ✅ **Rotta per controllare la disponibilità della fascia oraria**
app.get("/check-availability/:pickupTime/:pickupDate", async (req, res) => {
    try {
        const { pickupTime, pickupDate } = req.params;

        console.log(`📊 Controllo disponibilità per il ${pickupDate} alle ${pickupTime}`);

        const airtableQuery = `${AIRTABLE_URL}?filterByFormula=AND({Data Ritiro}='${pickupDate}', {Orario di Ritiro}='${pickupTime}')`;

        const response = await fetch(airtableQuery, { headers: airtableHeaders });
        const data = await response.json();

        if (data.error) {
            console.error("❌ Errore nel recupero dati da Airtable:", data.error);
            return res.status(500).json({ error: data.error });
        }

        let totalProductsBooked = 0;
        data.records.forEach(record => {
            totalProductsBooked += record.fields["Quantità"] || 0;
        });

        const limitPerTimeSlot = {
            "9.00": 20, "9.30": 30, "10.00": 40, "10.30": 20,
            "11.00": 20, "11.30": 20, "12.00": 30, "12.30": 30, "13.00": 30,
        };

        const maxAllowed = limitPerTimeSlot[pickupTime] || 1000; 

        console.log(`📊 Totale prodotti prenotati: ${totalProductsBooked} / Limite: ${maxAllowed}`);

        res.json({
            pickupTime,
            pickupDate,
            totalProductsBooked,
            maxAllowed,
            available: totalProductsBooked < maxAllowed
        });

    } catch (error) {
        console.error("❌ Errore nel controllo disponibilità:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ **Rotta per creare la sessione Stripe**
app.post("/create-checkout-session", async (req, res) => {
    try {
        const { items, orderNumber, pickupDate, pickupTime, termsAccepted } = req.body;
        
        console.log("📦 Dati ricevuti dal frontend:", req.body);

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
                termsAccepted,
            },
            success_url: `https://gran-bar-6108bf3b205aa5d212cc988270c94b.webflow.io/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: "https://gran-bar-6108bf3b205aa5d212cc988270c94b.webflow.io/cancel",
        });

        console.log("✅ Sessione Stripe creata:", session.id);
        res.json({ url: session.url });

    } catch (error) {
        console.error("❌ Errore nella creazione della sessione Stripe:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ **Rotta per recuperare la sessione Stripe e inviare dati a Airtable**
app.get("/checkout-session/:sessionId", async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        console.log("🔍 Recupero sessione Stripe con ID:", sessionId);

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session) {
            throw new Error(`❌ Nessuna sessione trovata con ID: ${sessionId}`);
        }

        console.log("💳 Dati della sessione Stripe:", session);

        const customerName = session.customer_details?.name || "Nome non disponibile";
        const customerEmail = session.customer_details?.email || "Email non disponibile";

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

        console.log("📤 Dati da inviare a Airtable:", orderData);

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

        await fetch(AIRTABLE_URL, {
            method: "POST",
            headers: airtableHeaders,
            body: JSON.stringify({ records: airtableRecords }),
        });

        res.json(orderData);

    } catch (error) {
        console.error("❌ Errore nel recupero della sessione:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ **Avvio del server**
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server in esecuzione su porta ${PORT}`);
});

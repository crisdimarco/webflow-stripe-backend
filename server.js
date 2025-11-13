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
    origin: "https://www.gran-bar.it", // Sostituisci con il tuo dominio Webflow
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

// ✅ **Rotta per controllare la disponibilità della fascia oraria selezionata**
app.get("/check-availability/:pickupTime/:pickupDate", async (req, res) => {
    try {
        const { pickupTime, pickupDate } = req.params;

        console.log(`📊 Controllo disponibilità per il ${pickupDate} alle ${pickupTime}`);

        // 📌 **Filtra direttamente su Airtable solo gli ordini con la stessa data e orario**
        const airtableQuery = `${AIRTABLE_URL}?filterByFormula=AND({Data Ritiro}='${pickupDate}', {Orario di Ritiro}='${pickupTime}')`;
        
        const response = await fetch(airtableQuery, { headers: airtableHeaders });
        const data = await response.json();

        if (data.error) {
            console.error("❌ Errore nel recupero dati da Airtable:", data.error);
            return res.status(500).json({ error: data.error });
        }

        // 📌 **Calcola il numero totale di prodotti prenotati in quella fascia oraria**
        let totalProductsBooked = 0;
        data.records.forEach(record => {
            totalProductsBooked += record.fields["Quantità"] || 0;
        });

        // 📌 **Definisci i limiti per fascia oraria**
        const limitPerTimeSlot = {
            "9.00": 20,
            "9.30": 30,
            "10.00": 40,
            "10.30": 20,
            "11.00": 20,
            "11.30": 20,
            "12.00": 30,
            "12.30": 30,
            "13.00": 30,
        };

        const maxAllowed = limitPerTimeSlot[pickupTime] || 1000; // Default alto se non specificato

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


// ✅ Rotta per creare la sessione Stripe (versione unificata)
app.post("/create-checkout-session", async (req, res) => {
    // Abilita il CORS solo per il dominio ufficiale
    res.setHeader("Access-Control-Allow-Origin", "https://www.gran-bar.it");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

    try {
        // Accetta sia "items" (vecchio formato) che "cart" (nuovo per panettoni)
        const { items, cart, orderNumber, pickupDate, pickupTime, termsAccepted, successUrl } = req.body;

        console.log("📦 Dati ricevuti dal frontend:", req.body);

        // Usa la lista corretta di prodotti
        const productList = items || cart || [];

        if (productList.length === 0) {
            return res.status(400).json({ error: "Nessun prodotto nel carrello." });
        }

        // Mappa i prodotti per Stripe
        const lineItems = productList.map(item => ({
            price_data: {
                currency: "eur",
                product_data: { name: item.name },
                unit_amount: Math.round(
                    (item.discountedPrice && item.discountedPrice > 0)
                        ? item.discountedPrice * 100
                        : (item.price || item.deposit || 0) * 100
                ),
            },
            quantity: item.quantity || 1,
        }));

        // Crea la sessione Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: lineItems,
            mode: "payment",
            metadata: {
                orderNumber: orderNumber || `PN-${Math.floor(Math.random() * 100000)}`,
                pickupDate: pickupDate || "non richiesto",
                pickupTime: pickupTime || "non richiesto",
                items: JSON.stringify(productList),
                termsAccepted: termsAccepted || "non richiesti",
            },
            success_url: successUrl || "https://www.gran-bar.it/success-panettoni?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: "https://www.gran-bar.it/cancel",
        });

        console.log("✅ Sessione Stripe creata:", session.id);
        res.json({ url: session.url });

    } catch (error) {
        console.error("❌ Errore nella creazione sessione Stripe:", error);
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

// ✅ Rotta dedicata per la pagina success-panettoni
app.get("/checkout-session-panettoni/:sessionId", async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        console.log("📥 Richiesta dati panettoni per sessione:", sessionId);

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (!session) {
            return res.status(404).json({ error: "Sessione non trovata." });
        }

        // Ricava i dati
        const orderData = {
            orderNumber: session.metadata.orderNumber || null,
            customerName: session.customer_details?.name || null,
            customerEmail: session.customer_details?.email || null,
            totalPaid: session.amount_total
                ? (session.amount_total / 100).toFixed(2)
                : "0.00",
            items: session.metadata.items || "[]"
        };

        console.log("📦 Dati inviati al frontend:", orderData);

        res.json(orderData);

    } catch (error) {
        console.error("❌ ERRORE nella rotta panettoni:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ Recupera dati della sessione Stripe
app.get("/check-session", async (req, res) => {
  const { session_id } = req.query;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    res.json({
      orderNumber: session.metadata.orderNumber,
      items: session.metadata.items,
      pickupDate: session.metadata.pickupDate,
      pickupTime: session.metadata.pickupTime
    });
  } catch (error) {
    console.error("❌ Errore recupero sessione Stripe:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ **Avvio del server**
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server in esecuzione su porta ${PORT}`);
});

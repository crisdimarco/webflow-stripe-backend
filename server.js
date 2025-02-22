import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
const PORT = process.env.PORT || 10000;

// 📌 **Configurazione Airtable**
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = "appCH6ig8sj0rhYNQ"; // <-- ID della BASE
const AIRTABLE_TABLE_ID = "tbl6hct9wvRyEtt0S"; // <-- ID della TABELLA

const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

const airtableHeaders = {
    "Authorization": `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
};

// 📌 **Middleware**
app.use(cors());
// ✅ Express usa JSON per tutto tranne i Webhook
app.use((req, res, next) => {
    if (req.originalUrl === "/webhook") {
        next(); // Ignora il parsing JSON per i Webhook
    } else {
        express.json()(req, res, next);
    }
});


// ✅ **Rotta per creare la sessione Stripe**
app.post("/create-checkout-session", async (req, res) => {
    try {
        const { items, orderNumber, pickupDate, pickupTime } = req.body;

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
            },
            success_url: "https://gran-bar.webflow.io/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: "https://gran-bar.webflow.io/cancel",
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error("❌ Errore nella creazione della sessione:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ **Gestione Webhook Stripe**
import bodyParser from "body-parser";

// ATTENZIONE: SOLO per il Webhook usiamo il formato RAW
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    try {
        if (!sig || !webhookSecret) {
            throw new Error("Firma o segreto del webhook mancanti.");
        }

        // ✅ **Verifica della firma usando il corpo RAW**
        const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

        console.log("✅ Webhook ricevuto:", event.type);

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;

            // 📌 **Recuperiamo i dati dell'ordine**
            const customerName = session.customer_details?.name || "Nome non disponibile";
            const customerEmail = session.customer_details?.email || "Email non disponibile";

            const orderData = {
                orderNumber: session.metadata.orderNumber,
                customerName,
                customerEmail,
                amountPaid: (session.amount_total / 100).toFixed(2),
                pickupDate: session.metadata.pickupDate,
                pickupTime: session.metadata.pickupTime,
                items: JSON.parse(session.metadata.items),
            };

            console.log("📦 Dati ordine da inviare a Airtable via Webhook:", orderData);

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
                }
            }));

            const airtableResponse = await fetch(AIRTABLE_URL, {
                method: "POST",
                headers: airtableHeaders,
                body: JSON.stringify({ records: airtableRecords }), // Invio multiplo
            });

            const airtableResult = await airtableResponse.json();
            console.log("📤 Dati inviati a Airtable via Webhook:", airtableResult);

            if (airtableResult.error) {
                console.error("❌ Errore nell'invio ad Airtable via Webhook:", airtableResult.error);
            }
        }

        res.status(200).send("Webhook ricevuto correttamente!");
    } catch (err) {
        console.error("❌ Errore nel Webhook:", err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
    }
});


// ✅ **Avvio del server**
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server in esecuzione su porta ${PORT}`);
});

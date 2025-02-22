import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

// 📌 **Airtable Configurazione**
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = "appCH6ig8sj0rhYNQ/tbl6hct9wvRyEtt0S/viwUe48Eq2RWBK2jA?blocks=show";  // <-- Sostituisci con il tuo
const AIRTABLE_TABLE_NAME = "Ordini"; // <-- Sostituisci con il nome della tua tabella
const AIRTABLE_URL = `https://api.airtable.com/v0/${appCH6ig8sj0rhYNQ/tbl6hct9wvRyEtt0S/viwUe48Eq2RWBK2jA?blocks=show}/${Ordini}`;

const airtableHeaders = {
    "Authorization": `Bearer ${AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
};

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
            customerName: customerName,
            customerEmail: customerEmail,
            amountPaid: (session.amount_total / 100).toFixed(2),
            pickupDate: session.metadata.pickupDate,
            pickupTime: session.metadata.pickupTime,
            items: JSON.parse(session.metadata.items),
        };

        console.log("📦 Dati ordine da inviare a Airtable:", orderData);

        // 📌 **Invia ogni prodotto come un record su Airtable**
        for (const item of orderData.items) {
            const airtablePayload = {
                fields: {
                    "Numero Ordine": orderData.orderNumber,
                    "Nome Cliente": orderData.customerName,
                    "Email Cliente": orderData.customerEmail,
                    "Data Ritiro": orderData.pickupDate,
                    "Ora Ritiro": orderData.pickupTime,
                    "Nome Prodotto": item.name,
                    "Quantità": item.quantity,
                    "Prezzo": item.price,
                    "Totale": orderData.amountPaid,
                }
            };

            const airtableResponse = await fetch(AIRTABLE_URL, {
                method: "POST",
                headers: airtableHeaders,
                body: JSON.stringify(airtablePayload),
            });

            const airtableResult = await airtableResponse.json();
            console.log("📤 Dati inviati a Airtable:", airtableResult);
        }

        res.json(session);

    } catch (error) {
        console.error("❌ Errore nel recupero della sessione o invio a Airtable:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ **Avvio del server**
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server in esecuzione su porta ${PORT}`);
});

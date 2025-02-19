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

// ✅ TEST: Route per verificare se il server risponde
app.get("/", (req, res) => {
    res.send("✅ Il server è attivo su Render!");
});

app.get("/test", (req, res) => {
    res.json({ message: "✅ Il server è attivo e risponde correttamente!" });
});

// ✅ CREA SESSIONE STRIPE (senza nome ed email dal frontend)
app.post("/create-checkout-session", async (req, res) => {
    console.log("Dati ricevuti dal frontend:", req.body);
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
                orderNumber: orderNumber,
                pickupDate: pickupDate,
                pickupTime: pickupTime,
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

// ✅ RECUPERA I DETTAGLI DELLA SESSIONE DOPO IL PAGAMENTO
app.get("/checkout-session/:sessionId", async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        
        console.log("💳 Dati della sessione di pagamento:", session);

        // ✅ Prendiamo nome ed email direttamente da Stripe
        const customerName = session.customer_details?.name || "Nome non disponibile";
        const customerEmail = session.customer_details?.email || "Email non disponibile";

        // ✅ Creiamo un oggetto con i dati da inviare a Zapier
        const orderData = {
            orderNumber: session.metadata.orderNumber,
            customerName: customerName,
            customerEmail: customerEmail,
            amountPaid: (session.amount_total / 100).toFixed(2), // Converti centesimi in euro
            pickupDate: session.metadata.pickupDate,
            pickupTime: session.metadata.pickupTime,
            items: session.metadata.items,
        };

        console.log("📦 Dati da inviare a Zapier:", orderData);

        // ✅ Inviamo i dati a Zapier
        const zapierWebhookUrl = "https://hooks.zapier.com/hooks/catch/9094613/2wlj5gl/";
        const zapierResponse = await fetch(zapierWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderData),
        });

        const zapierResult = await zapierResponse.text();
        console.log("🚀 Risposta di Zapier:", zapierResult);

        res.json(session);
    } catch (error) {
        console.error("❌ Errore nel recupero della sessione:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ AVVIO DEL SERVER
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server in esecuzione su porta ${PORT}`);
});

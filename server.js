import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.use(express.json());
app.use(cors());

// ✅ Test del server
app.get("/", (req, res) => {
    res.send("✅ Il server è attivo su Render!");
});

app.get("/test", (req, res) => {
    res.json({ message: "✅ Il server è attivo e risponde correttamente!" });
});

// ✅ Creazione della sessione di pagamento con Stripe
app.post("/create-checkout-session", async (req, res) => {
    console.log("🛒 Dati ricevuti dal frontend:", req.body);
    try {
        const { items, orderNumber, pickupDate, pickupTime, customerName, customerEmail } = req.body;

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
                customerName: customerName,
                customerEmail: customerEmail,
                items: JSON.stringify(items)
            },
            success_url: "https://gran-bar.webflow.io/success?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: "https://gran-bar.webflow.io/cancel",
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error("❌ Errore nella creazione della sessione Stripe:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ Recupero della sessione di pagamento
app.get("/checkout-session/:sessionId", async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        console.log("💳 Dati della sessione di pagamento:", session);
        res.json(session);
    } catch (error) {
        console.error("❌ Errore nel recupero della sessione:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ Invio dei dati a Zapier
app.post("/send-to-zapier", async (req, res) => {
    try {
        console.log("📦 Dati ricevuti dal frontend per Zapier:", req.body);

        const zapierWebhookUrl = "https://hooks.zapier.com/hooks/catch/9094613/2wlj5gl/";

        const payload = {
            orderNumber: req.body.orderNumber,
            customerName: req.body.customerName, // ✅ Nome del cliente
            customerEmail: req.body.customerEmail,
            amountPaid: req.body.amountPaid,
            pickupDate: req.body.pickupDate,
            pickupTime: req.body.pickupTime,
            items: req.body.items
        };

        console.log("🚀 Dati inviati a Zapier:", payload);

        const response = await fetch(zapierWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const result = await response.text();
        console.log("✅ Risposta di Zapier:", result);

        res.json({ success: true, response: result });
    } catch (error) {
        console.error("❌ Errore nell'invio a Zapier:", error);
        res.status(500).json({ error: error.message });
    }
});

// ✅ Avvio del server su Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Il server è avviato e in ascolto sulla porta: ${PORT}`);
});

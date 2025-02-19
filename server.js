require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const fetch = require("node-fetch"); // Importazione corretta

const app = express();

app.use(express.json());
app.use(cors());

// Endpoint di test
app.get("/", (req, res) => {
    res.send("✅ Il server è attivo su Render!");
});

app.get("/test", (req, res) => {
    res.json({ message: "✅ Il server è attivo e risponde correttamente!" });
});

// Endpoint per inviare dati a Zapier
app.post("/send-to-zapier", async (req, res) => {
    try {
        console.log("Dati ricevuti dal frontend:", req.body);

        const zapierWebhookUrl = "https://hooks.zapier.com/hooks/catch/9094613/2wlj5gl/";

        const response = await fetch(zapierWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
        });

        const result = await response.text();
        console.log("Risposta di Zapier:", result);

        res.json({ success: true, response: result });
    } catch (error) {
        console.error("Errore nell'invio dei dati a Zapier:", error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint per creare una sessione di pagamento con Stripe
app.post("/create-checkout-session", async (req, res) => {
    console.log("Dati ricevuti dal frontend:", req.body);
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
        res.status(500).json({ error: error.message });
    }
});

// Endpoint per recuperare una sessione di pagamento
app.get("/checkout-session/:sessionId", async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        res.json(session);
    } catch (error) {
        console.error("Errore nel recupero della sessione:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server in esecuzione su porta ${PORT}`);
});

require("dotenv").config();
console.log("Stripe Secret Key:", process.env.STRIPE_SECRET_KEY);
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());
app.use(cors());

app.post("/create-checkout-session", async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: req.body.items.map(item => ({
        price_data: {
            currency: "eur",
            product_data: { name: item.name },
            unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
    })),
    mode: "payment",
    payment_intent_data: { capture_method: "automatic" }, // Forza la creazione del Payment Intent
    success_url: "https://gran-bar.webflow.io/success?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: "https://gran-bar.webflow.io/cancel",
});


        res.json({ id: session.id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server in esecuzione su porta ${PORT}`));


app.get("/checkout-session/:sessionId", async (req, res) => {
    try {
        console.log("Ricevuta richiesta per session ID:", req.params.sessionId);
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        console.log("Dati sessione ricevuti:", session);
        res.json(session);
    } catch (error) {
        console.error("Errore nel recupero della sessione:", error);
        res.status(500).json({ error: error.message });
    }
});


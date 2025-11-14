import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());

// CORS solo per il dominio Webflow
app.use(
  cors({
    origin: "https://www.gran-bar.it",
    methods: "GET,POST,OPTIONS",
    allowedHeaders: "Content-Type,Authorization",
    credentials: true,
  })
);

const PORT = process.env.PORT || 10000;

// ----------------------------
// 📌 CONFIGURAZIONE AIRTABLE
// ----------------------------
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID;

const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  "Content-Type": "application/json",
};

// ----------------------------------------------------
// ✅ CHECK DISPONIBILITÀ FASCE ORARIE (HOME)
// ----------------------------------------------------
app.get("/check-availability/:pickupTime/:pickupDate", async (req, res) => {
  try {
    const { pickupTime, pickupDate } = req.params;

    const airtableQuery = `${AIRTABLE_URL}?filterByFormula=AND({Data Ritiro}='${pickupDate}', {Orario di Ritiro}='${pickupTime}')`;

    const response = await fetch(airtableQuery, { headers: airtableHeaders });
    const data = await response.json();

    let totalProductsBooked = 0;
    data.records.forEach((record) => {
      totalProductsBooked += record.fields["Quantità"] || 0;
    });

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

    const maxAllowed = limitPerTimeSlot[pickupTime] || 1000;

    res.json({
      pickupTime,
      pickupDate,
      totalProductsBooked,
      maxAllowed,
      available: totalProductsBooked < maxAllowed,
    });
  } catch (error) {
    console.error("❌ Errore disponibilità:", error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// ✅ ROTTA UNIFICATA PER CHECKOUT (HOME + PANETTONI)
// ----------------------------------------------------
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { items, cart, successUrl } = req.body;

    const productList = cart || items || [];

    if (productList.length === 0) {
      return res.status(400).json({ error: "Carrello vuoto" });
    }

    console.log("📦 Prodotti ricevuti:", productList);

    // 💶 Acconto panettoni: 20€ fisso
    const lineItems = productList.map((item) => ({
      price_data: {
        currency: "eur",
        product_data: { name: item.name },
        unit_amount: 20 * 100,
      },
      quantity: item.quantity,
    }));

    const orderNumber = `PN-${Math.floor(100000 + Math.random() * 900000)}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      metadata: {
        orderNumber,
        items: JSON.stringify(productList),
      },
      success_url:
        successUrl ||
        "https://www.gran-bar.it/success-panettoni?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://www.gran-bar.it/cancel",
    });

    console.log("✅ Stripe session ID:", session.id);

    res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Errore Stripe:", error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// ✅ RECUPERA DATI DELLA SESSIONE (SUCCESS PANETTONI)
// ----------------------------------------------------
app.get("/checkout-session-panettoni/:sessionId", async (req, res) => {
  try {
    const sessionId = req.params.sessionId;

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Sessione non trovata" });
    }

    const response = {
      orderNumber: session.metadata.orderNumber,
      customerName: session.customer_details?.name || "",
      customerEmail: session.customer_details?.email || "",
      totalPaid: (session.amount_total / 100).toFixed(2),
      items: JSON.parse(session.metadata.items || "[]"),
    };

    console.log("📦 Dati ordine (success):", response);

    res.json(response);
  } catch (error) {
    console.error("❌ Errore sessione panettoni:", error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// ✅ INVIA ORDINE A AIRTABLE
// ----------------------------------------------------
app.get("/checkout-session/:sessionId", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);

    const customerName = session.customer_details?.name || "";
    const customerEmail = session.customer_details?.email || "";
    const items = JSON.parse(session.metadata.items);

    const orderData = {
      orderNumber: session.metadata.orderNumber,
      customerName,
      customerEmail,
      amountPaid: (session.amount_total / 100).toFixed(2),
      items,
    };

    console.log("📤 Invio ad Airtable:", orderData);

    const records = items.map((item) => ({
      fields: {
        "Numero Ordine": orderData.orderNumber,
        "Nome Cliente": orderData.customerName,
        "Email Cliente": orderData.customerEmail,
        "Nome Prodotto": item.name,
        "Quantità": item.quantity,
        "Totale Pagamento": item.deposit, // totale acconto di QUEL prodotto
        "Order Status": "Pending",
      },
    }));

    await fetch(AIRTABLE_URL, {
      method: "POST",
      headers: airtableHeaders,
      body: JSON.stringify({ records }),
    });

    res.json(orderData);
  } catch (error) {
    console.error("❌ Errore Airtable:", error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// ✅ VERIFICA ORDINE via QUERY (?order=...) – usato dal QR
// ----------------------------------------------------
app.get("/verify-order", async (req, res) => {
  try {
    const orderNumber = req.query.order;

    if (!orderNumber) {
      return res.status(400).json({ error: "Nessun ordine specificato" });
    }

    console.log("🔍 Verifica (QR) ordine:", orderNumber);

    const query = `${AIRTABLE_URL}?filterByFormula={Numero Ordine}='${orderNumber}'`;

    const response = await fetch(query, { headers: airtableHeaders });
    const data = await response.json();

    if (!data.records || data.records.length === 0) {
      return res.json({ exists: false });
    }

    const record = data.records[0];
    const status = record.fields["Order Status"] || "Pending";

    if (status === "verified") {
      return res.json({
        exists: true,
        alreadyVerified: true,
        order: record.fields,
      });
    }

    // Aggiorna TUTTE le righe di quell’ordine a "verified"
    const updates = data.records.map((r) => ({
      id: r.id,
      fields: { "Order Status": "verified" },
    }));

    await fetch(AIRTABLE_URL, {
      method: "PATCH",
      headers: airtableHeaders,
      body: JSON.stringify({ records: updates }),
    });

    return res.json({
      exists: true,
      alreadyVerified: false,
      order: record.fields,
    });
  } catch (error) {
    console.error("❌ Errore verifica ordine (QR):", error);
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// ✅ VERIFICA ORDINE via /verify-order/:orderNumber – usata dalla pagina Webflow
// ----------------------------------------------------
app.get("/verify-order/:orderNumber", async (req, res) => {
  try {
    const orderNumber = req.params.orderNumber;

    const queryUrl = `${AIRTABLE_URL}?filterByFormula={Numero Ordine}='${orderNumber}'`;

    const airtableRes = await fetch(queryUrl, { headers: airtableHeaders });
    const data = await airtableRes.json();

    if (!data.records || data.records.length === 0) {
      return res.json({ found: false });
    }

    // Prima riga = dati cliente
    const first = data.records[0].fields;

    // Lista prodotti
    const items = data.records.map((r) => ({
      name: r.fields["Nome Prodotto"],
      quantity: r.fields["Quantità"],
      deposit: r.fields["Totale Pagamento"], // valore per singola riga
    }));

    const totalPaid = items.reduce((t, r) => t + (r.deposit || 0), 0);

    const result = {
      found: true,
      orderNumber,
      customerName: first["Nome Cliente"],
      customerEmail: first["Email Cliente"],
      totalPaid,
      status: first["Order Status"] || "Pending",
      items,
    };

    res.json(result);
  } catch (err) {
    console.error("❌ ERRORE verify-order (pagina):", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// ✅ MARCA COME VERIFIED TUTTE LE RIGHE DI UN ORDINE
// ----------------------------------------------------
app.get("/verify-order-mark/:orderNumber", async (req, res) => {
  try {
    const orderNumber = req.params.orderNumber;

    const queryUrl = `${AIRTABLE_URL}?filterByFormula={Numero Ordine}='${orderNumber}'`;
    const data = await fetch(queryUrl, { headers: airtableHeaders }).then((r) =>
      r.json()
    );

    if (!data.records.length) {
      return res.json({ ok: false, error: "Ordine non trovato" });
    }

    const updates = data.records.map((rec) => ({
      id: rec.id,
      fields: { "Order Status": "verified" },
    }));

    await fetch(AIRTABLE_URL, {
      method: "PATCH",
      headers: airtableHeaders,
      body: JSON.stringify({ records: updates }),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Errore verify-order-mark:", err);
    res.json({ ok: false });
  }
});

// ----------------------------------------------------
// 🚀 AVVIO SERVER
// ----------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server attivo su porta ${PORT}`);
});

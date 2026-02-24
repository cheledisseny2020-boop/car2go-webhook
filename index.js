import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();

/**
 * Importante:
 * - Webhooks Shopify requieren raw body para validar HMAC.
 * - Para el resto de rutas usamos express.json().
 */

// ✅ Middleware JSON SOLO para rutas que NO sean /webhooks/*
app.use((req, res, next) => {
  if (req.path.startsWith("/webhooks/")) return next();
  return express.json()(req, res, next);
});

const { SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, APP_URL } = process.env;

// ✅ Ruta base
app.get("/", (req, res) => {
  res.send("Car2Go webhook server running");
});

/* ✅ TEST: confirma que SHOPIFY_ADMIN_TOKEN funciona contra Shopify */
app.get("/test-shopify", async (req, res) => {
  try {
    const store = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!store || !token) {
      return res.status(500).json({
        error: "Missing env variables",
        need: ["SHOPIFY_STORE", "SHOPIFY_ADMIN_TOKEN"],
      });
    }

    const r = await fetch(`https://${store}/admin/api/2024-01/shop.json`, {
      headers: { "X-Shopify-Access-Token": token },
    });

    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ✅ Step 1: iniciar OAuth
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing ?shop=");

  const scope = "read_products,write_products,read_orders";
  const redirectUri = `${APP_URL}/auth/callback`;

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_CLIENT_ID}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&shop=${encodeURIComponent(shop)}`; // recomendado

  return res.redirect(installUrl);
});

// ✅ Step 2: callback OAuth
app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).send("Missing shop/code");

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code,
    }),
  });

  await tokenRes.json();
  console.log("✅ OAuth OK");
  return res.send("✅ App instalada correctamente. (OAuth OK)");
});

// =========================
// ✅ WEBHOOKS
// =========================

// (solo debug) evita "Cannot GET" si lo abres en navegador:
app.get("/webhooks/orders-paid", (req, res) => {
  res.status(200).send("OK webhook endpoint (GET test)");
});

// ✅ Webhook real: Order payment -> POST /webhooks/orders-paid
app.post(
  "/webhooks/orders-paid",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      console.log("✅ Shopify webhook HIT:", req.path);

      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
      const hmac = req.get("X-Shopify-Hmac-Sha256");

      if (!secret) {
        console.log("❌ Missing SHOPIFY_WEBHOOK_SECRET");
        return res.status(500).send("Missing webhook secret");
      }

      const digest = crypto
        .createHmac("sha256", secret)
        .update(req.body)
        .digest("base64");

      const a = Buffer.from(digest, "utf8");
      const b = Buffer.from(String(hmac || ""), "utf8");
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

      if (!ok) {
        console.log("❌ Invalid HMAC");
        return res.status(401).send("Invalid HMAC");
      }

      console.log("✅ HMAC OK");

      // Por ahora: solo confirmamos recepción.
      // Luego aquí metemos lógica de bloqueo de fechas.
      return res.status(200).send("OK");
    } catch (e) {
      console.log("❌ Webhook error:", e.message);
      return res.status(500).send("Webhook error");
    }
  }
);

// ✅ Webhook prueba viejo (Order creation)
app.post("/webhooks/test", express.json(), (req, res) => {
  console.log("Webhook test recibido:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));

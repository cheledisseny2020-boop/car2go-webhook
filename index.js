import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();

/* =====================================================
   JSON middleware (excepto webhooks)
===================================================== */
app.use((req, res, next) => {
  if (req.path.startsWith("/webhooks/")) return next();
  return express.json()(req, res, next);
});

const { SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, APP_URL } = process.env;

/* =====================================================
   BASE
===================================================== */
app.get("/", (req, res) => {
  res.send("Car2Go webhook server running");
});

/* =====================================================
   TEST SHOPIFY TOKEN
===================================================== */
app.get("/test-shopify", async (req, res) => {
  try {
    const store = process.env.SHOPIFY_STORE;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    const r = await fetch(`https://${store}/admin/api/2024-01/shop.json`, {
      headers: { "X-Shopify-Access-Token": token },
    });

    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* =====================================================
   OAUTH
===================================================== */
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing ?shop=");

  const scope = "read_products,write_products,read_orders";
  const redirectUri = `${APP_URL}/auth/callback`;

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_CLIENT_ID}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return res.redirect(installUrl);
});

app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;

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
  res.send("App instalada correctamente");
});

/* =====================================================
   WEBHOOK TEST GET
===================================================== */
app.get("/webhooks/orders-paid", (req, res) => {
  res.send("Webhook endpoint OK");
});

/* =====================================================
   WEBHOOK REAL — ORDERS PAID
===================================================== */
app.post(
  "/webhooks/orders-paid",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      console.log("✅ Shopify webhook HIT");

      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
      const hmac = req.get("X-Shopify-Hmac-Sha256");

      const digest = crypto
        .createHmac("sha256", secret)
        .update(req.body)
        .digest("base64");

      if (digest !== hmac) {
        console.log("❌ HMAC inválido");
        return res.status(401).send("Invalid HMAC");
      }

      console.log("✅ HMAC OK");

      const payload = JSON.parse(req.body.toString("utf8"));

      const store = process.env.SHOPIFY_STORE;
      const token = process.env.SHOPIFY_ADMIN_TOKEN;

      for (const item of payload.line_items || []) {
        const props = item.properties || [];

        const start = props.find(p => p.name === "start")?.value;
        const end = props.find(p => p.name === "end")?.value;

        if (!start || !end) {
          console.log("⚠️ item sin fechas");
          continue;
        }

        const productId = item.product_id;

        console.log("📅 Reservando", start, "→", end);

        /* generar rango fechas */
        const dates = [];
        let d = new Date(start);
        const last = new Date(end);

        while (d <= last) {
          dates.push(d.toISOString().split("T")[0]);
          d.setDate(d.getDate() + 1);
        }

        /* leer metafield existente */
        const mfRes = await fetch(
          `https://${store}/admin/api/2024-01/products/${productId}/metafields.json`,
          {
            headers: { "X-Shopify-Access-Token": token },
          }
        );

        const mfData = await mfRes.json();

        const existing = mfData.metafields?.find(
          m => m.namespace === "booking" && m.key === "unavailable_dates"
        );

        let current = [];

        if (existing?.value) {
          try {
            current = JSON.parse(existing.value);
          } catch {}
        }

        /* merge sin duplicados */
        const merged = [...new Set([...current, ...dates])];

        console.log("📦 Guardando fechas:", merged);

        if (existing) {
          await fetch(
            `https://${store}/admin/api/2024-01/metafields/${existing.id}.json`,
            {
              method: "PUT",
              headers: {
                "X-Shopify-Access-Token": token,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                metafield: {
                  id: existing.id,
                  value: JSON.stringify(merged),
                  type: "json",
                },
              }),
            }
          );
        } else {
          await fetch(
            `https://${store}/admin/api/2024-01/products/${productId}/metafields.json`,
            {
              method: "POST",
              headers: {
                "X-Shopify-Access-Token": token,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                metafield: {
                  namespace: "booking",
                  key: "unavailable_dates",
                  value: JSON.stringify(merged),
                  type: "json",
                },
              }),
            }
          );
        }
      }

      res.status(200).send("Dates saved");
    } catch (err) {
      console.log("❌ Error webhook:", err);
      res.status(500).send("Server error");
    }
  }
);

/* =====================================================
   TEST WEBHOOK MANUAL
===================================================== */
app.post(
  "/webhooks/test",
  express.raw({ type: "application/json" }),
  (req, res) => {
    console.log("TEST WEBHOOK BODY:");
    console.log(req.body.toString());
    res.sendStatus(200);
  }
);

/* =====================================================
   START SERVER
===================================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));

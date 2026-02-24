import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const {
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  APP_URL
} = process.env;

// ✅ Ruta base
app.get("/", (req, res) => {
  res.send("Car2Go webhook server running");
});

/* ✅ TEST: confirma que SHOPIFY_ADMIN_TOKEN funciona contra Shopify */
app.get("/test-shopify", async (req, res) => {
  try {
    const store = process.env.SHOPIFY_STORE; // ej: car2go-2.myshopify.com
    const token = process.env.SHOPIFY_ADMIN_TOKEN; // ej: shpat_...

    if (!store || !token) {
      return res.status(500).json({
        error: "Missing env variables",
        need: ["SHOPIFY_STORE", "SHOPIFY_ADMIN_TOKEN"]
      });
    }

    const r = await fetch(`https://${store}/admin/api/2024-01/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": token
      }
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
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return res.redirect(installUrl);
});

// ✅ Step 2: callback OAuth (obtiene access_token)
app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;

  if (!shop || !code) return res.status(400).send("Missing shop/code");

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code
    })
  });

  const data = await tokenRes.json();

  // ✅ No imprimimos el token en logs (seguridad)
  console.log("✅ OAuth OK");

  // Nota: este access_token NO lo estamos guardando aquí.
  // Para producción, se guarda en DB/KV por tienda.
  return res.send("✅ App instalada correctamente. (OAuth OK)");
});

// ✅ Webhook prueba
app.post("/webhooks/test", (req, res) => {
  console.log("Webhook recibido:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));

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

  console.log("✅ ACCESS TOKEN:", data.access_token);

  // Ojo: por ahora solo lo mostramos en logs.
  // Luego lo guardamos (DB / KV / file / etc).
  return res.send("✅ App instalada correctamente. Revisa los logs en Render.");
});

// ✅ Webhook prueba
app.post("/webhooks/test", (req, res) => {
  console.log("Webhook recibido:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));

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

      /* =====================================================
         RECORRER ITEMS
      ===================================================== */
      for (const item of payload.line_items || []) {

        const props = item.properties || [];

        /* detectar fechas flexible */
        const start = props.find(p => /start|retiro/i.test(p.name))?.value;
        const end   = props.find(p => /end|devol/i.test(p.name))?.value;

        if (!start || !end) {
          console.log("⚠️ item sin fechas", props);
          continue;
        }

        const productId = item.product_id;

        console.log("📅 Reservando", start, "→", end, "producto", productId);

        /* =====================================================
           GENERAR RANGO FECHAS
        ===================================================== */
        const dates = [];
        let d = new Date(start);
        const last = new Date(end);

        while (d <= last) {
          dates.push(d.toISOString().split("T")[0]);
          d.setDate(d.getDate() + 1);
        }

        /* =====================================================
           LEER METAFIELD ACTUAL
        ===================================================== */
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

        /* =====================================================
           MERGE SIN DUPLICADOS
        ===================================================== */
        const merged = [...new Set([...current, ...dates])];

        console.log("📦 Guardando fechas:", merged);

        /* =====================================================
           GUARDAR METAFIELD
        ===================================================== */
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

      return res.status(200).send("Dates saved");

    } catch (err) {
      console.log("❌ Error webhook:", err);
      return res.status(500).send("Server error");
    }
  }
);

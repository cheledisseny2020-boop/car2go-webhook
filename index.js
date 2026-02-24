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
        const propsRaw = item.properties || {};
        let start = "";
        let end = "";

        // 1) Si Shopify lo manda como ARRAY [{name,value}]
        if (Array.isArray(propsRaw)) {
          start =
            propsRaw.find(p => /^(start|retiro)$/i.test(p?.name))?.value ||
            propsRaw.find(p => /start|retiro/i.test(p?.name))?.value ||
            "";
          end =
            propsRaw.find(p => /^(end|devolución|devolucion)$/i.test(p?.name))?.value ||
            propsRaw.find(p => /end|devol/i.test(p?.name))?.value ||
            "";
        }
        // 2) Si Shopify lo manda como OBJETO {start:"", end:"", "Retiro":"", "Devolución":""}
        else if (propsRaw && typeof propsRaw === "object") {
          start =
            propsRaw.start ||
            propsRaw.Start ||
            propsRaw.Retiro ||
            propsRaw["Retiro"] ||
            propsRaw.retiro ||
            propsRaw["retiro"] ||
            "";
          end =
            propsRaw.end ||
            propsRaw.End ||
            propsRaw.Devolución ||
            propsRaw["Devolución"] ||
            propsRaw.Devolucion ||
            propsRaw["Devolucion"] ||
            propsRaw.devolucion ||
            propsRaw["devolucion"] ||
            "";
        }

        if (!start || !end) {
          console.log("⚠️ item sin fechas | properties:", propsRaw);
          continue;
        }

        const productId = item.product_id;
        console.log("📅 Reservando", start, "→", end, "producto", productId);

        // Generar rango (incluye start y end)
        const dates = [];
        let d = new Date(`${start}T00:00:00`);
        const last = new Date(`${end}T00:00:00`);

        while (d <= last) {
          dates.push(d.toISOString().split("T")[0]);
          d.setDate(d.getDate() + 1);
        }

        // Leer metafield actual
        const mfRes = await fetch(
          `https://${store}/admin/api/2024-01/products/${productId}/metafields.json`,
          { headers: { "X-Shopify-Access-Token": token } }
        );

        const mfData = await mfRes.json();
        const existing = mfData.metafields?.find(
          m => m.namespace === "booking" && m.key === "unavailable_dates"
        );

        let current = [];
        if (existing?.value) {
          try { current = JSON.parse(existing.value); } catch {}
        }

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

      return res.status(200).send("Dates saved");
    } catch (err) {
      console.log("❌ Error webhook:", err);
      return res.status(500).send("Server error");
    }
  }
);

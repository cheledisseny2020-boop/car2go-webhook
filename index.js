/* =====================================================
   HELPERS (HMAC + fechas + metafield)
===================================================== */
function verifyShopifyHmac(req) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hmac = req.get("X-Shopify-Hmac-Sha256");

  const digest = crypto
    .createHmac("sha256", secret)
    .update(req.body)
    .digest("base64");

  return digest === hmac;
}

function extractDatesFromProps(propsRaw) {
  let start = "";
  let end = "";

  // 1) ARRAY [{name,value}]
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
  // 2) OBJETO {start:"", end:"", "Retiro":"", "Devolución":""}
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

  return { start, end };
}

function buildDateRange(start, end) {
  const dates = [];
  const d = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);

  if (Number.isNaN(d.getTime()) || Number.isNaN(last.getTime())) return [];

  const cur = new Date(d);
  while (cur <= last) {
    dates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/* =====================================================
   METAFIELD: custom.booked_ranges  ✅
===================================================== */
async function getUnavailableDates(store, token, productId) {
  const mfRes = await fetch(
    `https://${store}/admin/api/2024-01/products/${productId}/metafields.json`,
    { headers: { "X-Shopify-Access-Token": token } }
  );

  const mfData = await mfRes.json();

  // ✅ ahora usamos el metafield real del storefront:
  // custom.booked_ranges
  const existing = mfData.metafields?.find(
    m => m.namespace === "custom" && m.key === "booked_ranges"
  );

  let current = [];
  if (existing?.value) {
    try { current = JSON.parse(existing.value); } catch {}
  }
  if (!Array.isArray(current)) current = [];

  return { existing, current };
}

async function saveUnavailableDates(store, token, existing, productId, nextArray) {
  const value = JSON.stringify(nextArray);

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
            value,
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
            // ✅ ahora guardamos en custom.booked_ranges
            namespace: "custom",
            key: "booked_ranges",
            value,
            type: "json",
          },
        }),
      }
    );
  }
}

/* =====================================================
   WEBHOOK REAL — ORDERS PAID (BLOQUEAR FECHAS)
===================================================== */
app.post(
  "/webhooks/orders-paid",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      console.log("✅ orders/paid HIT");

      if (!verifyShopifyHmac(req)) {
        console.log("❌ HMAC inválido (paid)");
        return res.status(401).send("Invalid HMAC");
      }
      console.log("✅ HMAC OK (paid)");

      const payload = JSON.parse(req.body.toString("utf8"));
      const store = process.env.SHOPIFY_STORE;
      const token = process.env.SHOPIFY_ADMIN_TOKEN;

      for (const item of payload.line_items || []) {
        const propsRaw = item.properties || {};
        const { start, end } = extractDatesFromProps(propsRaw);

        if (!start || !end) {
          console.log("⚠️ item sin fechas | properties:", propsRaw);
          continue;
        }

        const productId = item.product_id;
        console.log("📅 Bloqueando", start, "→", end, "producto", productId);

        const dates = buildDateRange(start, end);
        if (!dates.length) continue;

        const { existing, current } = await getUnavailableDates(store, token, productId);

        const merged = [...new Set([...current, ...dates])];
        console.log("📦 Guardando fechas:", merged);

        await saveUnavailableDates(store, token, existing, productId, merged);
      }

      return res.status(200).send("Dates saved");
    } catch (err) {
      console.log("❌ Error orders-paid:", err);
      return res.status(500).send("Server error");
    }
  }
);

/* =====================================================
   WEBHOOK — ORDERS CANCELLED (LIBERAR FECHAS)
===================================================== */
app.post(
  "/webhooks/orders-cancelled",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      console.log("🟠 orders/cancelled HIT");

      if (!verifyShopifyHmac(req)) {
        console.log("❌ HMAC inválido (cancelled)");
        return res.status(401).send("Invalid HMAC");
      }
      console.log("✅ HMAC OK (cancelled)");

      const payload = JSON.parse(req.body.toString("utf8"));
      const store = process.env.SHOPIFY_STORE;
      const token = process.env.SHOPIFY_ADMIN_TOKEN;

      for (const item of payload.line_items || []) {
        const propsRaw = item.properties || {};
        const { start, end } = extractDatesFromProps(propsRaw);

        if (!start || !end) {
          console.log("⚠️ cancel: item sin fechas");
          continue;
        }

        const productId = item.product_id;
        const toRemove = buildDateRange(start, end);
        if (!toRemove.length) continue;

        const { existing, current } = await getUnavailableDates(store, token, productId);

        const removeSet = new Set(toRemove);
        const next = current.filter(d => !removeSet.has(d));

        console.log("🧹 Liberando", toRemove.length, "fechas en producto", productId);

        await saveUnavailableDates(store, token, existing, productId, next);
      }

      return res.status(200).send("Dates released");
    } catch (err) {
      console.log("❌ Error orders-cancelled:", err);
      return res.status(500).send("Server error");
    }
  }
);

/* =====================================================
   WEBHOOK — REFUNDS CREATE (LIBERAR FECHAS POR REEMBOLSO)
===================================================== */
app.post(
  "/webhooks/refunds-create",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      console.log("🟣 refunds/create HIT");

      if (!verifyShopifyHmac(req)) {
        console.log("❌ HMAC inválido (refunds)");
        return res.status(401).send("Invalid HMAC");
      }
      console.log("✅ HMAC OK (refunds)");

      const payload = JSON.parse(req.body.toString("utf8"));
      const store = process.env.SHOPIFY_STORE;
      const token = process.env.SHOPIFY_ADMIN_TOKEN;

      const refundItems = payload.refund_line_items || [];
      for (const rli of refundItems) {
        const item = rli.line_item;
        if (!item) continue;

        const propsRaw = item.properties || {};
        const { start, end } = extractDatesFromProps(propsRaw);

        if (!start || !end) {
          console.log("⚠️ refund: item sin fechas");
          continue;
        }

        const productId = item.product_id;
        const toRemove = buildDateRange(start, end);
        if (!toRemove.length) continue;

        const { existing, current } = await getUnavailableDates(store, token, productId);

        const removeSet = new Set(toRemove);
        const next = current.filter(d => !removeSet.has(d));

        console.log("🧹 Refund libera", toRemove.length, "fechas en producto", productId);

        await saveUnavailableDates(store, token, existing, productId, next);
      }

      return res.status(200).send("Refund dates released");
    } catch (err) {
      console.log("❌ Error refunds-create:", err);
      return res.status(500).send("Server error");
    }
  }
);

/* ===================== /C2G WEBHOOKS ===================== */

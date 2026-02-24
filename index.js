const store = process.env.SHOPIFY_STORE;
const token = process.env.SHOPIFY_ADMIN_TOKEN;

for (const item of payload.line_items || []) {
  const props = item.properties || [];

  const start = props.find(p => p.name === "start")?.value;
  const end = props.find(p => p.name === "end")?.value;

  if (!start || !end) {
    console.log("⚠️ item sin fechas", item.id);
    continue;
  }

  const productId = item.product_id;

  console.log("📅 Reservando", start, "→", end, "producto", productId);

  // generar rango fechas
  const dates = [];
  let d = new Date(start);
  const last = new Date(end);

  while (d <= last) {
    dates.push(d.toISOString().split("T")[0]);
    d.setDate(d.getDate() + 1);
  }

  // leer metafield actual
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

  // unir fechas sin duplicados
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

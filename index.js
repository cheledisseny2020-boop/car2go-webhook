import express from "express";

const app = express();
app.use(express.json());

// Ruta base para comprobar que el servidor funciona
app.get("/", (req, res) => {
  res.send("Car2Go webhook server running");
});

// Endpoint webhook prueba
app.post("/webhooks/test", (req, res) => {
  console.log("Webhook recibido:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));

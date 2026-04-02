const express = require("express");
const cors = require("cors");
const path = require("path");
const apiRoutes = require("./routes");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "..", "frontend", "public")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "mediloop-backend" });
});

app.use("/api", apiRoutes);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "frontend", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Mediloop backend escuchando en puerto ${PORT}`);
});


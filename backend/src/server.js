const express = require("express");
const cors = require("cors");
const path = require("path");
const apiRoutes = require("./routes");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "..", "frontend", "public"), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    }
  }
}));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "mediloop-backend" });
});

app.use("/api", apiRoutes);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "frontend", "public", "index.html"));
});

// 404 catch-all
app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ message: "Ruta no encontrada" });
  }
  res.status(404).sendFile(path.join(__dirname, "..", "..", "frontend", "public", "404.html"));
});

app.listen(PORT, () => {
  console.log(`Mediloop backend escuchando en puerto ${PORT}`);
});


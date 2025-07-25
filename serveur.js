const express = require("express");
const dotenv = require("dotenv");
const { initializePresenceTracking } = require("./services/presenceService");
require("./config/db");

dotenv.config();

const app = express();

// Middleware minimal
app.use(express.json());

// Route santé pour vérifier que le serveur fonctionne
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", message: "Serveur de suivi de présence en cours d'exécution" });
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Une erreur est survenue", error: err.message });
});

// Démarrer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
  // Initialiser le suivi de présence en arrière-plan
  initializePresenceTracking();
});
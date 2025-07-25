const mongoose = require("mongoose");

const presenceSchema = new mongoose.Schema({
  employe_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employe' },
  date: String,
  heure_arrivee: String,
  heure_depart: String,
  created_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Presence", presenceSchema);

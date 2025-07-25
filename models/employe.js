const mongoose = require("mongoose");

const employeSchema = new mongoose.Schema({
  nom: String,
  mac_address: { type: String, unique: true },
  poste: String,
});

module.exports = mongoose.model("Employe", employeSchema);

const mongoose = require("mongoose");

mongoose.connect("mongodb://192.168.2.52:27017/presence_wifi", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

module.exports = mongoose;

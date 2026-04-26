const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

mongoose.connect("MONGO_URL=mongodb://atlas-sql-69ee08b8a25dbc0359f74e25-gw0snx.a.query.mongodb.net/sample_mflix?ssl=true&authSource=admin")
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log(err));

// serve frontend
app.use(express.static(path.join(__dirname, "public")));

// home route (optional now)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});

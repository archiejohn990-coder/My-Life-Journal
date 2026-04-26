const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// serve frontend folder
app.use(express.static(path.join(__dirname, "public")));

// homepage (SAFE)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// start server
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});

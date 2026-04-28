const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// CONNECT MONGODB
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

/* =========================
   SCHEMAS
========================= */

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
});

const journalSchema = new mongoose.Schema({
  userId: String,
  title: String,
  content: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Journal = mongoose.model("Journal", journalSchema);

/* =========================
   USER ROUTES
========================= */

// SIGNUP
app.post("/signup", async (req, res) => {
  try {
    const user = new User(req.body);
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LOGIN (simple version)
app.post("/login", async (req, res) => {
  try {
    const user = await User.findOne(req.body);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   FRIEND SYSTEM
========================= */

app.post("/add-friend", async (req, res) => {
  try {
    const { userId, friendId } = req.body;

    await User.findByIdAndUpdate(userId, {
      $push: { friends: friendId }
    });

    res.json({ message: "Friend added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   JOURNAL SYSTEM
========================= */

app.post("/journal", async (req, res) => {
  try {
    const journal = new Journal(req.body);
    await journal.save();
    res.json(journal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/journals/:userId", async (req, res) => {
  try {
    const journals = await Journal.find({ userId: req.params.userId });
    res.json(journals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   SERVER START
========================= */

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});

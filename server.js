const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Your MongoDB Atlas Connection String
const MONGO_URL = "mongodb+srv://Archie:Archie1225@cluster0.7e4s845.mongodb.net/myjournal?retryWrites=true&w=majority";

// Connect to MongoDB Atlas
mongoose.connect(MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ Connected to MongoDB Atlas!"))
.catch(err => console.error("❌ MongoDB Connection Error:", err));

/* =========================
   SCHEMAS
========================= */

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  pinHash: { type: String, required: true },
  kdfSalt: { type: String, required: true },
  pinSalt: { type: String, required: true },
  photo: { type: String, default: null },
  encryptedVault: {
    iv: { type: String, default: "" },
    data: { type: String, default: "" }
  },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  friendRequests: [{
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    fromEmail: { type: String },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
  }],
  lastSync: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const sharedEntrySchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  to: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  fromEmail: { type: String, required: true },
  toEmail: { type: String, required: true },
  title: { type: String, default: "" },
  body: { type: String, default: "" },
  mood: { type: String, default: "" },
  date: { type: String, default: "" },
  image: { type: String, default: null },
  tags: [{ type: String }],
  sharedAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const User = mongoose.model("User", userSchema);
const SharedEntry = mongoose.model("SharedEntry", sharedEntrySchema);

function cleanUser(user) {
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    photo: user.photo,
    kdfSalt: user.kdfSalt,
    encryptedVault: user.encryptedVault,
    lastSync: user.lastSync
  };
}

/* =========================
   API ROUTES
========================= */

// Signup
app.post("/api/signup", async (req, res) => {
  try {
    const { email, name, passwordHash, pinHash, kdfSalt, pinSalt, photo, encryptedVault } = req.body;
    
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }
    
    const user = new User({
      email: email.toLowerCase(),
      name,
      passwordHash,
      pinHash,
      kdfSalt,
      pinSalt,
      photo: photo || null,
      encryptedVault: encryptedVault || { iv: "", data: "" }
    });
    
    await user.save();
    res.json(cleanUser(user));
    
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error during signup" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { email, passwordHash, pinHash } = req.body;
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    if (user.passwordHash !== passwordHash || user.pinHash !== pinHash) {
      return res.status(401).json({ error: "Invalid email, password, or PIN" });
    }
    
    user.lastSync = new Date();
    await user.save();
    
    res.json(cleanUser(user));
    
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// Update user
app.post("/api/user/update", async (req, res) => {
  try {
    const { email, encryptedVault, photo, name } = req.body;
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (encryptedVault) user.encryptedVault = encryptedVault;
    if (photo !== undefined) user.photo = photo;
    if (name) user.name = name;
    user.lastSync = new Date();
    
    await user.save();
    res.json({ message: "User updated", user: cleanUser(user) });
    
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Server error during update" });
  }
});

// Sync pull
app.post("/api/sync/pull", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json({
      encryptedVault: user.encryptedVault,
      lastSync: user.lastSync
    });
  } catch (err) {
    res.status(500).json({ error: "Pull failed" });
  }
});

// Sync push
app.post("/api/sync/push", async (req, res) => {
  try {
    const { email, encryptedVault } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    user.encryptedVault = encryptedVault;
    user.lastSync = new Date();
    await user.save();
    
    res.json({ message: "Changes pushed successfully", lastSync: user.lastSync });
  } catch (err) {
    res.status(500).json({ error: "Push failed" });
  }
});

// Friend request
app.post("/api/friends/request", async (req, res) => {
  try {
    const { userEmail, friendEmail } = req.body;
    
    const user = await User.findOne({ email: userEmail.toLowerCase() });
    const friend = await User.findOne({ email: friendEmail.toLowerCase() });
    
    if (!user || !friend) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (user._id.equals(friend._id)) {
      return res.status(400).json({ error: "Cannot add yourself" });
    }
    
    if (user.friends.includes(friend._id)) {
      return res.status(400).json({ error: "Already friends" });
    }
    
    const existingRequest = friend.friendRequests.find(
      req => req.from.toString() === user._id.toString() && req.status === 'pending'
    );
    
    if (existingRequest) {
      return res.status(400).json({ error: "Friend request already sent" });
    }
    
    friend.friendRequests.push({ 
      from: user._id, 
      fromEmail: user.email,
      status: 'pending' 
    });
    await friend.save();
    
    res.json({ message: "Friend request sent" });
    
  } catch (err) {
    console.error("Friend request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get friends list
app.post("/api/friends/list", async (req, res) => {
  try {
    const { userEmail } = req.body;
    
    const user = await User.findOne({ email: userEmail.toLowerCase() })
      .populate('friends', 'email name photo');
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json({ friends: user.friends });
    
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Share entry
app.post("/api/share", async (req, res) => {
  try {
    const { fromEmail, toEmail, title, body, mood, date, image, tags } = req.body;
    
    const fromUser = await User.findOne({ email: fromEmail.toLowerCase() });
    const toUser = await User.findOne({ email: toEmail.toLowerCase() });
    
    if (!fromUser || !toUser) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (!fromUser.friends.includes(toUser._id)) {
      return res.status(403).json({ error: "Not friends with this user" });
    }
    
    const sharedEntry = new SharedEntry({
      from: fromUser._id,
      to: toUser._id,
      fromEmail: fromEmail.toLowerCase(),
      toEmail: toEmail.toLowerCase(),
      title: title || "",
      body: body || "",
      mood: mood || "",
      date: date || "",
      image: image || null,
      tags: tags || []
    });
    
    await sharedEntry.save();
    res.json({ message: "Entry shared successfully" });
    
  } catch (err) {
    console.error("Share error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get shared inbox
app.post("/api/shared/inbox", async (req, res) => {
  try {
    const { userEmail } = req.body;
    
    const sharedEntries = await SharedEntry.find({ toEmail: userEmail.toLowerCase() })
      .sort({ sharedAt: -1 });
    
    res.json({ shared: sharedEntries });
    
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/* =========================
   STATIC FILES - Fixed for Express 4.x
========================= */

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Catch-all route to serve index.html (for client-side routing)
app.get("*", (req, res) => {
  // Don't interfere with API routes
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`📁 Frontend served from /public folder`);
});

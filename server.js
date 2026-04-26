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

// MongoDB Connection
const MONGO_URL = process.env.MONGO_URL || "mongodb+srv://Archie:Archie1225@cluster0.7e4s845.mongodb.net/myjournal?retryWrites=true&w=majority";

mongoose.connect(MONGO_URL)
  .then(() => console.log("✅ Connected to MongoDB Atlas!"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

/* =========================
   SCHEMAS
========================= */

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
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

// Shared Entry Schema
const sharedEntrySchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fromEmail: { type: String, required: true, index: true },
  toEmail: { type: String, required: true, index: true },
  title: { type: String, default: "" },
  body: { type: String, default: "" },
  mood: { type: String, default: "" },
  date: { type: String, default: "" },
  image: { type: String, default: null },
  tags: [{ type: String }],
  sharedAt: { type: Date, default: Date.now, index: true },
  read: { type: Boolean, default: false }
});

const User = mongoose.model("User", userSchema);
const SharedEntry = mongoose.model("SharedEntry", sharedEntrySchema);

/* =========================
   HELPER FUNCTIONS
========================= */

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
   AUTH ROUTES
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
    console.log(`✅ New user created: ${email}`);
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
    
    console.log(`✅ User logged in: ${email}`);
    res.json(cleanUser(user));
    
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// Find user by email (returns salts only for login)
app.post("/api/user/find", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // Only return what's needed for login (salts)
    res.json({
      email: user.email,
      kdfSalt: user.kdfSalt,
      pinSalt: user.pinSalt
    });
  } catch (err) {
    console.error("Find user error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update user data
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
    
    console.log(`✅ User updated: ${email}`);
    res.json({ 
      message: "User updated",
      user: cleanUser(user)
    });
    
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Server error during update" });
  }
});

/* =========================
   FRIEND SYSTEM ROUTES
========================= */

// Send friend request
app.post("/api/friends/request", async (req, res) => {
  try {
    const { userEmail, friendEmail } = req.body;
    
    const user = await User.findOne({ email: userEmail.toLowerCase() });
    const friend = await User.findOne({ email: friendEmail.toLowerCase() });
    
    if (!user || !friend) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (user._id.toString() === friend._id.toString()) {
      return res.status(400).json({ error: "Cannot add yourself" });
    }
    
    // Check if already friends
    if (user.friends.includes(friend._id)) {
      return res.status(400).json({ error: "Already friends" });
    }
    
    // Check if request already exists
    const existingRequest = friend.friendRequests.find(
      req => req.from.toString() === user._id.toString() && req.status === 'pending'
    );
    
    if (existingRequest) {
      return res.status(400).json({ error: "Friend request already sent" });
    }
    
    // Add friend request
    friend.friendRequests.push({ 
      from: user._id, 
      fromEmail: user.email,
      status: 'pending',
      createdAt: new Date()
    });
    await friend.save();
    
    console.log(`✅ Friend request sent: ${user.email} -> ${friend.email}`);
    res.json({ message: "Friend request sent" });
    
  } catch (err) {
    console.error("Friend request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Accept friend request
app.post("/api/friends/accept", async (req, res) => {
  try {
    const { userEmail, requestId } = req.body;
    
    const user = await User.findOne({ email: userEmail.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const request = user.friendRequests.id(requestId);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }
    
    request.status = 'accepted';
    
    // Add to user's friends list
    user.friends.push(request.from);
    await user.save();
    
    // Add to requester's friends list
    const requester = await User.findById(request.from);
    if (requester && !requester.friends.includes(user._id)) {
      requester.friends.push(user._id);
      await requester.save();
    }
    
    console.log(`✅ Friend request accepted: ${userEmail}`);
    res.json({ message: "Friend request accepted" });
    
  } catch (err) {
    console.error("Accept friend error:", err);
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
    console.error("Get friends error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get pending friend requests
app.post("/api/friends/requests", async (req, res) => {
  try {
    const { userEmail } = req.body;
    
    const user = await User.findOne({ email: userEmail.toLowerCase() })
      .populate('friendRequests.from', 'email name photo');
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const pendingRequests = user.friendRequests.filter(req => req.status === 'pending');
    res.json({ requests: pendingRequests });
    
  } catch (err) {
    console.error("Get requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   SHARING ROUTES
========================= */

// Share entry with friend
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
    
    console.log(`✅ Entry shared: ${fromEmail} -> ${toEmail}`);
    res.json({ message: "Entry shared successfully", id: sharedEntry._id });
    
  } catch (err) {
    console.error("Share error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get shared entries (inbox)
app.post("/api/shared/inbox", async (req, res) => {
  try {
    const { userEmail } = req.body;
    
    const sharedEntries = await SharedEntry.find({ toEmail: userEmail.toLowerCase() })
      .sort({ sharedAt: -1 });
    
    res.json({ shared: sharedEntries });
    
  } catch (err) {
    console.error("Get inbox error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   SYNC ROUTES
========================= */

// Pull latest data from server
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
    console.error("Pull error:", err);
    res.status(500).json({ error: "Pull failed" });
  }
});

// Push local changes to server
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
    
    console.log(`✅ Sync push from: ${email}`);
    res.json({ 
      message: "Changes pushed successfully",
      lastSync: user.lastSync
    });
  } catch (err) {
    console.error("Push error:", err);
    res.status(500).json({ error: "Push failed" });
  }
});

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  res.json({ 
    status: "ok", 
    db: dbStatus,
    timestamp: new Date().toISOString()
  });
});

/* =========================
   STATIC FILES & FRONTEND
========================= */

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Serve index.html for all other routes (SPA support)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`📁 Frontend served from /public folder`);
});

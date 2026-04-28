const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, "public")));

// MongoDB Connection
const MONGO_URL = process.env.MONGO_URL || "mongodb+srv://Archie:Archie1225@cluster0.7e4s845.mongodb.net/myjournal?retryWrites=true&w=majority";

mongoose.connect(MONGO_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// ==================== SCHEMAS ====================

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  pinHash: { type: String, required: true },
  photo: { type: String, default: null },
  onlineStatus: { type: String, default: "offline" },
  lastSeen: { type: Date, default: Date.now },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now }
});

const journalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, default: "" },
  body: { type: String, default: "" },
  mood: { type: String, default: "😐 Neutral" },
  tags: [{ type: String }],
  date: { type: String, required: true },
  image: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const friendRequestSchema = new mongoose.Schema({
  fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  toUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const sharedEntrySchema = new mongoose.Schema({
  fromUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  toUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  entryId: { type: mongoose.Schema.Types.ObjectId, ref: "Journal" },
  title: String,
  body: String,
  mood: String,
  date: String,
  tags: [String],
  image: String,
  sharedAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Journal = mongoose.model("Journal", journalSchema);
const FriendRequest = mongoose.model("FriendRequest", friendRequestSchema);
const SharedEntry = mongoose.model("SharedEntry", sharedEntrySchema);

// ==================== MIDDLEWARE ====================

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key-change-this");
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token." });
  }
};

// ==================== AUTH ROUTES ====================

app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password, pin } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const pinHash = await bcrypt.hash(pin, 10);
    
    const user = new User({
      name,
      email,
      passwordHash,
      pinHash,
      onlineStatus: "online",
      lastSeen: new Date()
    });
    
    await user.save();
    
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || "your-secret-key-change-this",
      { expiresIn: "7d" }
    );
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        onlineStatus: user.onlineStatus
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password, pin } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    const validPin = await bcrypt.compare(pin, user.pinHash);
    
    if (!validPassword || !validPin) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    
    user.onlineStatus = "online";
    user.lastSeen = new Date();
    await user.save();
    
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || "your-secret-key-change-this",
      { expiresIn: "7d" }
    );
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        photo: user.photo,
        onlineStatus: user.onlineStatus
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== JOURNAL ROUTES ====================

app.post("/api/journal/create", authenticateToken, async (req, res) => {
  try {
    const { title, mood, date, tags, body, image } = req.body;
    
    const journal = new Journal({
      userId: req.userId,
      title: title || "",
      body: body || "",
      mood: mood || "😐 Neutral",
      tags: tags || [],
      date: date || new Date().toISOString().slice(0, 10),
      image: image || null
    });
    
    await journal.save();
    res.json({ success: true, entry: journal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/journal/list", authenticateToken, async (req, res) => {
  try {
    const entries = await Journal.find({ userId: req.userId }).sort({ date: -1, createdAt: -1 });
    res.json({ success: true, entries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/journal/get/:id", authenticateToken, async (req, res) => {
  try {
    const entry = await Journal.findOne({ _id: req.params.id, userId: req.userId });
    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }
    res.json({ success: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/journal/update/:id", authenticateToken, async (req, res) => {
  try {
    const { title, mood, date, tags, body, image } = req.body;
    
    const entry = await Journal.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      {
        title: title || "",
        body: body || "",
        mood: mood || "😐 Neutral",
        tags: tags || [],
        date: date || new Date().toISOString().slice(0, 10),
        image: image || null,
        updatedAt: new Date()
      },
      { new: true }
    );
    
    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }
    
    res.json({ success: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/journal/delete/:id", authenticateToken, async (req, res) => {
  try {
    const entry = await Journal.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== FRIEND ROUTES ====================

app.post("/api/friends/request", authenticateToken, async (req, res) => {
  try {
    const { toUserEmail } = req.body;
    
    const toUser = await User.findOne({ email: toUserEmail });
    if (!toUser) {
      return res.status(404).json({ error: "User not found" });
    }
    
    if (toUser._id.toString() === req.userId) {
      return res.status(400).json({ error: "Cannot send friend request to yourself" });
    }
    
    const fromUser = await User.findById(req.userId);
    if (fromUser.friends.includes(toUser._id)) {
      return res.status(400).json({ error: "Already friends with this user" });
    }
    
    const existingRequest = await FriendRequest.findOne({
      fromUser: req.userId,
      toUser: toUser._id,
      status: "pending"
    });
    
    if (existingRequest) {
      return res.status(400).json({ error: "Friend request already sent" });
    }
    
    const request = new FriendRequest({
      fromUser: req.userId,
      toUser: toUser._id,
      status: "pending"
    });
    
    await request.save();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/friends/requests", authenticateToken, async (req, res) => {
  try {
    const requests = await FriendRequest.find({
      toUser: req.userId,
      status: "pending"
    }).populate("fromUser", "name email photo");
    
    res.json({
      requests: requests.map(req => ({
        id: req._id,
        fromEmail: req.fromUser.email,
        fromName: req.fromUser.name,
        fromPhoto: req.fromUser.photo
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/friends/accept", authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.body;
    
    const request = await FriendRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }
    
    if (request.toUser.toString() !== req.userId) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    request.status = "accepted";
    await request.save();
    
    await User.findByIdAndUpdate(request.fromUser, {
      $addToSet: { friends: request.toUser }
    });
    await User.findByIdAndUpdate(request.toUser, {
      $addToSet: { friends: request.fromUser }
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/friends/unfriend", authenticateToken, async (req, res) => {
  try {
    const { friendId } = req.body;
    
    await User.findByIdAndUpdate(req.userId, {
      $pull: { friends: friendId }
    });
    await User.findByIdAndUpdate(friendId, {
      $pull: { friends: req.userId }
    });
    
    await FriendRequest.deleteMany({
      $or: [
        { fromUser: req.userId, toUser: friendId, status: "accepted" },
        { fromUser: friendId, toUser: req.userId, status: "accepted" }
      ]
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/friends/list", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate("friends", "name email photo onlineStatus lastSeen");
    
    res.json({
      friends: user.friends.map(friend => ({
        id: friend._id,
        name: friend.name,
        email: friend.email,
        photo: friend.photo,
        onlineStatus: friend.onlineStatus,
        lastSeen: friend.lastSeen
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== STATUS ROUTES ====================

app.post("/api/status/update", authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    
    await User.findByIdAndUpdate(req.userId, {
      onlineStatus: status,
      lastSeen: new Date()
    });
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== SHARING ROUTES ====================

app.post("/api/share/entry", authenticateToken, async (req, res) => {
  try {
    const { toUserEmail, entryId } = req.body;
    
    const toUser = await User.findOne({ email: toUserEmail });
    if (!toUser) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const entry = await Journal.findOne({ _id: entryId, userId: req.userId });
    if (!entry) {
      return res.status(404).json({ error: "Entry not found" });
    }
    
    const sharedEntry = new SharedEntry({
      fromUser: req.userId,
      toUser: toUser._id,
      entryId: entry._id,
      title: entry.title,
      body: entry.body,
      mood: entry.mood,
      date: entry.date,
      tags: entry.tags,
      image: entry.image
    });
    
    await sharedEntry.save();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/shared/inbox", authenticateToken, async (req, res) => {
  try {
    const shared = await SharedEntry.find({ toUser: req.userId })
      .populate("fromUser", "name email photo")
      .sort({ sharedAt: -1 });
    
    res.json({
      shared: shared.map(item => ({
        id: item._id,
        fromEmail: item.fromUser.email,
        fromName: item.fromUser.name,
        title: item.title,
        body: item.body,
        mood: item.mood,
        date: item.date,
        tags: item.tags,
        image: item.image,
        sharedAt: item.sharedAt
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== USER PHOTO ROUTE ====================

app.put("/api/user/photo", authenticateToken, async (req, res) => {
  try {
    const { photo } = req.body;
    await User.findByIdAndUpdate(req.userId, { photo });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/user/delete", authenticateToken, async (req, res) => {
  try {
    await Journal.deleteMany({ userId: req.userId });
    await FriendRequest.deleteMany({ $or: [{ fromUser: req.userId }, { toUser: req.userId }] });
    await SharedEntry.deleteMany({ $or: [{ fromUser: req.userId }, { toUser: req.userId }] });
    await User.findByIdAndDelete(req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== HEALTH CHECK ====================

app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// ==================== SERVE FRONTEND ====================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Open http://localhost:${PORT}`);
});

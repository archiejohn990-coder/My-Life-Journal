const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const MONGO_URL = process.env.MONGO_URL || "mongodb+srv://Archie:Archie1225@cluster0.7e4s845.mongodb.net/myjournal?retryWrites=true&w=majority";

mongoose.connect(MONGO_URL)
  .then(() => console.log("✅ Connected to MongoDB Atlas!"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// ==================== SCHEMAS ====================
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  pinHash: { type: String, required: true },
  kdfSalt: { type: String, required: true },
  pinSalt: { type: String, required: true },
  photo: { type: String, default: null },
  encryptedVault: { iv: { type: String, default: "" }, data: { type: String, default: "" } },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  friendRequests: [{
    from: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    fromEmail: { type: String },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
  }],
  failedAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastSync: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

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

function bytesToB64(bytes) { let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin); }
async function sha256(str) { const enc = new TextEncoder().encode(str); const hash = await crypto.subtle.digest("SHA-256", enc); return bytesToB64(new Uint8Array(hash)); }

function cleanUser(user) {
  return { id: user._id, email: user.email, name: user.name, photo: user.photo, kdfSalt: user.kdfSalt, encryptedVault: user.encryptedVault, lastSync: user.lastSync };
}

// ==================== AUTH ROUTES ====================
app.post("/api/signup", async (req, res) => {
  try {
    const { email, name, passwordHash, pinHash, kdfSalt, pinSalt, photo, encryptedVault } = req.body;
    if (!email || !name || !passwordHash || !pinHash || !kdfSalt || !pinSalt) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) return res.status(400).json({ error: "Email already registered" });
    const user = new User({ email: email.toLowerCase(), name, passwordHash, pinHash, kdfSalt, pinSalt, photo: photo || null, encryptedVault: encryptedVault || { iv: "", data: "" } });
    await user.save();
    res.json(cleanUser(user));
  } catch (err) { res.status(500).json({ error: "Server error: " + err.message }); }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, passwordHash, pinHash } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    if (user.lockedUntil && new Date() < user.lockedUntil) return res.status(401).json({ error: "Account locked. Try again later." });
    if (user.passwordHash !== passwordHash || user.pinHash !== pinHash) {
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      if (user.failedAttempts >= 5) { user.lockedUntil = new Date(Date.now() + 15 * 60000); user.failedAttempts = 0; }
      await user.save();
      return res.status(401).json({ error: "Invalid credentials" });
    }
    user.failedAttempts = 0; user.lockedUntil = null; user.lastSync = new Date();
    await user.save();
    res.json(cleanUser(user));
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/user/find", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ email: user.email, kdfSalt: user.kdfSalt, pinSalt: user.pinSalt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/user/update", async (req, res) => {
  try {
    const { email, encryptedVault, photo, name } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (encryptedVault) user.encryptedVault = encryptedVault;
    if (photo !== undefined) user.photo = photo;
    if (name) user.name = name;
    user.lastSync = new Date();
    await user.save();
    res.json({ message: "User updated", user: cleanUser(user) });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/recover", async (req, res) => {
  try {
    const { email, name, newPassword, newPin } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "Account not found" });
    if (user.name.toLowerCase() !== name.toLowerCase()) return res.status(401).json({ error: "Name does not match" });
    let message = "Account updated: ";
    if (newPassword && newPassword.length >= 8) {
      const newKdfSalt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
      const newPasswordHash = await sha256(newPassword + "|" + newKdfSalt);
      user.passwordHash = newPasswordHash; user.kdfSalt = newKdfSalt; user.encryptedVault = { iv: "", data: "" };
      message += "Password changed. ";
    }
    if (newPin && newPin.length === 6) {
      const newPinSalt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
      const newPinHash = await sha256(newPin + "|" + newPinSalt);
      user.pinHash = newPinHash; user.pinSalt = newPinSalt;
      message += "PIN changed. ";
    }
    user.failedAttempts = 0; user.lockedUntil = null;
    await user.save();
    res.json({ message: message + "You can now log in." });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ==================== FRIEND ROUTES ====================
app.post("/api/friends/request", async (req, res) => {
  try {
    const { userEmail, friendEmail } = req.body;
    const user = await User.findOne({ email: userEmail.toLowerCase() });
    const friend = await User.findOne({ email: friendEmail.toLowerCase() });
    if (!user || !friend) return res.status(404).json({ error: "User not found" });
    if (user._id.toString() === friend._id.toString()) return res.status(400).json({ error: "Cannot add yourself" });
    if (user.friends.includes(friend._id)) return res.status(400).json({ error: "Already friends" });
    const existingRequest = friend.friendRequests.find(req => req.from.toString() === user._id.toString() && req.status === 'pending');
    if (existingRequest) return res.status(400).json({ error: "Request already sent" });
    friend.friendRequests.push({ from: user._id, fromEmail: user.email, status: 'pending', createdAt: new Date() });
    await friend.save();
    res.json({ message: "Friend request sent" });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/friends/accept", async (req, res) => {
  try {
    const { userEmail, requestId } = req.body;
    const user = await User.findOne({ email: userEmail.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found" });
    const request = user.friendRequests.id(requestId);
    if (!request) return res.status(404).json({ error: "Request not found" });
    request.status = 'accepted';
    user.friends.push(request.from);
    await user.save();
    const requester = await User.findById(request.from);
    if (requester && !requester.friends.includes(user._id)) { requester.friends.push(user._id); await requester.save(); }
    res.json({ message: "Friend request accepted" });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/friends/list", async (req, res) => {
  try {
    const { userEmail } = req.body;
    const user = await User.findOne({ email: userEmail.toLowerCase() }).populate('friends', 'email name photo');
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ friends: user.friends });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/friends/requests", async (req, res) => {
  try {
    const { userEmail } = req.body;
    const user = await User.findOne({ email: userEmail.toLowerCase() }).populate('friendRequests.from', 'email name photo');
    if (!user) return res.status(404).json({ error: "User not found" });
    const pendingRequests = user.friendRequests.filter(req => req.status === 'pending');
    res.json({ requests: pendingRequests });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/friends/unfriend", async (req, res) => {
  try {
    const { userEmail, friendId } = req.body;
    const user = await User.findOne({ email: userEmail.toLowerCase() });
    const friend = await User.findById(friendId);
    if (!user || !friend) return res.status(404).json({ error: "User not found" });
    user.friends = user.friends.filter(id => id.toString() !== friendId);
    await user.save();
    friend.friends = friend.friends.filter(id => id.toString() !== user._id.toString());
    await friend.save();
    res.json({ message: "Unfriended successfully" });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ==================== SHARING ROUTES ====================
app.post("/api/share", async (req, res) => {
  try {
    const { fromEmail, toEmail, title, body, mood, date, image, tags } = req.body;
    const fromUser = await User.findOne({ email: fromEmail.toLowerCase() });
    const toUser = await User.findOne({ email: toEmail.toLowerCase() });
    if (!fromUser || !toUser) return res.status(404).json({ error: "User not found" });
    if (!fromUser.friends.includes(toUser._id)) return res.status(403).json({ error: "Not friends" });
    const sharedEntry = new SharedEntry({ from: fromUser._id, to: toUser._id, fromEmail: fromEmail.toLowerCase(), toEmail: toEmail.toLowerCase(), title, body, mood, date, image, tags });
    await sharedEntry.save();
    res.json({ message: "Entry shared successfully" });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/api/shared/inbox", async (req, res) => {
  try {
    const { userEmail } = req.body;
    const sharedEntries = await SharedEntry.find({ toEmail: userEmail.toLowerCase() }).sort({ sharedAt: -1 });
    res.json({ shared: sharedEntries });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// ==================== SYNC ROUTES ====================
app.post("/api/sync/pull", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ encryptedVault: user.encryptedVault, lastSync: user.lastSync });
  } catch (err) { res.status(500).json({ error: "Pull failed" }); }
});

app.post("/api/sync/push", async (req, res) => {
  try {
    const { email, encryptedVault } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found" });
    user.encryptedVault = encryptedVault;
    user.lastSync = new Date();
    await user.save();
    res.json({ message: "Changes pushed successfully", lastSync: user.lastSync });
  } catch (err) { res.status(500).json({ error: "Push failed" }); }
});

app.get("/api/health", (req, res) => { res.json({ status: "ok", timestamp: new Date().toISOString() }); });

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => { res.sendFile(path.join(__dirname, "public", "index.html")); });

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
});

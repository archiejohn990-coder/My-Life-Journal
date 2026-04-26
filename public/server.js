const express = require("express");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const USERS_FILE = "users.json";

// read users
function readUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, "[]");
  }
  return JSON.parse(fs.readFileSync(USERS_FILE));
}

// write users
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// TEST
const path = require("path");

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "source_original.html"), (err) => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(500).send("Error loading page");
    }
  });
});
// REGISTER
app.post("/api/register", (req, res) => {
  const { email, password, pin } = req.body;

  db.run(
    "INSERT INTO users (email, password_hash, pin) VALUES (?, ?, ?)",
    [email, password, pin],
    function (err) {
      if (err) {
        return res.json({ success: false, error: err.message });
      }
      res.json({ success: true });
    }
  );
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  let users = readUsers();

  const user = users.find(u => u.email === email && u.password === password);

  if (!user) {
    return res.json({ success: false });
  }

  res.json({ success: true, user });
});

// START SERVER
  app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
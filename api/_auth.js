// api/_auth.js — JWT creation and verification helpers

const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "polycoach-jwt-secret";

function createToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "24h" });
}

function verifyToken(req) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function requireUser(req, res) {
  // For regular users — just return true (book form on frontend is the gate)
  return true;
}

function requireAdmin(req, res) {
  const payload = verifyToken(req);
  if (!payload || payload.role !== "admin") {
    res.status(403).json({ success: false, message: "Admin only." });
    return null;
  }
  return payload;
}

// Standard CORS + JSON headers for all API responses
function setHeaders(res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

module.exports = { createToken, verifyToken, requireUser, requireAdmin, setHeaders };

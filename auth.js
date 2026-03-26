const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "adora-dev-secret";

function signToken(user) {
  const payload = { id: user.id, role: user.role };
  const phone = user.phone != null ? String(user.phone).trim() : "";
  const email = user.email != null ? String(user.email).trim() : "";
  if (phone) payload.phone = phone;
  if (email) payload.email = email;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/** يضبط req.user عند وجود Bearer صالح؛ وإلا يتابع بدون مصادقة (لطلبات عامة اختياريًا مرتبطة بحساب) */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  const payload = verifyToken(token);
  if (payload) req.user = payload;
  return next();
}

function requireAdmin(req, res, next) {
  const role = String(req.user?.role ?? "").trim().toLowerCase();
  if (!req.user || role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  return next();
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_e) {
    return null;
  }
}

module.exports = { signToken, requireAuth, requireAdmin, verifyToken, optionalAuth };

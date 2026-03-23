const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "adora-dev-secret";

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, phone: user.phone }, JWT_SECRET, {
    expiresIn: "7d",
  });
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

module.exports = { signToken, requireAuth, requireAdmin, verifyToken };

require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { all, get, run, initDb, getDatabaseOverview } = require("./db");
const http = require("http");
const { Server } = require("socket.io");
const { signToken, requireAuth, requireAdmin, verifyToken, optionalAuth } = require("./auth");
const { isWebPushConfigured, sanitizeHttpsUrl, notifyInAppRow } = require("./push-notify");
const { registerMarketplaceRoutes } = require("./marketplace-routes");
const { registerVendorPlatformRoutes } = require("./vendor-platform-routes");
const { getVendorPlatformSettings } = require("./vendor-platform-settings");
const { isEmailTransportConfigured, sendSignupOtpEmail } = require("./email-signup-mail");

const SIGNUP_SEND_COOLDOWN_MS = 45 * 1000;
const SIGNUP_RESEND_COOLDOWN_MS = 60 * 1000;
const SIGNUP_OTP_TTL_MS = 5 * 60 * 1000;

function hashEmailOtp(code) {
  const pepper = String(process.env.OTP_PEPPER || process.env.JWT_SECRET || "adora-otp-dev");
  return crypto.createHmac("sha256", pepper).update(String(code).trim()).digest("hex");
}

function verifyEmailOtp(code, storedHash) {
  const h = hashEmailOtp(code);
  let a;
  let b;
  try {
    a = Buffer.from(h, "hex");
    b = Buffer.from(String(storedHash || ""), "hex");
  } catch (_e) {
    return false;
  }
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** للتشخيص: مستخدم مؤهل لاستلام بث Push (إشعارات مفعّلة وليس في فترة كتم) */
function sqlPushUserEligible() {
  return `(COALESCE(u.notifications_enabled, 0) = 1 AND (u.notifications_snoozed_until IS NULL OR TRIM(COALESCE(u.notifications_snoozed_until::text, '')) = '' OR (u.notifications_snoozed_until)::timestamptz <= NOW()))`;
}
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

/** رابط إشعار: https كامل أو مسار داخل التطبيق يبدأ بـ / */
function normalizeNotificationLink(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > 2048) return null;
  if (s.startsWith("/")) {
    if (s.includes("..")) return null;
    return s;
  }
  return sanitizeHttpsUrl(s);
}

if (isProd) {
  app.set("trust proxy", 1);
}

/** CORS يتطلب أصلاً كاملاً مثل https://example.com — إن وُضع example.com فقط نضيف https:// */
function normalizeCorsOriginEntry(entry) {
  let s = String(entry ?? "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s.replace(/^\/+/, "")}`;
  }
  return s;
}

function parseCorsOriginEnv(raw) {
  return String(raw ?? "")
    .split(",")
    .map((x) => normalizeCorsOriginEntry(x))
    .filter(Boolean);
}

function corsOptions() {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || !String(raw).trim()) {
    return { origin: true, credentials: true };
  }
  const list = parseCorsOriginEnv(raw);
  if (!list.length) {
    return { origin: true, credentials: true };
  }
  return { origin: list.length === 1 ? list[0] : list, credentials: true };
}

app.use(cors(corsOptions()));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
/* static files registered after all /api routes so paths like /api/* are never swallowed */

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES) || 10 * 1024 * 1024 },
});

function isCloudinaryConfigured() {
  const url = process.env.CLOUDINARY_URL;
  if (url && String(url).trim()) return true;
  const n = process.env.CLOUDINARY_CLOUD_NAME;
  const k = process.env.CLOUDINARY_API_KEY;
  const s = process.env.CLOUDINARY_API_SECRET;
  return !!(n && k && s && String(n).trim() && String(k).trim() && String(s).trim());
}

function initCloudinary() {
  if (!isCloudinaryConfigured()) return;
  if (process.env.CLOUDINARY_URL && String(process.env.CLOUDINARY_URL).trim()) {
    cloudinary.config({ secure: true });
  } else {
    cloudinary.config({
      cloud_name: String(process.env.CLOUDINARY_CLOUD_NAME).trim(),
      api_key: String(process.env.CLOUDINARY_API_KEY).trim(),
      api_secret: String(process.env.CLOUDINARY_API_SECRET).trim(),
      secure: true,
    });
  }
}
initCloudinary();
if (isCloudinaryConfigured()) {
  // eslint-disable-next-line no-console
  console.log("[Adora] Image uploads: Cloudinary only (no /uploads on server)");
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "[Adora] Cloudinary is not configured — POST /api/upload/image will fail until CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME+API_KEY+API_SECRET is set."
  );
}

function uploadBufferToCloudinary(buffer) {
  const folderRaw = process.env.CLOUDINARY_FOLDER || "adora";
  const folder = String(folderRaw).trim().replace(/^\/+|\/+$/g, "") || "adora";
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: "image" }, (err, result) => {
      if (err) return reject(err);
      if (!result?.secure_url) return reject(new Error("Cloudinary returned no URL"));
      resolve(String(result.secure_url));
    });
    stream.end(buffer);
  });
}

const DEFAULT_HOME_SECTIONS_VISIBILITY = {
  banners: true,
  comprehensive_market: true,
  main_categories: true,
  brands: true,
  top_brands: true,
  flash_sale: true,
  curated: true,
  promo_collection: true,
  bestsellers: true,
};

/** Labels for admin UI + `/api/admin/home-sections/keys` — keep keys in sync with DEFAULT_HOME_SECTIONS_VISIBILITY */
const HOME_SECTION_LABELS = {
  banners: { ar: "البانرات الترويجية (كل المواضع)", en: "Promo banners (all slots)" },
  comprehensive_market: { ar: "السوق الشامل (مولات وشركات…)", en: "Comprehensive market (malls & companies)" },
  main_categories: { ar: "الأقسام الرئيسية (رجالي / نسائي / ولادي)", en: "Main categories (Men / Women / Kids)" },
  brands: { ar: "صف الشركات", en: "Brands row" },
  top_brands: { ar: "أفضل الشركات", en: "Top brands" },
  flash_sale: { ar: "عروض سريعة", en: "Flash sale" },
  curated: { ar: "اختيارات أنيقة", en: "Curated picks" },
  promo_collection: { ar: "شريط المجموعة الترويجية / وصل حديثاً", en: "Promo collection / New collection strip" },
  bestsellers: { ar: "الأكثر مبيعاً", en: "Bestsellers" },
};

function mergeHomeSectionsVisibility(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const out = { ...DEFAULT_HOME_SECTIONS_VISIBILITY };
  for (const k of Object.keys(out)) {
    if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = Boolean(o[k]);
  }
  return out;
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch (err) {
    return fallback;
  }
}

/** يطابق placement مع عناصر banner-slot-* في الواجهة */
function normalizeBannerPlacementValue(pl) {
  let s = String(pl ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  if (!s) return "";
  const aliases = {
    hometop: "home_top",
    top: "home_top",
    belowcategories: "below_categories",
    belowbrands: "below_brands",
    belowtopbrands: "below_top_brands",
    belowflash: "below_flash",
    belowcurated: "below_curated",
    belowtrending: "below_trending",
  };
  return aliases[s] || s;
}

/** الرقم التالي بصيغة ORD-00001 — متسلسل من قاعدة البيانات */
async function allocateNextOrderNo() {
  const row = await get(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(order_no FROM 5) AS INTEGER)), 0) AS n
     FROM orders
     WHERE order_no LIKE 'ORD-%' AND SUBSTRING(order_no FROM 5) ~ '^[0-9]+$'`
  );
  const next = Number(row?.n ?? 0) + 1;
  return `ORD-${String(next).padStart(5, "0")}`;
}

/** منتجات أدورا: بدون علامة أو علامة أدورا (للأقسام الرئيسية على الرئيسية) */
function sqlAdoraBrandPredicate() {
  return `(brand IS NULL OR TRIM(brand) = '' OR LOWER(TRIM(brand)) IN ('adora','adoura') OR TRIM(brand) = 'أدورا')`;
}

/** توحيد نص البحث العربي (تشكيل، همزات) — للمطابقة مع أسماء المخزن */
function normalizeArabicSearchQuery(q) {
  let t = String(q || "").trim();
  if (!t) return t;
  t = t.replace(/\u0640/g, "");
  t = t.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  t = t.replace(/[\u0622\u0623\u0625]/g, "\u0627");
  return t.replace(/\s+/g, " ").trim();
}

/** ه/ة ونص منطقي: يطابق «كنزه» من الصوت مع «كنزة» في قاعدة البيانات */
function arabicSearchQueryVariants(q) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const set = new Set();
  set.add(raw);
  const norm = normalizeArabicSearchQuery(raw);
  if (norm) set.add(norm);
  if (/ه$/.test(raw)) set.add(raw.slice(0, -1) + "\u0629");
  if (/ة$/.test(raw)) set.add(raw.slice(0, -1) + "\u0647");
  if (norm && /ه$/.test(norm)) set.add(norm.slice(0, -1) + "\u0629");
  if (norm && /ة$/.test(norm)) set.add(norm.slice(0, -1) + "\u0647");
  return [...set].filter(Boolean);
}

async function decrementMarketplaceStock(marketplaceProductId, qty) {
  const id = Number(marketplaceProductId);
  if (!Number.isFinite(id) || qty <= 0) return;
  await run(
    `UPDATE marketplace_products SET stock = GREATEST(0, COALESCE(stock,0) - ?), sales_count = COALESCE(sales_count,0) + ? WHERE id=?`,
    [qty, qty, id]
  );
}

async function decrementProductStock(productId, qty, size, color) {
  const pid = Number(productId);
  if (!Number.isFinite(pid) || qty <= 0) return;
  const p = await get(`SELECT stock, inventory_json FROM products WHERE id=?`, [pid]);
  if (!p) return;
  let inv = safeJsonParse(p.inventory_json, []);
  if (!Array.isArray(inv)) inv = [];
  const sz = size != null ? String(size).trim().toLowerCase() : "";
  const cl = color != null ? String(color).trim().toLowerCase() : "";
  let idx = -1;
  if (inv.length > 0 && (sz || cl)) {
    idx = inv.findIndex((row) => {
      const rs = String(row.size || "").trim().toLowerCase();
      const rc = String(row.color || "").trim().toLowerCase();
      const szMatch = !sz || rs === sz;
      const clMatch = !cl || rc === cl;
      return szMatch && clMatch;
    });
  }
  if (idx >= 0) {
    const row = inv[idx];
    const cur = Number(row.stock || 0);
    const next = Math.max(0, cur - qty);
    inv[idx] = { ...row, stock: next };
    await run(`UPDATE products SET inventory_json=? WHERE id=?`, [JSON.stringify(inv), pid]);
  } else {
    await run(`UPDATE products SET stock = COALESCE(stock, 0) - ? WHERE id=?`, [qty, pid]);
  }
}

function mapProductRow(p) {
  if (!p) return p;
  const { inventory_json, ...rest } = p;
  return {
    ...rest,
    inventory: safeJsonParse(inventory_json, []),
  };
}

/** إرسال رمز التحقق للبريد — إنشاء حساب فقط بعد /api/auth/signup/verify */
app.post("/api/auth/signup/send-code", async (req, res) => {
  try {
    if (!isEmailTransportConfigured()) {
      return res.status(503).json({
        error: "Email delivery is not configured on the server (EMAIL_HOST, EMAIL_USER, EMAIL_PASS)",
      });
    }
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    const norm = email.toLowerCase();
    const existing = await get(`SELECT id FROM users WHERE LOWER(TRIM(email)) = ?`, [norm]);
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const row = await get(`SELECT last_sent_at FROM pending_email_signups WHERE email_normalized=?`, [norm]);
    const nowMs = Date.now();
    if (row && row.last_sent_at) {
      const last = new Date(row.last_sent_at).getTime();
      if (last > nowMs - SIGNUP_SEND_COOLDOWN_MS) {
        const retry_after_sec = Math.ceil((SIGNUP_SEND_COOLDOWN_MS - (nowMs - last)) / 1000);
        return res.status(429).json({
          error: "Please wait before requesting another code",
          retry_after_sec,
        });
      }
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const otpHash = hashEmailOtp(code);
    const passwordHash = await bcrypt.hash(password, 10);
    const expiresAt = new Date(nowMs + SIGNUP_OTP_TTL_MS).toISOString();
    const lastSent = new Date(nowMs).toISOString();

    await run(
      `INSERT INTO pending_email_signups (email_normalized, name, password_hash, otp_hash, expires_at, last_sent_at, resend_count)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (email_normalized) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         otp_hash = EXCLUDED.otp_hash,
         expires_at = EXCLUDED.expires_at,
         last_sent_at = EXCLUDED.last_sent_at,
         resend_count = pending_email_signups.resend_count + 1`,
      [norm, name, passwordHash, otpHash, expiresAt, lastSent]
    );

    try {
      await sendSignupOtpEmail({ to: email, code, name });
    } catch (mailErr) {
      console.error("[auth] signup email:", mailErr?.message || mailErr);
      return res.status(502).json({ error: "Failed to send verification email. Try again later." });
    }

    return res.json({ ok: true, expires_in_sec: Math.floor(SIGNUP_OTP_TTL_MS / 1000) });
  } catch (err) {
    console.error("[auth] signup/send-code:", err?.message || err);
    return res.status(500).json({ error: "Failed to send verification code" });
  }
});

app.post("/api/auth/signup/resend-code", async (req, res) => {
  try {
    if (!isEmailTransportConfigured()) {
      return res.status(503).json({ error: "Email delivery is not configured on the server" });
    }
    const email = String(req.body?.email || "").trim();
    if (!email) return res.status(400).json({ error: "Missing email" });
    const norm = email.toLowerCase();
    const row = await get(`SELECT * FROM pending_email_signups WHERE email_normalized=?`, [norm]);
    if (!row) return res.status(404).json({ error: "No pending signup for this email" });
    const nowMs = Date.now();
    if (new Date(row.expires_at).getTime() < nowMs) {
      await run(`DELETE FROM pending_email_signups WHERE email_normalized=?`, [norm]);
      return res.status(410).json({ error: "Code expired. Please start signup again." });
    }
    const last = new Date(row.last_sent_at).getTime();
    if (last > nowMs - SIGNUP_RESEND_COOLDOWN_MS) {
      const retry_after_sec = Math.ceil((SIGNUP_RESEND_COOLDOWN_MS - (nowMs - last)) / 1000);
      return res.status(429).json({ error: "Please wait before resending", retry_after_sec });
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const otpHash = hashEmailOtp(code);
    const expiresAt = new Date(nowMs + SIGNUP_OTP_TTL_MS).toISOString();
    const lastSent = new Date(nowMs).toISOString();
    await run(
      `UPDATE pending_email_signups SET otp_hash=?, expires_at=?, last_sent_at=?, resend_count = resend_count + 1 WHERE email_normalized=?`,
      [otpHash, expiresAt, lastSent, norm]
    );
    try {
      await sendSignupOtpEmail({ to: email, code, name: row.name });
    } catch (mailErr) {
      console.error("[auth] resend email:", mailErr?.message || mailErr);
      return res.status(502).json({ error: "Failed to send email. Try again later." });
    }
    return res.json({ ok: true, expires_in_sec: Math.floor(SIGNUP_OTP_TTL_MS / 1000) });
  } catch (err) {
    console.error("[auth] signup/resend:", err?.message || err);
    return res.status(500).json({ error: "Failed to resend code" });
  }
});

app.post("/api/auth/signup/verify", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const code = String(req.body?.code || "").trim().replace(/\s/g, "");
    if (!email || !code) return res.status(400).json({ error: "Missing email or code" });
    const norm = email.toLowerCase();
    const row = await get(`SELECT * FROM pending_email_signups WHERE email_normalized=?`, [norm]);
    if (!row) return res.status(404).json({ error: "No pending signup for this email" });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await run(`DELETE FROM pending_email_signups WHERE email_normalized=?`, [norm]);
      return res.status(410).json({ error: "Code expired. Please request a new code." });
    }
    if (!verifyEmailOtp(code, row.otp_hash)) {
      return res.status(401).json({ error: "Invalid verification code" });
    }
    const dup = await get(`SELECT id FROM users WHERE LOWER(TRIM(email)) = ?`, [norm]);
    if (dup) {
      await run(`DELETE FROM pending_email_signups WHERE email_normalized=?`, [norm]);
      return res.status(409).json({ error: "Email already registered" });
    }

    const result = await run(
      `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, NULL, ?, 'user')`,
      [row.name, norm, row.password_hash]
    );
    await run(`DELETE FROM pending_email_signups WHERE email_normalized=?`, [norm]);
    const now = new Date().toISOString();
    await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [now, result.id]);
    const user = await get(
      `SELECT id, name, phone, email, role, credentials_acknowledged, notifications_enabled FROM users WHERE id=?`,
      [result.id]
    );
    const token = signToken({
      id: user.id,
      role: user.role,
      phone: user.phone,
      email: user.email,
    });
    const payload = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      notifications_enabled: user.notifications_enabled,
      credentials_acknowledged: user.credentials_acknowledged,
    };
    return res.json({ token, user: payload });
  } catch (err) {
    console.error("[auth] signup/verify:", err?.message || err);
    return res.status(500).json({ error: "Failed to complete signup" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const raw = String(req.body?.phone ?? req.body?.email ?? req.body?.identifier ?? "").trim();
    const password = String(req.body?.password || "");
    if (!raw || !password) return res.status(400).json({ error: "Missing credentials" });
    const user = await get(
      `SELECT * FROM users WHERE phone = ? OR LOWER(TRIM(email)) = LOWER(TRIM(?))`,
      [raw, raw]
    );
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [new Date().toISOString(), user.id]);
    const payload = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      notifications_enabled: user.notifications_enabled,
      credentials_acknowledged: user.credentials_acknowledged,
    };
    const token = signToken({
      id: user.id,
      role: user.role,
      phone: user.phone,
      email: user.email,
    });
    return res.json({ token, user: payload });
  } catch (err) {
    return res.status(500).json({ error: "Failed to login" });
  }
});

app.post("/api/auth/logout", (req, res) => res.json({ ok: true }));

/** فحص صحة للنشر (موازن، Docker، مراقبة) */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "adora",
    env: NODE_ENV,
    uptime: Math.round(process.uptime()),
    /** استخدم نفس أصل هذا الطلب (Render) وليس Netlify */
    endpoints: {
      publicStats: "/api/public/stats",
      publicStatsAlt: "/api/stats",
      publicConfig: "/api/public-config",
    },
  });
});

/** إعدادات عامة للواجهة (بدون مصادقة) — رابط تنزيل التطبيق من متغير البيئة */
app.get("/api/public-config", (_req, res) => {
  res.json({
    app_download_url: String(process.env.ADORA_APP_DOWNLOAD_URL || "").trim(),
  });
});

async function sendPublicStatsJson(_req, res) {
  try {
    const [pc, bc, cc] = await Promise.all([
      get(`SELECT COUNT(*) AS c FROM products`),
      get(`SELECT COUNT(*) AS c FROM brands`),
      get(`SELECT COUNT(*) AS c FROM categories`),
    ]);
    res.json({
      products: Number(pc?.c ?? 0),
      brands: Number(bc?.c ?? 0),
      categories: Number(cc?.c ?? 0),
      engine: "postgresql",
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load stats" });
  }
}

/** أرقام مجمّعة من قاعدة البيانات للواجهة — لا يعرض صفوفاً خام */
app.get("/api/public/stats", sendPublicStatsJson);
/** نفس المحتوى — مسار أقصر إن احتجت */
app.get("/api/stats", sendPublicStatsJson);

async function loadUserProfileBundle(userId) {
  await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [new Date().toISOString(), userId]);
  const user = await get(
    `SELECT id, name, phone, email, role, created_at, notifications_enabled, notifications_snoozed_until, credentials_acknowledged, last_activity_at
     FROM users WHERE id=?`,
    [userId]
  );
  const orders = await all(
    `SELECT id, order_no, total_price, status, payment_method, source, created_at
     FROM orders WHERE user_id=? ORDER BY id DESC`,
    [userId]
  );
  const reviewRow = await get(`SELECT COUNT(*) AS c FROM product_reviews WHERE user_id=?`, [userId]);
  const stats = { review_count: Number(reviewRow?.c || 0) };
  return { user, orders, stats };
}

app.get("/api/auth/profile", requireAuth, async (req, res) => {
  try {
    const bundle = await loadUserProfileBundle(req.user.id);
    return res.json(bundle);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

app.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const bundle = await loadUserProfileBundle(req.user.id);
    return res.json(bundle);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

app.put("/api/profile", requireAuth, async (req, res) => {
  try {
    const cur = await get(`SELECT name, phone, email FROM users WHERE id=?`, [req.user.id]);
    if (!cur) return res.status(404).json({ error: "User not found" });
    const { name, phone, email } = req.body || {};
    const n = name != null ? String(name).trim() : String(cur.name || "").trim();
    if (!n) return res.status(400).json({ error: "Missing name" });
    let nextPhone = cur.phone ?? null;
    let nextEmail = cur.email ?? null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "phone")) {
      const p = phone != null ? String(phone).trim() : "";
      nextPhone = p || null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "email")) {
      const e = email != null ? String(email).trim() : "";
      nextEmail = e || null;
    }
    if (!nextPhone && !nextEmail) {
      return res.status(400).json({ error: "Profile must keep at least phone or email" });
    }
    if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return res.status(400).json({ error: "Invalid email address" });
    }
    if (nextPhone) {
      const dupP = await get(`SELECT id FROM users WHERE phone=? AND id!=?`, [nextPhone, req.user.id]);
      if (dupP) return res.status(409).json({ error: "Phone already exists" });
    }
    if (nextEmail) {
      const dupE = await get(`SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND id!=?`, [
        nextEmail,
        req.user.id,
      ]);
      if (dupE) return res.status(409).json({ error: "Email already exists" });
    }
    await run(`UPDATE users SET name=?, phone=?, email=? WHERE id=?`, [n, nextPhone, nextEmail, req.user.id]);
    const user = await get(
      `SELECT id, name, phone, email, role, created_at, notifications_enabled, notifications_snoozed_until, credentials_acknowledged, last_activity_at FROM users WHERE id=?`,
      [req.user.id]
    );
    const token = signToken({
      id: user.id,
      role: user.role,
      phone: user.phone,
      email: user.email,
    });
    return res.json({ token, user });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update profile" });
  }
});

app.put("/api/profile/password", requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const cur = current_password != null ? String(current_password) : "";
    const nw = new_password != null ? String(new_password) : "";
    if (!cur || !nw) return res.status(400).json({ error: "Missing password fields" });
    if (nw.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
    const user = await get(`SELECT id, password_hash FROM users WHERE id=?`, [req.user.id]);
    if (!user) return res.status(404).json({ error: "User not found" });
    const match = await bcrypt.compare(cur, user.password_hash);
    if (!match) return res.status(401).json({ error: "Current password is incorrect" });
    const hash = await bcrypt.hash(nw, 10);
    await run(`UPDATE users SET password_hash=? WHERE id=?`, [hash, req.user.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update password" });
  }
});

app.post("/api/auth/ack-credentials", requireAuth, async (req, res) => {
  try {
    await run(`UPDATE users SET credentials_acknowledged=1 WHERE id=?`, [req.user.id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update" });
  }
});

app.put("/api/profile/notifications", requireAuth, async (req, res) => {
  try {
    const { notifications_enabled, snooze_hours } = req.body;
    const enabled = Number(notifications_enabled) === 1 ? 1 : 0;
    let snoozed = null;
    if (!enabled && snooze_hours != null) {
      const h = Math.max(1, Math.min(168, Number(snooze_hours) || 24));
      snoozed = new Date(Date.now() + h * 3600000).toISOString();
    }
    await run(`UPDATE users SET notifications_enabled=?, notifications_snoozed_until=? WHERE id=?`, [
      enabled,
      enabled ? null : snoozed,
      req.user.id,
    ]);
    return res.json({ ok: true, notifications_enabled: enabled, notifications_snoozed_until: enabled ? null : snoozed });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update notifications" });
  }
});

/** مفتاح VAPID العام — للاشتراك في Web Push من المتصفح (200 + ok:false إذا غير مضبوط لتفادي أخطاء حمراء في كونسول المتصفح) */
app.get("/api/push/vapid-public-key", (_req, res) => {
  const pub = process.env.VAPID_PUBLIC_KEY;
  if (!pub || !String(pub).trim()) {
    return res.status(200).json({ ok: false, error: "Push not configured" });
  }
  return res.json({ ok: true, publicKey: String(pub).trim() });
});

app.post("/api/push/subscribe", requireAuth, async (req, res) => {
  try {
    if (!isWebPushConfigured()) {
      return res.status(503).json({ error: "Push not configured on server" });
    }
    const sub = req.body?.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription" });
    }
    const endpoint = String(sub.endpoint).slice(0, 2500);
    const p256dh = String(sub.keys.p256dh).slice(0, 500);
    const auth = String(sub.keys.auth).slice(0, 200);
    await run(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [req.user.id, endpoint, p256dh, auth]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to save subscription" });
  }
});

app.post("/api/push/unsubscribe", requireAuth, async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint || typeof endpoint !== "string") {
      return res.status(400).json({ error: "endpoint required" });
    }
    await run(`DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?`, [
      req.user.id,
      String(endpoint).slice(0, 2500),
    ]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to remove subscription" });
  }
});

/** تشخيص Web Push — للمشرف: VAPID، عدد الاشتراكات، ملاحظة أن sw.js من نطاق الواجهة (Netlify) */
app.get("/api/admin/push-diagnostics", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const vapidConfigured = isWebPushConfigured();
    const total = await get(`SELECT COUNT(*)::int AS c FROM push_subscriptions`);
    const eligible = await get(
      `SELECT COUNT(*)::int AS c FROM push_subscriptions ps
       INNER JOIN users u ON u.id = ps.user_id
       WHERE ${sqlPushUserEligible()}`
    );
    return res.json({
      vapidConfigured,
      subscriptionRows: Number(total?.c ?? 0),
      subscriptionsEligibleForBroadcastPush: Number(eligible?.c ?? 0),
      hintAr:
        "يُفتح التطبيق من رابط Netlify؛ ملف /sw.js يُقدَّم من نفس النطاق. السيرفر على Render يحفظ الاشتراك ويرسل Push فقط.",
      hintEn:
        "Users must open the PWA from your Netlify URL; /sw.js is served there. Render stores subscriptions and sends pushes.",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to read push diagnostics" });
  }
});

/** ملخص الجداول (عدد الصفوف) — للمشرف فقط؛ الملف غير معروض للتنزيل */
app.get("/api/admin/database/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const overview = await getDatabaseOverview();
    return res.json({
      ...overview,
      note: "PostgreSQL via DATABASE_URL. Use this dashboard or REST APIs — no direct database file on the app host.",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load database overview" });
  }
});

/** Keys + labels for home section visibility (admin toggles) — derived from DEFAULT_HOME_SECTIONS_VISIBILITY */
app.get("/api/admin/home-sections/keys", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const keys = Object.keys(DEFAULT_HOME_SECTIONS_VISIBILITY);
    const defaults = { ...DEFAULT_HOME_SECTIONS_VISIBILITY };
    const sections = keys.map((key) => {
      const lab = HOME_SECTION_LABELS[key] || { ar: key, en: key };
      return {
        key,
        label_ar: lab.ar,
        label_en: lab.en,
        default: defaults[key] !== false,
      };
    });
    return res.json({ keys, defaults, sections });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load home section keys" });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all(
      `SELECT u.id, u.name, u.phone, u.email, u.role, u.created_at, u.last_activity_at,
        u.notifications_enabled, u.notifications_snoozed_until,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
        (SELECT MAX(o.created_at) FROM orders o WHERE o.user_id = u.id) AS last_order_at
       FROM users u
       WHERE COALESCE(u.role, 'user') != 'admin'
       ORDER BY u.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load users" });
  }
});

/** إشعارات: رسائل بث قديمة + إشعارات نصية جديدة (مع قراءة لكل مستخدم) */
app.get("/api/notifications", requireAuth, async (req, res) => {
  try {
    const urow = await get(`SELECT created_at FROM users WHERE id=?`, [req.user.id]);
    const since = urow?.created_at ? new Date(urow.created_at).toISOString() : new Date(0).toISOString();

    const messages = await all(
      `SELECT id, title_ar, title_en, body_ar, body_en, created_at FROM broadcast_messages
       WHERE created_at >= ?
       ORDER BY id DESC LIMIT 100`,
      [since]
    );
    const reads = await all(`SELECT broadcast_id FROM user_broadcast_reads WHERE user_id=?`, [req.user.id]);
    const readSet = new Set(reads.map((r) => r.broadcast_id));
    const broadcastRows = messages.map((m) => ({
      kind: "broadcast",
      id: m.id,
      title_ar: m.title_ar,
      title_en: m.title_en,
      body_ar: m.body_ar || "",
      body_en: m.body_en || "",
      read: readSet.has(m.id),
      created_at: m.created_at,
    }));

    const inApp = await all(
      `SELECT id, message, title, target_user_id, image_url, link_url, created_at FROM in_app_notifications
       WHERE (target_user_id IS NULL OR target_user_id = ?)
       AND created_at >= ?
       ORDER BY id DESC LIMIT 200`,
      [req.user.id, since]
    );
    const inReads = await all(`SELECT notification_id FROM in_app_notification_reads WHERE user_id=?`, [req.user.id]);
    const inReadSet = new Set(inReads.map((r) => r.notification_id));
    const inAppRows = inApp.map((n) => ({
      kind: "in_app",
      id: n.id,
      title: n.title || null,
      message: n.message,
      image_url: n.image_url || null,
      link_url: n.link_url || null,
      read: inReadSet.has(n.id),
      created_at: n.created_at,
    }));

    const merged = [...broadcastRows, ...inAppRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return res.json(merged);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load notifications" });
  }
});

/** عدد الإشعارات غير المقروءة (بث + in-app) — أخف من جلب القائمة كاملة */
app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
  try {
    const urow = await get(`SELECT created_at FROM users WHERE id=?`, [req.user.id]);
    const since = urow?.created_at ? new Date(urow.created_at).toISOString() : new Date(0).toISOString();
    const bcRow = await get(
      `SELECT COUNT(*)::int AS c FROM broadcast_messages bm
       WHERE bm.created_at >= ?
       AND NOT EXISTS (SELECT 1 FROM user_broadcast_reads r WHERE r.user_id = ? AND r.broadcast_id = bm.id)`,
      [since, req.user.id]
    );
    const inRow = await get(
      `SELECT COUNT(*)::int AS c FROM in_app_notifications n
       WHERE n.created_at >= ?
       AND (n.target_user_id IS NULL OR n.target_user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM in_app_notification_reads r WHERE r.user_id = ? AND r.notification_id = n.id)`,
      [since, req.user.id, req.user.id]
    );
    const unread = Number(bcRow?.c || 0) + Number(inRow?.c || 0);
    return res.json({ unread: Number.isFinite(unread) ? unread : 0 });
  } catch (err) {
    return res.status(500).json({ error: "Failed to count notifications" });
  }
});

app.post("/api/notifications/read", requireAuth, async (req, res) => {
  try {
    const { kind, id } = req.body || {};
    const nid = Number(id);
    if (!kind || !Number.isFinite(nid)) return res.status(400).json({ error: "kind and id required" });
    if (kind === "broadcast") {
      const exists = await get(`SELECT id FROM broadcast_messages WHERE id=?`, [nid]);
      if (!exists) return res.status(404).json({ error: "Not found" });
      await run(
        `INSERT INTO user_broadcast_reads (user_id, broadcast_id) VALUES (?, ?) ON CONFLICT (user_id, broadcast_id) DO NOTHING`,
        [req.user.id, nid]
      );
      return res.json({ ok: true });
    }
    if (kind === "in_app") {
      const row = await get(`SELECT id FROM in_app_notifications WHERE id=? AND (target_user_id IS NULL OR target_user_id=?)`, [
        nid,
        req.user.id,
      ]);
      if (!row) return res.status(404).json({ error: "Not found" });
      await run(
        `INSERT INTO in_app_notification_reads (user_id, notification_id) VALUES (?, ?) ON CONFLICT (user_id, notification_id) DO NOTHING`,
        [req.user.id, nid]
      );
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: "Invalid kind" });
  } catch (err) {
    return res.status(500).json({ error: "Failed to mark read" });
  }
});

/** توافق مع العميل القديم: يعامل كـ broadcast */
app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const exists = await get(`SELECT id FROM broadcast_messages WHERE id=?`, [id]);
    if (!exists) return res.status(404).json({ error: "Not found" });
    await run(
      `INSERT INTO user_broadcast_reads (user_id, broadcast_id) VALUES (?, ?) ON CONFLICT (user_id, broadcast_id) DO NOTHING`,
      [req.user.id, id]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to mark read" });
  }
});

function emitInAppNotification(io, row, targetUserId) {
  if (!io || !row) return;
  const payload = {
    kind: "in_app",
    id: row.id,
    title: row.title || null,
    message: row.message,
    image_url: row.image_url || null,
    link_url: row.link_url || null,
    created_at: row.created_at,
  };
  if (targetUserId != null) {
    io.to(`user:${targetUserId}`).emit("notification:new", payload);
  } else {
    io.to("app-users").emit("notification:new", payload);
  }
  notifyInAppRow(row, targetUserId != null && targetUserId !== "" ? Number(targetUserId) : null).catch((e) =>
    console.error("[Adora] Web Push:", e.message || e)
  );
}

app.post("/api/admin/notifications/send", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { message, title, target_user_id, image_url, link_url } = req.body || {};
    const text = message != null ? String(message).trim() : "";
    if (!text) return res.status(400).json({ error: "message required" });
    let titleVal = title != null ? String(title).trim().slice(0, 200) : "";
    if (!titleVal) titleVal = null;
    const img = sanitizeHttpsUrl(image_url);
    const link = normalizeNotificationLink(link_url);
    let uid = null;
    if (target_user_id != null && target_user_id !== "") {
      uid = Number(target_user_id);
      if (!Number.isFinite(uid)) return res.status(400).json({ error: "Invalid target_user_id" });
      const u = await get(`SELECT id FROM users WHERE id=? AND COALESCE(role,'user') != 'admin'`, [uid]);
      if (!u) return res.status(404).json({ error: "User not found" });
    }
    const result = await run(
      `INSERT INTO in_app_notifications (message, title, target_user_id, image_url, link_url) VALUES (?, ?, ?, ?, ?)`,
      [text, titleVal, uid, img, link]
    );
    const row = await get(
      `SELECT id, message, title, target_user_id, image_url, link_url, created_at FROM in_app_notifications WHERE id=?`,
      [result.id]
    );
    const io = req.app.get("io");
    emitInAppNotification(io, row, uid);
    return res.status(201).json({ id: result.id });
  } catch (err) {
    return res.status(500).json({ error: "Failed to send notification" });
  }
});

app.get("/api/admin/orders/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const order = await get(
      `SELECT o.*, u.name AS customer_name, COALESCE(NULLIF(TRIM(u.phone), ''), u.email) AS customer_phone
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.id=?`,
      [id]
    );
    if (!order) return res.status(404).json({ error: "Order not found" });
    const items = await all(`SELECT * FROM order_items WHERE order_id=? ORDER BY id ASC`, [id]);
    const history = await all(
      `SELECT status, created_at FROM order_status_history WHERE order_id=? ORDER BY id ASC`,
      [id]
    );
    return res.json({ order, items, history });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load order" });
  }
});

app.get("/api/admin/broadcasts", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all(`SELECT id, title_ar, title_en, body_ar, body_en, created_at FROM broadcast_messages ORDER BY id DESC LIMIT 200`);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load broadcasts" });
  }
});

app.post("/api/admin/broadcasts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title_ar, title_en, body_ar = "", body_en = "" } = req.body;
    if (!title_ar || !title_en) {
      return res.status(400).json({ error: "title_ar and title_en required" });
    }
    const result = await run(
      `INSERT INTO broadcast_messages (title_ar, title_en, body_ar, body_en) VALUES (?, ?, ?, ?)`,
      [String(title_ar).trim(), String(title_en).trim(), String(body_ar || "").trim(), String(body_en || "").trim()]
    );
    return res.status(201).json({ id: result.id });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create broadcast" });
  }
});

/** حذف كل رسائل البث والإشعارات الداخلية لجميع المستخدمين (تُحذف سجلات القراءة تلقائياً بـ CASCADE) */
app.delete("/api/admin/notifications/all", requireAuth, requireAdmin, async (_req, res) => {
  try {
    await run(`DELETE FROM in_app_notifications`);
    await run(`DELETE FROM broadcast_messages`);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to clear notifications" });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const {
      category,
      subcategory,
      brand,
      featured,
      flash,
      new_collection,
      q,
      min_price,
      max_price,
      no_brand,
      adora_only,
      min_rating,
    } = req.query;
    const where = [];
    const params = [];
    if (no_brand === "1" || no_brand === "true") {
      where.push(`(brand IS NULL OR TRIM(brand) = '')`);
    }
    if (adora_only === "1" || adora_only === "true") {
      where.push(sqlAdoraBrandPredicate());
    }
    if (category) {
      where.push("category=?");
      params.push(category);
    }
    if (subcategory) {
      where.push("subcategory=?");
      params.push(subcategory);
    }
    if (brand) {
      where.push("brand=?");
      params.push(brand);
    }
    if (featured === "1") where.push("is_featured=1");
    if (flash === "1") where.push("is_flash_sale=1");
    if (new_collection === "1") where.push("is_new_collection=1");
    const qtrim = q != null ? String(q).trim() : "";
    if (qtrim) {
      const variants = arabicSearchQueryVariants(qtrim);
      const clause = `(name_ar LIKE ? OR name_en LIKE ? OR COALESCE(brand,'') LIKE ? OR COALESCE(description,'') LIKE ? OR category LIKE ? OR COALESCE(subcategory,'') LIKE ? OR COALESCE(badge,'') LIKE ? OR EXISTS (SELECT 1 FROM brands b WHERE b.name LIKE ? AND (TRIM(COALESCE(products.brand,'')) = TRIM(b.name) OR COALESCE(products.brand,'') LIKE ('%' || TRIM(b.name) || '%'))))`;
      const parts = variants.map(() => clause);
      where.push(`(${parts.join(" OR ")})`);
      for (const v of variants) {
        const term = `%${v}%`;
        params.push(term, term, term, term, term, term, term, term);
      }
    }
    if (min_price !== undefined && min_price !== "" && !Number.isNaN(Number(min_price))) {
      where.push(`price >= ?`);
      params.push(Number(min_price));
    }
    if (max_price !== undefined && max_price !== "" && !Number.isNaN(Number(max_price))) {
      where.push(`price <= ?`);
      params.push(Number(max_price));
    }
    if (min_rating !== undefined && min_rating !== "" && !Number.isNaN(Number(min_rating))) {
      const mr = Number(min_rating);
      where.push(
        `id IN (SELECT product_id FROM product_reviews GROUP BY product_id HAVING ROUND(COALESCE(AVG(stars),0),2) >= ?)`
      );
      params.push(mr);
    }
    const sql = `SELECT * FROM products ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC`;
    const products = await all(sql, params);
    const ids = products.map((p) => p.id).filter((id) => Number.isFinite(Number(id)));
    const reviewMap = {};
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      const revRows = await all(
        `SELECT product_id, AVG(stars) AS review_avg, COUNT(*) AS review_count FROM product_reviews WHERE product_id IN (${ph}) GROUP BY product_id`,
        ids
      );
      for (const r of revRows) {
        reviewMap[r.product_id] = {
          review_avg: r.review_avg != null ? Math.round(Number(r.review_avg) * 10) / 10 : null,
          review_count: Number(r.review_count || 0),
        };
      }
    }
    const rows = [];
    for (const p of products) {
      const images = await all(`SELECT image_url FROM product_images WHERE product_id=?`, [p.id]);
      const base = mapProductRow(p);
      const rev = reviewMap[p.id] || { review_avg: null, review_count: 0 };
      rows.push({
        ...base,
        sizes: safeJsonParse(p.sizes_json, []),
        colors: safeJsonParse(p.colors_json, []),
        images: images.map((i) => i.image_url),
        review_avg: rev.review_avg,
        review_count: rev.review_count,
      });
    }
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load products" });
  }
});

/** منتجات ذات صلة: نفس القسم (ويفضّل نفس الفرع ثم نفس العلامة) */
app.get("/api/products/:id/related", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 8));
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid product id" });
    const p = await get(`SELECT id, category, subcategory, brand FROM products WHERE id=?`, [id]);
    if (!p) return res.status(404).json({ error: "Product not found" });
    const cat = String(p.category || "").trim();
    const sub = String(p.subcategory || "").trim();
    const brand = String(p.brand || "").trim();
    let products = [];
    if (cat) {
      products = await all(
        `SELECT * FROM products WHERE id != ? AND category = ?
         ORDER BY
           CASE WHEN TRIM(COALESCE(subcategory,'')) = ? THEN 0 ELSE 1 END,
           CASE WHEN TRIM(COALESCE(brand,'')) = ? THEN 0 ELSE 1 END,
           id DESC
         LIMIT ?`,
        [id, cat, sub, brand, limit]
      );
    }
    if (products.length < limit) {
      const exclude = [id, ...products.map((x) => x.id)];
      const ph = exclude.map(() => "?").join(",");
      const need = limit - products.length;
      const more = await all(
        `SELECT * FROM products WHERE id NOT IN (${ph}) ORDER BY id DESC LIMIT ?`,
        [...exclude, need]
      );
      const seen = new Set(products.map((x) => x.id));
      for (const m of more) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        products.push(m);
        if (products.length >= limit) break;
      }
    }
    const rows = [];
    for (const pr of products.slice(0, limit)) {
      const images = await all(`SELECT image_url FROM product_images WHERE product_id=?`, [pr.id]);
      const base = mapProductRow(pr);
      const agg = await get(
        `SELECT AVG(stars) AS review_avg, COUNT(*) AS review_count FROM product_reviews WHERE product_id=?`,
        [pr.id]
      );
      rows.push({
        ...base,
        sizes: safeJsonParse(pr.sizes_json, []),
        colors: safeJsonParse(pr.colors_json, []),
        images: images.map((i) => i.image_url),
        review_avg:
          agg && agg.review_avg != null ? Math.round(Number(agg.review_avg) * 10) / 10 : null,
        review_count: agg && agg.review_count != null ? Number(agg.review_count) : 0,
      });
    }
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load related products" });
  }
});

app.get("/api/products/:id/reviews", async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!Number.isFinite(productId)) return res.status(400).json({ error: "Invalid product id" });
    const p = await get(`SELECT id FROM products WHERE id=?`, [productId]);
    if (!p) return res.status(404).json({ error: "Product not found" });
    const agg = await get(
      `SELECT AVG(stars) AS avg_stars, COUNT(*) AS cnt FROM product_reviews WHERE product_id=?`,
      [productId]
    );
    const avg = agg && agg.avg_stars != null ? Number(agg.avg_stars) : null;
    const count = agg && agg.cnt != null ? Number(agg.cnt) : 0;
    const items = await all(
      `SELECT r.id, r.stars, r.comment, r.created_at, u.name AS user_name
       FROM product_reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.product_id = ?
       ORDER BY r.id DESC
       LIMIT 80`,
      [productId]
    );
    return res.json({
      average: avg != null && !Number.isNaN(avg) ? Math.round(avg * 10) / 10 : null,
      count,
      items,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load reviews" });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const p = await get(`SELECT * FROM products WHERE id=?`, [id]);
    if (!p) return res.status(404).json({ error: "Product not found" });
    const images = await all(`SELECT image_url FROM product_images WHERE product_id=?`, [p.id]);
    const base = mapProductRow(p);
    return res.json({
      ...base,
      sizes: safeJsonParse(p.sizes_json, []),
      colors: safeJsonParse(p.colors_json, []),
      images: images.map((i) => i.image_url),
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load product" });
  }
});

app.post("/api/products", requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      name_ar,
      name_en,
      description,
      price,
      discount = 0,
      images = [],
      category,
      subcategory = "",
      brand = "",
      sizes = [],
      colors = [],
      stock = 0,
      inventory = [],
      badge = "",
      is_featured = 0,
      is_flash_sale = 0,
      is_new_collection = 0,
      flash_sale_end_time = null,
    } = req.body;
    if (!name_ar || !name_en || !description || !category) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const invArr = Array.isArray(inventory) ? inventory : [];
    const result = await run(
      `INSERT INTO products (
        name_ar, name_en, description, price, discount, category, subcategory, brand,
        sizes_json, colors_json, stock, inventory_json, badge, is_featured, is_flash_sale, is_new_collection, flash_sale_end_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name_ar,
        name_en,
        description,
        Number(price || 0),
        Number(discount || 0),
        category,
        subcategory,
        brand,
        JSON.stringify(sizes),
        JSON.stringify(colors),
        Number(stock || 0),
        JSON.stringify(invArr),
        badge,
        is_featured ? 1 : 0,
        is_flash_sale ? 1 : 0,
        is_new_collection ? 1 : 0,
        flash_sale_end_time,
      ]
    );
    for (const imageUrl of images) {
      if (imageUrl) await run(`INSERT INTO product_images (product_id, image_url) VALUES (?, ?)`, [result.id, imageUrl]);
    }
    return res.status(201).json({ id: result.id });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create product" });
  }
});

app.put("/api/products/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      name_ar,
      name_en,
      description,
      price,
      discount = 0,
      images = [],
      category,
      subcategory = "",
      brand = "",
      sizes = [],
      colors = [],
      stock = 0,
      inventory = [],
      badge = "",
      is_featured = 0,
      is_flash_sale = 0,
      is_new_collection = 0,
      flash_sale_end_time = null,
    } = req.body;
    const invArr = Array.isArray(inventory) ? inventory : [];
    await run(
      `UPDATE products SET
        name_ar=?, name_en=?, description=?, price=?, discount=?, category=?, subcategory=?, brand=?,
        sizes_json=?, colors_json=?, stock=?, inventory_json=?, badge=?, is_featured=?, is_flash_sale=?, is_new_collection=?, flash_sale_end_time=?
       WHERE id=?`,
      [
        name_ar,
        name_en,
        description,
        Number(price || 0),
        Number(discount || 0),
        category,
        subcategory,
        brand,
        JSON.stringify(sizes),
        JSON.stringify(colors),
        Number(stock || 0),
        JSON.stringify(invArr),
        badge,
        is_featured ? 1 : 0,
        is_flash_sale ? 1 : 0,
        is_new_collection ? 1 : 0,
        flash_sale_end_time,
        id,
      ]
    );
    await run(`DELETE FROM product_images WHERE product_id=?`, [id]);
    for (const imageUrl of images) {
      if (imageUrl) await run(`INSERT INTO product_images (product_id, image_url) VALUES (?, ?)`, [id, imageUrl]);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update product" });
  }
});

app.delete("/api/products/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await run(`DELETE FROM products WHERE id=?`, [Number(req.params.id)]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete product" });
  }
});

app.get("/api/brands", async (_req, res) => {
  try {
    const rows = await all(
      `SELECT b.*,
        (SELECT COUNT(*) FROM products p WHERE TRIM(COALESCE(p.brand,'')) = TRIM(b.name)) AS product_count
       FROM brands b
       ORDER BY b.is_top_brand DESC, b.id DESC`
    );
    return res.json(
      rows.map((b) => {
        const { showcase_categories_json, ...rest } = b;
        return {
          ...rest,
          showcase_categories: safeJsonParse(showcase_categories_json, ["Men", "Women", "Kids"]),
        };
      })
    );
  } catch (err) {
    return res.status(500).json({ error: "Failed to load brands" });
  }
});

app.post("/api/brands", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, logo = "", is_top_brand = 0, showcase_categories } = req.body;
    const sc = Array.isArray(showcase_categories) ? showcase_categories : ["Men", "Women", "Kids"];
    const result = await run(
      `INSERT INTO brands (name, logo, is_top_brand, showcase_categories_json) VALUES (?, ?, ?, ?)`,
      [name, logo, is_top_brand ? 1 : 0, JSON.stringify(sc)]
    );
    return res.status(201).json({ id: result.id });
  } catch (err) {
    return res.status(500).json({ error: "Failed to add brand" });
  }
});

app.put("/api/brands/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, logo = "", is_top_brand = 0, showcase_categories } = req.body;
    const sc = Array.isArray(showcase_categories) ? showcase_categories : ["Men", "Women", "Kids"];
    await run(`UPDATE brands SET name=?, logo=?, is_top_brand=?, showcase_categories_json=? WHERE id=?`, [
      name,
      logo,
      is_top_brand ? 1 : 0,
      JSON.stringify(sc),
      Number(req.params.id),
    ]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update brand" });
  }
});

app.delete("/api/brands/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await run(`DELETE FROM brands WHERE id=?`, [Number(req.params.id)]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete brand" });
  }
});

app.get("/api/categories", async (_req, res) => {
  try {
    const rows = await all(`SELECT * FROM categories ORDER BY id ASC`);
    return res.json(rows.map((x) => ({ ...x, subcategories: safeJsonParse(x.subcategories_json, []) })));
  } catch (err) {
    return res.status(500).json({ error: "Failed to load categories" });
  }
});

app.post("/api/categories", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, subcategories = [] } = req.body;
    const result = await run(`INSERT INTO categories (name, subcategories_json) VALUES (?, ?)`, [
      name,
      JSON.stringify(subcategories),
    ]);
    return res.status(201).json({ id: result.id });
  } catch (err) {
    return res.status(500).json({ error: "Failed to add category" });
  }
});

app.put("/api/categories/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, subcategories = [] } = req.body;
    await run(`UPDATE categories SET name=?, subcategories_json=? WHERE id=?`, [
      name,
      JSON.stringify(subcategories),
      Number(req.params.id),
    ]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update category" });
  }
});

app.delete("/api/categories/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await run(`DELETE FROM categories WHERE id=?`, [Number(req.params.id)]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete category" });
  }
});

async function notifyUserInApp(app, userId, title, message, link_url) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid < 1) return;
  const text = String(message || "").trim();
  if (!text) return;
  let titleVal = title != null ? String(title).trim().slice(0, 200) : "";
  if (!titleVal) titleVal = null;
  const link = normalizeNotificationLink(link_url);
  const result = await run(
    `INSERT INTO in_app_notifications (message, title, target_user_id, image_url, link_url) VALUES (?, ?, ?, ?, ?)`,
    [text, titleVal, uid, null, link]
  );
  const row = await get(
    `SELECT id, message, title, target_user_id, image_url, link_url, created_at FROM in_app_notifications WHERE id=?`,
    [result.id]
  );
  const io = app.get("io");
  emitInAppNotification(io, row, uid);
}

registerMarketplaceRoutes(app, { requireAuth, requireAdmin });
registerVendorPlatformRoutes(app, {
  requireAuth,
  requireAdmin,
  optionalAuth,
  notifyUserInApp: (userId, title, message, link_url) => notifyUserInApp(app, userId, title, message, link_url),
  uploadVendorJoinImageBuffer: uploadBufferToCloudinary,
  isVendorJoinUploadReady: isCloudinaryConfigured,
});

const ORDER_STATUS_KEYS = ["pending_receipt", "in_progress", "fulfilled", "shipping", "delivered"];

function orderStatusNotifyMessageAr(status) {
  const m = {
    pending_receipt: "تم تحديث حالة طلبك إلى: جاري استلام طلبك",
    in_progress: "تم تحديث حالة طلبك إلى: جاري تجميع طلبك",
    fulfilled: "تم تحديث حالة طلبك إلى: تم تجميع طلبك",
    shipping: "تم تحديث حالة طلبك إلى: جاري الشحن",
    delivered: "تم تحديث حالة طلبك إلى: تم تسليم الطلب للعميل",
  };
  return m[status] || `تم تحديث حالة طلبك (${status})`;
}

app.get("/api/orders/next-order-no", requireAuth, async (req, res) => {
  try {
    const order_no = await allocateNextOrderNo();
    return res.json({ order_no });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load next order number" });
  }
});

app.post("/api/orders", requireAuth, async (req, res) => {
  try {
    const platformSettings = await getVendorPlatformSettings();
    const commissionPctRaw = platformSettings != null ? Number(platformSettings.commission_percent) : 5;
    const commissionPct = Number.isFinite(commissionPctRaw)
      ? Math.min(100, Math.max(0, commissionPctRaw))
      : 5;
    const {
      products = [],
      total_price = 0,
      payment_method = "cod",
      source = "system",
      shipping_address: shippingAddressBody,
    } = req.body;
    const shippingAddress =
      shippingAddressBody != null && String(shippingAddressBody).trim() ? String(shippingAddressBody).trim().slice(0, 2000) : null;
    const productLines = Array.isArray(products) ? products : [];
    if (productLines.length === 0) {
      return res.status(400).json({ error: "Order must include at least one product" });
    }
    for (const item of productLines) {
      const qn = Math.max(1, Math.floor(Number(item.qty || 1)));
      const mpidRaw = item.marketplace_product_id != null ? Number(item.marketplace_product_id) : null;
      const mpid = Number.isFinite(mpidRaw) && mpidRaw > 0 ? mpidRaw : null;
      if (!mpid) continue;
      const mp = await get(
        `SELECT id, stock, name_ar FROM marketplace_products WHERE id=? AND is_active = 1`,
        [mpid]
      );
      if (!mp) {
        return res.status(400).json({ error: "Invalid marketplace product" });
      }
      if (Number(mp.stock) < qn) {
        return res.status(400).json({ error: "Insufficient stock", detail: mp.name_ar || String(mpid) });
      }
    }
    /** الحالة الأولى دائماً «قيد الاستلام» — لا يُقبل تمرير حالة من الزبون */
    const status = "pending_receipt";
    const orderNo = await allocateNextOrderNo();
    const result = await run(
      `INSERT INTO orders (order_no, user_id, total_price, status, payment_method, source, shipping_address) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orderNo, req.user.id, Number(total_price || 0), status, payment_method, source, shippingAddress]
    );

    await run(`INSERT INTO order_status_history (order_id, status) VALUES (?, ?)`, [result.id, status]);

    for (const item of productLines) {
      const brandLine = item.brand != null ? String(item.brand).trim() : "";
      const mpidRaw = item.marketplace_product_id != null ? Number(item.marketplace_product_id) : null;
      const mpid = Number.isFinite(mpidRaw) && mpidRaw > 0 ? mpidRaw : null;
      const pidRaw = item.product_id != null ? Number(item.product_id) : null;
      const pid = mpid ? null : Number.isFinite(pidRaw) && pidRaw > 0 ? pidRaw : null;
      const qn = Math.max(1, Math.floor(Number(item.qty || 1)));
      const lineSubtotal = Number(item.price || 0) * qn;
      const marketplace_commission_amount =
        mpid && commissionPct > 0 ? Math.round(lineSubtotal * (commissionPct / 100) * 10000) / 10000 : mpid ? 0 : null;
      await run(
        `INSERT INTO order_items (order_id, product_id, marketplace_product_id, product_name, qty, price, image_url, color, size, brand, marketplace_commission_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.id,
          pid,
          mpid,
          item.product_name || "Item",
          qn,
          Number(item.price || 0),
          item.image_url != null ? String(item.image_url) : "",
          item.color != null ? String(item.color) : "",
          item.size != null ? String(item.size) : "",
          brandLine,
          marketplace_commission_amount,
        ]
      );
      if (mpid && qn > 0) {
        await decrementMarketplaceStock(mpid, qn);
      } else if (pid && qn > 0) {
        await decrementProductStock(pid, qn, item.size, item.color);
      }
    }
    await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [new Date().toISOString(), req.user.id]);
    const saved = await get(`SELECT * FROM orders WHERE id=?`, [result.id]);
    const items = await all(
      `SELECT id, product_id, marketplace_product_id, product_name, qty, price, image_url, color, size, brand
       FROM order_items WHERE order_id=? ORDER BY id ASC`,
      [result.id]
    );
    return res.status(201).json({ order: saved, items });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create order" });
  }
});

app.get("/api/orders/:orderId/tracking", requireAuth, async (req, res) => {
  try {
    const orderId = Number(req.params.orderId);
    const order = await get(`SELECT * FROM orders WHERE id=?`, [orderId]);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (req.user.role !== "admin" && order.user_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

    const history = await all(
      `SELECT status, created_at FROM order_status_history WHERE order_id=? ORDER BY id ASC`,
      [orderId]
    );
    const items = await all(
      `SELECT id, product_id, marketplace_product_id, product_name, qty, price, image_url, color, size, brand
       FROM order_items WHERE order_id=? ORDER BY id ASC`,
      [orderId]
    );
    return res.json({ order, history, items });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load tracking" });
  }
});

/** ترتيب الحالات للفرز الثانوي بعد التاريخ (الأحدث أولاً) */
const ORDER_STATUS_SORT_SQL = `CASE o.status
  WHEN 'pending_receipt' THEN 1
  WHEN 'in_progress' THEN 2
  WHEN 'fulfilled' THEN 3
  WHEN 'shipping' THEN 4
  WHEN 'delivered' THEN 5
  ELSE 6
END`;

app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const rows =
      req.user.role === "admin"
        ? await all(
            `SELECT o.*, u.name AS customer_name, COALESCE(NULLIF(TRIM(u.phone), ''), u.email) AS customer_phone
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             ORDER BY o.created_at DESC NULLS LAST, ${ORDER_STATUS_SORT_SQL} ASC, o.id DESC`
          )
        : await all(
            `SELECT o.*, u.name AS customer_name, COALESCE(NULLIF(TRIM(u.phone), ''), u.email) AS customer_phone
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             WHERE o.user_id=?
             ORDER BY o.created_at DESC NULLS LAST, ${ORDER_STATUS_SORT_SQL} ASC, o.id DESC`,
            [req.user.id]
          );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load orders" });
  }
});

app.put("/api/orders/:id/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const id = Number(req.params.id);
    if (!status || !ORDER_STATUS_KEYS.includes(String(status))) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const order = await get(`SELECT id, user_id FROM orders WHERE id=?`, [id]);
    if (!order) return res.status(404).json({ error: "Order not found" });

    await run(`UPDATE orders SET status=? WHERE id=?`, [status, id]);
    await run(`INSERT INTO order_status_history (order_id, status) VALUES (?, ?)`, [id, status]);

    const io = req.app.get("io");
    if (order.user_id) {
      const msg = orderStatusNotifyMessageAr(status);
      try {
        const ins = await run(
          `INSERT INTO in_app_notifications (message, title, target_user_id, image_url, link_url) VALUES (?, ?, ?, ?, ?)`,
          [msg, "تحديث الطلب", order.user_id, null, null]
        );
        const row = await get(
          `SELECT id, message, title, target_user_id, image_url, link_url, created_at FROM in_app_notifications WHERE id=?`,
          [ins.id]
        );
        emitInAppNotification(io, row, order.user_id);
      } catch (_e) {
        /* ignore notification failure */
      }
      if (io) {
        io.to(`user:${order.user_id}`).emit("order:updated", { orderId: id, status });
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update order status" });
  }
});

app.get("/api/offers", async (_req, res) => {
  try {
    const offerRows = await all(
      `SELECT id, product_id, banner_image_url, discount_percent, offer_end_time, created_at
       FROM product_offers ORDER BY id DESC`
    );
    const out = [];
    for (const o of offerRows) {
      const p = await get(`SELECT * FROM products WHERE id=?`, [o.product_id]);
      if (!p) continue;
      const imgs = await all(`SELECT image_url FROM product_images WHERE product_id=?`, [p.id]);
      out.push({
        id: o.id,
        product_id: o.product_id,
        banner_image_url: o.banner_image_url || "",
        discount_percent: Number(o.discount_percent || 0),
        offer_end_time: o.offer_end_time || null,
        created_at: o.created_at,
        name_ar: p.name_ar,
        name_en: p.name_en,
        description: p.description,
        price: p.price,
        discount: p.discount,
        category: p.category,
        subcategory: p.subcategory,
        brand: p.brand,
        stock: p.stock,
        badge: p.badge,
        sizes: safeJsonParse(p.sizes_json, []),
        colors: safeJsonParse(p.colors_json, []),
        images: imgs.map((i) => i.image_url),
      });
    }
    return res.json(out);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load offers" });
  }
});

app.post("/api/offers", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { product_id, banner_image_url = "", discount_percent = 0, offer_end_time = null } = req.body;
    if (!product_id) return res.status(400).json({ error: "product_id is required" });
    const result = await run(
      `INSERT INTO product_offers (product_id, banner_image_url, discount_percent, offer_end_time) VALUES (?, ?, ?, ?)`,
      [Number(product_id), banner_image_url, Number(discount_percent || 0), offer_end_time]
    );
    return res.status(201).json({ id: result.id });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create offer" });
  }
});

app.put("/api/offers/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { product_id, banner_image_url = "", discount_percent = 0, offer_end_time = null } = req.body;
    await run(
      `UPDATE product_offers SET product_id=?, banner_image_url=?, discount_percent=?, offer_end_time=? WHERE id=?`,
      [Number(product_id), banner_image_url, Number(discount_percent || 0), offer_end_time, id]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update offer" });
  }
});

app.delete("/api/offers/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await run(`DELETE FROM product_offers WHERE id=?`, [Number(req.params.id)]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete offer" });
  }
});

app.post("/api/site-ratings", requireAuth, async (req, res) => {
  try {
    const raw = Number(req.body.stars);
    const stars = Number.isFinite(raw) ? Math.min(5, Math.max(1, Math.round(raw))) : NaN;
    if (!Number.isFinite(stars)) {
      return res.status(400).json({ error: "stars must be 1–5" });
    }
    let comment = req.body.comment != null ? String(req.body.comment).trim() : "";
    if (comment.length > 2000) comment = comment.slice(0, 2000);
    const result = await run(`INSERT INTO site_ratings (user_id, stars, comment) VALUES (?, ?, ?)`, [
      req.user.id,
      stars,
      comment || null,
    ]);
    return res.status(201).json({ id: result.id });
  } catch (err) {
    return res.status(500).json({ error: "Failed to save rating" });
  }
});

app.get("/api/admin/site-ratings", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all(
      `SELECT r.id, r.stars, r.comment, r.created_at, u.name AS user_name, u.phone AS user_phone
       FROM site_ratings r
       JOIN users u ON u.id = r.user_id
       ORDER BY r.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load ratings" });
  }
});

app.post("/api/product-reviews", requireAuth, async (req, res) => {
  try {
    const product_id = Number(req.body.product_id);
    if (!product_id) return res.status(400).json({ error: "product_id is required" });
    const raw = Number(req.body.stars);
    const stars = Number.isFinite(raw) ? Math.min(5, Math.max(1, Math.round(raw))) : NaN;
    if (!Number.isFinite(stars)) {
      return res.status(400).json({ error: "stars must be 1–5" });
    }
    let comment = req.body.comment != null ? String(req.body.comment).trim() : "";
    if (comment.length > 2000) comment = comment.slice(0, 2000);
    const p = await get(`SELECT id FROM products WHERE id=?`, [product_id]);
    if (!p) return res.status(404).json({ error: "Product not found" });
    await run(
      `INSERT INTO product_reviews (user_id, product_id, stars, comment) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, product_id) DO UPDATE SET
         stars = excluded.stars,
         comment = excluded.comment,
         created_at = CURRENT_TIMESTAMP`,
      [req.user.id, product_id, stars, comment || null]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to save product review" });
  }
});

app.get("/api/admin/product-reviews", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all(
      `SELECT r.id, r.stars, r.comment, r.created_at,
              u.name AS user_name, u.phone AS user_phone,
              p.id AS product_id, p.name_ar AS product_name_ar, p.name_en AS product_name_en
       FROM product_reviews r
       JOIN users u ON u.id = r.user_id
       JOIN products p ON p.id = r.product_id
       ORDER BY r.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load product reviews" });
  }
});

/** الأكثر مبيعاً من مجموع كميات order_items */
app.get("/api/bestsellers", async (req, res) => {
  try {
    const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));
    const soldRows = await all(
      `SELECT product_id, SUM(qty) AS sold
       FROM order_items
       WHERE product_id IS NOT NULL
       GROUP BY product_id
       ORDER BY sold DESC
       LIMIT ?`,
      [limit]
    );
    const rows = [];
    for (const s of soldRows) {
      const p = await get(`SELECT * FROM products WHERE id=?`, [s.product_id]);
      if (!p) continue;
      const images = await all(`SELECT image_url FROM product_images WHERE product_id=?`, [p.id]);
      const base = mapProductRow(p);
      rows.push({
        ...base,
        sold: Number(s.sold || 0),
        sizes: safeJsonParse(p.sizes_json, []),
        colors: safeJsonParse(p.colors_json, []),
        images: images.map((i) => i.image_url),
      });
    }
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load bestsellers" });
  }
});

/** بانرات قابلة للوضع في الرئيسية — placement: home_top | below_categories | below_brands | below_top_brands | below_flash | below_curated | below_trending */
app.get("/api/banners", async (_req, res) => {
  try {
    const rows = await all(
      `SELECT id, title_ar, title_en, body_ar, body_en, image_url, link_url, placement, sort_order
       FROM app_banners WHERE active=1 ORDER BY placement ASC, sort_order ASC, id ASC`
    );
    const mapped = rows.map((r) => ({
      ...r,
      placement: normalizeBannerPlacementValue(r.placement),
    }));
    res.set("Cache-Control", "no-store, max-age=0");
    return res.json(mapped);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load banners" });
  }
});

app.get("/api/admin/banners", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all(`SELECT * FROM app_banners ORDER BY placement ASC, sort_order ASC, id DESC`);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load banners" });
  }
});

app.post("/api/admin/banners", requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      title_ar = "",
      title_en = "",
      body_ar = "",
      body_en = "",
      image_url,
      link_url = "",
      placement,
      sort_order = 0,
      active = 1,
    } = req.body || {};
    const img = image_url != null ? String(image_url).trim() : "";
    const plRaw = placement != null ? String(placement).trim() : "";
    const pl = normalizeBannerPlacementValue(plRaw);
    if (!pl) return res.status(400).json({ error: "placement required" });
    const ta = String(title_ar).trim();
    const te = String(title_en).trim();
    const ba = String(body_ar).trim();
    const be = String(body_en).trim();
    if (!ta && !te) return res.status(400).json({ error: "title_ar or title_en required" });
    if (!ba && !be) return res.status(400).json({ error: "body_ar or body_en required" });
    const r = await run(
      `INSERT INTO app_banners (title_ar, title_en, body_ar, body_en, image_url, link_url, placement, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(title_ar).trim(),
        String(title_en).trim(),
        String(body_ar).trim(),
        String(body_en).trim(),
        img,
        String(link_url).trim(),
        pl,
        Number(sort_order) || 0,
        Number(active) === 0 ? 0 : 1,
      ]
    );
    return res.status(201).json({ id: r.id });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create banner" });
  }
});

app.put("/api/admin/banners/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      title_ar = "",
      title_en = "",
      body_ar = "",
      body_en = "",
      image_url,
      link_url = "",
      placement,
      sort_order = 0,
      active = 1,
    } = req.body || {};
    const img = image_url != null ? String(image_url).trim() : "";
    const plRaw = placement != null ? String(placement).trim() : "";
    const pl = normalizeBannerPlacementValue(plRaw);
    if (!pl) return res.status(400).json({ error: "placement required" });
    const ta = String(title_ar).trim();
    const te = String(title_en).trim();
    const ba = String(body_ar).trim();
    const be = String(body_en).trim();
    if (!ta && !te) return res.status(400).json({ error: "title_ar or title_en required" });
    if (!ba && !be) return res.status(400).json({ error: "body_ar or body_en required" });
    await run(
      `UPDATE app_banners SET title_ar=?, title_en=?, body_ar=?, body_en=?, image_url=?, link_url=?, placement=?, sort_order=?, active=? WHERE id=?`,
      [
        String(title_ar).trim(),
        String(title_en).trim(),
        String(body_ar).trim(),
        String(body_en).trim(),
        img,
        String(link_url).trim(),
        pl,
        Number(sort_order) || 0,
        Number(active) === 0 ? 0 : 1,
        id,
      ]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update banner" });
  }
});

app.delete("/api/admin/banners/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await run(`DELETE FROM app_banners WHERE id=?`, [Number(req.params.id)]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete banner" });
  }
});

app.get("/api/contact", async (_req, res) => {
  try {
    const row = await get(`SELECT * FROM contact_info LIMIT 1`);
    const home_main_section_images = safeJsonParse(row?.home_main_section_images_json, null);
    const home_subcategory_slides = safeJsonParse(row?.home_subcategory_slides_json, null);
    const home_sections_visibility = mergeHomeSectionsVisibility(safeJsonParse(row?.home_sections_visibility_json, null));
    return res.json({
      ...row,
      phones: safeJsonParse(row.phones_json, []),
      home_main_section_images: home_main_section_images && typeof home_main_section_images === "object" ? home_main_section_images : null,
      home_subcategory_slides: home_subcategory_slides && typeof home_subcategory_slides === "object" ? home_subcategory_slides : null,
      home_sections_visibility,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load contact" });
  }
});

app.put("/api/contact", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const { address, phones = [], whatsapp_phone = "" } = body;
    const cur = await get(
      `SELECT id, home_main_section_images_json, home_subcategory_slides_json, home_sections_visibility_json FROM contact_info ORDER BY id LIMIT 1`
    );
    let homeJson = cur?.home_main_section_images_json ?? null;
    if (body.home_main_section_images !== undefined && body.home_main_section_images !== null && typeof body.home_main_section_images === "object") {
      const h = body.home_main_section_images;
      homeJson = JSON.stringify({
        men: String(h.men ?? "").trim(),
        women: String(h.women ?? "").trim(),
        kids: String(h.kids ?? "").trim(),
      });
    }
    let slidesJson = cur?.home_subcategory_slides_json ?? null;
    if (body.home_subcategory_slides !== undefined && body.home_subcategory_slides !== null && typeof body.home_subcategory_slides === "object") {
      slidesJson = JSON.stringify(body.home_subcategory_slides);
    }
    let visJson = cur?.home_sections_visibility_json ?? null;
    if (body.home_sections_visibility !== undefined && body.home_sections_visibility !== null && typeof body.home_sections_visibility === "object") {
      visJson = JSON.stringify(mergeHomeSectionsVisibility(body.home_sections_visibility));
    }
    await run(
      `UPDATE contact_info SET address=?, phones_json=?, whatsapp_phone=?, home_main_section_images_json=?, home_subcategory_slides_json=?, home_sections_visibility_json=? WHERE id=(SELECT id FROM contact_info ORDER BY id LIMIT 1)`,
      [address, JSON.stringify(phones), whatsapp_phone, homeJson, slidesJson, visJson]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update contact" });
  }
});

app.post(
  "/api/upload/image",
  requireAuth,
  requireAdmin,
  memoryUpload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({
          error:
            "Cloudinary is not configured. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
        });
      }
      const url = await uploadBufferToCloudinary(req.file.buffer);
      return res.json({ url });
    } catch (err) {
      const msg = err && err.message ? String(err.message) : "Upload failed";
      return res.status(500).json({ error: msg });
    }
  }
);

const adminHtmlPath = path.join(__dirname, "public", "admin.html");
function sendAdminPanel(_req, res) {
  res.sendFile(adminHtmlPath, (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("[Adora] admin.html missing — ensure public/admin.html is in the deployed repo.", err.message);
      res.status(500).type("text/plain").send("Admin panel file missing on server. Check that public/admin.html is deployed.");
    }
  });
}
app.get("/admin", sendAdminPanel);
app.get("/admin/", sendAdminPanel);

app.get("/manifest.json", (_req, res) => {
  res.type("application/manifest+json; charset=utf-8");
  res.sendFile(path.join(__dirname, "manifest.json"));
});

/** لا تُقدَّم ملفات قاعدة SQLite كملفات ثابتة */
app.use((req, res, next) => {
  const p = String(req.path || "");
  if (p.endsWith(".sqlite") || p.endsWith(".sqlite-journal") || p.endsWith(".sqlite-wal")) {
    return res.status(404).end();
  }
  next();
});

/** عند فتح التطبيق من رابط Render مباشرة: لا تخزّن sw.js بقوة حتى يتحدّث الـ worker */
app.get("/sw.js", (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.type("application/javascript; charset=utf-8");
  res.sendFile(path.join(__dirname, "sw.js"), (err) => {
    if (err) res.status(404).type("text/plain").send("sw.js not found");
  });
});

app.use(express.static(path.join(__dirname)));

function socketIoCors() {
  const raw = process.env.SOCKET_CORS_ORIGIN || process.env.CORS_ORIGIN;
  if (!raw || !String(raw).trim()) {
    return { origin: "*", methods: ["GET", "POST"] };
  }
  const list = parseCorsOriginEnv(raw);
  if (!list.length) {
    return { origin: "*", methods: ["GET", "POST"] };
  }
  return { origin: list.length === 1 ? list[0] : list, methods: ["GET", "POST"] };
}

initDb()
  .then(() => {
  if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "adora-dev-secret")) {
    // eslint-disable-next-line no-console
    console.warn(
      "[Adora] WARNING: Set JWT_SECRET in production to a long random string (not the default)."
    );
  }
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: socketIoCors(),
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const payload = verifyToken(token);
    if (!payload || !payload.id) {
      return next(new Error("unauthorized"));
    }
    socket.userId = payload.id;
    socket.userRole = payload.role || "user";
    socket.join(`user:${payload.id}`);
    if (socket.userRole !== "admin") {
      socket.join("app-users");
    }
    return next();
  });

  io.on("connection", () => {});

  app.set("io", io);

  server.listen(PORT, "0.0.0.0", () => {
    const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME;
    const publicHint =
      process.env.PUBLIC_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      (renderHost && String(renderHost).trim() ? `https://${String(renderHost).trim()}` : "") ||
      `http://localhost:${PORT}`;
    // eslint-disable-next-line no-console
    console.log(`Adora listening on 0.0.0.0:${PORT} [${NODE_ENV}]`);
    // eslint-disable-next-line no-console
    console.log(`Public URL hint: ${publicHint}`);
  });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[Adora] Database init failed:", err.message || err);
    process.exit(1);
  });

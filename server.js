require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { all, get, run, initDb, getDatabaseOverview } = require("./db");
const http = require("http");
const { Server } = require("socket.io");
const { signToken, requireAuth, requireAdmin, verifyToken } = require("./auth");
const multer = require("multer");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

if (isProd) {
  app.set("trust proxy", 1);
}

function corsOptions() {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || !String(raw).trim()) {
    return { origin: true, credentials: true };
  }
  const list = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { origin: list.length === 1 ? list[0] : list, credentials: true };
}

app.use(cors(corsOptions()));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
/* static files registered after all /api routes so paths like /api/* are never swallowed */

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (_req, file, cb) {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const stamp = Date.now();
    cb(null, `${stamp}_${safe}`);
  },
});
const upload = multer({ storage });

function publicUrl(fileName) {
  // Express static serves from __dirname, so /uploads/<file> works.
  return `/uploads/${fileName}`;
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch (err) {
    return fallback;
  }
}

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const existing = await get(`SELECT id FROM users WHERE phone=?`, [phone]);
    if (existing) return res.status(409).json({ error: "Phone already exists" });
    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      `INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, 'user')`,
      [name, phone, hash]
    );
    const now = new Date().toISOString();
    await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [now, result.id]);
    const user = await get(
      `SELECT id, name, phone, role, credentials_acknowledged, notifications_enabled FROM users WHERE id=?`,
      [result.id]
    );
    const token = signToken({ id: user.id, name: user.name, phone: user.phone, role: user.role });
    return res.json({ token, user });
  } catch (err) {
    return res.status(500).json({ error: "Failed to sign up" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await get(`SELECT * FROM users WHERE phone=?`, [phone]);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });
    await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [new Date().toISOString(), user.id]);
    const payload = {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      notifications_enabled: user.notifications_enabled,
      credentials_acknowledged: user.credentials_acknowledged,
    };
    const token = signToken(payload);
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
  });
});

/** إعدادات عامة للواجهة (بدون مصادقة) — رابط تنزيل التطبيق من متغير البيئة */
app.get("/api/public-config", (_req, res) => {
  res.json({
    app_download_url: String(process.env.ADORA_APP_DOWNLOAD_URL || "").trim(),
  });
});

/** أرقام مجمّعة من SQLite للواجهة — لا يعرض صفوفاً خام */
app.get("/api/public/stats", async (_req, res) => {
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
      engine: "sqlite",
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load stats" });
  }
});

async function loadUserProfileBundle(userId) {
  await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [new Date().toISOString(), userId]);
  const user = await get(
    `SELECT id, name, phone, role, created_at, notifications_enabled, notifications_snoozed_until, credentials_acknowledged, last_activity_at
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
    const { name, phone } = req.body;
    const n = name != null ? String(name).trim() : "";
    const p = phone != null ? String(phone).trim() : "";
    if (!n || !p) return res.status(400).json({ error: "Missing name or phone" });
    const dup = await get(`SELECT id FROM users WHERE phone=? AND id!=?`, [p, req.user.id]);
    if (dup) return res.status(409).json({ error: "Phone already exists" });
    await run(`UPDATE users SET name=?, phone=? WHERE id=?`, [n, p, req.user.id]);
    const user = await get(
      `SELECT id, name, phone, role, created_at, notifications_enabled, notifications_snoozed_until, credentials_acknowledged, last_activity_at FROM users WHERE id=?`,
      [req.user.id]
    );
    const token = signToken({ id: user.id, name: user.name, phone: user.phone, role: user.role });
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

/** ملخص الجداول (عدد الصفوف) — للمشرف فقط؛ الملف غير معروض للتنزيل */
app.get("/api/admin/database/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const overview = await getDatabaseOverview();
    return res.json({
      ...overview,
      note: "SQLite is internal to this Node process. Use this dashboard or REST APIs — no direct file access.",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load database overview" });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all(
      `SELECT u.id, u.name, u.phone, u.role, u.created_at, u.last_activity_at,
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
    const messages = await all(
      `SELECT id, title_ar, title_en, body_ar, body_en, created_at FROM broadcast_messages ORDER BY id DESC LIMIT 100`
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
      `SELECT id, message, target_user_id, created_at FROM in_app_notifications
       WHERE target_user_id IS NULL OR target_user_id = ?
       ORDER BY id DESC LIMIT 200`,
      [req.user.id]
    );
    const inReads = await all(`SELECT notification_id FROM in_app_notification_reads WHERE user_id=?`, [req.user.id]);
    const inReadSet = new Set(inReads.map((r) => r.notification_id));
    const inAppRows = inApp.map((n) => ({
      kind: "in_app",
      id: n.id,
      message: n.message,
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

app.post("/api/notifications/read", requireAuth, async (req, res) => {
  try {
    const { kind, id } = req.body || {};
    const nid = Number(id);
    if (!kind || !Number.isFinite(nid)) return res.status(400).json({ error: "kind and id required" });
    if (kind === "broadcast") {
      const exists = await get(`SELECT id FROM broadcast_messages WHERE id=?`, [nid]);
      if (!exists) return res.status(404).json({ error: "Not found" });
      await run(`INSERT OR IGNORE INTO user_broadcast_reads (user_id, broadcast_id) VALUES (?, ?)`, [req.user.id, nid]);
      return res.json({ ok: true });
    }
    if (kind === "in_app") {
      const row = await get(`SELECT id FROM in_app_notifications WHERE id=? AND (target_user_id IS NULL OR target_user_id=?)`, [
        nid,
        req.user.id,
      ]);
      if (!row) return res.status(404).json({ error: "Not found" });
      await run(`INSERT OR IGNORE INTO in_app_notification_reads (user_id, notification_id) VALUES (?, ?)`, [req.user.id, nid]);
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
    await run(`INSERT OR IGNORE INTO user_broadcast_reads (user_id, broadcast_id) VALUES (?, ?)`, [req.user.id, id]);
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
    message: row.message,
    created_at: row.created_at,
  };
  if (targetUserId != null) {
    io.to(`user:${targetUserId}`).emit("notification:new", payload);
  } else {
    io.to("app-users").emit("notification:new", payload);
  }
}

app.post("/api/admin/notifications/send", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { message, target_user_id } = req.body || {};
    const text = message != null ? String(message).trim() : "";
    if (!text) return res.status(400).json({ error: "message required" });
    let uid = null;
    if (target_user_id != null && target_user_id !== "") {
      uid = Number(target_user_id);
      if (!Number.isFinite(uid)) return res.status(400).json({ error: "Invalid target_user_id" });
      const u = await get(`SELECT id FROM users WHERE id=? AND COALESCE(role,'user') != 'admin'`, [uid]);
      if (!u) return res.status(404).json({ error: "User not found" });
    }
    const result = await run(`INSERT INTO in_app_notifications (message, target_user_id) VALUES (?, ?)`, [text, uid]);
    const row = await get(`SELECT id, message, target_user_id, created_at FROM in_app_notifications WHERE id=?`, [result.id]);
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
      `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone
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

app.get("/api/products", async (req, res) => {
  try {
    const { category, subcategory, brand, featured, flash, q, min_price, max_price, no_brand } = req.query;
    const where = [];
    const params = [];
    if (no_brand === "1" || no_brand === "true") {
      where.push(`(brand IS NULL OR TRIM(brand) = '')`);
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
    const qtrim = q != null ? String(q).trim() : "";
    if (qtrim) {
      const term = `%${qtrim}%`;
      where.push(
        `(name_ar LIKE ? OR name_en LIKE ? OR IFNULL(brand,'') LIKE ? OR description LIKE ? OR category LIKE ? OR IFNULL(subcategory,'') LIKE ?)`
      );
      params.push(term, term, term, term, term, term);
    }
    if (min_price !== undefined && min_price !== "" && !Number.isNaN(Number(min_price))) {
      where.push(`price >= ?`);
      params.push(Number(min_price));
    }
    if (max_price !== undefined && max_price !== "" && !Number.isNaN(Number(max_price))) {
      where.push(`price <= ?`);
      params.push(Number(max_price));
    }
    const sql = `SELECT * FROM products ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC`;
    const products = await all(sql, params);
    const rows = [];
    for (const p of products) {
      const images = await all(`SELECT image_url FROM product_images WHERE product_id=?`, [p.id]);
      rows.push({
        ...p,
        sizes: safeJsonParse(p.sizes_json, []),
        colors: safeJsonParse(p.colors_json, []),
        images: images.map((i) => i.image_url),
      });
    }
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load products" });
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
    return res.json({
      ...p,
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
      badge = "",
      is_featured = 0,
      is_flash_sale = 0,
      flash_sale_end_time = null,
    } = req.body;
    if (!name_ar || !name_en || !description || !category) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const result = await run(
      `INSERT INTO products (
        name_ar, name_en, description, price, discount, category, subcategory, brand,
        sizes_json, colors_json, stock, badge, is_featured, is_flash_sale, flash_sale_end_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        badge,
        is_featured ? 1 : 0,
        is_flash_sale ? 1 : 0,
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
      badge = "",
      is_featured = 0,
      is_flash_sale = 0,
      flash_sale_end_time = null,
    } = req.body;
    await run(
      `UPDATE products SET
        name_ar=?, name_en=?, description=?, price=?, discount=?, category=?, subcategory=?, brand=?,
        sizes_json=?, colors_json=?, stock=?, badge=?, is_featured=?, is_flash_sale=?, flash_sale_end_time=?
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
        badge,
        is_featured ? 1 : 0,
        is_flash_sale ? 1 : 0,
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
        (SELECT COUNT(*) FROM products p WHERE TRIM(IFNULL(p.brand,'')) = TRIM(b.name)) AS product_count
       FROM brands b
       ORDER BY b.is_top_brand DESC, b.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load brands" });
  }
});

app.post("/api/brands", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, logo = "", is_top_brand = 0 } = req.body;
    const result = await run(`INSERT INTO brands (name, logo, is_top_brand) VALUES (?, ?, ?)`, [
      name,
      logo,
      is_top_brand ? 1 : 0,
    ]);
    return res.status(201).json({ id: result.id });
  } catch (err) {
    return res.status(500).json({ error: "Failed to add brand" });
  }
});

app.put("/api/brands/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, logo = "", is_top_brand = 0 } = req.body;
    await run(`UPDATE brands SET name=?, logo=?, is_top_brand=? WHERE id=?`, [
      name,
      logo,
      is_top_brand ? 1 : 0,
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

const ORDER_STATUS_KEYS = ["pending_receipt", "in_progress", "fulfilled", "shipping", "delivered"];

function orderStatusNotifyMessageAr(status) {
  const m = {
    pending_receipt: "تم تحديث حالة طلبك إلى: قيد الاستلام",
    in_progress: "تم تحديث حالة طلبك إلى: قيد التنفيذ",
    fulfilled: "تم تحديث حالة طلبك إلى: تم التنفيذ",
    shipping: "تم تحديث حالة طلبك إلى: جاري الشحن",
    delivered: "تم تحديث حالة طلبك إلى: تم استلام طلبك",
  };
  return m[status] || `تم تحديث حالة طلبك (${status})`;
}

app.post("/api/orders", requireAuth, async (req, res) => {
  try {
    const { products = [], total_price = 0, payment_method = "cod", source = "system" } = req.body;
    const productLines = Array.isArray(products) ? products : [];
    if (productLines.length === 0) {
      return res.status(400).json({ error: "Order must include at least one product" });
    }
    /** الحالة الأولى دائماً «قيد الاستلام» — لا يُقبل تمرير حالة من الزبون */
    const status = "pending_receipt";
    const orderNo = `ORD-${Math.floor(Math.random() * 900000 + 100000)}`;
    const result = await run(
      `INSERT INTO orders (order_no, user_id, total_price, status, payment_method, source) VALUES (?, ?, ?, ?, ?, ?)`,
      [orderNo, req.user.id, Number(total_price || 0), status, payment_method, source]
    );

    await run(`INSERT INTO order_status_history (order_id, status) VALUES (?, ?)`, [result.id, status]);

    for (const item of productLines) {
      await run(
        `INSERT INTO order_items (order_id, product_id, product_name, qty, price, image_url, color, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.id,
          item.product_id || null,
          item.product_name || "Item",
          Number(item.qty || 1),
          Number(item.price || 0),
          item.image_url != null ? String(item.image_url) : "",
          item.color != null ? String(item.color) : "",
          item.size != null ? String(item.size) : "",
        ]
      );
      const pid = item.product_id != null ? Number(item.product_id) : null;
      const qn = Number(item.qty || 1);
      if (pid && qn > 0) {
        await run(`UPDATE products SET stock = COALESCE(stock, 0) - ? WHERE id=?`, [qn, pid]);
      }
    }
    await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [new Date().toISOString(), req.user.id]);
    const saved = await get(`SELECT * FROM orders WHERE id=?`, [result.id]);
    const items = await all(
      `SELECT id, product_id, product_name, qty, price, image_url, color, size
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
      `SELECT id, product_id, product_name, qty, price, image_url, color, size
       FROM order_items WHERE order_id=? ORDER BY id ASC`,
      [orderId]
    );
    return res.json({ order, history, items });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load tracking" });
  }
});

app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const rows =
      req.user.role === "admin"
        ? await all(
            `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             ORDER BY o.id DESC`
          )
        : await all(
            `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             WHERE o.user_id=?
             ORDER BY o.id DESC`,
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
        const ins = await run(`INSERT INTO in_app_notifications (message, target_user_id) VALUES (?, ?)`, [msg, order.user_id]);
        const row = await get(`SELECT id, message, target_user_id, created_at FROM in_app_notifications WHERE id=?`, [ins.id]);
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
       ON CONFLICT(user_id, product_id) DO UPDATE SET
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

app.get("/api/contact", async (_req, res) => {
  try {
    const row = await get(`SELECT * FROM contact_info LIMIT 1`);
    return res.json({ ...row, phones: safeJsonParse(row.phones_json, []) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load contact" });
  }
});

app.put("/api/contact", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { address, phones = [], whatsapp_phone = "" } = req.body;
    await run(`UPDATE contact_info SET address=?, phones_json=?, whatsapp_phone=? WHERE id=(SELECT id FROM contact_info LIMIT 1)`, [
      address,
      JSON.stringify(phones),
      whatsapp_phone,
    ]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update contact" });
  }
});

app.post("/api/upload/image", requireAuth, requireAdmin, upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file is required" });
    return res.json({ url: publicUrl(req.file.filename) });
  } catch (err) {
    return res.status(500).json({ error: "Upload failed" });
  }
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

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

app.use(express.static(path.join(__dirname)));

function socketIoCors() {
  const raw = process.env.SOCKET_CORS_ORIGIN || process.env.CORS_ORIGIN;
  if (!raw || !String(raw).trim()) {
    return { origin: "*", methods: ["GET", "POST"] };
  }
  const list = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { origin: list.length === 1 ? list[0] : list, methods: ["GET", "POST"] };
}

initDb().then(() => {
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
    const publicHint = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    // eslint-disable-next-line no-console
    console.log(`Adora listening on 0.0.0.0:${PORT} [${NODE_ENV}]`);
    // eslint-disable-next-line no-console
    console.log(`Public URL (set PUBLIC_URL in .env): ${publicHint}`);
  });
});

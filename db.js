const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");

/**
 * SQLite داخل عملية Node فقط — ملف محلي على قرص الخدمة (Render free: نفس المثيل).
 * لا يوجد اتصال بقاعدة خارجية عبر الشبكة؛ الوصول للبيانات عبر server.js / الـ API فقط.
 * مثال لمسار صريح: SQLITE_PATH=/var/data/adora.sqlite
 */
const dbPath = process.env.SQLITE_PATH || path.join(__dirname, "adora.sqlite");
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDb() {
  await run(`PRAGMA foreign_keys = ON`);

  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    logo TEXT,
    is_top_brand INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    subcategories_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    category TEXT NOT NULL,
    subcategory TEXT,
    brand TEXT,
    sizes_json TEXT NOT NULL DEFAULT '[]',
    colors_json TEXT NOT NULL DEFAULT '[]',
    stock INTEGER NOT NULL DEFAULT 0,
    badge TEXT,
    is_featured INTEGER NOT NULL DEFAULT 0,
    is_flash_sale INTEGER NOT NULL DEFAULT 0,
    flash_sale_end_time TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    total_price REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS order_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS contact_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    phones_json TEXT NOT NULL DEFAULT '[]',
    whatsapp_phone TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS product_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    banner_image_url TEXT,
    discount_percent REAL NOT NULL DEFAULT 0,
    offer_end_time TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS broadcast_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_ar TEXT NOT NULL,
    title_en TEXT NOT NULL,
    body_ar TEXT,
    body_en TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS user_broadcast_reads (
    user_id INTEGER NOT NULL,
    broadcast_id INTEGER NOT NULL,
    read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, broadcast_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(broadcast_id) REFERENCES broadcast_messages(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS in_app_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    target_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS in_app_notification_reads (
    user_id INTEGER NOT NULL,
    notification_id INTEGER NOT NULL,
    read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, notification_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(notification_id) REFERENCES in_app_notifications(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS site_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS product_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    stars INTEGER NOT NULL,
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(user_id, product_id)
  )`);

  const admin = await get(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  if (!admin) {
    const hash = await bcrypt.hash("admin123", 10);
    await run(
      `INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, 'admin')`,
      ["Admin", "0000000000", hash]
    );
  }

  const contact = await get(`SELECT id FROM contact_info LIMIT 1`);
  if (!contact) {
    await run(
      `INSERT INTO contact_info (address, phones_json, whatsapp_phone) VALUES (?, ?, ?)`,
      ["Riyadh, Saudi Arabia", JSON.stringify(["+966500000001", "+966500000002"]), "+966500000001"]
    );
  }

  const categoryCount = await get(`SELECT COUNT(*) AS c FROM categories`);
  if (!categoryCount || categoryCount.c === 0) {
    await run(
      `INSERT INTO categories (name, subcategories_json) VALUES (?, ?), (?, ?), (?, ?)`,
      [
        "Men",
        JSON.stringify(["T-Shirts", "Shirts", "Pants", "Jackets", "Shoes", "Accessories"]),
        "Women",
        JSON.stringify(["Dresses", "Tops", "Pants", "Heels", "Bags", "Accessories"]),
        "Kids",
        JSON.stringify(["Boys", "Girls", "Baby", "Sets", "Shoes", "Outerwear"]),
      ]
    );
  }

  await migrateUsersColumns();
  await migrateOrderItemsColumns();
  await migrateOrderStatusesToV2();
  await mergeCategorySubcategoriesWithDefaults();

  try {
    await run(`UPDATE contact_info SET whatsapp_phone=? WHERE id=(SELECT id FROM contact_info LIMIT 1)`, ["971588978943"]);
  } catch (_e) {
    /* ignore */
  }
}

/** يضيف أسماء الأقسام الفرعية الافتراضية إلى قواعد قديمة دون حذف ما عرّفه المدير */
async function mergeCategorySubcategoriesWithDefaults() {
  const defaults = {
    Men: ["T-Shirts", "Shirts", "Pants", "Jackets", "Shoes", "Accessories"],
    Women: ["Dresses", "Tops", "Pants", "Heels", "Bags", "Accessories"],
    Kids: ["Boys", "Girls", "Baby", "Sets", "Shoes", "Outerwear"],
  };
  for (const [name, subs] of Object.entries(defaults)) {
    const row = await get(`SELECT id, subcategories_json FROM categories WHERE name=?`, [name]);
    if (!row) continue;
    let existing = [];
    try {
      existing = JSON.parse(row.subcategories_json || "[]");
    } catch (_e) {
      existing = [];
    }
    if (!Array.isArray(existing)) existing = [];
    const merged = [...new Set([...existing, ...subs])];
    await run(`UPDATE categories SET subcategories_json=? WHERE id=?`, [JSON.stringify(merged), row.id]);
  }
}

async function migrateUsersColumns() {
  const cols = await all(`PRAGMA table_info(users)`);
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("notifications_enabled")) {
    await run(`ALTER TABLE users ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  if (!names.has("notifications_snoozed_until")) {
    await run(`ALTER TABLE users ADD COLUMN notifications_snoozed_until TEXT`);
  }
  if (!names.has("credentials_acknowledged")) {
    await run(`ALTER TABLE users ADD COLUMN credentials_acknowledged INTEGER NOT NULL DEFAULT 0`);
  }
  if (!names.has("last_activity_at")) {
    await run(`ALTER TABLE users ADD COLUMN last_activity_at TEXT`);
  }
}

async function migrateOrderItemsColumns() {
  const cols = await all(`PRAGMA table_info(order_items)`);
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("image_url")) await run(`ALTER TABLE order_items ADD COLUMN image_url TEXT`);
  if (!names.has("color")) await run(`ALTER TABLE order_items ADD COLUMN color TEXT`);
  if (!names.has("size")) await run(`ALTER TABLE order_items ADD COLUMN size TEXT`);
}

/** ترحيل حالات الطلب القديمة إلى المفاتيح الجديدة (لوحة التحكم فقط تغيّر الحالة) */
async function migrateOrderStatusesToV2() {
  const pairs = [
    ["pending", "pending_receipt"],
    ["processing", "in_progress"],
    ["shipped", "shipping"],
  ];
  for (const [from, to] of pairs) {
    try {
      await run(`UPDATE orders SET status=? WHERE status=?`, [to, from]);
    } catch (_e) {
      /* ignore */
    }
    try {
      await run(`UPDATE order_status_history SET status=? WHERE status=?`, [to, from]);
    } catch (_e) {
      /* ignore */
    }
  }
}

/** جداول آمنة للعدّ (أسماء من sqlite_master مع تحقق) */
async function getDatabaseOverview() {
  const rows = await all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );
  const tables = [];
  let totalRows = 0;
  for (const row of rows) {
    const name = String(row.name || "");
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const r = await get(`SELECT COUNT(*) AS c FROM ${quoted}`);
    const c = Number(r?.c ?? 0);
    totalRows += c;
    tables.push({ name, rowCount: c });
  }
  return { engine: "sqlite", internalOnly: true, tables, totalRows };
}

module.exports = { db, run, get, all, initDb, getDatabaseOverview };

/**
 * نقل البيانات من ملف SQLite (adora.sqlite) إلى PostgreSQL عبر DATABASE_URL.
 *
 * الاستخدام:
 *   DATABASE_URL="postgres://..." node scripts/migrate-sqlite-to-pg.cjs [مسار_ملف_sqlite]
 *
 * يتطلب devDependency: sqlite3  (npm ci مع dev، أو npm install sqlite3 --save-dev)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

if (!process.env.DATABASE_URL || !String(process.env.DATABASE_URL).trim()) {
  console.error("عيّن DATABASE_URL لقاعدة PostgreSQL قبل تشغيل السكربت.");
  process.exit(1);
}

const { pool, initDb, columnNames } = require("../db.js");

const TABLES_IN_ORDER = [
  "users",
  "brands",
  "categories",
  "products",
  "product_images",
  "orders",
  "order_status_history",
  "order_items",
  "contact_info",
  "product_offers",
  "broadcast_messages",
  "user_broadcast_reads",
  "in_app_notifications",
  "in_app_notification_reads",
  "site_ratings",
  "product_reviews",
  "app_banners",
];

function openSqlite(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function sqliteClose(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function tableExistsSqlite(db, name) {
  const row = await sqliteAll(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [name]
  );
  return row.length > 0;
}

async function syncSerialSequences() {
  const serialTables = await pool.query(`
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'id'
      AND c.column_default IS NOT NULL
      AND c.column_default LIKE '%nextval%'
  `);
  for (const { table_name } of serialTables.rows) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table_name)) continue;
    const q = `"${table_name.replace(/"/g, '""')}"`;
    const maxRow = await pool.query(`SELECT MAX(id) AS m FROM ${q}`);
    const m = maxRow.rows[0]?.m;
    const seq = await pool.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [table_name]);
    const seqName = seq.rows[0]?.s;
    if (!seqName) continue;
    if (m == null) {
      await pool.query(`SELECT setval($1::regclass, 1, false)`, [seqName]);
    } else {
      await pool.query(`SELECT setval($1::regclass, $2::bigint, true)`, [seqName, m]);
    }
  }
}

async function copyTable(sqliteDb, table) {
  if (!(await tableExistsSqlite(sqliteDb, table))) {
    console.warn(`[migrate] SQLite: جدول غير موجود — تخطي: ${table}`);
    return;
  }
  const rows = await sqliteAll(sqliteDb, `SELECT * FROM ${table}`);
  if (!rows.length) {
    console.log(`[migrate] ${table}: 0 صفوف`);
    return;
  }
  const pgCols = await columnNames(table);
  const colSet = new Set(pgCols);
  let inserted = 0;
  for (const row of rows) {
    const cols = Object.keys(row).filter((k) => colSet.has(k));
    if (!cols.length) continue;
    const vals = cols.map((c) => row[c]);
    const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
    const quotedCols = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
    const qTable = `"${table.replace(/"/g, '""')}"`;
    await pool.query(`INSERT INTO ${qTable} (${quotedCols}) VALUES (${ph})`, vals);
    inserted++;
  }
  console.log(`[migrate] ${table}: ${inserted} صفاً`);
}

async function main() {
  const sqlitePath = path.resolve(process.argv[2] || path.join(__dirname, "..", "adora.sqlite"));
  if (!fs.existsSync(sqlitePath)) {
    console.error("ملف SQLite غير موجود:", sqlitePath);
    process.exit(1);
  }
  console.log("تهيئة مخطط PostgreSQL (initDb)…");
  await initDb();

  const client = await pool.connect();
  try {
    console.log("تفريغ الجداول على PostgreSQL…");
    await client.query(`
      TRUNCATE TABLE
        in_app_notification_reads,
        user_broadcast_reads,
        order_status_history,
        order_items,
        product_images,
        product_offers,
        product_reviews,
        site_ratings,
        orders,
        in_app_notifications,
        products,
        broadcast_messages,
        app_banners,
        categories,
        brands,
        contact_info,
        users
      RESTART IDENTITY CASCADE
    `);
  } finally {
    client.release();
  }

  const sqliteDb = await openSqlite(sqlitePath);
  try {
    for (const t of TABLES_IN_ORDER) {
      await copyTable(sqliteDb, t);
    }
  } finally {
    await sqliteClose(sqliteDb);
  }

  console.log("مزامنة تسلسلات SERIAL…");
  await syncSerialSequences();
  console.log("تم النقل.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

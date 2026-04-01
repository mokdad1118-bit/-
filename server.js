require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const { all, get, run, initDb, getDatabaseOverview } = require("./db");
const { arabicSearchQueryVariants, sqlLikePrefixParam, sqlLikeContainsParam } = require("./search-utils");
const http = require("http");
const { Server } = require("socket.io");
const { signToken, requireAuth, requireAdmin, verifyToken, optionalAuth } = require("./auth");
const { getPublicOAuthConfig, handleOAuthSignIn } = require("./auth-oauth");
const { isWebPushConfigured, sanitizeHttpsUrl, notifyInAppRow } = require("./push-notify");
const {
  registerMarketplaceRoutes,
  fetchMarketplaceProductsForListingSearchMerge,
  mapProductRow: mapMarketplaceProductRow,
} = require("./marketplace-routes");
const { registerVendorPlatformRoutes } = require("./vendor-platform-routes");
const { getVendorPlatformSettings } = require("./vendor-platform-settings");
const { isEmailTransportConfigured, sendSignupOtpEmail } = require("./email-signup-mail");
const { registerVendorPortalRoutes } = require("./vendor-portal-routes");
const { registerAdoraCompanyAdminRoutes } = require("./adora-company-admin-routes");
const { registerVendorContactAdminRoutes } = require("./vendor-contact-routes");
const {
  createFulfillmentsForOrder,
  parseShippingStructured,
  shippingStructuredComplete,
} = require("./adora-mv-core");

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

/** Ù„Ù„ØªØ´Ø®ÙŠØµ: Ù…Ø³ØªØ®Ø¯Ù… Ù…Ø¤Ù‡Ù„ Ù„Ø§Ø³ØªÙ„Ø§Ù… Ø¨Ø« Push (Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù…ÙØ¹Ù‘Ù„Ø© ÙˆÙ„ÙŠØ³ ÙÙŠ ÙØªØ±Ø© ÙƒØªÙ…) */
function sqlPushUserEligible() {
  return `(COALESCE(u.notifications_enabled, 0) = 1 AND (u.notifications_snoozed_until IS NULL OR TRIM(COALESCE(u.notifications_snoozed_until::text, '')) = '' OR (u.notifications_snoozed_until)::timestamptz <= NOW()))`;
}
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

/** Ø±Ø§Ø¨Ø· Ø¥Ø´Ø¹Ø§Ø±: https ÙƒØ§Ù…Ù„ Ø£Ùˆ Ù…Ø³Ø§Ø± Ø¯Ø§Ø®Ù„ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ ÙŠØ¨Ø¯Ø£ Ø¨Ù€ / */
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

/** CORS ÙŠØªØ·Ù„Ø¨ Ø£ØµÙ„Ø§Ù‹ ÙƒØ§Ù…Ù„Ø§Ù‹ Ù…Ø«Ù„ https://example.com â€” Ø¥Ù† ÙˆÙØ¶Ø¹ example.com ÙÙ‚Ø· Ù†Ø¶ÙŠÙ https:// */
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

const ADORA_LOCAL_UPLOADS_DIR = path.join(__dirname, "public", "uploads");

function ensureLocalUploadsDir() {
  try {
    fs.mkdirSync(ADORA_LOCAL_UPLOADS_DIR, { recursive: true });
  } catch (_e) {
    /* ignore */
  }
}

function localUploadImageExtension(originalname) {
  const ext = path.extname(String(originalname || "")).toLowerCase();
  if (/^\.(jpe?g|png|gif|webp|svg)$/.test(ext)) return ext;
  return ".jpg";
}

async function saveLocalUploadFromBuffer(buffer, originalname) {
  ensureLocalUploadsDir();
  const ext = localUploadImageExtension(originalname);
  const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  const fp = path.join(ADORA_LOCAL_UPLOADS_DIR, name);
  await fs.promises.writeFile(fp, buffer);
  return `/uploads/${name}`;
}

if (isCloudinaryConfigured()) {
  // eslint-disable-next-line no-console
  console.log("[Adora] Image uploads: Cloudinary (HTTPS URLs). Local /uploads/ still served if present.");
} else {
  ensureLocalUploadsDir();
  // eslint-disable-next-line no-console
  console.warn(
    "[Adora] Cloudinary is not configured â€” uploads save to public/uploads (served at /uploads/). Use CLOUDINARY_* in production for persistent CDN URLs."
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
  mp_premium_vendors: true,
  top_brands: true,
  mp_featured_marketplace_products: true,
  flash_sale: true,
  curated: true,
  home_featured: true,
  promo_collection: true,
  bestsellers: true,
};

/** Labels for admin UI + `/api/admin/home-sections/keys` — keep keys in sync with DEFAULT_HOME_SECTIONS_VISIBILITY */
const HOME_SECTION_LABELS = {
  banners: { ar: "البانرات الترويجية (كل المواضع)", en: "Promo banners (all slots)" },
  comprehensive_market: { ar: "السوق الشامل (مولات وشركات…)", en: "Comprehensive market (malls & companies)" },
  main_categories: { ar: "الأقسام الرئيسية (رجالي / نسائي / ولادي)", en: "Main categories (Men / Women / Kids)" },
  brands: { ar: "الشركات المتاحة داخل التطبيق", en: "Companies available in the app" },
  mp_premium_vendors: { ar: "شركات مميزة (السوق الشامل)", en: "Featured marketplace companies" },
  top_brands: { ar: "العلامات المميزة", en: "Featured brands" },
  mp_featured_marketplace_products: { ar: "منتجات مميزة (السوق الشامل)", en: "Featured marketplace products" },
  flash_sale: { ar: "عروض لفترة محدودة", en: "Limited-time offers" },
  curated: { ar: "اختيارات أنيقة (العنوان والوصف)", en: "Curated picks (header & intro)" },
  home_featured: { ar: "منتجات مميزة (الشريط الأفقي)", en: "Featured products (horizontal strip)" },
  promo_collection: { ar: "وصل حديثاً / المجموعة الترويجية", en: "New collection / promo strip" },
  bestsellers: { ar: "الأكثر مبيعاً", en: "Bestsellers" },
};

/** ترتيب الكتل داخل #home-reorder-root */
const HOME_SECTION_ORDER_KEYS = [
  "comprehensive_market",
  "banner_home_top",
  "main_categories",
  "home_subcat_overlay",
  "banner_below_categories",
  "brands",
  "mp_premium_vendors",
  "banner_below_brands",
  "top_brands",
  "mp_featured_marketplace_products",
  "banner_below_top_brands",
  "flash_sale",
  "banner_below_flash",
  "curated",
  "banner_below_curated",
  "promo_collection",
  "banner_below_trending",
  "bestsellers",
];

const HOME_SECTION_ORDER_LABELS = {
  comprehensive_market: { ar: "السوق الشامل", en: "Comprehensive market" },
  banner_home_top: { ar: "بانر أعلى الرئيسية (تحت السوق الشامل)", en: "Top home banner (below market block)" },
  main_categories: { ar: "الأقسام الرئيسية (رجالي / نسائي / ولادي)", en: "Main categories" },
  home_subcat_overlay: { ar: "لوحة الفئات الفرعية (منبثقة)", en: "Subcategory bottom sheet (fixed overlay)" },
  banner_below_categories: { ar: "بانر تحت الأقسام الرئيسية", en: "Banner below main categories" },
  brands: { ar: "الشركات المتاحة داخل التطبيق", en: "Companies in the app" },
  mp_premium_vendors: { ar: "شركات مميزة (سوق الشركات)", en: "Featured marketplace companies" },
  banner_below_brands: { ar: "بانر تحت صف الشركات", en: "Banner below companies row" },
  top_brands: { ar: "العلامات المميزة", en: "Featured brands" },
  mp_featured_marketplace_products: { ar: "منتجات مميزة (سوق الشركات)", en: "Featured marketplace products" },
  banner_below_top_brands: { ar: "بانر تحت العلامات المميزة", en: "Banner below featured brands" },
  flash_sale: { ar: "عروض لفترة محدودة", en: "Limited-time offers" },
  banner_below_flash: { ar: "بانر تحت العروض المحدودة", en: "Banner below flash offers" },
  curated: { ar: "اختيارات أنيقة", en: "Curated picks" },
  banner_below_curated: { ar: "بانر تحت الاختيارات الأنيقة", en: "Banner below curated" },
  promo_collection: { ar: "وصل حديثاً / المجموعة الترويجية", en: "New collection strip" },
  banner_below_trending: { ar: "بانر قبل الأكثر مبيعاً", en: "Banner before bestsellers" },
  bestsellers: { ar: "الأكثر مبيعاً", en: "Bestsellers" },
};

function mergeHomeSectionsOrder(raw) {
  const allowed = new Set(HOME_SECTION_ORDER_KEYS);
  const def = [...HOME_SECTION_ORDER_KEYS];
  if (!Array.isArray(raw)) return def;
  const rawHadBannerHomeTop = raw.some((k) => k === "banner_home_top");
  const seen = new Set();
  const out = [];
  for (const k of raw) {
    if (typeof k !== "string" || !allowed.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  for (const k of def) {
    if (!seen.has(k)) out.push(k);
  }
  const mi = out.indexOf("comprehensive_market");
  const bi = out.indexOf("banner_home_top");
  if (!rawHadBannerHomeTop && mi >= 0 && bi >= 0) {
    out.splice(bi, 1);
    const mi2 = out.indexOf("comprehensive_market");
    out.splice(mi2 + 1, 0, "banner_home_top");
  }
  return out;
}

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

function firstMarketplaceImageFromImagesJson(raw) {
  const arr = safeJsonParse(raw, []);
  if (!Array.isArray(arr) || !arr.length) return null;
  const u = arr[0];
  const s = u != null ? String(u).trim() : "";
  return s || null;
}

/** ÙŠØ·Ø§Ø¨Ù‚ placement Ù…Ø¹ Ø¹Ù†Ø§ØµØ± banner-slot-* ÙÙŠ Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© */
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
    listingtop: "listing_top",
    offerstop: "offers_top",
    wishlisttop: "wishlist_top",
    marketplacetop: "marketplace_top",
    producttop: "product_top",
    mpproducttop: "mp_product_top",
    carttop: "cart_top",
    checkouttop: "checkout_top",
    profiletop: "profile_top",
    ordertrackingtop: "order_tracking_top",
    vendorjointop: "vendor_join_top",
    appadinquirytop: "app_ad_inquiry_top",
    categoriestop: "categories_top",
    featuredhubtop: "featured_hub_top",
  };
  return aliases[s] || s;
}

/** Ø£Ù‚Ø³Ø§Ù… Ø´Ø§Ø´Ø© Â«Ù…Ù…ÙŠØ²Â» Ø§Ù„Ø«Ø§Ø¨ØªØ© ÙÙŠ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ */
const FEATURED_HUB_SECTIONS = new Set([
  "clothes",
  "electronics",
  "phones",
  "shoes",
  "accessories",
  "bedding",
  "medical",
  "used",
]);

function normalizeFeaturedHubSection(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return FEATURED_HUB_SECTIONS.has(s) ? s : null;
}

/** Ø§Ù„Ø±Ù‚Ù… Ø§Ù„ØªØ§Ù„ÙŠ Ø¨ØµÙŠØºØ© ORD-00001 â€” Ù…ØªØ³Ù„Ø³Ù„ Ù…Ù† Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª */
async function allocateNextOrderNo() {
  const row = await get(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(order_no FROM 5) AS INTEGER)), 0) AS n
     FROM orders
     WHERE order_no LIKE 'ORD-%' AND SUBSTRING(order_no FROM 5) ~ '^[0-9]+$'`
  );
  const next = Number(row?.n ?? 0) + 1;
  return `ORD-${String(next).padStart(5, "0")}`;
}

/** Ù…Ù†ØªØ¬Ø§Øª Ø£Ø¯ÙˆØ±Ø§: Ø¨Ø¯ÙˆÙ† Ø¹Ù„Ø§Ù…Ø© Ø£Ùˆ Ø¹Ù„Ø§Ù…Ø© Ø£Ø¯ÙˆØ±Ø§ (Ù„Ù„Ø£Ù‚Ø³Ø§Ù… Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ© Ø¹Ù„Ù‰ Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ©) */
function sqlAdoraBrandPredicate() {
  return `(brand IS NULL OR TRIM(brand) = '' OR LOWER(TRIM(brand)) IN ('adora','adoura') OR TRIM(brand) = 'أدورا')`;
}

/** Ù…Ø·Ø§Ø¨Ù‚Ø© ØµÙ Ù…Ø®Ø²ÙˆÙ† Ø¯ÙŠÙ†Ø§Ù…ÙŠÙƒÙŠ Ø¨Ø®Ø±ÙŠØ·Ø© options (Ù†ÙØ³ Ù…Ù†Ø·Ù‚ decrementProductStock) */
function findDynamicInventoryRowIndex(inv, vOpts) {
  if (!Array.isArray(inv)) return -1;
  if (!vOpts || typeof vOpts !== "object" || Array.isArray(vOpts) || !Object.keys(vOpts).length) return -1;
  return inv.findIndex((row) => {
    if (!row.options || typeof row.options !== "object") return false;
    const keys = Object.keys(vOpts);
    for (const k of keys) {
      if (String(row.options[k] || "") !== String(vOpts[k] || "")) return false;
    }
    for (const k of Object.keys(row.options)) {
      if (!(k in vOpts)) return false;
    }
    return Object.keys(row.options).length === keys.length;
  });
}

async function decrementMarketplaceStock(marketplaceProductId, qty, meta = {}) {
  const id = Number(marketplaceProductId);
  if (!Number.isFinite(id) || qty <= 0) return;
  const p = await get(
    `SELECT stock, inventory_json, product_options_json FROM marketplace_products WHERE id=?`,
    [id]
  );
  if (!p) return;
  const opts = safeJsonParse(p.product_options_json, []);
  const hasDyn = Array.isArray(opts) && opts.length > 0;
  const vOpts = meta.variant_options;
  const hasPick =
    vOpts && typeof vOpts === "object" && !Array.isArray(vOpts) && Object.keys(vOpts).length > 0;
  if (hasDyn && hasPick) {
    let inv = safeJsonParse(p.inventory_json, []);
    if (!Array.isArray(inv)) inv = [];
    const idx = findDynamicInventoryRowIndex(inv, vOpts);
    if (idx >= 0) {
      const row = inv[idx];
      const cur = Number(row.stock || 0);
      inv[idx] = { ...row, stock: Math.max(0, cur - qty) };
      await run(
        `UPDATE marketplace_products SET inventory_json=?, stock = GREATEST(0, COALESCE(stock,0) - ?), sales_count = COALESCE(sales_count,0) + ? WHERE id=?`,
        [JSON.stringify(inv), qty, qty, id]
      );
      return;
    }
  }
  await run(
    `UPDATE marketplace_products SET stock = GREATEST(0, COALESCE(stock,0) - ?), sales_count = COALESCE(sales_count,0) + ? WHERE id=?`,
    [qty, qty, id]
  );
}

async function decrementProductStock(productId, qty, meta = {}) {
  const pid = Number(productId);
  if (!Number.isFinite(pid) || qty <= 0) return;
  const p = await get(`SELECT stock, inventory_json FROM products WHERE id=?`, [pid]);
  if (!p) return;
  let inv = safeJsonParse(p.inventory_json, []);
  if (!Array.isArray(inv)) inv = [];
  const sz = meta.size != null ? String(meta.size).trim().toLowerCase() : "";
  const cl = meta.color != null ? String(meta.color).trim().toLowerCase() : "";
  const vOpts = meta.variant_options;
  const hasDyn = vOpts && typeof vOpts === "object" && !Array.isArray(vOpts) && Object.keys(vOpts).length > 0;
  let idx = -1;
  if (inv.length > 0) {
    if (hasDyn) {
      idx = findDynamicInventoryRowIndex(inv, vOpts);
    } else if (sz || cl) {
      idx = inv.findIndex((row) => {
        if (row.options && typeof row.options === "object" && Object.keys(row.options).length) return false;
        const rs = String(row.size || "").trim().toLowerCase();
        const rc = String(row.color || "").trim().toLowerCase();
        const szMatch = !sz || rs === sz;
        const clMatch = !cl || rc === cl;
        return szMatch && clMatch;
      });
    }
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
  const invRaw = p.inventory_json;
  const optRaw = p.product_options_json;
  const { inventory_json, product_options_json, ...rest } = p;
  return {
    ...rest,
    inventory: safeJsonParse(invRaw, []),
    product_options: optRaw != null ? safeJsonParse(optRaw, []) : [],
  };
}

function normalizeSignupPhoneDigits(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length >= 8 ? d : null;
}

/** Ø¥Ø±Ø³Ø§Ù„ Ø±Ù…Ø² Ø§Ù„ØªØ­Ù‚Ù‚ Ù„Ù„Ø¨Ø±ÙŠØ¯ â€” Ø¥Ù†Ø´Ø§Ø¡ Ø­Ø³Ø§Ø¨ ÙÙ‚Ø· Ø¨Ø¹Ø¯ /api/auth/signup/verify */
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
    const phoneDigits = normalizeSignupPhoneDigits(req.body?.phone ?? req.body?.whatsapp_phone ?? "");
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!phoneDigits) {
      return res.status(400).json({ error: "Valid WhatsApp phone number is required (at least 8 digits)" });
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
    const phoneTaken = await get(`SELECT id FROM users WHERE phone = ?`, [phoneDigits]);
    if (phoneTaken) return res.status(409).json({ error: "Phone number already registered" });

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
      `INSERT INTO pending_email_signups (email_normalized, name, password_hash, otp_hash, expires_at, last_sent_at, resend_count, signup_phone)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT (email_normalized) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         otp_hash = EXCLUDED.otp_hash,
         expires_at = EXCLUDED.expires_at,
         last_sent_at = EXCLUDED.last_sent_at,
         resend_count = pending_email_signups.resend_count + 1,
         signup_phone = EXCLUDED.signup_phone`,
      [norm, name, passwordHash, otpHash, expiresAt, lastSent, phoneDigits]
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

    const phoneDigits = String(row.signup_phone || "")
      .replace(/\D/g, "")
      .trim();
    const finalPhone = phoneDigits.length >= 8 ? phoneDigits : null;
    if (!finalPhone) {
      await run(`DELETE FROM pending_email_signups WHERE email_normalized=?`, [norm]);
      return res.status(400).json({ error: "Signup is missing a valid phone. Please start again." });
    }
    const phoneDup = await get(`SELECT id FROM users WHERE phone = ?`, [finalPhone]);
    if (phoneDup) {
      await run(`DELETE FROM pending_email_signups WHERE email_normalized=?`, [norm]);
      return res.status(409).json({ error: "Phone number already registered" });
    }
    const result = await run(
      `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'user')`,
      [row.name, norm, finalPhone, row.password_hash]
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
    const rawDigits = raw.replace(/\D/g, "");
    const user = await get(
      `SELECT * FROM users WHERE phone = ? OR phone = ? OR LOWER(TRIM(email)) = LOWER(TRIM(?))`,
      [raw, rawDigits || raw, raw]
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

/** تسجيل دخول / إنشاء حساب عبر Google أو Apple — التحقق من id_token على الخادم */
app.post("/api/auth/oauth", async (req, res) => {
  try {
    const provider = String(req.body?.provider || "")
      .toLowerCase()
      .trim();
    const idToken = String(req.body?.id_token || "").trim();
    if (!idToken) return res.status(400).json({ error: "Missing id_token" });
    if (provider !== "google" && provider !== "apple") {
      return res.status(400).json({ error: "Invalid provider" });
    }
    const nameExtra = String(req.body?.name || "").trim();
    const user = await handleOAuthSignIn(provider, idToken, nameExtra);
    const now = new Date().toISOString();
    await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [now, user.id]);
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
    if (err.code === "CONFLICT") return res.status(409).json({ error: err.message });
    if (err.code === "NOT_CONFIGURED") return res.status(503).json({ error: err.message });
    console.error("[auth] oauth:", err?.message || err);
    return res.status(401).json({ error: "OAuth sign-in failed" });
  }
});

/** ÙØ­Øµ ØµØ­Ø© Ù„Ù„Ù†Ø´Ø± (Ù…ÙˆØ§Ø²Ù†ØŒ DockerØŒ Ù…Ø±Ø§Ù‚Ø¨Ø©) */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "adora",
    env: NODE_ENV,
    uptime: Math.round(process.uptime()),
    /** Ø§Ø³ØªØ®Ø¯Ù… Ù†ÙØ³ Ø£ØµÙ„ Ù‡Ø°Ø§ Ø§Ù„Ø·Ù„Ø¨ (Render) ÙˆÙ„ÙŠØ³ Netlify */
    endpoints: {
      publicStats: "/api/public/stats",
      publicStatsAlt: "/api/stats",
      publicConfig: "/api/public-config",
    },
  });
});

/** Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø¹Ø§Ù…Ø© Ù„Ù„ÙˆØ§Ø¬Ù‡Ø© (Ø¨Ø¯ÙˆÙ† Ù…ØµØ§Ø¯Ù‚Ø©) â€” Ø±Ø§Ø¨Ø· ØªÙ†Ø²ÙŠÙ„ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ù…Ù† Ù…ØªØºÙŠØ± Ø§Ù„Ø¨ÙŠØ¦Ø© */
app.get("/api/public-config", (_req, res) => {
  res.json({
    app_download_url: String(process.env.ADORA_APP_DOWNLOAD_URL || "").trim(),
    ...getPublicOAuthConfig(),
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

/** Ø£Ø±Ù‚Ø§Ù… Ù…Ø¬Ù…Ù‘Ø¹Ø© Ù…Ù† Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù„Ù„ÙˆØ§Ø¬Ù‡Ø© â€” Ù„Ø§ ÙŠØ¹Ø±Ø¶ ØµÙÙˆÙØ§Ù‹ Ø®Ø§Ù… */
app.get("/api/public/stats", sendPublicStatsJson);
/** Ù†ÙØ³ Ø§Ù„Ù…Ø­ØªÙˆÙ‰ â€” Ù…Ø³Ø§Ø± Ø£Ù‚ØµØ± Ø¥Ù† Ø§Ø­ØªØ¬Øª */
app.get("/api/stats", sendPublicStatsJson);

async function loadUserProfileBundle(userId) {
  await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [new Date().toISOString(), userId]);
  const user = await get(
    `SELECT id, name, phone, email, role, created_at, notifications_enabled, notifications_snoozed_until, credentials_acknowledged, last_activity_at, avatar_url
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
      `SELECT id, name, phone, email, role, created_at, notifications_enabled, notifications_snoozed_until, credentials_acknowledged, last_activity_at, avatar_url FROM users WHERE id=?`,
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

/** Ù…ÙØªØ§Ø­ VAPID Ø§Ù„Ø¹Ø§Ù… â€” Ù„Ù„Ø§Ø´ØªØ±Ø§Ùƒ ÙÙŠ Web Push Ù…Ù† Ø§Ù„Ù…ØªØµÙØ­ (200 + ok:false Ø¥Ø°Ø§ ØºÙŠØ± Ù…Ø¶Ø¨ÙˆØ· Ù„ØªÙØ§Ø¯ÙŠ Ø£Ø®Ø·Ø§Ø¡ Ø­Ù…Ø±Ø§Ø¡ ÙÙŠ ÙƒÙˆÙ†Ø³ÙˆÙ„ Ø§Ù„Ù…ØªØµÙØ­) */
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

/** ØªØ´Ø®ÙŠØµ Web Push â€” Ù„Ù„Ù…Ø´Ø±Ù: VAPIDØŒ Ø¹Ø¯Ø¯ Ø§Ù„Ø§Ø´ØªØ±Ø§ÙƒØ§ØªØŒ Ù…Ù„Ø§Ø­Ø¸Ø© Ø£Ù† sw.js Ù…Ù† Ù†Ø·Ø§Ù‚ Ø§Ù„ÙˆØ§Ø¬Ù‡Ø© (Netlify) */
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
        "ÙŠÙÙØªØ­ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ù…Ù† Ø±Ø§Ø¨Ø· NetlifyØ› Ù…Ù„Ù /sw.js ÙŠÙÙ‚Ø¯Ù‘ÙŽÙ… Ù…Ù† Ù†ÙØ³ Ø§Ù„Ù†Ø·Ø§Ù‚. Ø§Ù„Ø³ÙŠØ±ÙØ± Ø¹Ù„Ù‰ Render ÙŠØ­ÙØ¸ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ ÙˆÙŠØ±Ø³Ù„ Push ÙÙ‚Ø·.",
      hintEn:
        "Users must open the PWA from your Netlify URL; /sw.js is served there. Render stores subscriptions and sends pushes.",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to read push diagnostics" });
  }
});

/** Ù…Ù„Ø®Øµ Ø§Ù„Ø¬Ø¯Ø§ÙˆÙ„ (Ø¹Ø¯Ø¯ Ø§Ù„ØµÙÙˆÙ) â€” Ù„Ù„Ù…Ø´Ø±Ù ÙÙ‚Ø·Ø› Ø§Ù„Ù…Ù„Ù ØºÙŠØ± Ù…Ø¹Ø±ÙˆØ¶ Ù„Ù„ØªÙ†Ø²ÙŠÙ„ */
app.get("/api/admin/database/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const overview = await getDatabaseOverview();
    return res.json({
      ...overview,
      note: "PostgreSQL via DATABASE_URL. Use this dashboard or REST APIs â€” no direct database file on the app host.",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load database overview" });
  }
});

/** Keys + labels for home section visibility (admin toggles) â€” derived from DEFAULT_HOME_SECTIONS_VISIBILITY */
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
    const order_sections = HOME_SECTION_ORDER_KEYS.map((key) => {
      const lab = HOME_SECTION_ORDER_LABELS[key] || { ar: key, en: key };
      return { key, label_ar: lab.ar, label_en: lab.en };
    });
    return res.json({ keys, defaults, sections, order_keys: HOME_SECTION_ORDER_KEYS, order_sections });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load home section keys" });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all(
      `SELECT u.id, u.name, u.phone, u.email, u.role, u.created_at, u.last_activity_at,
        u.notifications_enabled, u.notifications_snoozed_until,
        u.avatar_url, u.oauth_provider,
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

/** Ø¥Ø´Ø¹Ø§Ø±Ø§Øª: Ø±Ø³Ø§Ø¦Ù„ Ø¨Ø« Ù‚Ø¯ÙŠÙ…Ø© + Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ù†ØµÙŠØ© Ø¬Ø¯ÙŠØ¯Ø© (Ù…Ø¹ Ù‚Ø±Ø§Ø¡Ø© Ù„ÙƒÙ„ Ù…Ø³ØªØ®Ø¯Ù…) */
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

/** Ø¹Ø¯Ø¯ Ø§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª ØºÙŠØ± Ø§Ù„Ù…Ù‚Ø±ÙˆØ¡Ø© (Ø¨Ø« + in-app) â€” Ø£Ø®Ù Ù…Ù† Ø¬Ù„Ø¨ Ø§Ù„Ù‚Ø§Ø¦Ù…Ø© ÙƒØ§Ù…Ù„Ø© */
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

/** ØªÙˆØ§ÙÙ‚ Ù…Ø¹ Ø§Ù„Ø¹Ù…ÙŠÙ„ Ø§Ù„Ù‚Ø¯ÙŠÙ…: ÙŠØ¹Ø§Ù…Ù„ ÙƒÙ€ broadcast */
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
    const fulfillments = await all(
      `SELECT f.*, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en
       FROM order_vendor_fulfillments f
       INNER JOIN marketplace_vendors mv ON mv.id = f.vendor_id
       WHERE f.order_id=?
       ORDER BY f.id ASC`,
      [id]
    );
    return res.json({ order, items, history, fulfillments });
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

/** Ø­Ø°Ù ÙƒÙ„ Ø±Ø³Ø§Ø¦Ù„ Ø§Ù„Ø¨Ø« ÙˆØ§Ù„Ø¥Ø´Ø¹Ø§Ø±Ø§Øª Ø§Ù„Ø¯Ø§Ø®Ù„ÙŠØ© Ù„Ø¬Ù…ÙŠØ¹ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…ÙŠÙ† (ØªÙØ­Ø°Ù Ø³Ø¬Ù„Ø§Øª Ø§Ù„Ù‚Ø±Ø§Ø¡Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠØ§Ù‹ Ø¨Ù€ CASCADE) */
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
    const fh = String(req.query.featured_hub || "").trim();
    if (fh === "1" || fh === "true") {
      where.push("featured_hub_enabled=1");
      const fsec = normalizeFeaturedHubSection(req.query.featured_hub_section);
      if (fsec) {
        where.push("featured_hub_section=?");
        params.push(fsec);
      }
    }
    const qtrim = q != null ? String(q).trim() : "";
    if (qtrim) {
      const variants = arabicSearchQueryVariants(qtrim);
      const clause = `(name_ar ILIKE ? OR name_en ILIKE ? OR COALESCE(brand,'') ILIKE ? OR COALESCE(description,'') ILIKE ? OR category ILIKE ? OR COALESCE(subcategory,'') ILIKE ? OR COALESCE(badge,'') ILIKE ? OR EXISTS (SELECT 1 FROM brands b WHERE b.name ILIKE ? AND (TRIM(COALESCE(products.brand,'')) = TRIM(b.name) OR COALESCE(products.brand,'') ILIKE ('%' || TRIM(b.name) || '%'))))`;
      const parts = variants.map(() => clause);
      where.push(`(${parts.join(" OR ")})`);
      for (const v of variants) {
        const term = sqlLikePrefixParam(v);
        const brandSub = sqlLikeContainsParam(v);
        params.push(term, term, brandSub, term, term, term, term, term);
      }
    }
    const inMpTab = String(req.query.in_marketplace_tab || "").trim();
    if (inMpTab === "1" || inMpTab === "true") {
      where.push("COALESCE(show_in_marketplace_tab,0) = 1");
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
    let products = await all(sql, params);
    const fhActive = String(req.query.featured_hub || "").trim();
    const mergeMpRaw = String(req.query.merge_marketplace ?? "1").trim().toLowerCase();
    const mergeMp = mergeMpRaw !== "0" && mergeMpRaw !== "false";
    if (qtrim && mergeMp && fhActive !== "1" && fhActive !== "true") {
      try {
        const mpMerged = await fetchMarketplaceProductsForListingSearchMerge(arabicSearchQueryVariants(qtrim));
        if (mpMerged.length) {
          const seen = new Set(products.map((p) => Number(p.id)));
          for (const m of mpMerged) {
            const mid = Number(m.id);
            if (Number.isFinite(mid) && !seen.has(mid)) {
              seen.add(mid);
              products.push(m);
            }
          }
        }
      } catch (_e) {
        /* keep catalog-only */
      }
    }
    const ids = products
      .filter((p) => p.adora_listing_kind !== "marketplace")
      .map((p) => Number(p.id))
      .filter((id) => Number.isFinite(id));
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
      if (p.adora_listing_kind === "marketplace") {
        rows.push(p);
        continue;
      }
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

/** Ø§Ù‚ØªØ±Ø§Ø­Ø§Øª Ø¨Ø­Ø« Ø¨Ø§Ù„Ø¨Ø§Ø¯Ø¦Ø© â€” ØµÙÙˆÙ ØºÙ†ÙŠØ© (Ù…Ù†ØªØ¬ + Ø´Ø±ÙƒØ© + ØµÙˆØ±Ø©) Ù„Ù‚Ø§Ø¦Ù…Ø© ØªØ­Øª Ù…Ø±Ø¨Ø¹ Ø§Ù„Ø¨Ø­Ø« */
app.get("/api/search/suggestions", async (req, res) => {
  try {
    const qtrim = String(req.query.q || "").trim();
    const scope = String(req.query.scope || "all").toLowerCase();
    if (qtrim.length < 1) return res.json([]);
    const variants = arabicSearchQueryVariants(qtrim);
    if (!variants.length) return res.json([]);
    const maxTotal = Math.min(20, Math.max(4, Number(req.query.limit) || 10));
    const hubOn = String(req.query.featured_hub || "").trim();
    const hubSec = normalizeFeaturedHubSection(req.query.featured_hub_section);
    let hubSql = "";
    const hubParams = [];
    if (hubOn === "1" || hubOn === "true") {
      hubSql += " AND p.featured_hub_enabled = 1";
      if (hubSec) {
        hubSql += " AND p.featured_hub_section = ?";
        hubParams.push(hubSec);
      }
    }

    const buildProductClauses = () => {
      const clauses = [];
      const params = [];
      for (const v of variants) {
        const pfx = sqlLikePrefixParam(v);
        const sub = sqlLikeContainsParam(v);
        clauses.push("(p.name_ar ILIKE ? OR p.name_en ILIKE ? OR COALESCE(p.brand,'') ILIKE ?)");
        params.push(pfx, pfx, sub);
      }
      return { where: clauses.join(" OR "), params };
    };

    const buildMpClauses = () => {
      const clauses = [];
      const params = [];
      for (const v of variants) {
        const pfx = sqlLikePrefixParam(v);
        const sub = sqlLikeContainsParam(v);
        clauses.push(
          "(mp.name_ar ILIKE ? OR mp.name_en ILIKE ? OR mv.name_ar ILIKE ? OR mv.name_en ILIKE ? OR mv.name_ar ILIKE ? OR mv.name_en ILIKE ?)"
        );
        params.push(pfx, pfx, pfx, pfx, sub, sub);
      }
      return { where: clauses.join(" OR "), params };
    };

    const mapAdoraRow = (r) => {
      const id = Number(r.id);
      if (!Number.isFinite(id)) return null;
      const titleAr = String(r.name_ar || "").trim();
      const titleEn = String(r.name_en || "").trim();
      const brand = r.brand != null ? String(r.brand).trim() : "";
      if (!titleAr && !titleEn) return null;
      const thumb = r.thumb != null ? String(r.thumb).trim() : "";
      return {
        kind: "adora",
        id,
        title_ar: titleAr || null,
        title_en: titleEn || null,
        subtitle_ar: brand || null,
        subtitle_en: brand || null,
        image_url: thumb || null,
      };
    };

    const mapMpRow = (r) => {
      const id = Number(r.id);
      if (!Number.isFinite(id)) return null;
      const titleAr = String(r.name_ar || "").trim();
      const titleEn = String(r.name_en || "").trim();
      if (!titleAr && !titleEn) return null;
      const img = firstMarketplaceImageFromImagesJson(r.images_json);
      const vnAr = r.vn_ar != null ? String(r.vn_ar).trim() : "";
      const vnEn = r.vn_en != null ? String(r.vn_en).trim() : "";
      return {
        kind: "marketplace",
        id,
        title_ar: titleAr || null,
        title_en: titleEn || null,
        subtitle_ar: vnAr || null,
        subtitle_en: vnEn || null,
        image_url: img || null,
      };
    };

    const items = [];

    if (scope === "products" || scope === "all") {
      const { where, params } = buildProductClauses();
      const lim = scope === "all" ? Math.min(maxTotal, Math.max(4, Math.ceil(maxTotal * 0.55))) : maxTotal;
      const sql = `SELECT p.id, p.name_ar, p.name_en, p.brand,
        (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.id ASC LIMIT 1) AS thumb
        FROM products p
        WHERE (${where})${hubSql}
        ORDER BY p.id DESC
        LIMIT ?`;
      const rows = await all(sql, [...params, ...hubParams, lim]);
      for (const r of rows) {
        const o = mapAdoraRow(r);
        if (o) items.push(o);
      }
    }

    if ((hubOn === "1" || hubOn === "true") && (scope === "products" || scope === "all")) {
      let limHub = Math.max(1, maxTotal - items.length);
      if (limHub > 0) {
        let mpHubSql = " AND COALESCE(mp.featured_hub_enabled,0) = 1 AND COALESCE(mp.show_in_marketplace_tab,1) = 1 ";
        const mpHubParams = [];
        if (hubSec) {
          mpHubSql += " AND mp.featured_hub_section = ? ";
          mpHubParams.push(hubSec);
        }
        const { where, params } = buildMpClauses();
        const sqlHub = `SELECT mp.id, mp.name_ar, mp.name_en, mp.images_json, mv.name_ar AS vn_ar, mv.name_en AS vn_en
        FROM marketplace_products mp
        INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND mv.is_active = 1 AND COALESCE(mv.portal_suspended, 0) = 0
        INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
        WHERE mp.is_active = 1 ${mpHubSql} AND (${where})
        ORDER BY mp.id DESC
        LIMIT ?`;
        const rowsHub = await all(sqlHub, [...mpHubParams, ...params, limHub]);
        for (const r of rowsHub) {
          const o = mapMpRow(r);
          if (o) items.push(o);
        }
      }
    }

    if (scope === "marketplace" || scope === "all") {
      const { where, params } = buildMpClauses();
      let lim = maxTotal;
      if (scope === "all") {
        lim = Math.max(1, maxTotal - items.length);
      }
      let mpScopeExtra = " AND COALESCE(mp.show_in_marketplace_tab,1) = 1 ";
      const mpScopeParams = [];
      if (hubOn === "1" || hubOn === "true") {
        mpScopeExtra += " AND COALESCE(mp.featured_hub_enabled,0) = 1 ";
        if (hubSec) {
          mpScopeExtra += " AND mp.featured_hub_section = ? ";
          mpScopeParams.push(hubSec);
        }
      }
      const sql = `SELECT mp.id, mp.name_ar, mp.name_en, mp.images_json, mv.name_ar AS vn_ar, mv.name_en AS vn_en
        FROM marketplace_products mp
        INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND mv.is_active = 1 AND COALESCE(mv.portal_suspended, 0) = 0
        INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
        WHERE mp.is_active = 1 ${mpScopeExtra} AND (${where})
        ORDER BY mp.id DESC
        LIMIT ?`;
      const rows = await all(sql, [...mpScopeParams, ...params, lim]);
      for (const r of rows) {
        const o = mapMpRow(r);
        if (o) items.push(o);
      }
    }

    const seenKeys = new Set();
    const deduped = [];
    for (const it of items) {
      const kid = it && it.kind != null && it.id != null ? `${it.kind}:${it.id}` : "";
      if (kid && seenKeys.has(kid)) continue;
      if (kid) seenKeys.add(kid);
      deduped.push(it);
    }
    return res.json(deduped.slice(0, maxTotal));
  } catch (_e) {
    return res.json([]);
  }
});

app.post("/api/customer-feedback-notes", requireAuth, async (req, res) => {
  try {
    const note = String(req.body?.note || "").trim();
    const bannerIdRaw = req.body?.banner_id;
    const bannerId = bannerIdRaw != null && bannerIdRaw !== "" ? Number(bannerIdRaw) : null;
    if (!note || note.length < 2) return res.status(400).json({ error: "Note too short" });
    if (note.length > 4000) return res.status(400).json({ error: "Note too long" });
    let bid = null;
    if (bannerId != null) {
      if (!Number.isFinite(bannerId)) return res.status(400).json({ error: "Invalid banner" });
      const b = await get(`SELECT id FROM app_banners WHERE id=? AND active=1 AND banner_kind='customer_note'`, [bannerId]);
      if (!b) return res.status(400).json({ error: "Invalid feedback banner" });
      bid = bannerId;
    }
    await run(`INSERT INTO customer_feedback_notes (user_id, banner_id, note) VALUES (?, ?, ?)`, [req.user.id, bid, note]);
    return res.json({ ok: true });
  } catch (_e) {
    return res.status(500).json({ error: "Failed to save note" });
  }
});

app.get("/api/admin/customer-feedback-notes", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all(
      `SELECT n.id, n.note, n.created_at, n.banner_id, u.name AS user_name, u.email, u.phone
       FROM customer_feedback_notes n
       JOIN users u ON u.id = n.user_id
       ORDER BY n.id DESC
       LIMIT 500`
    );
    return res.json(rows);
  } catch (_e) {
    return res.status(500).json({ error: "Failed to load notes" });
  }
});

/** Ù…Ù†ØªØ¬Ø§Øª Ø°Ø§Øª ØµÙ„Ø©: Ù†ÙØ³ Ø§Ù„Ù‚Ø³Ù… (ÙˆÙŠÙØ¶Ù‘Ù„ Ù†ÙØ³ Ø§Ù„ÙØ±Ø¹ Ø«Ù… Ù†ÙØ³ Ø§Ù„Ø¹Ù„Ø§Ù…Ø©) */
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
    const distRows = await all(
      `SELECT stars, COUNT(*) AS c FROM product_reviews WHERE product_id=? GROUP BY stars`,
      [productId]
    );
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of distRows || []) {
      const s = Number(row.stars);
      if (s >= 1 && s <= 5) distribution[s] = Number(row.c) || 0;
    }
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
      distribution,
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
      product_options = [],
      badge = "",
      is_featured = 0,
      is_flash_sale = 0,
      is_new_collection = 0,
      flash_sale_end_time = null,
      featured_hub_enabled = 0,
      featured_hub_section: featuredHubSectionBody = null,
      show_in_offers_tab = 0,
      show_in_marketplace_tab = 0,
    } = req.body;
    if (!name_ar || !name_en || !description || !category) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const showOffers = Number(show_in_offers_tab) === 1 ? 1 : 0;
    const showMpTab = Number(show_in_marketplace_tab) === 1 ? 1 : 0;
    const fhEn = featured_hub_enabled ? 1 : 0;
    let fhSec = null;
    if (fhEn) {
      fhSec = normalizeFeaturedHubSection(featuredHubSectionBody);
      if (!fhSec) {
        return res.status(400).json({ error: "featured_hub_section required when featured hub is enabled" });
      }
    }
    const invArr = Array.isArray(inventory) ? inventory : [];
    const optArr = Array.isArray(product_options) ? product_options : [];
    const result = await run(
      `INSERT INTO products (
        name_ar, name_en, description, price, discount, category, subcategory, brand,
        sizes_json, colors_json, stock, inventory_json, product_options_json, badge, is_featured, is_flash_sale, is_new_collection, flash_sale_end_time,
        featured_hub_enabled, featured_hub_section, show_in_offers_tab, show_in_marketplace_tab
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        JSON.stringify(optArr),
        badge,
        is_featured ? 1 : 0,
        is_flash_sale ? 1 : 0,
        is_new_collection ? 1 : 0,
        flash_sale_end_time,
        fhEn,
        fhSec,
        showOffers,
        showMpTab,
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
      product_options = [],
      badge = "",
      is_featured = 0,
      is_flash_sale = 0,
      is_new_collection = 0,
      flash_sale_end_time = null,
      featured_hub_enabled = 0,
      featured_hub_section: featuredHubSectionPut = null,
      show_in_offers_tab = 0,
      show_in_marketplace_tab = 0,
    } = req.body;
    const showOffersPut = Number(show_in_offers_tab) === 1 ? 1 : 0;
    const showMpTabPut = Number(show_in_marketplace_tab) === 1 ? 1 : 0;
    const fhEnPut = featured_hub_enabled ? 1 : 0;
    let fhSecPut = null;
    if (fhEnPut) {
      fhSecPut = normalizeFeaturedHubSection(featuredHubSectionPut);
      if (!fhSecPut) {
        return res.status(400).json({ error: "featured_hub_section required when featured hub is enabled" });
      }
    }
    const invArr = Array.isArray(inventory) ? inventory : [];
    const optArr = Array.isArray(product_options) ? product_options : [];
    await run(
      `UPDATE products SET
        name_ar=?, name_en=?, description=?, price=?, discount=?, category=?, subcategory=?, brand=?,
        sizes_json=?, colors_json=?, stock=?, inventory_json=?, product_options_json=?, badge=?, is_featured=?, is_flash_sale=?, is_new_collection=?, flash_sale_end_time=?,
        featured_hub_enabled=?, featured_hub_section=?, show_in_offers_tab=?, show_in_marketplace_tab=?
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
        JSON.stringify(optArr),
        badge,
        is_featured ? 1 : 0,
        is_flash_sale ? 1 : 0,
        is_new_collection ? 1 : 0,
        flash_sale_end_time,
        fhEnPut,
        fhSecPut,
        showOffersPut,
        showMpTabPut,
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

registerVendorPortalRoutes(app, {
  notifyUserInApp: (userId, title, message, link_url) => notifyUserInApp(app, userId, title, message, link_url),
  savePublicImageFromBuffer: async (buffer, originalname) => {
    if (isCloudinaryConfigured()) return uploadBufferToCloudinary(buffer);
    return saveLocalUploadFromBuffer(buffer, originalname);
  },
});

registerAdoraCompanyAdminRoutes(app, {
  requireAuth,
  requireAdmin,
  notifyUserInApp: (userId, title, message, link_url) => notifyUserInApp(app, userId, title, message, link_url),
});

registerVendorContactAdminRoutes(app, { requireAuth, requireAdmin });

const ORDER_STATUS_KEYS = ["pending_receipt", "in_progress", "fulfilled", "shipping", "delivered", "cancelled"];

/** عنوان إشعار حالة الطلب — يتضمن رقم الطلب ليظهر في Push والقائمة */
function orderStatusNotifyTitle(orderNo) {
  const ord = orderNo != null ? String(orderNo).trim() : "";
  return ord ? `تحديث طلب ${ord}` : "تحديث الطلب";
}

/** نص إشعار حالة الطلب (عربي + سطر إنجليزي قصير يذكر الرقم) */
function orderStatusNotifyMessage(orderNo, status) {
  const ord = orderNo != null ? String(orderNo).trim() : "";
  const refAr = ord ? `رقم الطلب ${ord}. ` : "";
  const m = {
    pending_receipt: `${refAr}تم تحديث حالة طلبك إلى: جاري استلام طلبك`,
    in_progress: `${refAr}تم تحديث حالة طلبك إلى: جاري تجميع طلبك`,
    fulfilled: `${refAr}تم تحديث حالة طلبك إلى: تم تجميع طلبك`,
    shipping: `${refAr}تم تحديث حالة طلبك إلى: جاري الشحن`,
    delivered: `${refAr}تم تحديث حالة طلبك إلى: تم تسليم الطلب للعميل`,
    cancelled: `${refAr}تم إلغاء طلبك`,
  };
  const ar = m[status] || `${refAr}تم تحديث حالة طلبك (${status})`;
  const refEn = ord ? `Order ${ord}. ` : "";
  const en = {
    pending_receipt: `${refEn}Status: pending receipt`,
    in_progress: `${refEn}Status: in progress`,
    fulfilled: `${refEn}Status: fulfilled`,
    shipping: `${refEn}Status: shipping`,
    delivered: `${refEn}Status: delivered`,
    cancelled: `${refEn}Status: cancelled`,
  };
  const enLine = en[status] || `${refEn}Status updated`;
  return `${ar}\n${enLine}`;
}

function orderReceivedNotifyTitle(orderNo) {
  const ord = orderNo != null ? String(orderNo).trim() : "";
  return ord ? `تم استلام الطلب ${ord}` : "تم استلام الطلب";
}

function orderReceivedNotifyMessage(orderNo) {
  const ord = orderNo != null ? String(orderNo).trim() : "\u2014";
  return `تم استلام طلبك في النظام. رقم الطلب: ${ord}. احفظ الرقم للمتابعة؛ ستصلك إشعارات عند تغيير الحالة.\nOrder received. Number: ${ord}. Save it - you will get status updates here.`;
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
    let shippingAddress =
      shippingAddressBody != null && String(shippingAddressBody).trim() ? String(shippingAddressBody).trim().slice(0, 2000) : null;
    const productLines = Array.isArray(products) ? products : [];
    if (productLines.length === 0) {
      return res.status(400).json({ error: "Order must include at least one product" });
    }
    const hasMarketplaceLines = productLines.some((it) => {
      const mpidRaw = it.marketplace_product_id != null ? Number(it.marketplace_product_id) : null;
      return Number.isFinite(mpidRaw) && mpidRaw > 0;
    });
    const shipStruct = parseShippingStructured(req.body);
    let shippingAddressJson = null;
    if (hasMarketplaceLines) {
      if (!shippingStructuredComplete(shipStruct)) {
        return res.status(400).json({
          error: "incomplete_shipping",
          detail: "Full name, phone, governorate, region, and street address are required for marketplace orders.",
        });
      }
      shippingAddressJson = JSON.stringify(shipStruct);
      shippingAddress = [
        shipStruct.full_name,
        shipStruct.phone,
        `${shipStruct.governorate} — ${shipStruct.region}`,
        shipStruct.address,
      ]
        .join("\n")
        .slice(0, 2000);
    }
    for (const item of productLines) {
      const qn = Math.max(1, Math.floor(Number(item.qty || 1)));
      const mpidRaw = item.marketplace_product_id != null ? Number(item.marketplace_product_id) : null;
      const mpid = Number.isFinite(mpidRaw) && mpidRaw > 0 ? mpidRaw : null;
      if (!mpid) continue;
      const mp = await get(
        `SELECT mp.id, mp.stock, mp.name_ar, mp.inventory_json, mp.product_options_json
         FROM marketplace_products mp
         INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND mv.is_active = 1 AND COALESCE(mv.portal_suspended, 0) = 0
         WHERE mp.id=? AND mp.is_active = 1 AND COALESCE(mp.vendor_listing_status, 'published') = 'published'`,
        [mpid]
      );
      if (!mp) {
        return res.status(400).json({ error: "Invalid marketplace product" });
      }
      const po = safeJsonParse(mp.product_options_json, []);
      const hasDynMp = Array.isArray(po) && po.length > 0;
      const vOptPre = item.variant_options;
      const variantOptsPre =
        vOptPre && typeof vOptPre === "object" && !Array.isArray(vOptPre) ? vOptPre : null;
      if (hasDynMp) {
        const inv = safeJsonParse(mp.inventory_json, []);
        const vIdx = findDynamicInventoryRowIndex(inv, variantOptsPre);
        if (vIdx < 0) {
          return res.status(400).json({
            error: "Invalid marketplace variant",
            detail: mp.name_ar || String(mpid),
          });
        }
        if (Number(inv[vIdx].stock) < qn) {
          return res.status(400).json({ error: "Insufficient stock", detail: mp.name_ar || String(mpid) });
        }
      } else if (Number(mp.stock) < qn) {
        return res.status(400).json({ error: "Insufficient stock", detail: mp.name_ar || String(mpid) });
      }
    }
    /** Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„Ø£ÙˆÙ„Ù‰ Ø¯Ø§Ø¦Ù…Ø§Ù‹ Â«Ù‚ÙŠØ¯ Ø§Ù„Ø§Ø³ØªÙ„Ø§Ù…Â» â€” Ù„Ø§ ÙŠÙÙ‚Ø¨Ù„ ØªÙ…Ø±ÙŠØ± Ø­Ø§Ù„Ø© Ù…Ù† Ø§Ù„Ø²Ø¨ÙˆÙ† */
    const status = "pending_receipt";
    const orderNo = await allocateNextOrderNo();
    const result = await run(
      `INSERT INTO orders (order_no, user_id, total_price, status, payment_method, source, shipping_address, shipping_address_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderNo, req.user.id, Number(total_price || 0), status, payment_method, source, shippingAddress, shippingAddressJson]
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
      const vOptRaw = item.variant_options;
      const variant_options =
        vOptRaw && typeof vOptRaw === "object" && !Array.isArray(vOptRaw) ? vOptRaw : null;
      const variant_label = item.variant_label != null ? String(item.variant_label).slice(0, 2000) : "";
      await run(
        `INSERT INTO order_items (order_id, product_id, marketplace_product_id, product_name, qty, price, image_url, color, size, brand, marketplace_commission_amount, variant_options_json, variant_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          variant_options && Object.keys(variant_options).length
            ? JSON.stringify(variant_options)
            : null,
          variant_label || null,
        ]
      );
      if (mpid && qn > 0) {
        await decrementMarketplaceStock(mpid, qn, { variant_options });
      } else if (pid && qn > 0) {
        await decrementProductStock(pid, qn, {
          size: item.size,
          color: item.color,
          variant_options,
        });
      }
    }
    await createFulfillmentsForOrder(result.id);
    await run(`UPDATE users SET last_activity_at=? WHERE id=?`, [new Date().toISOString(), req.user.id]);
    const saved = await get(`SELECT * FROM orders WHERE id=?`, [result.id]);
    const items = await all(
      `SELECT id, product_id, marketplace_product_id, product_name, qty, price, image_url, color, size, brand, variant_options_json, variant_label
       FROM order_items WHERE order_id=? ORDER BY id ASC`,
      [result.id]
    );
    try {
      await notifyUserInApp(
        req.app,
        req.user.id,
        orderReceivedNotifyTitle(orderNo),
        orderReceivedNotifyMessage(orderNo),
        "/"
      );
    } catch (_n) {
      /* لا نفشل إنشاء الطلب إذا تعذر الإشعار */
    }
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
      `SELECT id, product_id, marketplace_product_id, product_name, qty, price, image_url, color, size, brand, variant_options_json, variant_label, vendor_fulfillment_id
       FROM order_items WHERE order_id=? ORDER BY id ASC`,
      [orderId]
    );
    const fulfillments = await all(
      `SELECT f.*, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en
       FROM order_vendor_fulfillments f
       INNER JOIN marketplace_vendors mv ON mv.id = f.vendor_id
       WHERE f.order_id=?
       ORDER BY f.id ASC`,
      [orderId]
    );
    let shipping_structured = null;
    try {
      shipping_structured = order.shipping_address_json ? JSON.parse(order.shipping_address_json) : null;
    } catch (_e) {
      shipping_structured = null;
    }
    return res.json({ order, history, items, fulfillments, shipping_structured });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load tracking" });
  }
});

/** ØªØ±ØªÙŠØ¨ Ø§Ù„Ø­Ø§Ù„Ø§Øª Ù„Ù„ÙØ±Ø² Ø§Ù„Ø«Ø§Ù†ÙˆÙŠ Ø¨Ø¹Ø¯ Ø§Ù„ØªØ§Ø±ÙŠØ® (Ø§Ù„Ø£Ø­Ø¯Ø« Ø£ÙˆÙ„Ø§Ù‹) */
const ORDER_STATUS_SORT_SQL = `CASE o.status
  WHEN 'pending_receipt' THEN 1
  WHEN 'in_progress' THEN 2
  WHEN 'fulfilled' THEN 3
  WHEN 'shipping' THEN 4
  WHEN 'delivered' THEN 5
  WHEN 'cancelled' THEN 6
  ELSE 7
END`;

app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const rows =
      req.user.role === "admin"
        ? await all(
            `SELECT o.*, u.name AS customer_name, COALESCE(NULLIF(TRIM(u.phone), ''), u.email) AS customer_phone,
              COALESCE(
                (SELECT json_agg(
                  json_build_object(
                    'fulfillment_id', f.id,
                    'vendor_id', f.vendor_id,
                    'vendor_name_ar', mv.name_ar,
                    'vendor_name_en', mv.name_en,
                    'status', f.status,
                    'subtotal', f.subtotal
                  ) ORDER BY f.id
                )
                FROM order_vendor_fulfillments f
                INNER JOIN marketplace_vendors mv ON mv.id = f.vendor_id
                WHERE f.order_id = o.id),
                '[]'::json
              ) AS mp_fulfillments
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

    const order = await get(`SELECT id, user_id, order_no FROM orders WHERE id=?`, [id]);
    if (!order) return res.status(404).json({ error: "Order not found" });

    await run(`UPDATE orders SET status=? WHERE id=?`, [status, id]);
    await run(`INSERT INTO order_status_history (order_id, status) VALUES (?, ?)`, [id, status]);

    const io = req.app.get("io");
    if (order.user_id) {
      try {
        await notifyUserInApp(
          req.app,
          order.user_id,
          orderStatusNotifyTitle(order.order_no),
          orderStatusNotifyMessage(order.order_no, status),
          "/"
        );
      } catch (_e) {
        /* ignore notification failure */
      }
      if (io) {
        io.to(`user:${order.user_id}`).emit("order:updated", {
          orderId: id,
          status,
          order_no: order.order_no || null,
        });
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update order status" });
  }
});

app.get("/api/offers", async (req, res) => {
  try {
    const legacyOnly =
      String(req.query.offers_table_only || "").trim() === "1" ||
      String(req.query.offers_table_only || "").trim().toLowerCase() === "true";
    if (legacyOnly) {
      const offerRowsLegacy = await all(
        `SELECT id, product_id, banner_image_url, discount_percent, offer_end_time, created_at
         FROM product_offers ORDER BY id DESC`
      );
      const outLegacy = [];
      for (const o of offerRowsLegacy) {
        const p = await get(`SELECT * FROM products WHERE id=?`, [o.product_id]);
        if (!p) continue;
        const imgs = await all(`SELECT image_url FROM product_images WHERE product_id=?`, [p.id]);
        outLegacy.push({
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
      return res.json(outLegacy);
    }

    const offerRows = await all(
      `SELECT id, product_id, banner_image_url, discount_percent, offer_end_time, created_at
       FROM product_offers ORDER BY id DESC`
    );
    const seenCatalog = new Set();
    const seenMp = new Set();
    const out = [];

    for (const o of offerRows) {
      const pid = Number(o.product_id);
      if (!Number.isFinite(pid) || seenCatalog.has(pid)) continue;
      const p = await get(`SELECT * FROM products WHERE id=?`, [pid]);
      if (!p) continue;
      seenCatalog.add(pid);
      const imgs = await all(`SELECT image_url FROM product_images WHERE product_id=?`, [p.id]);
      out.push({
        id: o.id,
        offer_kind: "catalog_row",
        product_id: pid,
        marketplace_product_id: null,
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

    const catFlagged = await all(
      `SELECT * FROM products WHERE COALESCE(show_in_offers_tab,0) = 1 ORDER BY id DESC LIMIT 300`
    );
    for (const p of catFlagged) {
      const pid = Number(p.id);
      if (!Number.isFinite(pid) || seenCatalog.has(pid)) continue;
      seenCatalog.add(pid);
      const imgs = await all(`SELECT image_url FROM product_images WHERE product_id=?`, [p.id]);
      out.push({
        id: null,
        offer_kind: "catalog_flag",
        product_id: pid,
        marketplace_product_id: null,
        banner_image_url: "",
        discount_percent: Number(p.discount || 0),
        offer_end_time: null,
        created_at: null,
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

    const mpOfferRows = await all(
      `SELECT mp.*, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
              mvd.name_ar AS department_name_ar, mvd.name_en AS department_name_en,
              ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en,
              mprev.review_avg, mprev.review_count
       FROM marketplace_products mp
       INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND mv.is_active = 1 AND COALESCE(mv.portal_suspended, 0) = 0
       INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
       LEFT JOIN marketplace_vendor_departments mvd ON mvd.id = mp.department_id
       LEFT JOIN (
         SELECT marketplace_product_id,
                ROUND(AVG(stars)::numeric, 1) AS review_avg,
                COUNT(*)::int AS review_count
         FROM marketplace_product_reviews
         GROUP BY marketplace_product_id
       ) mprev ON mprev.marketplace_product_id = mp.id
       WHERE mp.is_active = 1 AND COALESCE(mp.show_in_offers_tab,0) = 1
       ORDER BY mp.id DESC LIMIT 300`
    );
    for (const row of mpOfferRows) {
      const mid = Number(row.id);
      if (!Number.isFinite(mid) || seenMp.has(mid)) continue;
      seenMp.add(mid);
      const m = mapMarketplaceProductRow(row);
      out.push({
        id: null,
        offer_kind: "marketplace_flag",
        product_id: null,
        marketplace_product_id: mid,
        banner_image_url: "",
        discount_percent: Number(m.discount_percent || 0),
        offer_end_time: null,
        created_at: null,
        name_ar: m.name_ar,
        name_en: m.name_en,
        description: String(m.description_ar || m.description_en || ""),
        price: m.price,
        discount: m.discount_percent,
        category: m.section_slug || "",
        subcategory: "",
        brand: String(m.vendor_name_en || m.vendor_name_ar || "").trim(),
        stock: m.stock,
        badge: "",
        sizes: [],
        colors: [],
        images: Array.isArray(m.images) ? m.images : [],
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
      return res.status(400).json({ error: "stars must be 1â€“5" });
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
      return res.status(400).json({ error: "stars must be 1â€“5" });
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

/** ØªÙ‚ÙŠÙŠÙ…Ø§Øª Ù…Ù†ØªØ¬Ø§Øª Ø§Ù„Ø³ÙˆÙ‚ Ø§Ù„Ø´Ø§Ù…Ù„ (Ø¬Ø¯ÙˆÙ„ Ù…Ù†ÙØµÙ„ Ø¹Ù† ÙƒØªØ§Ù„ÙˆØ¬ Ø§Ù„Ø£Ù„Ø¨Ø³Ø©) */
app.get("/api/admin/marketplace-product-reviews", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await all(
      `SELECT r.id, r.stars, r.comment, r.created_at,
              u.name AS user_name, u.phone AS user_phone,
              mp.id AS marketplace_product_id, mp.name_ar AS product_name_ar, mp.name_en AS product_name_en,
              mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en
       FROM marketplace_product_reviews r
       JOIN users u ON u.id = r.user_id
       JOIN marketplace_products mp ON mp.id = r.marketplace_product_id
       JOIN marketplace_vendors mv ON mv.id = mp.vendor_id
       ORDER BY r.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error("[admin] marketplace-product-reviews", err);
    return res.status(500).json({ error: "Failed to load marketplace product reviews" });
  }
});

/** Ø§Ù„Ø£ÙƒØ«Ø± Ù…Ø¨ÙŠØ¹Ø§Ù‹ Ù…Ù† Ù…Ø¬Ù…ÙˆØ¹ ÙƒÙ…ÙŠØ§Øª order_items */
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
        review_avg: null,
        review_count: 0,
      });
    }
    const ids = rows.map((r) => r.id).filter((id) => Number.isFinite(Number(id)));
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      const revRows = await all(
        `SELECT product_id, AVG(stars) AS review_avg, COUNT(*) AS review_count FROM product_reviews WHERE product_id IN (${ph}) GROUP BY product_id`,
        ids
      );
      const revMap = {};
      for (const r of revRows) {
        revMap[r.product_id] = {
          review_avg: r.review_avg != null ? Math.round(Number(r.review_avg) * 10) / 10 : null,
          review_count: Number(r.review_count || 0),
        };
      }
      for (const row of rows) {
        const rv = revMap[row.id];
        if (rv) {
          row.review_avg = rv.review_avg;
          row.review_count = rv.review_count;
        }
      }
    }
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load bestsellers" });
  }
});

function normalizeAppBannerKind(k) {
  const s = String(k || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return s === "customer_note" ? "customer_note" : "standard";
}

/** Ø¨Ø§Ù†Ø±Ø§Øª Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ â€” Ù…ÙˆØ§Ø¶Ø¹ Ù…ØªØ¹Ø¯Ø¯Ø© (Ø±Ø¦ÙŠØ³ÙŠØ©ØŒ Ù‚ÙˆØ§Ø¦Ù…ØŒ ØªÙØ§ØµÙŠÙ„â€¦) */
app.get("/api/banners", async (_req, res) => {
  try {
    const rows = await all(
      `SELECT id, title_ar, title_en, body_ar, body_en, image_url, link_url, placement, sort_order,
              COALESCE(banner_kind, 'standard') AS banner_kind
       FROM app_banners WHERE active=1 ORDER BY placement ASC, sort_order ASC, id ASC`
    );
    const mapped = rows.map((r) => ({
      ...r,
      placement: normalizeBannerPlacementValue(r.placement),
      banner_kind: normalizeAppBannerKind(r.banner_kind),
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
      banner_kind,
    } = req.body || {};
    const img = image_url != null ? String(image_url).trim() : "";
    const plRaw = placement != null ? String(placement).trim() : "";
    const pl = normalizeBannerPlacementValue(plRaw);
    if (!pl) return res.status(400).json({ error: "placement required" });
    const ta = String(title_ar).trim();
    const te = String(title_en).trim();
    const ba = String(body_ar).trim();
    const be = String(body_en).trim();
    const bk = normalizeAppBannerKind(banner_kind);
    if (bk === "customer_note") {
      const hasVisual = !!img;
      const hasCtaText = (ta || te) && (ba || be);
      if (!hasVisual && !hasCtaText) {
        return res.status(400).json({ error: "Customer note banner: add an image or title+body (like join CTA)" });
      }
    } else {
      if (!ta && !te) return res.status(400).json({ error: "title_ar or title_en required" });
      if (!ba && !be) return res.status(400).json({ error: "body_ar or body_en required" });
    }
    const r = await run(
      `INSERT INTO app_banners (title_ar, title_en, body_ar, body_en, image_url, link_url, placement, sort_order, active, banner_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        bk,
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
      banner_kind,
    } = req.body || {};
    const img = image_url != null ? String(image_url).trim() : "";
    const plRaw = placement != null ? String(placement).trim() : "";
    const pl = normalizeBannerPlacementValue(plRaw);
    if (!pl) return res.status(400).json({ error: "placement required" });
    const ta = String(title_ar).trim();
    const te = String(title_en).trim();
    const ba = String(body_ar).trim();
    const be = String(body_en).trim();
    const bk = normalizeAppBannerKind(banner_kind);
    if (bk === "customer_note") {
      const hasVisual = !!img;
      const hasCtaText = (ta || te) && (ba || be);
      if (!hasVisual && !hasCtaText) {
        return res.status(400).json({ error: "Customer note banner: add an image or title+body (like join CTA)" });
      }
    } else {
      if (!ta && !te) return res.status(400).json({ error: "title_ar or title_en required" });
      if (!ba && !be) return res.status(400).json({ error: "body_ar or body_en required" });
    }
    await run(
      `UPDATE app_banners SET title_ar=?, title_en=?, body_ar=?, body_en=?, image_url=?, link_url=?, placement=?, sort_order=?, active=?, banner_kind=? WHERE id=?`,
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
        bk,
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
    const home_sections_order = mergeHomeSectionsOrder(safeJsonParse(row?.home_sections_order_json, null));
    const home_top_banners_sticky = Number(row?.home_top_banners_sticky) === 1;
    return res.json({
      ...row,
      phones: safeJsonParse(row.phones_json, []),
      home_main_section_images: home_main_section_images && typeof home_main_section_images === "object" ? home_main_section_images : null,
      home_subcategory_slides: home_subcategory_slides && typeof home_subcategory_slides === "object" ? home_subcategory_slides : null,
      home_sections_visibility,
      home_sections_order,
      home_top_banners_sticky,
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
      `SELECT id, home_main_section_images_json, home_subcategory_slides_json, home_sections_visibility_json, home_sections_order_json, home_top_banners_sticky FROM contact_info ORDER BY id LIMIT 1`
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
    let orderJson = cur?.home_sections_order_json ?? null;
    if (body.home_sections_order !== undefined && body.home_sections_order !== null && Array.isArray(body.home_sections_order)) {
      orderJson = JSON.stringify(mergeHomeSectionsOrder(body.home_sections_order));
    }
    let homeTopSticky = cur?.home_top_banners_sticky != null ? (Number(cur.home_top_banners_sticky) === 1 ? 1 : 0) : 0;
    if (body.home_top_banners_sticky !== undefined && body.home_top_banners_sticky !== null) {
      homeTopSticky = body.home_top_banners_sticky === true || body.home_top_banners_sticky === 1 || body.home_top_banners_sticky === "1" ? 1 : 0;
    }
    await run(
      `UPDATE contact_info SET address=?, phones_json=?, whatsapp_phone=?, home_main_section_images_json=?, home_subcategory_slides_json=?, home_sections_visibility_json=?, home_sections_order_json=?, home_top_banners_sticky=? WHERE id=(SELECT id FROM contact_info ORDER BY id LIMIT 1)`,
      [address, JSON.stringify(phones), whatsapp_phone, homeJson, slidesJson, visJson, orderJson, homeTopSticky]
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
      let url;
      if (isCloudinaryConfigured()) {
        url = await uploadBufferToCloudinary(req.file.buffer);
      } else {
        url = await saveLocalUploadFromBuffer(req.file.buffer, req.file.originalname);
      }
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
      console.error("[Adora] admin.html missing â€” ensure public/admin.html is in the deployed repo.", err.message);
      res.status(500).type("text/plain").send("Admin panel file missing on server. Check that public/admin.html is deployed.");
    }
  });
}
app.get("/admin", sendAdminPanel);
app.get("/admin/", sendAdminPanel);
/** مسار قديم في HTML؛ الملفات تُقدَّم من جذر public كـ /admin.js */
app.get("/public/admin.js", (_req, res) => {
  res.redirect(301, "/admin.js");
});

app.get("/manifest.json", (_req, res) => {
  res.type("application/manifest+json; charset=utf-8");
  res.sendFile(path.join(__dirname, "manifest.json"));
});

/** Ù„Ø§ ØªÙÙ‚Ø¯Ù‘ÙŽÙ… Ù…Ù„ÙØ§Øª Ù‚Ø§Ø¹Ø¯Ø© SQLite ÙƒÙ…Ù„ÙØ§Øª Ø«Ø§Ø¨ØªØ© */
app.use((req, res, next) => {
  const p = String(req.path || "");
  if (p.endsWith(".sqlite") || p.endsWith(".sqlite-journal") || p.endsWith(".sqlite-wal")) {
    return res.status(404).end();
  }
  next();
});

ensureLocalUploadsDir();
app.use(
  "/uploads",
  (req, res, next) => {
    res.set("Cache-Control", "public, max-age=86400");
    next();
  },
  express.static(ADORA_LOCAL_UPLOADS_DIR)
);

/** Ø¹Ù†Ø¯ ÙØªØ­ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ù…Ù† Ø±Ø§Ø¨Ø· Render Ù…Ø¨Ø§Ø´Ø±Ø©: Ù„Ø§ ØªØ®Ø²Ù‘Ù† sw.js Ø¨Ù‚ÙˆØ© Ø­ØªÙ‰ ÙŠØªØ­Ø¯Ù‘Ø« Ø§Ù„Ù€ worker */
app.get("/sw.js", (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.type("application/javascript; charset=utf-8");
  res.sendFile(path.join(__dirname, "sw.js"), (err) => {
    if (err) res.status(404).type("text/plain").send("sw.js not found");
  });
});

/** صفحات وملفات داخل public/ (vendor-portal، إل.) تُعرض من جذر المسار: /vendor-portal.html وليس فقط /public/... */
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname)));

/** CORS Ù„Ù€ Socket.IO â€” ÙŠÙØ­Ø§Ø°ÙŠ Ù…Ù†Ø·Ù‚ ExpressØ› origin: * Ø¨Ø¯ÙˆÙ† credentials ÙŠØ³Ø¨Ø¨ ÙØ´Ù„Ø§Ù‹ Ù…Ø¹ Ø¨Ø¹Ø¶ Ø¹Ù…Ù„Ø§Ø¡ polling Ø®Ù„Ù Ø¨Ø±ÙˆÙƒØ³ÙŠ */
function socketIoCors() {
  const raw = process.env.SOCKET_CORS_ORIGIN || process.env.CORS_ORIGIN;
  const methods = ["GET", "POST", "OPTIONS"];
  if (!raw || !String(raw).trim()) {
    return { origin: true, credentials: true, methods, allowedHeaders: ["Content-Type"] };
  }
  const list = parseCorsOriginEnv(raw);
  if (!list.length) {
    return { origin: true, credentials: true, methods, allowedHeaders: ["Content-Type"] };
  }
  return {
    origin: list.length === 1 ? list[0] : list,
    credentials: true,
    methods,
    allowedHeaders: ["Content-Type"],
  };
}

/** Ø¹Ù†Ø¯ Ø£ÙƒØ«Ø± Ù…Ù† Ù†Ø³Ø®Ø© Ø®Ø§Ø¯Ù… (Render Instance Count > 1) ÙŠØ¬Ø¨ Redis ÙˆØ¥Ù„Ø§ polling ÙŠØ¹ÙŠØ¯ 400 Â«Session ID unknownÂ» */
async function attachSocketIoRedisAdapterIfConfigured(io) {
  const url = String(process.env.REDIS_URL || process.env.SOCKET_IO_REDIS_URL || "").trim();
  if (!url) return;
  try {
    const { createClient } = require("redis");
    const { createAdapter } = require("@socket.io/redis-adapter");
    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();
    const onRedisErr = (label) => (err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error(`[Adora] Redis (${label}):`, err.message || err);
      }
    };
    pubClient.on("error", onRedisErr("pub"));
    subClient.on("error", onRedisErr("sub"));
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    // eslint-disable-next-line no-console
    console.log("[Adora] Socket.IO: Redis adapter enabled (multi-instance safe)");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[Adora] Socket.IO: Redis adapter not used:", e.message || e);
  }
}

initDb()
  .then(async () => {
  if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "adora-dev-secret")) {
    // eslint-disable-next-line no-console
    console.warn(
      "[Adora] WARNING: Set JWT_SECRET in production to a long random string (not the default)."
    );
  }
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: socketIoCors(),
    /* Ø£Ø·ÙˆÙ„ Ø¹Ù†Ø¯ Ø¥ÙŠÙ‚Ø§Ø¸ Render Ø§Ù„Ø¨Ø§Ø±Ø¯ Ø£Ùˆ Ø´Ø¨ÙƒØ§Øª Ø¨Ø·ÙŠØ¦Ø© â€” ÙŠÙ‚Ù„Ù‘Ù„ Ø¥ØºÙ„Ø§Ù‚ Ø§Ù„Ù€ handshake Ù…Ø¨ÙƒØ±Ø§Ù‹ */
    connectTimeout: 90000,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  await attachSocketIoRedisAdapterIfConfigured(io);

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const payload = verifyToken(token);
    if (!payload || !payload.id) {
      return next(new Error("unauthorized"));
    }
    socket.userId = payload.id;
    socket.userRole = payload.role || "user";
    socket.join(`user:${payload.id}`);
    if (socket.userRole === "admin") {
      socket.join("admin");
    } else {
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

/**
 * السوق الشامل — أقسام، مولات/شركات، منتجات (عامة + لوحة تحكم)
 */
const { get, all, run } = require("./db");
const { arabicSearchQueryVariants, sqlLikePrefixParam, sqlLikeContainsParam } = require("./search-utils");
const { getVendorPlatformSettings } = require("./vendor-platform-settings");
const {
  allocateNextPublicProductCode,
  allocateNextPublicVendorCode,
  deleteMarketplaceVendorCompletely,
} = require("./adora-mv-core");

/** شركة مميزة «فعّالة» حسب is_premium و premium_until */
function vendorPremiumEffectiveAt(isPremium, premiumUntil, nowMs = Date.now()) {
  if (Number(isPremium) !== 1) return false;
  if (premiumUntil == null || String(premiumUntil).trim() === "") return true;
  const t = new Date(String(premiumUntil)).getTime();
  if (Number.isNaN(t)) return true;
  return t > nowMs;
}

/** منتج مميز 🔥 «فعّال» حسب is_mp_featured و mp_featured_until */
function mpProductFeaturedEffectiveAt(isFeatured, until, nowMs = Date.now()) {
  if (Number(isFeatured) !== 1) return false;
  if (until == null || String(until).trim() === "") return true;
  const t = new Date(String(until)).getTime();
  if (Number.isNaN(t)) return true;
  return t > nowMs;
}

async function notifyVendorPortal(vendorId, title, message) {
  const vid = Number(vendorId);
  if (!Number.isFinite(vid) || vid <= 0) return;
  try {
    await run(
      `INSERT INTO vendor_portal_notifications (vendor_id, title, message, link_url, is_read) VALUES (?, ?, ?, ?, 0)`,
      [vid, title, message, null]
    );
  } catch (e) {
    console.error("vendor_portal_notifications insert failed", e);
  }
}

function safeJsonParse(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  /** PostgreSQL قد يُرجِع JSON/JSONB ككائن/مصفوفة جاهزة — JSON.parse عليها يفشل ويُعاد fallback خاطئ */
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function mapProductRow(row) {
  if (!row) return row;
  const slot = row.promo_slot != null ? String(row.promo_slot).trim() : "";
  const is_search_sponsored = slot === "search_sponsored" && row.promo_id != null ? 1 : 0;
  const is_section_featured_promo = slot === "section_featured" && row.promo_id != null ? 1 : 0;
  const is_listing_top_promo = slot === "listing_top" && row.promo_id != null ? 1 : 0;
  const is_home_featured_promo = slot === "home_featured" && row.promo_id != null ? 1 : 0;
  const {
    promo_id: _pid,
    promo_priority: _pp,
    promo_slot: _ps,
    inventory_json: _invj,
    product_options_json: _poj,
    ...rest
  } = row;
  const disc = Math.min(100, Math.max(0, Number(row.discount_percent ?? 0)));
  const listPrice = Number(row.price ?? 0);
  const finalPrice =
    disc > 0 && disc < 100 ? Math.round(listPrice * (100 - disc) * 100) / 10000 : listPrice;
  const review_avg =
    row.review_avg != null && String(row.review_avg).trim() !== ""
      ? Math.round(Number(row.review_avg) * 10) / 10
      : null;
  const review_count = Number(row.review_count || 0);
  const product_options = safeJsonParse(row.product_options_json, []);
  const inventory = safeJsonParse(row.inventory_json, []);
  const poArr = Array.isArray(product_options) ? product_options : [];
  const invArr = Array.isArray(inventory) ? inventory : [];
  let stockOut = Number(row.stock ?? 0);
  if (poArr.length && invArr.length) {
    stockOut = invArr.reduce((a, r) => a + Math.max(0, Math.floor(Number(r.stock) || 0)), 0);
  }
  let is_mp_featured_effective = 0;
  if (Number(row.is_mp_featured) === 1) {
    const u = row.mp_featured_until;
    if (u == null || String(u).trim() === "") is_mp_featured_effective = 1;
    else {
      const t = new Date(u);
      is_mp_featured_effective = !Number.isNaN(t.getTime()) && t > new Date() ? 1 : 0;
    }
  }
  return {
    ...rest,
    is_mp_featured_effective,
    images: safeJsonParse(row.images_json, []),
    discount_percent: disc,
    price: listPrice,
    final_price: finalPrice,
    is_search_sponsored,
    is_section_featured_promo,
    is_listing_top_promo,
    is_home_featured_promo,
    marketplace_promo_slot: slot && row.promo_id != null ? slot : null,
    review_avg,
    review_count,
    inventory: invArr,
    product_options: poArr,
    stock: stockOut,
  };
}

/** تجميع تقييمات منتجات السوق — يُضاف كـ LEFT JOIN في استعلامات القوائم */
const MP_REVIEW_JOIN_SQL = `LEFT JOIN (
  SELECT marketplace_product_id,
         ROUND(AVG(stars)::numeric, 1) AS review_avg,
         COUNT(*)::int AS review_count
  FROM marketplace_product_reviews
  GROUP BY marketplace_product_id
) mprev ON mprev.marketplace_product_id = mp.id`;

function normLower(s) {
  return String(s ?? "").trim().toLowerCase();
}

/** أقسام الرئيسية التي يمكن ربط منتجات/شركات السوق الشامل بها */
const MP_HOME_SLOTS = new Set([
  "brands_strip",
  "top_brands_strip",
  "flash_sale",
  "curated",
  "promo_collection",
  "bestsellers",
]);

function normalizeMpHomeSlot(slot) {
  const s = String(slot || "").trim();
  return MP_HOME_SLOTS.has(s) ? s : null;
}

const MP_FEATURED_HUB_SECTIONS = new Set([
  "clothes",
  "electronics",
  "phones",
  "shoes",
  "accessories",
  "bedding",
  "medical",
  "used",
]);

function normalizeMpFeaturedHubSection(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return MP_FEATURED_HUB_SECTIONS.has(s) ? s : null;
}

const VENDOR_LISTING_STATUSES = new Set(["pending", "published", "rejected"]);

function normalizeVendorListingStatus(raw, curRow) {
  const fb =
    curRow && curRow.vendor_listing_status != null
      ? String(curRow.vendor_listing_status).trim().toLowerCase()
      : "published";
  const fallback = VENDOR_LISTING_STATUSES.has(fb) ? fb : "published";
  if (raw === undefined || raw === null) return fallback;
  const s = String(raw).trim().toLowerCase();
  return VENDOR_LISTING_STATUSES.has(s) ? s : fallback;
}

/** منتجات البائع غير المعتمدة لا تظهر للزبائن في واجهة التطبيق */
const MP_PUBLIC_LISTING_FILTER = `AND COALESCE(mp.vendor_listing_status, 'published') = 'published'`;

/** شركة موقوفة من الإدارة (إيقاف البوابة) لا تظهر للزبائن مع منتجاتها */
const MP_PUBLIC_VENDOR_ACTIVE = `mv.is_active = 1 AND COALESCE(mv.portal_suspended, 0) = 0`;

/** شركة مميزة فعّالة (is_premium + تاريخ انتهاء غير منقضٍ) — ترتيب وبحث دون نجمة على كل منتج */
const MP_SQL_VENDOR_PREMIUM_OK = `(COALESCE(mv.is_premium,0) = 1 AND (mv.premium_until IS NULL OR mv.premium_until > CURRENT_TIMESTAMP))`;
/** منتج مميز فعّال — العلم + مدة انتهاء اختيارية */
const MP_SQL_PRODUCT_FEATURED_OK = `(COALESCE(mp.is_mp_featured,0) = 1 AND (mp.mp_featured_until IS NULL OR mp.mp_featured_until > CURRENT_TIMESTAMP))`;
const MP_ORDER_VENDOR_PREMIUM = `(CASE WHEN ${MP_SQL_VENDOR_PREMIUM_OK} THEN 0 ELSE 1 END)`;
const MP_ORDER_PRODUCT_FEATURED = `(CASE WHEN ${MP_SQL_PRODUCT_FEATURED_OK} THEN 0 ELSE 1 END)`;

const MP_SELECT_LIST = `mp.id, mp.section_id, mp.vendor_id, mp.public_product_code, mp.name_ar, mp.name_en, mp.description_ar, mp.description_en,
      mp.price, mp.discount_percent, mp.stock, mp.images_json, mp.inventory_json, mp.product_options_json, mp.is_offer, mp.sort_order, mp.sales_count, mp.created_at,
      mp.department_id, mp.is_mp_featured, mp.mp_featured_until, mp.featured_hub_enabled, mp.featured_hub_section, mp.show_in_offers_tab, mp.show_in_marketplace_tab, mp.vendor_listing_status,
      mp.show_in_flash_sale_strip, mp.show_in_curated_strip, mp.show_in_promo_collection_strip, mp.show_in_bestsellers_strip, mp.show_in_you_may_also_like, mp.search_priority_boost,
      mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
      mvd.name_ar AS department_name_ar, mvd.name_en AS department_name_en,
      ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en`;

/** دمج منتجات السوق المفعّل لها ظهور تلقائي في شريط رئيسي (إضافةً لجدول marketplace_home_placements) */
const MP_HOME_STRIP_FLAG_COLUMN = {
  flash_sale: "show_in_flash_sale_strip",
  curated: "show_in_curated_strip",
  promo_collection: "show_in_promo_collection_strip",
  bestsellers: "show_in_bestsellers_strip",
};

async function mergeMpHomeStripFlagProducts(result) {
  for (const slot of Object.keys(MP_HOME_STRIP_FLAG_COLUMN)) {
    const col = MP_HOME_STRIP_FLAG_COLUMN[slot];
    if (!col || String(col).includes(" ") || String(col).includes(";")) continue;
    const items = Array.isArray(result[slot]) ? result[slot] : [];
    const seen = new Set();
    for (const x of items) {
      if (x && x.kind === "mp_product" && x.id != null) seen.add(Number(x.id));
    }
    const rows = await all(
      `SELECT ${MP_SELECT_LIST}, mprev.review_avg, mprev.review_count
       ${MP_FROM}
       ${MP_REVIEW_JOIN_SQL}
       WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER} AND COALESCE(mp.${col},0) = 1
       ORDER BY ${MP_ORDER_VENDOR_PREMIUM} ASC, ${MP_ORDER_PRODUCT_FEATURED} ASC, mp.sort_order ASC, mp.id DESC
       LIMIT 80`,
      []
    );
    const out = items.slice();
    for (const row of rows) {
      const pid = Number(row.id);
      if (!Number.isFinite(pid) || seen.has(pid)) continue;
      seen.add(pid);
      out.push({ kind: "mp_product", ...mapProductRow(row) });
    }
    result[slot] = out;
  }
}

const MP_FROM = `FROM marketplace_products mp
      INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND ${MP_PUBLIC_VENDOR_ACTIVE}
      INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
      LEFT JOIN marketplace_vendor_departments mvd ON mvd.id = mp.department_id`;

async function resolveMpHomeSlotItems(placements, slot) {
  const isBrandSlot = slot === "brands_strip" || slot === "top_brands_strip";
  const out = [];
  const seen = new Set();
  for (const pl of placements) {
    const tt = String(pl.target_type || "").trim().toLowerCase();
    const tid = Number(pl.target_id);
    if (!Number.isFinite(tid)) continue;
    if (tt === "vendor") {
      const v = await get(
        `SELECT id, name_ar, name_en, logo_url, is_premium, premium_until,
          (CASE WHEN COALESCE(is_premium,0) = 1 AND (premium_until IS NULL OR premium_until > CURRENT_TIMESTAMP) THEN 1 ELSE 0 END) AS is_premium_active
         FROM marketplace_vendors WHERE id=? AND COALESCE(is_active,1)=1 AND COALESCE(portal_suspended,0)=0`,
        [tid]
      );
      if (!v) continue;
      if (isBrandSlot) {
        const k = `v:${v.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          kind: "mp_vendor",
          id: v.id,
          name_ar: v.name_ar,
          name_en: v.name_en,
          logo_url: v.logo_url || "",
          is_premium_active: Number(v.is_premium_active) === 1 ? 1 : 0,
        });
      } else {
        const prows = await all(
          `SELECT ${MP_SELECT_LIST} ${MP_FROM} WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER} AND mp.vendor_id=? ORDER BY ${MP_ORDER_PRODUCT_FEATURED} ASC, mp.sort_order ASC, mp.id DESC LIMIT 60`,
          [tid]
        );
        for (const row of prows) {
          const k = `p:${row.id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ kind: "mp_product", ...mapProductRow(row) });
        }
      }
    } else if (tt === "department") {
      if (isBrandSlot) continue;
      const d = await get(
        `SELECT id FROM marketplace_vendor_departments WHERE id=? AND COALESCE(is_active,1)=1`,
        [tid]
      );
      if (!d) continue;
      const prows = await all(
        `SELECT ${MP_SELECT_LIST} ${MP_FROM} WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER} AND mp.department_id=? ORDER BY ${MP_ORDER_VENDOR_PREMIUM} ASC, ${MP_ORDER_PRODUCT_FEATURED} ASC, mp.sort_order ASC, mp.id DESC LIMIT 60`,
        [tid]
      );
      for (const row of prows) {
        const k = `p:${row.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ kind: "mp_product", ...mapProductRow(row) });
      }
    } else if (tt === "product") {
      if (isBrandSlot) continue;
      const row = await get(`SELECT ${MP_SELECT_LIST} ${MP_FROM} WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER} AND mp.id=?`, [tid]);
      if (!row) continue;
      const k = `p:${row.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ kind: "mp_product", ...mapProductRow(row) });
    }
  }
  return out;
}

async function buildAppHomePlacementsResponse() {
  const slotList = Array.from(MP_HOME_SLOTS);
  const ph = slotList.map(() => "?").join(", ");
  const rows = await all(
    `SELECT id, slot, target_type, target_id, sort_order FROM marketplace_home_placements WHERE slot IN (${ph}) ORDER BY slot ASC, sort_order ASC, id ASC`,
    slotList
  );
  const bySlot = {};
  for (const s of slotList) bySlot[s] = [];
  for (const r of rows) {
    if (bySlot[r.slot]) bySlot[r.slot].push(r);
  }
  const result = {};
  for (const slot of slotList) {
    result[slot] = await resolveMpHomeSlotItems(bySlot[slot] || [], slot);
  }
  await mergeMpHomeStripFlagProducts(result);
  return result;
}

async function findMarketplaceProductDuplicate(vendorId, { name_ar, name_en, sku, barcode }, excludeId) {
  const nar = normLower(name_ar);
  const nen = normLower(name_en);
  const sk = sku != null && String(sku).trim() !== "" ? String(sku).trim() : "";
  const bc = barcode != null && String(barcode).trim() !== "" ? String(barcode).trim() : "";
  const conds = [];
  const params = [vendorId];
  let sql = `SELECT id FROM marketplace_products WHERE vendor_id = ?`;
  if (excludeId != null && Number.isFinite(excludeId)) {
    sql += ` AND id <> ?`;
    params.push(excludeId);
  }
  if (nar) {
    conds.push(`LOWER(TRIM(name_ar)) = ?`);
    params.push(nar);
  }
  if (nen) {
    conds.push(`LOWER(TRIM(name_en)) = ?`);
    params.push(nen);
  }
  if (sk) {
    conds.push(`(sku IS NOT NULL AND TRIM(sku) = ?)`);
    params.push(sk);
  }
  if (bc) {
    conds.push(`(barcode IS NOT NULL AND TRIM(barcode) = ?)`);
    params.push(bc);
  }
  if (!conds.length) return null;
  sql += ` AND (${conds.join(" OR ")}) LIMIT 1`;
  return await get(sql, params);
}

async function fetchMarketplaceProductsByPromotionSlot(slot, limit) {
  const rows = await all(
    `SELECT mp.id, mp.section_id, mp.vendor_id, mp.name_ar, mp.name_en, mp.description_ar, mp.description_en,
      mp.price, mp.discount_percent, mp.stock, mp.images_json, mp.inventory_json, mp.product_options_json, mp.is_offer, mp.sort_order, mp.sales_count, mp.created_at,
      mp.department_id,
      mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
      mvd.name_ar AS department_name_ar, mvd.name_en AS department_name_en,
      ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en,
      mprev.review_avg, mprev.review_count,
      pr.id AS promo_id, pr.priority AS promo_priority, pr.slot AS promo_slot
     FROM marketplace_product_promotions pr
     INNER JOIN marketplace_products mp ON mp.id = pr.product_id AND mp.is_active = 1 AND COALESCE(mp.vendor_listing_status, 'published') = 'published'
     INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND ${MP_PUBLIC_VENDOR_ACTIVE}
     INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
     LEFT JOIN marketplace_vendor_departments mvd ON mvd.id = mp.department_id
     ${MP_REVIEW_JOIN_SQL}
     WHERE pr.slot = ? AND pr.is_active = 1
       AND pr.starts_at <= CURRENT_TIMESTAMP AND pr.ends_at >= CURRENT_TIMESTAMP
       AND (pr.max_impressions IS NULL OR pr.impressions_count < pr.max_impressions)
     ORDER BY pr.priority DESC, mp.id DESC
     LIMIT ?`,
    [slot, limit]
  );
  return rows;
}

async function bumpPromotionImpressionsForRows(rows) {
  const ids = [...new Set((rows || []).map((r) => r.promo_id).filter((id) => id != null))];
  for (const pid of ids) {
    await run(`UPDATE marketplace_product_promotions SET impressions_count = impressions_count + 1 WHERE id = ?`, [pid]);
  }
}

/** حد المنتجات النشطة: كل صف في marketplace_products = منتج واحد ضمن الحصة، بمواصفات ديناميكية أو بدونها (التركيبات لا تزيد العدد). */
async function assertMarketplaceProductQuota(vendorId, settings, willBeActive) {
  if (!willBeActive) return { ok: true };
  if (!settings || Number(settings.product_quota_enabled) !== 1) return { ok: true };
  const v = await get(
    `SELECT COALESCE(paid_product_slots, 0)::int AS paid_product_slots, COALESCE(product_quota, 0)::int AS product_quota FROM marketplace_vendors WHERE id = ?`,
    [vendorId]
  );
  const paid = Number(v?.paid_product_slots || 0);
  const pq = Number(v?.product_quota || 0);
  const freeDefault = Math.max(0, Math.floor(Number(settings.free_products_per_vendor) || 0));
  const free = pq > 0 ? pq : freeDefault;
  const limit = free + paid;
  const c = await get(
    `SELECT COUNT(*)::int AS n FROM marketplace_products WHERE vendor_id = ? AND is_active = 1`,
    [vendorId]
  );
  const n = Number(c?.n || 0);
  if (n >= limit) {
    return {
      ok: false,
      error: `وصلتَ لحد المنتجات النشطة (${limit}). كل منتج يُحسب وحدة واحدة — بما فيه المنتج ذو المواصفات المتعددة (لون/قياس…). زِد الحصة من لوحة الإدارة أو عطّل نظام الحصص من إعدادات المنصة.`,
    };
  }
  return { ok: true };
}

async function resolveDepartmentIdForProduct(vendorId, departmentIdRaw) {
  const vid = Number(vendorId);
  if (!Number.isFinite(vid)) return { ok: false, error: "Invalid vendor" };
  const want = departmentIdRaw != null ? Number(departmentIdRaw) : null;
  if (Number.isFinite(want)) {
    const d = await get(
      `SELECT id FROM marketplace_vendor_departments WHERE id=? AND vendor_id=? AND is_active=1`,
      [want, vid]
    );
    if (d) return { ok: true, department_id: want };
  }
  const def = await get(
    `SELECT id FROM marketplace_vendor_departments WHERE vendor_id=? AND is_active=1 ORDER BY sort_order ASC, id ASC LIMIT 1`,
    [vid]
  );
  if (!def) return { ok: false, error: "أنشئ قسماً داخل الشركة أولاً (من لوحة التحكم)." };
  return { ok: true, department_id: Number(def.id) };
}

async function getMarketplaceProductMappedAdminById(id) {
  const row = await get(
    `SELECT mp.*, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
            mvd.name_ar AS department_name_ar, mvd.name_en AS department_name_en,
            ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en
     FROM marketplace_products mp
     INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id
     INNER JOIN marketplace_sections ms ON ms.id = mp.section_id
     LEFT JOIN marketplace_vendor_departments mvd ON mvd.id = mp.department_id
     WHERE mp.id=?`,
    [id]
  );
  return row ? mapProductRow(row) : null;
}

/** تاريخ انتهاء تمييز منتج السوق — ISO أو null (بدون انتهاء) */
function normalizeMpFeaturedUntil(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function clampDiscountPercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** مواصفات ديناميكية + مخزون صفوف — يُحدَّث عمود stock ليكون مجموع المخزون عند وجود مجموعات */
function normalizeMpVariantsForSave({ product_options, inventory, stock }) {
  const optArr = Array.isArray(product_options) ? product_options : [];
  const invArr = Array.isArray(inventory) ? inventory : [];
  let stockNum = Math.max(0, Math.floor(Number(stock) || 0));
  if (optArr.length) {
    stockNum = invArr.reduce((a, r) => a + Math.max(0, Math.floor(Number(r.stock) || 0)), 0);
  }
  return { optArr, invArr, stockNum };
}

/** صورة بطاقة دخول السوق في التطبيق: المحفوظة في الإعدادات، أو أول صورة كرت من أقسام السوق */
async function buildMarketplaceEntranceResponse(s) {
  if (!s) {
    return {
      image_url: null,
      hero_image_url: null,
      title_ar: "",
      title_en: "",
      subtitle_ar: "",
      subtitle_en: "",
    };
  }
  const stored =
    s.marketplace_entrance_image_url != null && String(s.marketplace_entrance_image_url).trim() !== ""
      ? String(s.marketplace_entrance_image_url).trim()
      : null;
  let hero = stored;
  if (!hero) {
    const row = await get(
      `SELECT card_image_url FROM marketplace_sections
       WHERE COALESCE(is_active, 1) = 1
         AND card_image_url IS NOT NULL
         AND LENGTH(TRIM(COALESCE(card_image_url, ''))) > 0
       ORDER BY sort_order ASC, id ASC
       LIMIT 1`
    );
    if (row && row.card_image_url) hero = String(row.card_image_url).trim();
  }
  return {
    image_url: stored,
    hero_image_url: hero || null,
    title_ar: s.marketplace_entrance_title_ar || "",
    title_en: s.marketplace_entrance_title_en || "",
    subtitle_ar: s.marketplace_entrance_subtitle_ar || "",
    subtitle_en: s.marketplace_entrance_subtitle_en || "",
  };
}

/** دمج نتائج بحث السوق الشامل مع قائمة الكتالوج عند البحث النصي */
async function fetchMarketplaceProductsForListingSearchMerge(variants) {
  if (!variants || !variants.length) return [];
  const parts = [];
  const params = [];
  for (const v of variants) {
    const like = sqlLikePrefixParam(v);
    const likeSub = sqlLikeContainsParam(v);
    const likeCode = sqlLikeContainsParam(v);
    parts.push(
      `(mp.name_ar ILIKE ? OR mp.name_en ILIKE ? OR mv.name_ar ILIKE ? OR mv.name_en ILIKE ? OR mv.name_ar ILIKE ? OR mv.name_en ILIKE ? OR mp.public_product_code ILIKE ? OR mv.public_vendor_code ILIKE ?)`
    );
    params.push(like, like, like, like, likeSub, likeSub, likeCode, likeCode);
  }
  const sql = `SELECT ${MP_SELECT_LIST}, mprev.review_avg, mprev.review_count
     ${MP_FROM}
     ${MP_REVIEW_JOIN_SQL}
     WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER}
     AND (${parts.join(" OR ")})
     ORDER BY ${MP_ORDER_VENDOR_PREMIUM} ASC, ${MP_ORDER_PRODUCT_FEATURED} ASC, mp.id DESC
     LIMIT 120`;
  const rows = await all(sql, params);
  return rows.map((r) => {
    const m = mapProductRow(r);
    m.adora_listing_kind = "marketplace";
    return m;
  });
}

function registerMarketplaceRoutes(app, { requireAuth, requireAdmin }) {
  app.get("/api/marketplace/entrance", async (_req, res) => {
    try {
      const s = await getVendorPlatformSettings();
      const payload = await buildMarketplaceEntranceResponse(s);
      return res.json(payload);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load entrance" });
    }
  });

  app.put("/api/admin/marketplace/entrance", requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const image_url = b.image_url != null ? String(b.image_url).trim().slice(0, 2000) : "";
      const title_ar = b.title_ar != null ? String(b.title_ar).trim().slice(0, 500) : "";
      const title_en = b.title_en != null ? String(b.title_en).trim().slice(0, 500) : "";
      const subtitle_ar = b.subtitle_ar != null ? String(b.subtitle_ar).trim().slice(0, 800) : "";
      const subtitle_en = b.subtitle_en != null ? String(b.subtitle_en).trim().slice(0, 800) : "";
      await run(
        `UPDATE vendor_platform_settings SET
          marketplace_entrance_image_url=?,
          marketplace_entrance_title_ar=?,
          marketplace_entrance_title_en=?,
          marketplace_entrance_subtitle_ar=?,
          marketplace_entrance_subtitle_en=?,
          updated_at=CURRENT_TIMESTAMP
         WHERE id=1`,
        [
          image_url || null,
          title_ar,
          title_en,
          subtitle_ar,
          subtitle_en,
        ]
      );
      const s = await getVendorPlatformSettings();
      return res.json(await buildMarketplaceEntranceResponse(s));
    } catch (_e) {
      return res.status(500).json({ error: "Failed to save entrance" });
    }
  });

  app.get("/api/marketplace/sections", async (_req, res) => {
    try {
      const rows = await all(
        `SELECT id, slug, name_ar, name_en, subtitle_ar, subtitle_en, card_image_url, sort_order
         FROM marketplace_sections WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: "Failed to load marketplace sections" });
    }
  });

  app.get("/api/marketplace/vendors", async (req, res) => {
    try {
      const sid = req.query.section_id != null ? Number(req.query.section_id) : null;
      let sql = `SELECT id, section_id, name_ar, name_en, vendor_type, logo_url, cover_image_url, sort_order,
                        COALESCE(is_premium, 0) AS is_premium, premium_until,
                        COALESCE(premium_subscription_type, 'none') AS premium_subscription_type,
                        (CASE WHEN COALESCE(is_premium,0) = 1 AND (premium_until IS NULL OR premium_until > CURRENT_TIMESTAMP) THEN 1 ELSE 0 END) AS is_premium_active,
                        COALESCE(show_in_app_brands_section, 1) AS show_in_app_brands_section,
                        COALESCE(show_in_app_top_brands_section, 0) AS show_in_app_top_brands_section
                 FROM marketplace_vendors WHERE is_active = 1 AND COALESCE(portal_suspended, 0) = 0`;
      const params = [];
      if (sid != null && Number.isFinite(sid)) {
        sql += ` AND section_id = ?`;
        params.push(sid);
      }
      sql += ` ORDER BY (CASE WHEN COALESCE(is_premium,0) = 1 AND (premium_until IS NULL OR premium_until > CURRENT_TIMESTAMP) THEN 0 ELSE 1 END) ASC,
                sort_order ASC, id ASC`;
      const rows = await all(sql, params);
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: "Failed to load vendors" });
    }
  });

  app.get("/api/marketplace/home/featured-vendors", async (_req, res) => {
    try {
      const rows = await all(
        `SELECT id, section_id, name_ar, name_en, vendor_type, logo_url, cover_image_url, sort_order
         FROM marketplace_vendors
         WHERE is_active = 1 AND COALESCE(portal_suspended, 0) = 0
           AND COALESCE(is_premium, 0) = 1
           AND (premium_until IS NULL OR premium_until > CURRENT_TIMESTAMP)
         ORDER BY sort_order ASC, id ASC
         LIMIT 48`,
        []
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load featured vendors" });
    }
  });

  app.get("/api/marketplace/home/featured-products", async (_req, res) => {
    try {
      const rows = await all(
        `SELECT ${MP_SELECT_LIST}, mprev.review_avg, mprev.review_count
         ${MP_FROM}
         ${MP_REVIEW_JOIN_SQL}
         WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER}
           AND COALESCE(mp.show_in_marketplace_tab, 1) = 1
           AND ${MP_SQL_PRODUCT_FEATURED_OK}
         ORDER BY ${MP_ORDER_VENDOR_PREMIUM} ASC, mp.sort_order ASC, mp.id DESC
         LIMIT 28`,
        []
      );
      return res.json(rows.map(mapProductRow));
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load featured marketplace products" });
    }
  });

  app.get("/api/marketplace/products", async (req, res) => {
    try {
      const q = req.query.q != null ? String(req.query.q).trim() : "";
      const sectionId = req.query.section_id != null ? Number(req.query.section_id) : null;
      const vendorId = req.query.vendor_id != null ? Number(req.query.vendor_id) : null;
      const minP = req.query.min_price != null ? Number(req.query.min_price) : null;
      const maxP = req.query.max_price != null ? Number(req.query.max_price) : null;
      const sort = req.query.sort != null ? String(req.query.sort).trim() : "newest";
      const isOffer = req.query.is_offer === "1" || req.query.is_offer === "true";

      const settings = await getVendorPlatformSettings();
      const adsOn = settings && Number(settings.ads_module_enabled) === 1;
      /** أولوية السلوت: بحث → أعلى قائمة المتجر → داخل القسم */
      let promoSlot = null;
      if (adsOn) {
        if (q) promoSlot = "search_sponsored";
        else if (vendorId != null && Number.isFinite(vendorId)) promoSlot = "listing_top";
        else if (sectionId != null && Number.isFinite(sectionId)) promoSlot = "section_featured";
      }

      let promoSelect = "";
      let promoJoin = "";
      if (promoSlot) {
        promoSelect = ", pr.id AS promo_id, COALESCE(pr.priority, 0) AS promo_priority, pr.slot AS promo_slot";
        promoJoin = `
          LEFT JOIN LATERAL (
            SELECT pz.id, pz.priority, pz.slot
            FROM marketplace_product_promotions pz
            WHERE pz.product_id = mp.id AND pz.slot = ? AND pz.is_active = 1
              AND pz.starts_at <= CURRENT_TIMESTAMP AND pz.ends_at >= CURRENT_TIMESTAMP
              AND (pz.max_impressions IS NULL OR pz.impressions_count < pz.max_impressions)
            ORDER BY pz.priority DESC, pz.id ASC
            LIMIT 1
          ) pr ON true
        `;
      }

      let sql = `SELECT mp.id, mp.section_id, mp.vendor_id, mp.name_ar, mp.name_en, mp.description_ar, mp.description_en,
                        mp.price, mp.discount_percent, mp.stock, mp.images_json, mp.inventory_json, mp.product_options_json, mp.is_offer, mp.sort_order, mp.sales_count, mp.created_at,
                        mp.department_id, mp.is_mp_featured, mp.mp_featured_until, mp.search_priority_boost,
                        mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
                        mvd.name_ar AS department_name_ar, mvd.name_en AS department_name_en,
                        ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en,
                        mprev.review_avg, mprev.review_count
                        ${promoSelect}
                 FROM marketplace_products mp
                 INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND ${MP_PUBLIC_VENDOR_ACTIVE}
                 INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
                 LEFT JOIN marketplace_vendor_departments mvd ON mvd.id = mp.department_id
                 ${MP_REVIEW_JOIN_SQL}
                 ${promoJoin}
                 WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER}`;
      const params = [];
      if (promoSlot) params.push(promoSlot);

      /** داخل واجهة شركة محددة: كل المنتجات النشطة تظهر حتى لو show_in_marketplace_tab=0 */
      const vendorScopedList = vendorId != null && Number.isFinite(vendorId);
      if (!vendorScopedList) {
        sql += ` AND COALESCE(mp.show_in_marketplace_tab, 1) = 1`;
      }

      const fh = String(req.query.featured_hub || "").trim();
      if (fh === "1" || fh === "true") {
        sql += ` AND COALESCE(mp.featured_hub_enabled,0) = 1`;
        const fsec = normalizeMpFeaturedHubSection(req.query.featured_hub_section);
        if (fsec) {
          sql += ` AND mp.featured_hub_section = ?`;
          params.push(fsec);
        }
      }

      const narrowBrowse =
        (vendorId != null && Number.isFinite(vendorId)) || (sectionId != null && Number.isFinite(sectionId));
      if (!q && !narrowBrowse) {
        sql += ` AND ${MP_SQL_PRODUCT_FEATURED_OK}`;
      }

      if (sectionId != null && Number.isFinite(sectionId)) {
        sql += ` AND mp.section_id = ?`;
        params.push(sectionId);
      }
      if (vendorId != null && Number.isFinite(vendorId)) {
        sql += ` AND mp.vendor_id = ?`;
        params.push(vendorId);
      }
      if (minP != null && Number.isFinite(minP)) {
        sql += ` AND mp.price >= ?`;
        params.push(minP);
      }
      if (maxP != null && Number.isFinite(maxP)) {
        sql += ` AND mp.price <= ?`;
        params.push(maxP);
      }
      if (isOffer) {
        sql += ` AND mp.is_offer = 1`;
      }
      if (q) {
        const variants = arabicSearchQueryVariants(String(q).trim());
        if (variants.length) {
          const parts = [];
          for (const v of variants) {
            const like = sqlLikePrefixParam(v);
            const likeSub = sqlLikeContainsParam(v);
            parts.push(`(
          mp.name_ar ILIKE ? OR mp.name_en ILIKE ?
          OR mv.name_ar ILIKE ? OR mv.name_en ILIKE ?
          OR ms.name_ar ILIKE ? OR ms.name_en ILIKE ?
          OR mvd.name_ar ILIKE ? OR mvd.name_en ILIKE ?
          OR mv.name_ar ILIKE ? OR mv.name_en ILIKE ?
        )`);
            params.push(like, like, like, like, like, like, like, like, likeSub, likeSub);
          }
          sql += ` AND (${parts.join(" OR ")})`;
        }
      }

      let orderBody = "mp.created_at DESC, mp.id DESC";
      if (sort === "price_asc") orderBody = "mp.price ASC, mp.id ASC";
      else if (sort === "price_desc") orderBody = "mp.price DESC, mp.id DESC";
      else if (sort === "bestsellers") orderBody = "mp.sales_count DESC, mp.created_at DESC";

      const searchVendorBoost = q ? `COALESCE(mv.search_priority, 0) DESC, ` : "";
      const productSearchBoost = q ? `COALESCE(mp.search_priority_boost, 0) DESC, ` : "";
      const vendorPremiumFirst = `${MP_ORDER_VENDOR_PREMIUM} ASC, `;
      const orderSql = promoSlot
        ? `${vendorPremiumFirst}${productSearchBoost}${searchVendorBoost}${MP_ORDER_PRODUCT_FEATURED} ASC, (CASE WHEN pr.id IS NOT NULL THEN 0 ELSE 1 END) ASC, pr.priority DESC NULLS LAST, ${orderBody}`
        : `${vendorPremiumFirst}${productSearchBoost}${searchVendorBoost}${MP_ORDER_PRODUCT_FEATURED} ASC, ${orderBody}`;
      sql += ` ORDER BY ${orderSql} LIMIT 200`;

      const rows = await all(sql, params);
      const promoIds =
        promoSlot && rows.length ? [...new Set(rows.map((r) => r.promo_id).filter((id) => id != null))] : [];
      for (const pid of promoIds) {
        await run(`UPDATE marketplace_product_promotions SET impressions_count = impressions_count + 1 WHERE id = ?`, [pid]);
      }
      return res.json(rows.map(mapProductRow));
    } catch (err) {
      return res.status(500).json({ error: "Failed to load marketplace products" });
    }
  });

  app.get("/api/marketplace/products/you-may-also-like", async (req, res) => {
    try {
      const excludeRaw = req.query.exclude_id != null ? Number(req.query.exclude_id) : NaN;
      const limRaw = req.query.limit != null ? Number(req.query.limit) : 12;
      const limit = Number.isFinite(limRaw) ? Math.min(24, Math.max(1, Math.floor(limRaw))) : 12;
      /** فقط منتجات مفعّل لها «قد يعجبك أيضاً» في لوحة التحكم. لا تعبئة تلقائية من باقي السوق (fallback=1 اختياري لاختبار داخلي فقط). */
      const allowFallback = req.query.fallback === "1" || req.query.fallback === "true";

      let sql = `SELECT ${MP_SELECT_LIST}, mprev.review_avg, mprev.review_count
        ${MP_FROM}
        ${MP_REVIEW_JOIN_SQL}
        WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER} AND COALESCE(mp.show_in_you_may_also_like,0) = 1`;
      const params = [];
      if (Number.isFinite(excludeRaw) && excludeRaw > 0) {
        sql += ` AND mp.id <> ?`;
        params.push(excludeRaw);
      }
      sql += ` ORDER BY ${MP_ORDER_VENDOR_PREMIUM} ASC, ${MP_ORDER_PRODUCT_FEATURED} ASC, mp.sort_order ASC, mp.id DESC LIMIT ?`;
      params.push(limit);
      let rows = await all(sql, params);

      if (allowFallback && rows.length < limit) {
        const need = limit - rows.length;
        const seen = new Set();
        for (const r of rows) {
          const id = Number(r.id);
          if (Number.isFinite(id) && id > 0) seen.add(id);
        }
        if (Number.isFinite(excludeRaw) && excludeRaw > 0) seen.add(excludeRaw);
        const ids = [...seen].filter((id) => Number.isFinite(id) && id > 0);
        const notIn = ids.length ? ` AND mp.id NOT IN (${ids.map(() => "?").join(", ")})` : "";
        const sql2 = `SELECT ${MP_SELECT_LIST}, mprev.review_avg, mprev.review_count
          ${MP_FROM}
          ${MP_REVIEW_JOIN_SQL}
          WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER} AND COALESCE(mp.show_in_marketplace_tab,1) = 1${notIn}
          ORDER BY mp.sales_count DESC, mp.created_at DESC, mp.id DESC
          LIMIT ?`;
        const fill = await all(sql2, [...ids, need]);
        rows = rows.concat(fill);
      }

      return res.json(rows.map(mapProductRow));
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load suggestions" });
    }
  });

  app.get("/api/marketplace/products/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await get(
        `SELECT mp.*, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
                mvd.name_ar AS department_name_ar, mvd.name_en AS department_name_en,
                ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en
         FROM marketplace_products mp
         INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND ${MP_PUBLIC_VENDOR_ACTIVE}
         INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
         LEFT JOIN marketplace_vendor_departments mvd ON mvd.id = mp.department_id
         WHERE mp.id = ? AND mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER}`,
        [id]
      );
      if (!row) return res.status(404).json({ error: "Not found" });
      return res.json(mapProductRow(row));
    } catch (err) {
      return res.status(500).json({ error: "Failed to load product" });
    }
  });

  app.get("/api/marketplace/products/:id/reviews", async (req, res) => {
    try {
      const productId = Number(req.params.id);
      if (!Number.isFinite(productId)) return res.status(400).json({ error: "Invalid id" });
      const p = await get(
        `SELECT mp.id FROM marketplace_products mp
         INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND ${MP_PUBLIC_VENDOR_ACTIVE}
         WHERE mp.id=? AND mp.is_active=1 AND COALESCE(mp.vendor_listing_status, 'published') = 'published'`,
        [productId]
      );
      if (!p) return res.status(404).json({ error: "Not found" });
      const agg = await get(
        `SELECT AVG(stars) AS avg_stars, COUNT(*)::int AS cnt FROM marketplace_product_reviews WHERE marketplace_product_id=?`,
        [productId]
      );
      const avg = agg && agg.avg_stars != null ? Number(agg.avg_stars) : null;
      const count = agg && agg.cnt != null ? Number(agg.cnt) : 0;
      const distRows = await all(
        `SELECT stars, COUNT(*) AS c FROM marketplace_product_reviews WHERE marketplace_product_id=? GROUP BY stars`,
        [productId]
      );
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const row of distRows || []) {
        const s = Number(row.stars);
        if (s >= 1 && s <= 5) distribution[s] = Number(row.c) || 0;
      }
      const items = await all(
        `SELECT r.id, r.stars, r.comment, r.created_at, u.name AS user_name
         FROM marketplace_product_reviews r
         JOIN users u ON u.id = r.user_id
         WHERE r.marketplace_product_id = ?
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
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load reviews" });
    }
  });

  app.post("/api/marketplace/product-reviews", requireAuth, async (req, res) => {
    try {
      const marketplace_product_id = Number(req.body.marketplace_product_id);
      if (!Number.isFinite(marketplace_product_id)) {
        return res.status(400).json({ error: "marketplace_product_id is required" });
      }
      const raw = Number(req.body.stars);
      const stars = Number.isFinite(raw) ? Math.min(5, Math.max(1, Math.round(raw))) : NaN;
      if (!Number.isFinite(stars)) {
        return res.status(400).json({ error: "stars must be 1–5" });
      }
      let comment = req.body.comment != null ? String(req.body.comment).trim() : "";
      if (comment.length > 2000) comment = comment.slice(0, 2000);
      const p = await get(
        `SELECT mp.id FROM marketplace_products mp
         INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND ${MP_PUBLIC_VENDOR_ACTIVE}
         WHERE mp.id=? AND mp.is_active=1 AND COALESCE(mp.vendor_listing_status, 'published') = 'published'`,
        [marketplace_product_id]
      );
      if (!p) return res.status(404).json({ error: "Product not found" });
      await run(
        `INSERT INTO marketplace_product_reviews (user_id, marketplace_product_id, stars, comment) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, marketplace_product_id) DO UPDATE SET
           stars = EXCLUDED.stars,
           comment = EXCLUDED.comment,
           created_at = CURRENT_TIMESTAMP`,
        [req.user.id, marketplace_product_id, stars, comment || null]
      );
      return res.status(201).json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to save review" });
    }
  });

  app.get("/api/marketplace/home-highlights", async (_req, res) => {
    try {
      const settings = await getVendorPlatformSettings();
      const mode = settings?.featured_products_mode || "manual";
      const vendorIds = safeJsonParse(settings?.featured_vendor_ids_json, []);
      const boost = settings && Number(settings.bestsellers_boost_enabled) === 1;
      const adsOn = settings && Number(settings.ads_module_enabled) === 1;

      const baseSelect = `SELECT mp.id, mp.section_id, mp.vendor_id, mp.name_ar, mp.name_en, mp.description_ar, mp.description_en,
        mp.price, mp.discount_percent, mp.stock, mp.images_json, mp.is_offer, mp.sort_order, mp.sales_count, mp.created_at,
        mp.is_mp_featured, mp.mp_featured_until, mp.search_priority_boost,
        mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
        ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en,
        mprev.review_avg, mprev.review_count
        FROM marketplace_products mp
        INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND ${MP_PUBLIC_VENDOR_ACTIVE}
        INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
        ${MP_REVIEW_JOIN_SQL}
        WHERE mp.is_active = 1 ${MP_PUBLIC_LISTING_FILTER}`;

      let promotedHome = [];
      if (adsOn) {
        promotedHome = await fetchMarketplaceProductsByPromotionSlot("home_featured", 12);
        await bumpPromotionImpressionsForRows(promotedHome);
      }

      let featuredBase = [];
      if (mode === "manual") {
        featuredBase = await all(
          `${baseSelect} AND ${MP_SQL_PRODUCT_FEATURED_OK} ORDER BY ${MP_ORDER_VENDOR_PREMIUM} ASC, mp.sort_order ASC, mp.id DESC LIMIT 12`,
          []
        );
      } else if (mode === "auto_bestsellers") {
        featuredBase = await all(`${baseSelect} ORDER BY mp.sales_count DESC, mp.id DESC LIMIT 12`, []);
      } else if (mode === "by_vendor" && Array.isArray(vendorIds) && vendorIds.length) {
        const ph = vendorIds.map(() => "?").join(", ");
        featuredBase = await all(
          `${baseSelect} AND mp.vendor_id IN (${ph}) ORDER BY mp.sales_count DESC, mp.id DESC LIMIT 12`,
          vendorIds.map((x) => Number(x)).filter((n) => Number.isFinite(n))
        );
      }

      const seen = new Set();
      const featuredMerged = [];
      for (const r of promotedHome) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        featuredMerged.push(r);
        if (featuredMerged.length >= 12) break;
      }
      for (const r of featuredBase) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        featuredMerged.push(r);
        if (featuredMerged.length >= 12) break;
      }

      let bestsellers = [];
      if (boost) {
        bestsellers = await all(
          `${baseSelect} AND COALESCE(mp.show_in_bestsellers_strip, 0) = 1 ORDER BY mp.sales_count DESC, mp.created_at DESC LIMIT 12`,
          []
        );
      }

      const offers = await all(`${baseSelect} AND mp.is_offer = 1 ORDER BY mp.created_at DESC LIMIT 12`, []);

      return res.json({
        featured: featuredMerged.map(mapProductRow),
        bestsellers: bestsellers.map(mapProductRow),
        offers: offers.map(mapProductRow),
      });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load marketplace highlights" });
    }
  });

  app.get("/api/marketplace/app-home-placements", async (_req, res) => {
    try {
      const data = await buildAppHomePlacementsResponse();
      return res.json(data);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load home placements" });
    }
  });

  /* ---------- Admin: sections ---------- */
  app.get("/api/admin/marketplace/sections", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const rows = await all(
        `SELECT * FROM marketplace_sections ORDER BY sort_order ASC, id ASC`
      );
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ error: "Failed to load sections" });
    }
  });

  app.post("/api/admin/marketplace/sections", requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const slug = b.slug != null ? String(b.slug).trim().toLowerCase().replace(/\s+/g, "_") : "";
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : "";
      const name_en = b.name_en != null ? String(b.name_en).trim() : "";
      if (!slug || !name_ar || !name_en) return res.status(400).json({ error: "slug, name_ar, name_en required" });
      const subtitle_ar = b.subtitle_ar != null ? String(b.subtitle_ar).trim() : "";
      const subtitle_en = b.subtitle_en != null ? String(b.subtitle_en).trim() : "";
      const card_image_url = b.card_image_url != null ? String(b.card_image_url).trim() : null;
      const sort_order = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999;
      const is_active = Number(b.is_active) === 0 ? 0 : 1;
      const ins = await run(
        `INSERT INTO marketplace_sections (slug, name_ar, name_en, subtitle_ar, subtitle_en, card_image_url, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [slug, name_ar, name_en, subtitle_ar, subtitle_en, card_image_url || null, sort_order, is_active]
      );
      const row = await get(`SELECT * FROM marketplace_sections WHERE id=?`, [ins.id]);
      return res.status(201).json(row);
    } catch (err) {
      if (String(err.message || "").includes("unique")) {
        return res.status(409).json({ error: "Slug already exists" });
      }
      return res.status(500).json({ error: "Failed to create section" });
    }
  });

  app.put("/api/admin/marketplace/sections/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const cur = await get(`SELECT * FROM marketplace_sections WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      const slug = b.slug != null ? String(b.slug).trim().toLowerCase().replace(/\s+/g, "_") : cur.slug;
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : cur.name_ar;
      const name_en = b.name_en != null ? String(b.name_en).trim() : cur.name_en;
      const subtitle_ar = b.subtitle_ar != null ? String(b.subtitle_ar).trim() : cur.subtitle_ar;
      const subtitle_en = b.subtitle_en != null ? String(b.subtitle_en).trim() : cur.subtitle_en;
      const card_image_url =
        b.card_image_url !== undefined ? (b.card_image_url ? String(b.card_image_url).trim() : null) : cur.card_image_url;
      const sort_order = b.sort_order != null ? Number(b.sort_order) : cur.sort_order;
      const is_active = b.is_active != null ? (Number(b.is_active) === 0 ? 0 : 1) : cur.is_active;
      await run(
        `UPDATE marketplace_sections SET slug=?, name_ar=?, name_en=?, subtitle_ar=?, subtitle_en=?, card_image_url=?, sort_order=?, is_active=? WHERE id=?`,
        [slug, name_ar, name_en, subtitle_ar, subtitle_en, card_image_url, sort_order, is_active, id]
      );
      return res.json(await get(`SELECT * FROM marketplace_sections WHERE id=?`, [id]));
    } catch (err) {
      return res.status(500).json({ error: "Failed to update section" });
    }
  });

  app.delete("/api/admin/marketplace/sections/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await run(`DELETE FROM marketplace_sections WHERE id=?`, [id]);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to delete section" });
    }
  });

  app.post("/api/admin/marketplace/sections/reorder", requireAuth, requireAdmin, async (req, res) => {
    try {
      const ids = req.body?.orderedIds;
      if (!Array.isArray(ids)) return res.status(400).json({ error: "orderedIds array required" });
      let o = 0;
      for (const raw of ids) {
        const id = Number(raw);
        if (Number.isFinite(id)) await run(`UPDATE marketplace_sections SET sort_order=? WHERE id=?`, [o++, id]);
      }
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to reorder" });
    }
  });

  /* ---------- Admin: vendors ---------- */
  app.get("/api/admin/marketplace/vendors", requireAuth, requireAdmin, async (req, res) => {
    try {
      const sid = req.query.section_id != null ? Number(req.query.section_id) : null;
      let sql = `SELECT * FROM marketplace_vendors WHERE 1=1`;
      const params = [];
      if (sid != null && Number.isFinite(sid)) {
        sql += ` AND section_id = ?`;
        params.push(sid);
      }
      sql += ` ORDER BY section_id ASC, sort_order ASC, id ASC`;
      return res.json(await all(sql, params));
    } catch (err) {
      return res.status(500).json({ error: "Failed to load vendors" });
    }
  });

  app.post("/api/admin/marketplace/vendors", requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const section_id = Number(b.section_id);
      if (!Number.isFinite(section_id)) return res.status(400).json({ error: "section_id required" });
      const sec = await get(`SELECT id FROM marketplace_sections WHERE id=?`, [section_id]);
      if (!sec) return res.status(404).json({ error: "Section not found" });
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : "";
      const name_en = b.name_en != null ? String(b.name_en).trim() : "";
      if (!name_ar || !name_en) return res.status(400).json({ error: "name_ar, name_en required" });
      const vendor_type = b.vendor_type === "mall" ? "mall" : "company";
      const logo_url = b.logo_url != null ? String(b.logo_url).trim() : null;
      const cover_image_url = b.cover_image_url != null ? String(b.cover_image_url).trim() : null;
      const sort_order = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999;
      const is_active = Number(b.is_active) === 0 ? 0 : 1;
      const paid_product_slots = Math.max(0, Math.floor(Number(b.paid_product_slots) || 0));
      const is_premium = Number(b.is_premium) === 1 ? 1 : 0;
      const premium_until =
        b.premium_until != null && String(b.premium_until).trim() ? String(b.premium_until).trim() : null;
      const premium_subscription_type = ["none", "permanent", "monthly", "weekly"].includes(
        String(b.premium_subscription_type || "").trim()
      )
        ? String(b.premium_subscription_type).trim()
        : "none";
      const search_priority = Math.max(0, Math.min(1000, Math.floor(Number(b.search_priority) || 0)));
      const show_in_app_brands_section = Number(b.show_in_app_brands_section) === 0 ? 0 : 1;
      const show_in_app_top_brands_section = Number(b.show_in_app_top_brands_section) === 1 ? 1 : 0;
      const public_vendor_code = await allocateNextPublicVendorCode();
      const ins = await run(
        `INSERT INTO marketplace_vendors (section_id, name_ar, name_en, vendor_type, logo_url, cover_image_url, sort_order, is_active,
          paid_product_slots, is_premium, premium_until, premium_subscription_type, search_priority,
          show_in_app_brands_section, show_in_app_top_brands_section, public_vendor_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?, ?, ?, ?, ?)`,
        [
          section_id,
          name_ar,
          name_en,
          vendor_type,
          logo_url || null,
          cover_image_url || null,
          sort_order,
          is_active,
          paid_product_slots,
          is_premium,
          premium_until,
          premium_subscription_type,
          search_priority,
          show_in_app_brands_section,
          show_in_app_top_brands_section,
          public_vendor_code,
        ]
      );
      return res.status(201).json(await get(`SELECT * FROM marketplace_vendors WHERE id=?`, [ins.id]));
    } catch (err) {
      return res.status(500).json({ error: "Failed to create vendor" });
    }
  });

  app.put("/api/admin/marketplace/vendors/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await get(`SELECT * FROM marketplace_vendors WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      const section_id = b.section_id != null ? Number(b.section_id) : cur.section_id;
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : cur.name_ar;
      const name_en = b.name_en != null ? String(b.name_en).trim() : cur.name_en;
      const vendor_type = b.vendor_type === "mall" || b.vendor_type === "company" ? b.vendor_type : cur.vendor_type;
      const logo_url = b.logo_url !== undefined ? (b.logo_url ? String(b.logo_url).trim() : null) : cur.logo_url;
      const cover_image_url =
        b.cover_image_url !== undefined ? (b.cover_image_url ? String(b.cover_image_url).trim() : null) : cur.cover_image_url;
      const sort_order = b.sort_order != null ? Number(b.sort_order) : cur.sort_order;
      const is_active = b.is_active != null ? (Number(b.is_active) === 0 ? 0 : 1) : cur.is_active;
      const paid_product_slots =
        b.paid_product_slots != null
          ? Math.max(0, Math.floor(Number(b.paid_product_slots) || 0))
          : cur.paid_product_slots ?? 0;
      const is_premium = b.is_premium != null ? (Number(b.is_premium) === 1 ? 1 : 0) : cur.is_premium ?? 0;
      const premium_until =
        b.premium_until !== undefined
          ? b.premium_until && String(b.premium_until).trim()
            ? String(b.premium_until).trim()
            : null
          : cur.premium_until;
      let premium_subscription_type = cur.premium_subscription_type || "none";
      if (b.premium_subscription_type != null) {
        const t = String(b.premium_subscription_type).trim();
        if (["none", "permanent", "monthly", "weekly"].includes(t)) premium_subscription_type = t;
      }
      const search_priority =
        b.search_priority != null
          ? Math.max(0, Math.min(1000, Math.floor(Number(b.search_priority) || 0)))
          : cur.search_priority ?? 0;
      const show_in_app_brands_section =
        b.show_in_app_brands_section != null
          ? Number(b.show_in_app_brands_section) === 0
            ? 0
            : 1
          : Number(cur.show_in_app_brands_section) === 0
            ? 0
            : 1;
      const show_in_app_top_brands_section =
        b.show_in_app_top_brands_section != null
          ? Number(b.show_in_app_top_brands_section) === 1
            ? 1
            : 0
          : Number(cur.show_in_app_top_brands_section) === 1
            ? 1
            : 0;
      await run(
        `UPDATE marketplace_vendors SET section_id=?, name_ar=?, name_en=?, vendor_type=?, logo_url=?, cover_image_url=?, sort_order=?, is_active=?,
         paid_product_slots=?, is_premium=?, premium_until=?::timestamptz, premium_subscription_type=?, search_priority=?,
         show_in_app_brands_section=?, show_in_app_top_brands_section=?
         WHERE id=?`,
        [
          section_id,
          name_ar,
          name_en,
          vendor_type,
          logo_url,
          cover_image_url,
          sort_order,
          is_active,
          paid_product_slots,
          is_premium,
          premium_until,
          premium_subscription_type,
          search_priority,
          show_in_app_brands_section,
          show_in_app_top_brands_section,
          id,
        ]
      );
      const wasPremiumEff = vendorPremiumEffectiveAt(cur.is_premium, cur.premium_until);
      const nowPremiumEff = vendorPremiumEffectiveAt(is_premium, premium_until);
      if (nowPremiumEff && !wasPremiumEff) {
        await notifyVendorPortal(
          id,
          "نجمة مميزة — أدورا غروب",
          `تم إضافة علامة النجمة الذهبية النابضة لشركتكم (رقم ${id}) داخل تطبيق أدورا غروب — تظهر بجانب شعاركم للزبائن.\n\nA pulsing gold star badge was added for your company (#${id}) in the Adora Group app.`
        );
      }
      return res.json(await get(`SELECT * FROM marketplace_vendors WHERE id=?`, [id]));
    } catch (err) {
      return res.status(500).json({ error: "Failed to update vendor" });
    }
  });

  app.delete("/api/admin/marketplace/vendors/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await deleteMarketplaceVendorCompletely(Number(req.params.id));
      if (!result.ok) {
        return res.status(404).json({ error: result.error || "Not found" });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to delete vendor" });
    }
  });

  app.post("/api/admin/marketplace/vendors/reorder", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { section_id, orderedIds } = req.body || {};
      const sid = Number(section_id);
      if (!Number.isFinite(sid) || !Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "section_id and orderedIds required" });
      }
      let o = 0;
      for (const raw of orderedIds) {
        const id = Number(raw);
        if (Number.isFinite(id)) {
          await run(`UPDATE marketplace_vendors SET sort_order=? WHERE id=? AND section_id=?`, [o++, id, sid]);
        }
      }
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to reorder vendors" });
    }
  });

  /* ---------- Admin: departments داخل كل شركة ---------- */
  app.get("/api/admin/marketplace/vendors/:id/departments", requireAuth, requireAdmin, async (req, res) => {
    try {
      const vid = Number(req.params.id);
      if (!Number.isFinite(vid)) return res.status(400).json({ error: "Invalid vendor id" });
      const v = await get(`SELECT id FROM marketplace_vendors WHERE id=?`, [vid]);
      if (!v) return res.status(404).json({ error: "Vendor not found" });
      const rows = await all(
        `SELECT id, vendor_id, name_ar, name_en, sort_order, is_active, created_at
         FROM marketplace_vendor_departments WHERE vendor_id=? ORDER BY sort_order ASC, id ASC`,
        [vid]
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load departments" });
    }
  });

  app.post("/api/admin/marketplace/vendors/:id/departments", requireAuth, requireAdmin, async (req, res) => {
    try {
      const vid = Number(req.params.id);
      if (!Number.isFinite(vid)) return res.status(400).json({ error: "Invalid vendor id" });
      const v = await get(`SELECT id FROM marketplace_vendors WHERE id=?`, [vid]);
      if (!v) return res.status(404).json({ error: "Vendor not found" });
      const b = req.body || {};
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : "";
      const name_en = b.name_en != null ? String(b.name_en).trim() : "";
      if (!name_ar || !name_en) return res.status(400).json({ error: "name_ar and name_en required" });
      const sort_order = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999;
      const ins = await run(
        `INSERT INTO marketplace_vendor_departments (vendor_id, name_ar, name_en, sort_order, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [vid, name_ar, name_en, sort_order]
      );
      const row = await get(`SELECT * FROM marketplace_vendor_departments WHERE id=?`, [ins.id]);
      return res.status(201).json(row);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to create department" });
    }
  });

  app.put("/api/admin/marketplace/departments/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await get(`SELECT * FROM marketplace_vendor_departments WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : cur.name_ar;
      const name_en = b.name_en != null ? String(b.name_en).trim() : cur.name_en;
      if (!name_ar || !name_en) return res.status(400).json({ error: "name_ar and name_en required" });
      const sort_order = b.sort_order != null ? Number(b.sort_order) : cur.sort_order;
      const is_active = b.is_active != null ? (Number(b.is_active) === 0 ? 0 : 1) : cur.is_active;
      await run(`UPDATE marketplace_vendor_departments SET name_ar=?, name_en=?, sort_order=?, is_active=? WHERE id=?`, [
        name_ar,
        name_en,
        sort_order,
        is_active,
        id,
      ]);
      return res.json(await get(`SELECT * FROM marketplace_vendor_departments WHERE id=?`, [id]));
    } catch (_e) {
      return res.status(500).json({ error: "Failed to update department" });
    }
  });

  app.delete("/api/admin/marketplace/departments/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await run(`DELETE FROM marketplace_vendor_departments WHERE id=?`, [Number(req.params.id)]);
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to delete department" });
    }
  });

  app.post("/api/admin/marketplace/vendors/:id/departments/reorder", requireAuth, requireAdmin, async (req, res) => {
    try {
      const vid = Number(req.params.id);
      if (!Number.isFinite(vid)) return res.status(400).json({ error: "Invalid vendor id" });
      const { orderedIds } = req.body || {};
      if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds required" });
      let o = 0;
      for (const raw of orderedIds) {
        const did = Number(raw);
        if (Number.isFinite(did)) {
          await run(`UPDATE marketplace_vendor_departments SET sort_order=? WHERE id=? AND vendor_id=?`, [o++, did, vid]);
        }
      }
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to reorder departments" });
    }
  });

  /* ---------- Admin: products ---------- */
  app.get("/api/admin/marketplace/products", requireAuth, requireAdmin, async (req, res) => {
    try {
      const sid = req.query.section_id != null ? Number(req.query.section_id) : null;
      const vid = req.query.vendor_id != null ? Number(req.query.vendor_id) : null;
      const codeRaw = req.query.code != null ? String(req.query.code).trim() : "";
      let sql = `SELECT mp.*, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
                        mvd.name_ar AS department_name_ar, mvd.name_en AS department_name_en, ms.slug AS section_slug
                 FROM marketplace_products mp
                 INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id
                 INNER JOIN marketplace_sections ms ON ms.id = mp.section_id
                 LEFT JOIN marketplace_vendor_departments mvd ON mvd.id = mp.department_id
                 WHERE 1=1`;
      const params = [];
      if (sid != null && Number.isFinite(sid)) {
        sql += ` AND mp.section_id = ?`;
        params.push(sid);
      }
      if (vid != null && Number.isFinite(vid)) {
        sql += ` AND mp.vendor_id = ?`;
        params.push(vid);
      }
      if (codeRaw) {
        const trimmed = codeRaw.trim();
        const byId = Number(trimmed);
        if (String(byId) === trimmed && Number.isFinite(byId) && byId > 0) {
          sql += ` AND mp.id = ?`;
          params.push(byId);
        } else {
          sql += ` AND mp.public_product_code ILIKE ?`;
          params.push(`%${trimmed}%`);
        }
      }
      const vendorCodeRaw =
        req.query.vendor_code != null ? String(req.query.vendor_code).trim() : "";
      if (vendorCodeRaw) {
        const vNum = Number(vendorCodeRaw);
        if (String(Math.trunc(vNum)) === vendorCodeRaw.trim() && Number.isFinite(vNum) && vNum > 0) {
          sql += ` AND mp.vendor_id = ?`;
          params.push(vNum);
        } else {
          sql += ` AND LOWER(TRIM(COALESCE(mv.public_vendor_code,''))) = LOWER(TRIM(?))`;
          params.push(vendorCodeRaw);
        }
      }
      sql += ` ORDER BY mp.section_id, mp.vendor_id, mp.sort_order ASC, mp.id DESC LIMIT 500`;
      const rows = await all(sql, params);
      return res.json(rows.map(mapProductRow));
    } catch (err) {
      return res.status(500).json({ error: "Failed to load products" });
    }
  });

  app.get("/api/admin/marketplace/products/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const mapped = await getMarketplaceProductMappedAdminById(id);
      if (!mapped) return res.status(404).json({ error: "Not found" });
      return res.json(mapped);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load product" });
    }
  });

  app.put("/api/admin/marketplace/products/:id/is-active", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const cur = await get(`SELECT id, vendor_id, is_active FROM marketplace_products WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const ia = Number(req.body?.is_active) === 0 ? 0 : 1;
      const settings = await getVendorPlatformSettings();
      if (Number(cur.is_active) === 0 && ia === 1) {
        const quota = await assertMarketplaceProductQuota(cur.vendor_id, settings, true);
        if (!quota.ok) return res.status(400).json({ error: quota.error });
      }
      await run(`UPDATE marketplace_products SET is_active=? WHERE id=?`, [ia, id]);
      return res.json(await getMarketplaceProductMappedAdminById(id));
    } catch (_e) {
      return res.status(500).json({ error: "Failed to update product activation" });
    }
  });

  app.put("/api/admin/marketplace/products/:id/quick-flags", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const cur = await get(`SELECT * FROM marketplace_products WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      if (!Object.prototype.hasOwnProperty.call(b, "is_mp_featured") && !Object.prototype.hasOwnProperty.call(b, "search_priority_boost")) {
        return res.status(400).json({ error: "is_mp_featured and/or search_priority_boost required" });
      }
      let is_mp_featured = Number(cur.is_mp_featured) === 1 ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(b, "is_mp_featured")) {
        is_mp_featured = Number(b.is_mp_featured) === 1 ? 1 : 0;
      }
      let mp_featured_until = cur.mp_featured_until;
      if (Object.prototype.hasOwnProperty.call(b, "is_mp_featured") && !is_mp_featured) {
        mp_featured_until = null;
      }
      let search_priority_boost = Number(cur.search_priority_boost) === 1 ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(b, "search_priority_boost")) {
        search_priority_boost = Number(b.search_priority_boost) === 1 ? 1 : 0;
      }
      await run(
        `UPDATE marketplace_products SET is_mp_featured=?, mp_featured_until=?, search_priority_boost=? WHERE id=?`,
        [is_mp_featured, mp_featured_until, search_priority_boost, id]
      );
      const wasFeat = mpProductFeaturedEffectiveAt(cur.is_mp_featured, cur.mp_featured_until);
      const nowFeat = mpProductFeaturedEffectiveAt(is_mp_featured, mp_featured_until);
      if (nowFeat && !wasFeat) {
        const code = cur.public_product_code != null ? String(cur.public_product_code).trim() : "";
        const codeBit = code ? ` (${code})` : "";
        await notifyVendorPortal(
          Number(cur.vendor_id),
          "تمييز منتج — أدورا غروب",
          `لقد تم إضافة علامة التمييز 🔥 إلى منتجك رقم ${id}${codeBit} داخل تطبيق أدورا غروب.\n\nThe featured 🔥 badge was added to your product #${id}${codeBit} in the Adora Group app.`
        );
      }
      return res.json(await getMarketplaceProductMappedAdminById(id));
    } catch (_e) {
      return res.status(500).json({ error: "Failed to update product flags" });
    }
  });

  app.post("/api/admin/marketplace/products", requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const section_id = Number(b.section_id);
      const vendor_id = Number(b.vendor_id);
      if (!Number.isFinite(section_id) || !Number.isFinite(vendor_id)) {
        return res.status(400).json({ error: "section_id and vendor_id required" });
      }
      const v = await get(`SELECT section_id FROM marketplace_vendors WHERE id=?`, [vendor_id]);
      if (!v || Number(v.section_id) !== section_id) {
        return res.status(400).json({ error: "Vendor does not belong to section" });
      }
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : "";
      const name_en = b.name_en != null ? String(b.name_en).trim() : "";
      if (!name_ar || !name_en) return res.status(400).json({ error: "name_ar, name_en required" });
      const sku = b.sku != null ? String(b.sku).trim().slice(0, 120) : "";
      const barcodeNorm = b.barcode != null ? String(b.barcode).trim().slice(0, 120) : "";
      const description_ar = b.description_ar != null ? String(b.description_ar).trim() : "";
      const description_en = b.description_en != null ? String(b.description_en).trim() : "";
      const price = Number(b.price);
      const { optArr, invArr, stockNum } = normalizeMpVariantsForSave({
        product_options: b.product_options,
        inventory: b.inventory,
        stock: b.stock,
      });
      const stock = stockNum;
      let images = b.images;
      if (!Array.isArray(images)) images = [];
      images = images.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 12);
      const is_offer = Number(b.is_offer) === 1 ? 1 : 0;
      const sort_order = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999;
      const is_active = Number(b.is_active) === 0 ? 0 : 1;
      const is_mp_featured = Number(b.is_mp_featured) === 1 ? 1 : 0;
      let mp_featured_until = normalizeMpFeaturedUntil(b.mp_featured_until);
      if (mp_featured_until === undefined) mp_featured_until = null;
      if (!is_mp_featured) mp_featured_until = null;
      const featured_hub_enabled = Number(b.featured_hub_enabled) === 1 ? 1 : 0;
      let featured_hub_section = normalizeMpFeaturedHubSection(b.featured_hub_section);
      if (featured_hub_enabled && !featured_hub_section) {
        return res.status(400).json({ error: "featured_hub_section required when featured hub is enabled" });
      }
      if (!featured_hub_enabled) featured_hub_section = null;
      const show_in_offers_tab = Number(b.show_in_offers_tab) === 1 ? 1 : 0;
      const show_in_marketplace_tab = Number(b.show_in_marketplace_tab) === 0 ? 0 : 1;
      const show_in_flash_sale_strip = Number(b.show_in_flash_sale_strip) === 1 ? 1 : 0;
      const show_in_curated_strip = Number(b.show_in_curated_strip) === 1 ? 1 : 0;
      const show_in_promo_collection_strip = Number(b.show_in_promo_collection_strip) === 1 ? 1 : 0;
      const show_in_bestsellers_strip = Number(b.show_in_bestsellers_strip) === 1 ? 1 : 0;
      const show_in_you_may_also_like = Number(b.show_in_you_may_also_like) === 1 ? 1 : 0;
      const search_priority_boost = Number(b.search_priority_boost) === 1 ? 1 : 0;
      const settings = await getVendorPlatformSettings();
      const dup = await findMarketplaceProductDuplicate(
        vendor_id,
        { name_ar, name_en, sku: sku || null, barcode: barcodeNorm ? barcodeNorm : null },
        null
      );
      if (dup) {
        return res.status(409).json({
          error: "منتج مكرر لنفس الشركة (نفس الاسم أو SKU أو الباركود).",
        });
      }
      const quota = await assertMarketplaceProductQuota(vendor_id, settings, is_active === 1);
      if (!quota.ok) return res.status(400).json({ error: quota.error });
      const discount_percent = clampDiscountPercent(b.discount_percent);
      const depRes = await resolveDepartmentIdForProduct(vendor_id, b.department_id);
      if (!depRes.ok) return res.status(400).json({ error: depRes.error });
      const department_id = depRes.department_id;
      const public_product_code = await allocateNextPublicProductCode();
      const vendor_listing_status = normalizeVendorListingStatus(b.vendor_listing_status, { vendor_listing_status: "published" });
      const ins = await run(
        `INSERT INTO marketplace_products (section_id, vendor_id, department_id, name_ar, name_en, description_ar, description_en, price, discount_percent, stock, images_json, inventory_json, product_options_json, is_offer, sort_order, is_active, sku, barcode, public_product_code, is_mp_featured, mp_featured_until, featured_hub_enabled, featured_hub_section, show_in_offers_tab, show_in_marketplace_tab, vendor_listing_status, show_in_flash_sale_strip, show_in_curated_strip, show_in_promo_collection_strip, show_in_bestsellers_strip, show_in_you_may_also_like, search_priority_boost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          section_id,
          vendor_id,
          department_id,
          name_ar,
          name_en,
          description_ar,
          description_en,
          Number.isFinite(price) ? price : 0,
          discount_percent,
          stock,
          JSON.stringify(images),
          JSON.stringify(invArr),
          JSON.stringify(optArr),
          is_offer,
          sort_order,
          is_active,
          sku || null,
          barcodeNorm || null,
          public_product_code,
          is_mp_featured,
          mp_featured_until,
          featured_hub_enabled,
          featured_hub_section,
          show_in_offers_tab,
          show_in_marketplace_tab,
          vendor_listing_status,
          show_in_flash_sale_strip,
          show_in_curated_strip,
          show_in_promo_collection_strip,
          show_in_bestsellers_strip,
          show_in_you_may_also_like,
          search_priority_boost,
        ]
      );
      if (mpProductFeaturedEffectiveAt(is_mp_featured, mp_featured_until)) {
        const code = public_product_code ? String(public_product_code).trim() : "";
        const codeBit = code ? ` (${code})` : "";
        await notifyVendorPortal(
          vendor_id,
          "تمييز منتج — أدورا غروب",
          `لقد تم إضافة علامة التمييز 🔥 إلى منتجك رقم ${ins.id}${codeBit} داخل تطبيق أدورا غروب.\n\nThe featured 🔥 badge was added to your product #${ins.id}${codeBit} in the Adora Group app.`
        );
      }
      const mapped = await getMarketplaceProductMappedAdminById(ins.id);
      return res.status(201).json(mapped);
    } catch (err) {
      return res.status(500).json({ error: "Failed to create product" });
    }
  });

  app.put("/api/admin/marketplace/products/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await get(`SELECT * FROM marketplace_products WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      let section_id = b.section_id != null ? Number(b.section_id) : cur.section_id;
      let vendor_id = b.vendor_id != null ? Number(b.vendor_id) : cur.vendor_id;
      const v = await get(`SELECT section_id FROM marketplace_vendors WHERE id=?`, [vendor_id]);
      if (!v || Number(v.section_id) !== section_id) {
        return res.status(400).json({ error: "Vendor does not belong to section" });
      }
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : cur.name_ar;
      const name_en = b.name_en != null ? String(b.name_en).trim() : cur.name_en;
      const sku = b.sku !== undefined ? String(b.sku ?? "").trim().slice(0, 120) : cur.sku || "";
      const barcode =
        b.barcode !== undefined ? String(b.barcode ?? "").trim().slice(0, 120) : cur.barcode || "";
      const description_ar = b.description_ar != null ? String(b.description_ar).trim() : cur.description_ar;
      const description_en = b.description_en != null ? String(b.description_en).trim() : cur.description_en;
      const price = b.price != null ? Number(b.price) : cur.price;
      const hasVariantBody = b.product_options != null || b.inventory != null;
      let stock;
      let invJson;
      let optJson;
      if (hasVariantBody) {
        const { optArr, invArr, stockNum } = normalizeMpVariantsForSave({
          product_options: b.product_options,
          inventory: b.inventory,
          stock: b.stock != null ? b.stock : cur.stock,
        });
        stock = stockNum;
        invJson = JSON.stringify(invArr);
        optJson = JSON.stringify(optArr);
      } else {
        stock = b.stock != null ? Math.max(0, Math.floor(Number(b.stock) || 0)) : cur.stock;
        invJson = cur.inventory_json != null ? cur.inventory_json : "[]";
        optJson = cur.product_options_json != null ? cur.product_options_json : "[]";
      }
      let images_json = cur.images_json;
      if (b.images != null) {
        let images = Array.isArray(b.images) ? b.images : [];
        images = images.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12);
        images_json = JSON.stringify(images);
      }
      const is_offer = b.is_offer != null ? (Number(b.is_offer) === 1 ? 1 : 0) : cur.is_offer;
      const sort_order = b.sort_order != null ? Number(b.sort_order) : cur.sort_order;
      const is_active = b.is_active != null ? (Number(b.is_active) === 0 ? 0 : 1) : cur.is_active;
      const is_mp_featured = b.is_mp_featured != null ? (Number(b.is_mp_featured) === 1 ? 1 : 0) : cur.is_mp_featured ?? 0;
      let mp_featured_until = cur.mp_featured_until;
      if (b.mp_featured_until !== undefined) {
        const n = normalizeMpFeaturedUntil(b.mp_featured_until);
        mp_featured_until = n;
      }
      if (!is_mp_featured) mp_featured_until = null;
      let featured_hub_enabled =
        b.featured_hub_enabled != null ? (Number(b.featured_hub_enabled) === 1 ? 1 : 0) : Number(cur.featured_hub_enabled) === 1 ? 1 : 0;
      let featured_hub_section =
        b.featured_hub_section !== undefined
          ? normalizeMpFeaturedHubSection(b.featured_hub_section)
          : normalizeMpFeaturedHubSection(cur.featured_hub_section);
      if (featured_hub_enabled && !featured_hub_section) {
        return res.status(400).json({ error: "featured_hub_section required when featured hub is enabled" });
      }
      if (!featured_hub_enabled) featured_hub_section = null;
      const show_in_offers_tab =
        b.show_in_offers_tab != null ? (Number(b.show_in_offers_tab) === 1 ? 1 : 0) : Number(cur.show_in_offers_tab) === 1 ? 1 : 0;
      const show_in_marketplace_tab =
        b.show_in_marketplace_tab != null
          ? Number(b.show_in_marketplace_tab) === 0
            ? 0
            : 1
          : cur.show_in_marketplace_tab != null && Number(cur.show_in_marketplace_tab) === 0
            ? 0
            : 1;
      const pickMpStrip = (k) =>
        b[k] != null ? (Number(b[k]) === 1 ? 1 : 0) : Number(cur[k]) === 1 ? 1 : 0;
      const show_in_flash_sale_strip = pickMpStrip("show_in_flash_sale_strip");
      const show_in_curated_strip = pickMpStrip("show_in_curated_strip");
      const show_in_promo_collection_strip = pickMpStrip("show_in_promo_collection_strip");
      const show_in_bestsellers_strip = pickMpStrip("show_in_bestsellers_strip");
      const show_in_you_may_also_like = pickMpStrip("show_in_you_may_also_like");
      const search_priority_boost =
        b.search_priority_boost != null
          ? Number(b.search_priority_boost) === 1
            ? 1
            : 0
          : Number(cur.search_priority_boost) === 1
            ? 1
            : 0;
      const vendor_listing_status = normalizeVendorListingStatus(b.vendor_listing_status, cur);
      const discount_percent =
        b.discount_percent !== undefined
          ? clampDiscountPercent(b.discount_percent)
          : clampDiscountPercent(cur.discount_percent);
      const depRaw = b.department_id !== undefined ? b.department_id : cur.department_id;
      const depRes = await resolveDepartmentIdForProduct(vendor_id, depRaw);
      if (!depRes.ok) return res.status(400).json({ error: depRes.error });
      const department_id = depRes.department_id;
      const settings = await getVendorPlatformSettings();
      const dup = await findMarketplaceProductDuplicate(
        vendor_id,
        {
          name_ar,
          name_en,
          sku: sku || null,
          barcode: barcode || null,
        },
        id
      );
      if (dup) {
        return res.status(409).json({
          error: "منتج مكرر لنفس الشركة (نفس الاسم أو SKU أو الباركود).",
        });
      }
      const wasInactive = Number(cur.is_active) === 0;
      if (wasInactive && is_active === 1) {
        const quota = await assertMarketplaceProductQuota(vendor_id, settings, true);
        if (!quota.ok) return res.status(400).json({ error: quota.error });
      }
      await run(
        `UPDATE marketplace_products SET section_id=?, vendor_id=?, department_id=?, name_ar=?, name_en=?, description_ar=?, description_en=?,
         price=?, discount_percent=?, stock=?, images_json=?, inventory_json=?, product_options_json=?, is_offer=?, sort_order=?, is_active=?, sku=?, barcode=?, is_mp_featured=?, mp_featured_until=?,
         featured_hub_enabled=?, featured_hub_section=?, show_in_offers_tab=?, show_in_marketplace_tab=?, vendor_listing_status=?,
         show_in_flash_sale_strip=?, show_in_curated_strip=?, show_in_promo_collection_strip=?, show_in_bestsellers_strip=?, show_in_you_may_also_like=?, search_priority_boost=? WHERE id=?`,
        [
          section_id,
          vendor_id,
          department_id,
          name_ar,
          name_en,
          description_ar,
          description_en,
          price,
          discount_percent,
          stock,
          images_json,
          invJson,
          optJson,
          is_offer,
          sort_order,
          is_active,
          sku || null,
          barcode || null,
          is_mp_featured,
          mp_featured_until,
          featured_hub_enabled,
          featured_hub_section,
          show_in_offers_tab,
          show_in_marketplace_tab,
          vendor_listing_status,
          show_in_flash_sale_strip,
          show_in_curated_strip,
          show_in_promo_collection_strip,
          show_in_bestsellers_strip,
          show_in_you_may_also_like,
          search_priority_boost,
          id,
        ]
      );
      const wasFeat = mpProductFeaturedEffectiveAt(cur.is_mp_featured, cur.mp_featured_until);
      const nowFeat = mpProductFeaturedEffectiveAt(is_mp_featured, mp_featured_until);
      if (nowFeat && !wasFeat) {
        const code =
          cur.public_product_code != null ? String(cur.public_product_code).trim() : "";
        const codeBit = code ? ` (${code})` : "";
        await notifyVendorPortal(
          vendor_id,
          "تمييز منتج — أدورا غروب",
          `لقد تم إضافة علامة التمييز 🔥 إلى منتجك رقم ${id}${codeBit} داخل تطبيق أدورا غروب.\n\nThe featured 🔥 badge was added to your product #${id}${codeBit} in the Adora Group app.`
        );
      }
      return res.json(await getMarketplaceProductMappedAdminById(id));
    } catch (err) {
      return res.status(500).json({ error: "Failed to update product" });
    }
  });

  app.delete("/api/admin/marketplace/products/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await run(`DELETE FROM marketplace_products WHERE id=?`, [Number(req.params.id)]);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to delete product" });
    }
  });

  app.post("/api/admin/marketplace/products/reorder", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { vendor_id, orderedIds } = req.body || {};
      const vid = Number(vendor_id);
      if (!Number.isFinite(vid) || !Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "vendor_id and orderedIds required" });
      }
      let o = 0;
      for (const raw of orderedIds) {
        const id = Number(raw);
        if (Number.isFinite(id)) {
          await run(`UPDATE marketplace_products SET sort_order=? WHERE id=? AND vendor_id=?`, [o++, id, vid]);
        }
      }
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: "Failed to reorder products" });
    }
  });

  app.get("/api/admin/marketplace/home-placements", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const rows = await all(
        `SELECT id, slot, target_type, target_id, sort_order, created_at FROM marketplace_home_placements ORDER BY slot ASC, sort_order ASC, id ASC`
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to list placements" });
    }
  });

  app.put("/api/admin/marketplace/home-placements/:slot", requireAuth, requireAdmin, async (req, res) => {
    try {
      const slot = normalizeMpHomeSlot(req.params.slot);
      if (!slot) return res.status(400).json({ error: "Invalid slot" });
      const items = req.body && Array.isArray(req.body.items) ? req.body.items : null;
      if (!items) return res.status(400).json({ error: "items array required" });
      await run(`DELETE FROM marketplace_home_placements WHERE slot=?`, [slot]);
      let o = 0;
      for (const raw of items) {
        const target_type = String(raw.target_type || "").trim().toLowerCase();
        const target_id = Number(raw.target_id);
        if (!["product", "vendor", "department"].includes(target_type) || !Number.isFinite(target_id)) continue;
        const sort_order = Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : o;
        await run(
          `INSERT INTO marketplace_home_placements (slot, target_type, target_id, sort_order) VALUES (?, ?, ?, ?)`,
          [slot, target_type, target_id, sort_order]
        );
        o += 1;
      }
      return res.json({ ok: true, slot });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to save placements" });
    }
  });

  app.delete("/api/admin/marketplace/home-placements/item/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      await run(`DELETE FROM marketplace_home_placements WHERE id=?`, [id]);
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to delete" });
    }
  });

  app.post("/api/admin/marketplace/home-placements/bulk-vendor", requireAuth, requireAdmin, async (req, res) => {
    try {
      const slot = normalizeMpHomeSlot(req.body && req.body.slot);
      const vendor_id = Number(req.body && req.body.vendor_id);
      if (!slot || !Number.isFinite(vendor_id)) return res.status(400).json({ error: "slot and vendor_id required" });
      const v = await get(`SELECT id FROM marketplace_vendors WHERE id=?`, [vendor_id]);
      if (!v) return res.status(404).json({ error: "Vendor not found" });
      const maxRow = await get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM marketplace_home_placements WHERE slot=?`, [slot]);
      let o = Number(maxRow && maxRow.m != null ? maxRow.m : -1) + 1;
      if (slot === "brands_strip" || slot === "top_brands_strip") {
        await run(
          `INSERT INTO marketplace_home_placements (slot, target_type, target_id, sort_order) VALUES (?, 'vendor', ?, ?)
           ON CONFLICT (slot, target_type, target_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
          [slot, vendor_id, o]
        );
        return res.json({ ok: true, mode: "vendor" });
      }
      const products = await all(
        `SELECT id FROM marketplace_products WHERE vendor_id=? AND COALESCE(is_active,1)=1 ORDER BY sort_order ASC, id ASC`,
        [vendor_id]
      );
      for (const p of products) {
        await run(
          `INSERT INTO marketplace_home_placements (slot, target_type, target_id, sort_order) VALUES (?, 'product', ?, ?)
           ON CONFLICT (slot, target_type, target_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
          [slot, p.id, o]
        );
        o += 1;
      }
      return res.json({ ok: true, mode: "products", count: products.length });
    } catch (_e) {
      return res.status(500).json({ error: "Bulk vendor failed" });
    }
  });

  app.post("/api/admin/marketplace/home-placements/bulk-department", requireAuth, requireAdmin, async (req, res) => {
    try {
      const slot = normalizeMpHomeSlot(req.body && req.body.slot);
      const department_id = Number(req.body && req.body.department_id);
      if (!slot || !Number.isFinite(department_id)) return res.status(400).json({ error: "slot and department_id required" });
      if (slot === "brands_strip" || slot === "top_brands_strip") {
        return res.status(400).json({ error: "Brand strips accept companies only (vendor), not departments" });
      }
      const d = await get(`SELECT id FROM marketplace_vendor_departments WHERE id=? AND COALESCE(is_active,1)=1`, [
        department_id,
      ]);
      if (!d) return res.status(404).json({ error: "Department not found" });
      const maxRow = await get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM marketplace_home_placements WHERE slot=?`, [slot]);
      let o = Number(maxRow && maxRow.m != null ? maxRow.m : -1) + 1;
      const products = await all(
        `SELECT id FROM marketplace_products WHERE department_id=? AND COALESCE(is_active,1)=1 ORDER BY sort_order ASC, id ASC`,
        [department_id]
      );
      for (const p of products) {
        await run(
          `INSERT INTO marketplace_home_placements (slot, target_type, target_id, sort_order) VALUES (?, 'product', ?, ?)
           ON CONFLICT (slot, target_type, target_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
          [slot, p.id, o]
        );
        o += 1;
      }
      return res.json({ ok: true, count: products.length });
    } catch (_e) {
      return res.status(500).json({ error: "Bulk department failed" });
    }
  });
}

module.exports = {
  registerMarketplaceRoutes,
  fetchMarketplaceProductsForListingSearchMerge,
  mapProductRow,
  assertMarketplaceProductQuota,
  resolveDepartmentIdForProduct,
  clampDiscountPercent,
  normalizeMpVariantsForSave,
  getMarketplaceProductMappedAdminById,
  findMarketplaceProductDuplicate,
  normalizeMpFeaturedHubSection,
};

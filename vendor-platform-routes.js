/**
 * لوحة تحكم منصة البائعين: إعدادات، طلبات الانضمام، إعلانات المنتجات، تقارير العمولة
 */
const multer = require("multer");
const { get, all, run } = require("./db");
const { getVendorPlatformSettings } = require("./vendor-platform-settings");
const { mergePlansFromSettingsJson, getPlanByKey, planSnapshotForStorage } = require("./lib/vendorJoinPlans");
const { sanitizeHttpsUrl } = require("./push-notify");

const vendorJoinUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|pjpeg|png|webp)$/i.test(file.mimetype || "");
    cb(null, ok);
  },
});
const vendorJoinUploadFields = vendorJoinUpload.fields([
  { name: "id_front", maxCount: 1 },
  { name: "id_back", maxCount: 1 },
  { name: "commercial_register", maxCount: 1 },
]);

function vendorJoinMultipartMiddleware(req, res, next) {
  if (req.is("multipart/form-data")) {
    return vendorJoinUploadFields(req, res, next);
  }
  next();
}

const PROMOTION_SLOTS = ["search_sponsored", "home_featured", "section_featured", "listing_top"];

const DEFAULT_APP_AD_BANNER_TEXT_AR = "أعلن عن منتجك داخل تطبيق أدورا";
const DEFAULT_APP_AD_BANNER_TEXT_EN = "Advertise your product on Adora";

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function normalizeCtaSlideEntry(x) {
  if (!x || typeof x !== "object") return null;
  const title_ar = String(x.title_ar || "").trim().slice(0, 500);
  const title_en = String(x.title_en || "").trim().slice(0, 500);
  const subtitle_ar = String(x.subtitle_ar || "").trim().slice(0, 500);
  const subtitle_en = String(x.subtitle_en || "").trim().slice(0, 500);
  if (!title_ar && !title_en) return null;
  return { title_ar, title_en, subtitle_ar, subtitle_en };
}

function normalizeVendorJoinClause(x) {
  if (!x || typeof x !== "object") return null;
  const title_ar = String(x.title_ar || "").trim().slice(0, 500);
  const title_en = String(x.title_en || "").trim().slice(0, 500);
  const intro_ar = String(x.intro_ar || "").trim().slice(0, 4000);
  const intro_en = String(x.intro_en || "").trim().slice(0, 4000);
  const toLines = (v) => {
    if (Array.isArray(v)) {
      return v
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .slice(0, 40)
        .map((s) => s.slice(0, 2000));
    }
    if (typeof v === "string") {
      return v
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 40)
        .map((s) => s.slice(0, 2000));
    }
    return [];
  };
  const bullets_ar = toLines(x.bullets_ar);
  const bullets_en = toLines(x.bullets_en);
  const list_style = x.list_style === "none" ? "none" : "disc";
  const is_header = x.is_header === true || Number(x.is_header) === 1;
  if (!title_ar && !title_en && !intro_ar && !intro_en && !bullets_ar.length && !bullets_en.length) return null;
  return { title_ar, title_en, intro_ar, intro_en, bullets_ar, bullets_en, list_style, is_header };
}

function vendorJoinTermsClausesForPublic(s) {
  const raw = s.vendor_join_terms_clauses_json != null ? s.vendor_join_terms_clauses_json : "[]";
  const arr = safeJsonParse(raw, []);
  if (!Array.isArray(arr) || !arr.length) return [];
  return arr.map(normalizeVendorJoinClause).filter(Boolean);
}

function partnerCtaSlidesForPublic(s) {
  const arr = safeJsonParse(s.partner_cta_slides_json, []);
  if (Array.isArray(arr) && arr.length) {
    const out = arr.map(normalizeCtaSlideEntry).filter(Boolean);
    if (out.length) return out;
  }
  return [
    {
      title_ar: String(s.partner_banner_text_ar || "").trim(),
      title_en: String(s.partner_banner_text_en || "").trim(),
      subtitle_ar: String(s.partner_cta_subtitle_ar || "").trim(),
      subtitle_en: String(s.partner_cta_subtitle_en || "").trim(),
    },
  ];
}

function appAdCtaSlidesForPublic(s) {
  const arr = safeJsonParse(s.app_ad_cta_slides_json, []);
  if (Array.isArray(arr) && arr.length) {
    const out = arr.map(normalizeCtaSlideEntry).filter(Boolean);
    if (out.length) return out;
  }
  return [
    {
      title_ar: String(s.app_ad_banner_text_ar || "").trim() || DEFAULT_APP_AD_BANNER_TEXT_AR,
      title_en: String(s.app_ad_banner_text_en || "").trim() || DEFAULT_APP_AD_BANNER_TEXT_EN,
      subtitle_ar: String(s.app_ad_banner_subtitle_ar || "").trim(),
      subtitle_en: String(s.app_ad_banner_subtitle_en || "").trim(),
    },
  ];
}

const PARTNER_CTA_PLACEMENT_KEYS = [
  "home_under_search",
  "home_above_marketplace",
  "marketplace_screen",
  "offers_screen",
  "featured_hub_screen",
  "listing_screen",
];

function parsePartnerCtaPlacementsJson(raw) {
  const allowed = new Set(PARTNER_CTA_PLACEMENT_KEYS);
  try {
    const v = JSON.parse(raw || "[]");
    if (!Array.isArray(v)) return ["home_under_search"];
    const list = [...new Set(v.map((x) => String(x).trim()).filter((k) => allowed.has(k)))];
    return list.length ? list : ["home_under_search"];
  } catch {
    return ["home_under_search"];
  }
}

function normalizePartnerPlacementsFromBody(body, curJson) {
  if (body != null && Array.isArray(body.partner_cta_placements)) {
    return parsePartnerCtaPlacementsJson(JSON.stringify(body.partner_cta_placements));
  }
  if (body != null && body.partner_cta_placements_json != null) {
    return parsePartnerCtaPlacementsJson(String(body.partner_cta_placements_json));
  }
  return parsePartnerCtaPlacementsJson(curJson);
}

const APP_AD_PLACEMENT_KEYS = [
  "home_above_partner",
  "home_below_partner",
  "home_between_main_and_brands",
  "home_above_marketplace",
  "side_menu_account",
  "profile_screen",
  "marketplace_screen",
  "offers_screen",
  "featured_hub_screen",
  "listing_screen",
];

function parseAppAdPlacementsJson(raw) {
  const allowed = new Set(APP_AD_PLACEMENT_KEYS);
  try {
    const v = JSON.parse(raw || "[]");
    if (!Array.isArray(v)) return [];
    return [...new Set(v.map((x) => String(x).trim()).filter((k) => allowed.has(k)))];
  } catch {
    return [];
  }
}

/** مواضع افتراضية إذا كان البنر مفعّلاً ولم تُختر مواضع في لوحة التحكم */
/** موضع واحد فقط تحت البحث بجانب «انضم كشركة» لتفادي تكرار البنر */
const DEFAULT_APP_AD_PLACEMENTS_JSON = JSON.stringify([
  "home_above_partner",
  "home_above_marketplace",
  "side_menu_account",
]);

function effectiveAppAdPlacementsForPublic(enabled, placementsJson) {
  const enabledOn = Number(enabled) === 1;
  let list = parseAppAdPlacementsJson(placementsJson || "[]");
  if (enabledOn && !list.length) {
    list = parseAppAdPlacementsJson(DEFAULT_APP_AD_PLACEMENTS_JSON);
  }
  return { enabledOn, list };
}

function normalizeAppAdPlacementsFromBody(body, curJson) {
  if (body != null && Array.isArray(body.app_ad_banner_placements)) {
    return parseAppAdPlacementsJson(JSON.stringify(body.app_ad_banner_placements));
  }
  if (body != null && body.app_ad_banner_placements_json != null) {
    return parseAppAdPlacementsJson(String(body.app_ad_banner_placements_json));
  }
  return parseAppAdPlacementsJson(curJson);
}

const appAdProductUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|pjpeg|png|webp)$/i.test(file.mimetype || "");
    cb(null, ok);
  },
});

async function resolveAppAdInquiryNotifyUserId(row) {
  if (row.user_id != null && Number(row.user_id) > 0) {
    const u = await get(`SELECT id FROM users WHERE id=? AND COALESCE(role,'user') <> 'admin'`, [Number(row.user_id)]);
    if (u) return Number(u.id);
  }
  const em = row.email != null ? String(row.email).trim() : "";
  if (em) {
    const u = await get(
      `SELECT id FROM users WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(?)) AND COALESCE(role,'user') <> 'admin' LIMIT 1`,
      [em]
    );
    if (u) return Number(u.id);
  }
  const ph = row.phone != null ? String(row.phone).trim() : "";
  if (ph) {
    const u = await get(
      `SELECT id FROM users WHERE TRIM(COALESCE(phone,'')) = TRIM(?) AND COALESCE(role,'user') <> 'admin' LIMIT 1`,
      [ph]
    );
    if (u) return Number(u.id);
  }
  return null;
}

function buildAppAdInquiryStatusNotification(status, companyName, adminNote) {
  const c = companyName && String(companyName).trim() ? String(companyName).trim() : "شركتك";
  const note =
    adminNote != null && String(adminNote).trim()
      ? `\n\nملاحظة من Adora:\n${String(adminNote).trim().slice(0, 1500)}`
      : "";
  const map = {
    pending: {
      title: "طلب إعلان في التطبيق",
      message: `تم تحديث حالة طلب إعلانك لشركة «${c}» إلى: قيد الانتظار.${note}`,
    },
    reviewed: {
      title: "تحديث طلب الإعلان",
      message: `تمت مراجعة طلب إعلان المنتج لشركة «${c}».${note}`,
    },
    approved: {
      title: "تمت الموافقة على إعلانك",
      message: `تهانينا! تمت الموافقة على طلب إعلانك لشركة «${c}». سيظهر إعلانك في البنر حسب إعدادات المنصة.${note}`,
    },
    archived: {
      title: "طلب إعلان في التطبيق",
      message: `تم أرشفة طلب إعلانك لشركة «${c}».${note}`,
    },
  };
  const key = String(status || "").trim().toLowerCase();
  return map[key] || map.pending;
}

async function resolveVendorSubscriptionNotifyUserId(row) {
  if (row.user_id != null && Number(row.user_id) > 0) {
    const u = await get(`SELECT id FROM users WHERE id=? AND COALESCE(role,'user') <> 'admin'`, [Number(row.user_id)]);
    if (u) return Number(u.id);
  }
  const em = row.email != null ? String(row.email).trim() : "";
  if (em) {
    const u = await get(
      `SELECT id FROM users WHERE LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(?)) AND COALESCE(role,'user') <> 'admin' LIMIT 1`,
      [em]
    );
    if (u) return Number(u.id);
  }
  const ph = row.phone != null ? String(row.phone).trim() : "";
  if (ph) {
    const u = await get(
      `SELECT id FROM users WHERE TRIM(COALESCE(phone,'')) = TRIM(?) AND COALESCE(role,'user') <> 'admin' LIMIT 1`,
      [ph]
    );
    if (u) return Number(u.id);
  }
  return null;
}

/** مطابقة شركة السوق مع طلب الانضمام: بريد البوابة = بريد المستخدم/الطلب، أو اسم شركة فريد */
async function resolveMarketplaceVendorIdForSubscriptionRequest(row) {
  const uid = row.user_id != null ? Number(row.user_id) : NaN;
  if (Number.isFinite(uid) && uid > 0) {
    const u = await get(`SELECT email FROM users WHERE id=? AND COALESCE(role,'user') <> 'admin'`, [uid]);
    const em = u && u.email ? String(u.email).trim().toLowerCase() : "";
    if (em) {
      const v = await get(
        `SELECT id FROM marketplace_vendors WHERE LOWER(TRIM(COALESCE(portal_username,'')))=? LIMIT 1`,
        [em]
      );
      if (v) return { vendorId: Number(v.id), match: "portal_username_user_email" };
    }
  }
  const reqEmail = row.email != null ? String(row.email).trim().toLowerCase() : "";
  if (reqEmail) {
    const v = await get(
      `SELECT id FROM marketplace_vendors WHERE LOWER(TRIM(COALESCE(portal_username,'')))=? LIMIT 1`,
      [reqEmail]
    );
    if (v) return { vendorId: Number(v.id), match: "portal_username_request_email" };
  }
  const cn = row.company_name != null ? String(row.company_name).trim() : "";
  if (cn) {
    const list = await all(
      `SELECT id FROM marketplace_vendors
       WHERE vendor_type = 'company'
         AND (TRIM(name_ar) = TRIM(?) OR TRIM(name_en) = TRIM(?)
              OR LOWER(TRIM(name_en)) = LOWER(TRIM(?)))
       ORDER BY id DESC
       LIMIT 5`,
      [cn, cn, cn]
    );
    if (list.length === 1) return { vendorId: Number(list[0].id), match: "company_name_unique" };
  }
  return { vendorId: null, match: null };
}

/** عند الموافقة: تعبئة حقول الباقة والعمولة والتواريخ على marketplace_vendors من لقطة الطلب */
async function applySubscriptionPlanToMarketplaceVendor(vendorId, row) {
  const snap = safeJsonParse(row.selected_plan_snapshot_json, {});
  const planKey = String(row.selected_plan_key || snap.key || "")
    .trim()
    .slice(0, 64);
  if (!planKey) {
    return { ok: false, reason: "no_plan_key" };
  }
  const comm = Number(snap.commission_percent);
  const commissionOk = Number.isFinite(comm) && comm >= 0 && comm <= 100;
  const quotaNum = Math.floor(Number(snap.product_quota));
  const quotaOk = Number.isFinite(quotaNum) && quotaNum > 0;
  const priceMonthly = Number(snap.price_usd_monthly);
  const hasPaidPlan = Number.isFinite(priceMonthly) && priceMonthly > 0;

  const started = new Date().toISOString();
  let endsAt = null;
  if (hasPaidPlan) {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    endsAt = d.toISOString();
  }

  await run(
    `UPDATE marketplace_vendors SET
      subscription_plan_key=?,
      subscription_commission_percent=?,
      subscription_product_quota=COALESCE(?, subscription_product_quota),
      subscription_started_at=?::timestamptz,
      subscription_ends_at=?::timestamptz,
      product_quota=COALESCE(?, product_quota)
     WHERE id=?`,
    [
      planKey,
      commissionOk ? comm : null,
      quotaOk ? quotaNum : null,
      started,
      endsAt,
      quotaOk ? quotaNum : null,
      vendorId,
    ]
  );
  return { ok: true, plan_key: planKey, subscription_ends_at: endsAt };
}

function buildVendorSubStatusNotification(status, companyName, adminMessage) {
  const c = companyName && String(companyName).trim() ? String(companyName).trim() : "شركتك";
  const note =
    adminMessage != null && String(adminMessage).trim()
      ? `\n\nملاحظة من Adora:\n${String(adminMessage).trim().slice(0, 1500)}`
      : "";
  const map = {
    pending: {
      title: "طلب الاشتراك كشركة",
      message: `تم تسجيل طلبك للانضمام كشركة «${c}» وهو قيد المراجعة.${note}`,
    },
    approved: {
      title: "تمت الموافقة على طلبك",
      message: `تهانينا! تمت الموافقة على طلب الانضمام لشركة «${c}».${note}`,
    },
    rejected: {
      title: "تحديث طلب الانضمام كشركة",
      message: `نعتذر، لم تُقبل طلبات الانضمام الحالية لشركة «${c}».${note}`,
    },
    incomplete: {
      title: "طلب اشتراك يحتاج إكمالاً",
      message: `يحتاج طلب الانضمام لشركة «${c}» إلى معلومات أو مستندات إضافية.${note}`,
    },
  };
  const key = String(status || "").trim();
  return map[key] || map.pending;
}

function registerVendorPlatformRoutes(app, { requireAuth, requireAdmin, optionalAuth, notifyUserInApp, uploadVendorJoinImageBuffer, isVendorJoinUploadReady }) {
  app.get("/api/public/vendor-platform/home", async (_req, res) => {
    try {
      const s = await getVendorPlatformSettings();
      if (!s) {
        return res.json({
          partner_banner_enabled: 1,
          partner_banner_text_ar: "انضم كشركة في Adora - اضغط هنا",
          partner_banner_text_en: "Join Adora as a company — click here",
          partner_cta_subtitle_ar: "",
          partner_cta_subtitle_en: "",
          partner_cta_placements: ["home_under_search"],
          vendor_join_terms_ar: "",
          vendor_join_terms_en: "",
          vendor_join_terms_clauses: [],
          bestsellers_boost_enabled: 1,
          app_ad_banner_enabled: 1,
          app_ad_banner_text_ar: "أعلن عن منتجك داخل تطبيق أدورا",
          app_ad_banner_text_en: "Advertise your product on Adora",
          app_ad_banner_subtitle_ar: "",
          app_ad_banner_subtitle_en: "",
          app_ad_banner_placements: parseAppAdPlacementsJson(DEFAULT_APP_AD_PLACEMENTS_JSON),
          app_ad_terms_ar: "",
          app_ad_terms_en: "",
          partner_cta_slides: [
            {
              title_ar: "انضم كشركة في Adora - اضغط هنا",
              title_en: "Join Adora as a company — click here",
              subtitle_ar: "",
              subtitle_en: "",
            },
          ],
          app_ad_cta_slides: [
            {
              title_ar: "أعلن عن منتجك داخل تطبيق أدورا",
              title_en: "Advertise your product on Adora",
              subtitle_ar: "",
              subtitle_en: "",
            },
          ],
        });
      }
      const placements = parsePartnerCtaPlacementsJson(s.partner_cta_placements_json);
      const appAdEff = effectiveAppAdPlacementsForPublic(s.app_ad_banner_enabled, s.app_ad_banner_placements_json);
      return res.json({
        partner_banner_enabled: Number(s.partner_banner_enabled) === 1 ? 1 : 0,
        partner_banner_text_ar: s.partner_banner_text_ar || "",
        partner_banner_text_en: s.partner_banner_text_en || "",
        partner_cta_subtitle_ar: s.partner_cta_subtitle_ar || "",
        partner_cta_subtitle_en: s.partner_cta_subtitle_en || "",
        partner_cta_placements: placements,
        partner_cta_slides: partnerCtaSlidesForPublic(s),
        vendor_join_terms_ar: s.vendor_join_terms_ar || "",
        vendor_join_terms_en: s.vendor_join_terms_en || "",
        vendor_join_terms_clauses: vendorJoinTermsClausesForPublic(s),
        bestsellers_boost_enabled: Number(s.bestsellers_boost_enabled) === 1 ? 1 : 0,
        app_ad_banner_enabled: appAdEff.enabledOn ? 1 : 0,
        app_ad_banner_text_ar: String(s.app_ad_banner_text_ar || "").trim() || DEFAULT_APP_AD_BANNER_TEXT_AR,
        app_ad_banner_text_en: String(s.app_ad_banner_text_en || "").trim() || DEFAULT_APP_AD_BANNER_TEXT_EN,
        app_ad_banner_subtitle_ar: s.app_ad_banner_subtitle_ar || "",
        app_ad_banner_subtitle_en: s.app_ad_banner_subtitle_en || "",
        app_ad_banner_placements: appAdEff.list,
        app_ad_cta_slides: appAdCtaSlidesForPublic(s),
        app_ad_terms_ar: s.app_ad_terms_ar || "",
        app_ad_terms_en: s.app_ad_terms_en || "",
      });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load public settings" });
    }
  });

  app.get("/api/public/vendor-platform/join-plans", async (_req, res) => {
    try {
      const s = await getVendorPlatformSettings();
      const plans = mergePlansFromSettingsJson(s?.vendor_join_plans_json);
      return res.json({ plans });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load join plans" });
    }
  });

  app.get("/api/admin/vendor-platform/settings", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const row = await getVendorPlatformSettings();
      if (!row) return res.status(500).json({ error: "Settings not initialized" });
      return res.json(row);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load settings" });
    }
  });

  app.put("/api/admin/vendor-platform/settings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const cur = await getVendorPlatformSettings();
      if (!cur) return res.status(500).json({ error: "Settings not initialized" });
      const b = req.body || {};
      const product_quota_enabled = b.product_quota_enabled != null ? (Number(b.product_quota_enabled) === 0 ? 0 : 1) : cur.product_quota_enabled;
      const free_products_per_vendor = Math.max(
        0,
        Math.floor(Number(b.free_products_per_vendor != null ? b.free_products_per_vendor : cur.free_products_per_vendor) || 0)
      );
      const extra_product_price_usd = Math.max(
        0,
        Number(b.extra_product_price_usd != null ? b.extra_product_price_usd : cur.extra_product_price_usd) || 0
      );
      const commission_percent = Math.min(
        100,
        Math.max(0, Number(b.commission_percent != null ? b.commission_percent : cur.commission_percent) || 0)
      );
      const ads_module_enabled = b.ads_module_enabled != null ? (Number(b.ads_module_enabled) === 0 ? 0 : 1) : cur.ads_module_enabled;
      const partner_banner_enabled =
        b.partner_banner_enabled != null ? (Number(b.partner_banner_enabled) === 0 ? 0 : 1) : cur.partner_banner_enabled;
      const partner_banner_text_ar =
        b.partner_banner_text_ar != null ? String(b.partner_banner_text_ar).slice(0, 500) : cur.partner_banner_text_ar;
      const partner_banner_text_en =
        b.partner_banner_text_en != null ? String(b.partner_banner_text_en).slice(0, 500) : cur.partner_banner_text_en;
      const partner_cta_subtitle_ar =
        b.partner_cta_subtitle_ar != null ? String(b.partner_cta_subtitle_ar).slice(0, 500) : cur.partner_cta_subtitle_ar ?? "";
      const partner_cta_subtitle_en =
        b.partner_cta_subtitle_en != null ? String(b.partner_cta_subtitle_en).slice(0, 500) : cur.partner_cta_subtitle_en ?? "";
      const partner_cta_placements_json = JSON.stringify(
        normalizePartnerPlacementsFromBody(b, cur.partner_cta_placements_json)
      );
      const featured_products_mode = ["manual", "auto_bestsellers", "by_vendor"].includes(String(b.featured_products_mode || "").trim())
        ? String(b.featured_products_mode).trim()
        : cur.featured_products_mode;
      let featured_vendor_ids_json = cur.featured_vendor_ids_json;
      if (b.featured_vendor_ids != null && Array.isArray(b.featured_vendor_ids)) {
        const ids = b.featured_vendor_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
        featured_vendor_ids_json = JSON.stringify(ids);
      } else if (b.featured_vendor_ids_json != null) {
        featured_vendor_ids_json = String(b.featured_vendor_ids_json).slice(0, 4000);
      }
      const bestsellers_boost_enabled =
        b.bestsellers_boost_enabled != null ? (Number(b.bestsellers_boost_enabled) === 0 ? 0 : 1) : cur.bestsellers_boost_enabled;
      const vendor_join_terms_ar =
        b.vendor_join_terms_ar != null ? String(b.vendor_join_terms_ar).slice(0, 8000) : cur.vendor_join_terms_ar ?? "";
      const vendor_join_terms_en =
        b.vendor_join_terms_en != null ? String(b.vendor_join_terms_en).slice(0, 8000) : cur.vendor_join_terms_en ?? "";

      let vendor_join_terms_clauses_json =
        cur.vendor_join_terms_clauses_json != null ? String(cur.vendor_join_terms_clauses_json) : "[]";
      if (Array.isArray(b.vendor_join_terms_clauses)) {
        const clauses = b.vendor_join_terms_clauses.map(normalizeVendorJoinClause).filter(Boolean);
        vendor_join_terms_clauses_json = JSON.stringify(clauses).slice(0, 120000);
      } else if (b.vendor_join_terms_clauses_json !== undefined && b.vendor_join_terms_clauses_json !== null) {
        const t = String(b.vendor_join_terms_clauses_json).trim();
        if (!t) {
          vendor_join_terms_clauses_json = "[]";
        } else {
          const parsed = safeJsonParse(t, null);
          if (Array.isArray(parsed)) {
            vendor_join_terms_clauses_json = JSON.stringify(parsed.map(normalizeVendorJoinClause).filter(Boolean)).slice(
              0,
              120000
            );
          } else {
            vendor_join_terms_clauses_json = t.slice(0, 120000);
          }
        }
      }

      let vendor_join_plans_json =
        cur.vendor_join_plans_json != null ? String(cur.vendor_join_plans_json) : "";
      if (Array.isArray(b.vendor_join_plans)) {
        vendor_join_plans_json = JSON.stringify({ plans: b.vendor_join_plans }).slice(0, 120000);
      } else if (b.vendor_join_plans_json !== undefined && b.vendor_join_plans_json !== null) {
        const t = String(b.vendor_join_plans_json).trim();
        if (!t) {
          vendor_join_plans_json = "";
        } else {
          const parsed = safeJsonParse(t, null);
          const ok = Array.isArray(parsed) || (parsed && typeof parsed === "object" && Array.isArray(parsed.plans));
          vendor_join_plans_json = ok ? t.slice(0, 120000) : vendor_join_plans_json;
        }
      }

      const app_ad_banner_enabled =
        b.app_ad_banner_enabled != null ? (Number(b.app_ad_banner_enabled) === 0 ? 0 : 1) : Number(cur.app_ad_banner_enabled) === 1 ? 1 : 0;
      const app_ad_banner_text_ar =
        b.app_ad_banner_text_ar != null ? String(b.app_ad_banner_text_ar).slice(0, 500) : cur.app_ad_banner_text_ar ?? "";
      const app_ad_banner_text_en =
        b.app_ad_banner_text_en != null ? String(b.app_ad_banner_text_en).slice(0, 500) : cur.app_ad_banner_text_en ?? "";
      const app_ad_banner_subtitle_ar =
        b.app_ad_banner_subtitle_ar != null ? String(b.app_ad_banner_subtitle_ar).slice(0, 500) : cur.app_ad_banner_subtitle_ar ?? "";
      const app_ad_banner_subtitle_en =
        b.app_ad_banner_subtitle_en != null ? String(b.app_ad_banner_subtitle_en).slice(0, 500) : cur.app_ad_banner_subtitle_en ?? "";
      const app_ad_banner_placements_json = JSON.stringify(
        normalizeAppAdPlacementsFromBody(b, cur.app_ad_banner_placements_json || "[]")
      );
      const app_ad_terms_ar =
        b.app_ad_terms_ar != null ? String(b.app_ad_terms_ar).slice(0, 8000) : cur.app_ad_terms_ar ?? "";
      const app_ad_terms_en =
        b.app_ad_terms_en != null ? String(b.app_ad_terms_en).slice(0, 8000) : cur.app_ad_terms_en ?? "";

      let partner_cta_slides_json = cur.partner_cta_slides_json != null ? String(cur.partner_cta_slides_json) : "[]";
      if (Array.isArray(b.partner_cta_slides)) {
        const slides = b.partner_cta_slides.map(normalizeCtaSlideEntry).filter(Boolean);
        partner_cta_slides_json = JSON.stringify(slides.slice(0, 20));
      } else if (b.partner_cta_slides_json !== undefined && b.partner_cta_slides_json !== null) {
        const t = String(b.partner_cta_slides_json).trim();
        partner_cta_slides_json = t ? t.slice(0, 32000) : "[]";
      }
      let app_ad_cta_slides_json = cur.app_ad_cta_slides_json != null ? String(cur.app_ad_cta_slides_json) : "[]";
      if (Array.isArray(b.app_ad_cta_slides)) {
        const slides = b.app_ad_cta_slides.map(normalizeCtaSlideEntry).filter(Boolean);
        app_ad_cta_slides_json = JSON.stringify(slides.slice(0, 20));
      } else if (b.app_ad_cta_slides_json !== undefined && b.app_ad_cta_slides_json !== null) {
        const t = String(b.app_ad_cta_slides_json).trim();
        app_ad_cta_slides_json = t ? t.slice(0, 32000) : "[]";
      }

      await run(
        `UPDATE vendor_platform_settings SET
          product_quota_enabled=?, free_products_per_vendor=?, extra_product_price_usd=?, commission_percent=?,
          ads_module_enabled=?, partner_banner_enabled=?, partner_banner_text_ar=?, partner_banner_text_en=?,
          partner_cta_subtitle_ar=?, partner_cta_subtitle_en=?, partner_cta_placements_json=?,
          partner_cta_slides_json=?,
          featured_products_mode=?, featured_vendor_ids_json=?, bestsellers_boost_enabled=?,
          vendor_join_terms_ar=?, vendor_join_terms_en=?, vendor_join_terms_clauses_json=?,
          vendor_join_plans_json=?,
          app_ad_banner_enabled=?, app_ad_banner_text_ar=?, app_ad_banner_text_en=?,
          app_ad_banner_subtitle_ar=?, app_ad_banner_subtitle_en=?, app_ad_banner_placements_json=?,
          app_ad_cta_slides_json=?,
          app_ad_terms_ar=?, app_ad_terms_en=?,
          updated_at=CURRENT_TIMESTAMP
         WHERE id=1`,
        [
          product_quota_enabled,
          free_products_per_vendor,
          extra_product_price_usd,
          commission_percent,
          ads_module_enabled,
          partner_banner_enabled,
          partner_banner_text_ar,
          partner_banner_text_en,
          partner_cta_subtitle_ar,
          partner_cta_subtitle_en,
          partner_cta_placements_json,
          partner_cta_slides_json,
          featured_products_mode,
          featured_vendor_ids_json,
          bestsellers_boost_enabled,
          vendor_join_terms_ar,
          vendor_join_terms_en,
          vendor_join_terms_clauses_json,
          vendor_join_plans_json,
          app_ad_banner_enabled,
          app_ad_banner_text_ar,
          app_ad_banner_text_en,
          app_ad_banner_subtitle_ar,
          app_ad_banner_subtitle_en,
          app_ad_banner_placements_json,
          app_ad_cta_slides_json,
          app_ad_terms_ar,
          app_ad_terms_en,
        ]
      );
      return res.json(await getVendorPlatformSettings());
    } catch (_e) {
      return res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.post("/api/vendor-subscription-requests", optionalAuth, vendorJoinMultipartMiddleware, async (req, res) => {
    try {
      const uploadReady = typeof isVendorJoinUploadReady === "function" ? isVendorJoinUploadReady() : false;
      const multipart = req.is("multipart/form-data");
      const b = req.body || {};
      const full_name = b.full_name != null ? String(b.full_name).trim().slice(0, 200) : "";
      const phone = b.phone != null ? String(b.phone).trim().slice(0, 40) : "";
      const company_name = b.company_name != null ? String(b.company_name).trim().slice(0, 200) : "";
      const email = b.email != null ? String(b.email).trim().slice(0, 200) : "";
      const terms_accepted = Number(b.terms_accepted) === 1 || String(b.terms_accepted).trim() === "1" ? 1 : 0;
      let doc_type = String(b.doc_type || "national_id").trim().toLowerCase();
      if (doc_type === "commercial" || doc_type === "commercial_register") doc_type = "commercial";
      else doc_type = "national_id";

      let id_front_url = null;
      let id_back_url = null;
      let commercial_register_url = null;

      if (multipart) {
        if (!uploadReady || typeof uploadVendorJoinImageBuffer !== "function") {
          return res.status(503).json({
            error:
              "رفع الصور غير متاح — أضف إعدادات Cloudinary على الخادم (CLOUDINARY_URL أو اسم السحابة والمفاتيح).",
          });
        }
        try {
          const fFront = req.files?.id_front?.[0];
          const fBack = req.files?.id_back?.[0];
          const fCom = req.files?.commercial_register?.[0];
          if (fFront) id_front_url = await uploadVendorJoinImageBuffer(fFront.buffer);
          if (fBack) id_back_url = await uploadVendorJoinImageBuffer(fBack.buffer);
          if (fCom) commercial_register_url = await uploadVendorJoinImageBuffer(fCom.buffer);
        } catch (e) {
          const msg = e && e.message ? String(e.message) : "Upload failed";
          return res.status(500).json({ error: msg });
        }
      } else {
        id_front_url = sanitizeHttpsUrl(b.id_front_url);
        id_back_url = sanitizeHttpsUrl(b.id_back_url);
        commercial_register_url = sanitizeHttpsUrl(b.commercial_register_url);
      }

      if (doc_type === "national_id") {
        if (!id_front_url && !id_back_url) {
          return res.status(400).json({
            error: "يجب رفع صورة واجهة الهوية أو الخلفية (أو كليهما).",
          });
        }
      } else if (!commercial_register_url) {
        return res.status(400).json({ error: "يجب رفع صورة السجل التجاري." });
      }

      const id_document = "";
      if (!full_name || !phone || !company_name || !email) {
        return res.status(400).json({ error: "All fields are required" });
      }
      if (!terms_accepted) {
        return res.status(400).json({ error: "You must accept the terms" });
      }

      const settingsForPlans = await getVendorPlatformSettings();
      const joinPlans = mergePlansFromSettingsJson(settingsForPlans?.vendor_join_plans_json);
      const selected_plan_key_raw = b.selected_plan_key != null ? String(b.selected_plan_key).trim().toLowerCase() : "";
      const chosenPlan = getPlanByKey(joinPlans, selected_plan_key_raw);
      if (!chosenPlan) {
        return res.status(400).json({
          error: "يرجى اختيار باقة صالحة من القائمة.",
          error_en: "Please select a valid subscription plan.",
        });
      }
      const selected_plan_key = chosenPlan.key;
      const selected_plan_snapshot_json = JSON.stringify(planSnapshotForStorage(chosenPlan));

      let user_id = null;
      if (req.user && String(req.user.role || "").trim().toLowerCase() !== "admin") {
        const uid = Number(req.user.id);
        if (Number.isFinite(uid) && uid > 0) user_id = uid;
      }
      const ins = await run(
        `INSERT INTO vendor_subscription_requests (full_name, phone, company_name, email, id_document, terms_accepted, status, user_id, doc_type, id_front_url, id_back_url, commercial_register_url, selected_plan_key, selected_plan_snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
        [
          full_name,
          phone,
          company_name,
          email,
          id_document,
          terms_accepted,
          user_id,
          doc_type,
          id_front_url,
          id_back_url,
          commercial_register_url,
          selected_plan_key,
          selected_plan_snapshot_json,
        ]
      );
      return res.status(201).json({ ok: true, id: ins.id });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to submit request" });
    }
  });

  app.get("/api/me/vendor-subscription-requests", requireAuth, async (req, res) => {
    try {
      const role = String(req.user?.role ?? "").trim().toLowerCase();
      if (role === "admin") return res.json([]);
      const uid = Number(req.user.id);
      const urow = await get(`SELECT id, email, phone FROM users WHERE id=?`, [uid]);
      if (!urow) return res.status(401).json({ error: "Unauthorized" });
      const email = urow.email != null ? String(urow.email).trim() : "";
      const phone = urow.phone != null ? String(urow.phone).trim() : "";
      const rows = await all(
        `SELECT id, full_name, phone, company_name, email, status, admin_message, created_at, updated_at, user_id,
                doc_type, id_front_url, id_back_url, commercial_register_url,
                selected_plan_key, selected_plan_snapshot_json
         FROM vendor_subscription_requests
         WHERE user_id = ?
            OR (user_id IS NULL AND TRIM(COALESCE(?, '')) <> '' AND LOWER(TRIM(email)) = LOWER(TRIM(?)))
            OR (user_id IS NULL AND TRIM(COALESCE(?, '')) <> '' AND TRIM(phone) = TRIM(?))
         ORDER BY created_at DESC, id DESC
         LIMIT 50`,
        [uid, email, email, phone, phone]
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load requests" });
    }
  });

  app.get("/api/me/app-ad-inquiries", requireAuth, async (req, res) => {
    try {
      const role = String(req.user?.role ?? "").trim().toLowerCase();
      if (role === "admin") return res.json([]);
      const uid = Number(req.user.id);
      const urow = await get(`SELECT id, email, phone FROM users WHERE id=?`, [uid]);
      if (!urow) return res.status(401).json({ error: "Unauthorized" });
      const email = urow.email != null ? String(urow.email).trim() : "";
      const phone = urow.phone != null ? String(urow.phone).trim() : "";
      const rows = await all(
        `SELECT id, full_name, company_name, email, phone, residence, product_price, product_image_url, status, admin_note, created_at, updated_at, user_id
         FROM app_ad_inquiries
         WHERE user_id = ?
            OR (user_id IS NULL AND TRIM(COALESCE(?, '')) <> '' AND LOWER(TRIM(email)) = LOWER(TRIM(?)))
            OR (user_id IS NULL AND TRIM(COALESCE(?, '')) <> '' AND TRIM(phone) = TRIM(?))
         ORDER BY created_at DESC, id DESC
         LIMIT 50`,
        [uid, email, email, phone, phone]
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load ad inquiries" });
    }
  });

  app.get("/api/admin/vendor-subscription-requests", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const rows = await all(
        `SELECT * FROM vendor_subscription_requests ORDER BY created_at DESC, id DESC LIMIT 500`
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load requests" });
    }
  });

  app.patch("/api/admin/vendor-subscription-requests/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const cur = await get(`SELECT * FROM vendor_subscription_requests WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      const prevStatus = String(cur.status || "").trim();
      let status = cur.status;
      if (b.status != null) {
        const s = String(b.status).trim();
        if (["pending", "approved", "rejected", "incomplete"].includes(s)) status = s;
      }
      const admin_message =
        b.admin_message !== undefined ? (b.admin_message ? String(b.admin_message).trim().slice(0, 4000) : null) : cur.admin_message;
      await run(
        `UPDATE vendor_subscription_requests SET status=?, admin_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [status, admin_message, id]
      );
      const updated = await get(`SELECT * FROM vendor_subscription_requests WHERE id=?`, [id]);
      const newStatus = String(updated.status || "").trim();
      let vendor_plan_sync = null;
      if (newStatus === "approved" && prevStatus !== "approved") {
        try {
          const { vendorId, match } = await resolveMarketplaceVendorIdForSubscriptionRequest(updated);
          if (vendorId) {
            const applied = await applySubscriptionPlanToMarketplaceVendor(vendorId, updated);
            vendor_plan_sync = {
              applied: applied.ok === true,
              vendor_id: vendorId,
              match,
              ...applied,
            };
          } else {
            vendor_plan_sync = {
              applied: false,
              reason: "vendor_not_found",
              hint_ar:
                "لم تُعثر على شركة سوق مطابقة. أنشئ الشركة من «إضافة شركة» واجعل اسم مستخدم البوابة مساوياً لبريد الطلب، أو طابق اسم الشركة (عربي/إنجليزي) بدقة وفريد.",
              hint_en:
                "No matching marketplace company. Create the company with portal username equal to the request email, or a unique company name match.",
            };
          }
        } catch (e) {
          const msg = e && e.message ? String(e.message) : "sync_failed";
          vendor_plan_sync = { applied: false, reason: "exception", error: msg };
        }
      }
      if (typeof notifyUserInApp === "function" && prevStatus !== newStatus) {
        try {
          const notifyUid = await resolveVendorSubscriptionNotifyUserId(updated);
          if (notifyUid) {
            const { title, message } = buildVendorSubStatusNotification(
              newStatus,
              updated.company_name,
              updated.admin_message
            );
            await notifyUserInApp(notifyUid, title, message, null);
          }
        } catch (_n) {
          /* لا نفشل حفظ الحالة إذا تعذر الإشعار */
        }
      }
      return vendor_plan_sync != null ? res.json({ ...updated, vendor_plan_sync }) : res.json(updated);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to update request" });
    }
  });

  app.get("/api/admin/vendor-platform/promotions", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const rows = await all(
        `SELECT pr.*, mp.name_ar AS product_name_ar, mp.name_en AS product_name_en
         FROM marketplace_product_promotions pr
         INNER JOIN marketplace_products mp ON mp.id = pr.product_id
         ORDER BY pr.ends_at DESC, pr.id DESC LIMIT 300`
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load promotions" });
    }
  });

  app.post("/api/admin/vendor-platform/promotions", requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const product_id = Number(b.product_id);
      const slot = b.slot != null ? String(b.slot).trim() : "";
      if (!Number.isFinite(product_id) || !PROMOTION_SLOTS.includes(slot)) {
        return res.status(400).json({ error: "product_id and valid slot required" });
      }
      const mp = await get(`SELECT id FROM marketplace_products WHERE id=?`, [product_id]);
      if (!mp) return res.status(404).json({ error: "Product not found" });
      const priority = Math.floor(Number(b.priority) || 0);
      const price_usd = Math.max(0, Number(b.price_usd) || 0);
      const starts_at = b.starts_at != null ? String(b.starts_at).trim() : "";
      const ends_at = b.ends_at != null ? String(b.ends_at).trim() : "";
      if (!starts_at || !ends_at) return res.status(400).json({ error: "starts_at and ends_at required (ISO date)" });
      const max_impressions =
        b.max_impressions != null && b.max_impressions !== ""
          ? Math.max(0, Math.floor(Number(b.max_impressions)))
          : null;
      if (max_impressions !== null && !Number.isFinite(max_impressions)) {
        return res.status(400).json({ error: "Invalid max_impressions" });
      }
      const is_active = Number(b.is_active) === 0 ? 0 : 1;
      const ins = await run(
        `INSERT INTO marketplace_product_promotions (product_id, slot, priority, price_usd, starts_at, ends_at, max_impressions, is_active)
         VALUES (?, ?, ?, ?, ?::timestamptz, ?::timestamptz, ?, ?)`,
        [product_id, slot, priority, price_usd, starts_at, ends_at, max_impressions, is_active]
      );
      return res.status(201).json(await get(`SELECT * FROM marketplace_product_promotions WHERE id=?`, [ins.id]));
    } catch (_e) {
      return res.status(500).json({ error: "Failed to create promotion" });
    }
  });

  app.put("/api/admin/vendor-platform/promotions/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await get(`SELECT * FROM marketplace_product_promotions WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      const product_id = b.product_id != null ? Number(b.product_id) : cur.product_id;
      const slot = b.slot != null ? String(b.slot).trim() : cur.slot;
      if (!Number.isFinite(product_id) || !PROMOTION_SLOTS.includes(slot)) {
        return res.status(400).json({ error: "Invalid product or slot" });
      }
      const mp = await get(`SELECT id FROM marketplace_products WHERE id=?`, [product_id]);
      if (!mp) return res.status(404).json({ error: "Product not found" });
      const priority = b.priority != null ? Math.floor(Number(b.priority) || 0) : cur.priority;
      const price_usd = b.price_usd != null ? Math.max(0, Number(b.price_usd) || 0) : cur.price_usd;
      const starts_at = b.starts_at != null ? String(b.starts_at).trim() : cur.starts_at;
      const ends_at = b.ends_at != null ? String(b.ends_at).trim() : cur.ends_at;
      let max_impressions = cur.max_impressions;
      if (b.max_impressions !== undefined) {
        max_impressions =
          b.max_impressions != null && b.max_impressions !== ""
            ? Math.max(0, Math.floor(Number(b.max_impressions)))
            : null;
      }
      const is_active = b.is_active != null ? (Number(b.is_active) === 0 ? 0 : 1) : cur.is_active;
      await run(
        `UPDATE marketplace_product_promotions SET product_id=?, slot=?, priority=?, price_usd=?,
         starts_at=?::timestamptz, ends_at=?::timestamptz, max_impressions=?, is_active=? WHERE id=?`,
        [product_id, slot, priority, price_usd, starts_at, ends_at, max_impressions, is_active, id]
      );
      return res.json(await get(`SELECT * FROM marketplace_product_promotions WHERE id=?`, [id]));
    } catch (_e) {
      return res.status(500).json({ error: "Failed to update promotion" });
    }
  });

  app.delete("/api/admin/vendor-platform/promotions/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await run(`DELETE FROM marketplace_product_promotions WHERE id=?`, [Number(req.params.id)]);
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to delete promotion" });
    }
  });

  app.get("/api/admin/vendor-platform/commission-report", requireAuth, requireAdmin, async (req, res) => {
    try {
      const from = req.query.from != null ? String(req.query.from).trim() : "";
      const to = req.query.to != null ? String(req.query.to).trim() : "";
      let dateClause = "";
      const params = [];
      if (from) {
        dateClause += ` AND o.created_at >= ?::timestamptz`;
        params.push(from);
      }
      if (to) {
        dateClause += ` AND o.created_at <= ?::timestamptz`;
        params.push(to);
      }
      const byVendor = await all(
        `SELECT mp.vendor_id,
                MAX(mv.name_ar) AS vendor_name_ar,
                MAX(mv.name_en) AS vendor_name_en,
                SUM(oi.qty * oi.price)::float AS gross_sales,
                SUM(COALESCE(oi.marketplace_commission_amount, 0))::float AS commission_total
         FROM order_items oi
         INNER JOIN orders o ON o.id = oi.order_id
         LEFT JOIN marketplace_products mp ON mp.id = oi.marketplace_product_id
         LEFT JOIN marketplace_vendors mv ON mv.id = mp.vendor_id
         WHERE oi.marketplace_product_id IS NOT NULL ${dateClause}
         GROUP BY mp.vendor_id
         ORDER BY commission_total DESC NULLS LAST`,
        params
      );
      const adoraRow = await get(
        `SELECT SUM(COALESCE(oi.marketplace_commission_amount, 0))::float AS t
         FROM order_items oi
         INNER JOIN orders o ON o.id = oi.order_id
         WHERE oi.marketplace_product_id IS NOT NULL ${dateClause}`,
        params
      );
      let vendorsNet = 0;
      let vendorsGross = 0;
      for (const row of byVendor) {
        vendorsGross += Number(row.gross_sales || 0);
        vendorsNet += Number(row.gross_sales || 0) - Number(row.commission_total || 0);
      }
      return res.json({
        by_vendor: byVendor,
        adora_commission_total: Number(adoraRow?.t || 0),
        summary: {
          marketplace_gross_sales: vendorsGross,
          estimated_vendors_net_after_commission: vendorsNet,
        },
      });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load commission report" });
    }
  });

  app.post("/api/app-ad-inquiries", optionalAuth, appAdProductUpload.single("product_image"), async (req, res) => {
    try {
      const uploadReady = typeof isVendorJoinUploadReady === "function" ? isVendorJoinUploadReady() : false;
      const b = req.body || {};
      const full_name = b.full_name != null ? String(b.full_name).trim().slice(0, 200) : "";
      const company_name = b.company_name != null ? String(b.company_name).trim().slice(0, 200) : "";
      const email = b.email != null ? String(b.email).trim().slice(0, 200) : "";
      const phone = b.phone != null ? String(b.phone).trim().slice(0, 40) : "";
      const residence = b.residence != null ? String(b.residence).trim().slice(0, 400) : "";
      const product_price = b.product_price != null ? String(b.product_price).trim().slice(0, 120) : "";
      const terms_accepted = Number(b.terms_accepted) === 1 || String(b.terms_accepted).trim() === "1" ? 1 : 0;
      if (!full_name || !company_name || !email || !phone || !residence || !product_price) {
        return res.status(400).json({ error: "يرجى تعبئة جميع الحقول المطلوبة." });
      }
      if (!terms_accepted) {
        return res.status(400).json({ error: "يجب الموافقة على الشروط." });
      }
      const f = req.file;
      if (!f || !f.buffer) {
        return res.status(400).json({ error: "يرجى إرفاق صورة المنتج." });
      }
      if (!uploadReady || typeof uploadVendorJoinImageBuffer !== "function") {
        return res.status(503).json({
          error:
            "رفع الصور غير متاح — أضف إعدادات Cloudinary على الخادم (CLOUDINARY_URL أو اسم السحابة والمفاتيح).",
        });
      }
      let product_image_url;
      try {
        product_image_url = await uploadVendorJoinImageBuffer(f.buffer);
      } catch (e) {
        const msg = e && e.message ? String(e.message) : "Upload failed";
        return res.status(500).json({ error: msg });
      }
      let user_id = null;
      if (req.user && String(req.user.role || "").trim().toLowerCase() !== "admin") {
        const uid = Number(req.user.id);
        if (Number.isFinite(uid) && uid > 0) user_id = uid;
      }
      const ins = await run(
        `INSERT INTO app_ad_inquiries (full_name, company_name, email, phone, residence, product_price, product_image_url, terms_accepted, status, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [full_name, company_name, email, phone, residence, product_price, product_image_url, terms_accepted, user_id]
      );
      return res.status(201).json({ ok: true, id: ins.id });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to submit inquiry" });
    }
  });

  app.get("/api/admin/app-ad-inquiries", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const rows = await all(
        `SELECT id, full_name, company_name, email, phone, residence, product_price, product_image_url, terms_accepted, status, admin_note, user_id, created_at, updated_at
         FROM app_ad_inquiries ORDER BY created_at DESC, id DESC LIMIT 500`
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load inquiries" });
    }
  });

  app.patch("/api/admin/app-ad-inquiries/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await get(`SELECT * FROM app_ad_inquiries WHERE id=?`, [id]);
      if (!row) return res.status(404).json({ error: "Not found" });
      const prevStatus = String(row.status || "").trim().toLowerCase();
      const b = req.body || {};
      const statusIn = b.status != null ? String(b.status).trim().toLowerCase() : null;
      let newStatus = String(row.status || "").trim().toLowerCase();
      if (statusIn === "pending" || statusIn === "reviewed" || statusIn === "approved" || statusIn === "archived") {
        newStatus = statusIn;
      }
      let newNote = row.admin_note;
      if (b.admin_note !== undefined) {
        newNote = b.admin_note != null ? String(b.admin_note).slice(0, 4000) : null;
      }
      await run(`UPDATE app_ad_inquiries SET status=?, admin_note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [
        newStatus,
        newNote,
        id,
      ]);
      const updated = await get(`SELECT * FROM app_ad_inquiries WHERE id=?`, [id]);
      const nextStatus = String(updated.status || "").trim().toLowerCase();
      if (typeof notifyUserInApp === "function" && prevStatus !== nextStatus) {
        try {
          const notifyUid = await resolveAppAdInquiryNotifyUserId(updated);
          if (notifyUid) {
            const { title, message } = buildAppAdInquiryStatusNotification(
              nextStatus,
              updated.company_name,
              updated.admin_note
            );
            await notifyUserInApp(notifyUid, title, message, null);
          }
        } catch (_n) {
          /* لا نفشل حفظ الحالة إذا تعذر الإشعار */
        }
      }
      return res.json(updated);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to update inquiry" });
    }
  });
}

module.exports = { registerVendorPlatformRoutes, PROMOTION_SLOTS, APP_AD_PLACEMENT_KEYS };

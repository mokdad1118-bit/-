/**
 * لوحة تحكم منصة البائعين: إعدادات، طلبات الانضمام، إعلانات المنتجات، تقارير العمولة
 */
const multer = require("multer");
const { get, all, run } = require("./db");
const { getVendorPlatformSettings } = require("./vendor-platform-settings");
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

const PARTNER_CTA_PLACEMENT_KEYS = [
  "home_under_search",
  "home_above_marketplace",
  "marketplace_screen",
  "offers_screen",
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
          bestsellers_boost_enabled: 1,
        });
      }
      const placements = parsePartnerCtaPlacementsJson(s.partner_cta_placements_json);
      return res.json({
        partner_banner_enabled: Number(s.partner_banner_enabled) === 1 ? 1 : 0,
        partner_banner_text_ar: s.partner_banner_text_ar || "",
        partner_banner_text_en: s.partner_banner_text_en || "",
        partner_cta_subtitle_ar: s.partner_cta_subtitle_ar || "",
        partner_cta_subtitle_en: s.partner_cta_subtitle_en || "",
        partner_cta_placements: placements,
        vendor_join_terms_ar: s.vendor_join_terms_ar || "",
        vendor_join_terms_en: s.vendor_join_terms_en || "",
        bestsellers_boost_enabled: Number(s.bestsellers_boost_enabled) === 1 ? 1 : 0,
      });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load public settings" });
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

      await run(
        `UPDATE vendor_platform_settings SET
          product_quota_enabled=?, free_products_per_vendor=?, extra_product_price_usd=?, commission_percent=?,
          ads_module_enabled=?, partner_banner_enabled=?, partner_banner_text_ar=?, partner_banner_text_en=?,
          partner_cta_subtitle_ar=?, partner_cta_subtitle_en=?, partner_cta_placements_json=?,
          featured_products_mode=?, featured_vendor_ids_json=?, bestsellers_boost_enabled=?,
          vendor_join_terms_ar=?, vendor_join_terms_en=?,
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
          featured_products_mode,
          featured_vendor_ids_json,
          bestsellers_boost_enabled,
          vendor_join_terms_ar,
          vendor_join_terms_en,
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

      let user_id = null;
      if (req.user && String(req.user.role || "").trim().toLowerCase() !== "admin") {
        const uid = Number(req.user.id);
        if (Number.isFinite(uid) && uid > 0) user_id = uid;
      }
      const ins = await run(
        `INSERT INTO vendor_subscription_requests (full_name, phone, company_name, email, id_document, terms_accepted, status, user_id, doc_type, id_front_url, id_back_url, commercial_register_url)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
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
                doc_type, id_front_url, id_back_url, commercial_register_url
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
      return res.json(updated);
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
}

module.exports = { registerVendorPlatformRoutes, PROMOTION_SLOTS };

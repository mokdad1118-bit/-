/**
 * لوحة تحكم منصة البائعين: إعدادات، طلبات الانضمام، إعلانات المنتجات، تقارير العمولة
 */
const { get, all, run } = require("./db");
const { getVendorPlatformSettings } = require("./vendor-platform-settings");

const PROMOTION_SLOTS = ["search_sponsored", "home_featured", "section_featured", "listing_top"];

function registerVendorPlatformRoutes(app, { requireAuth, requireAdmin }) {
  app.get("/api/public/vendor-platform/home", async (_req, res) => {
    try {
      const s = await getVendorPlatformSettings();
      if (!s) {
        return res.json({
          partner_banner_enabled: 1,
          partner_banner_text_ar: "انضم كشركة في Adora - اضغط هنا",
          partner_banner_text_en: "Join Adora as a company — click here",
        });
      }
      return res.json({
        partner_banner_enabled: Number(s.partner_banner_enabled) === 1 ? 1 : 0,
        partner_banner_text_ar: s.partner_banner_text_ar || "",
        partner_banner_text_en: s.partner_banner_text_en || "",
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

      await run(
        `UPDATE vendor_platform_settings SET
          product_quota_enabled=?, free_products_per_vendor=?, extra_product_price_usd=?, commission_percent=?,
          ads_module_enabled=?, partner_banner_enabled=?, partner_banner_text_ar=?, partner_banner_text_en=?,
          featured_products_mode=?, featured_vendor_ids_json=?, bestsellers_boost_enabled=?,
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
          featured_products_mode,
          featured_vendor_ids_json,
          bestsellers_boost_enabled,
        ]
      );
      return res.json(await getVendorPlatformSettings());
    } catch (_e) {
      return res.status(500).json({ error: "Failed to save settings" });
    }
  });

  app.post("/api/vendor-subscription-requests", async (req, res) => {
    try {
      const b = req.body || {};
      const full_name = b.full_name != null ? String(b.full_name).trim().slice(0, 200) : "";
      const phone = b.phone != null ? String(b.phone).trim().slice(0, 40) : "";
      const company_name = b.company_name != null ? String(b.company_name).trim().slice(0, 200) : "";
      const email = b.email != null ? String(b.email).trim().slice(0, 200) : "";
      const id_document = b.id_document != null ? String(b.id_document).trim().slice(0, 500) : "";
      const terms_accepted = Number(b.terms_accepted) === 1 ? 1 : 0;
      if (!full_name || !phone || !company_name || !email || !id_document) {
        return res.status(400).json({ error: "All fields are required" });
      }
      if (!terms_accepted) {
        return res.status(400).json({ error: "You must accept the terms" });
      }
      const ins = await run(
        `INSERT INTO vendor_subscription_requests (full_name, phone, company_name, email, id_document, terms_accepted, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [full_name, phone, company_name, email, id_document, terms_accepted]
      );
      return res.status(201).json({ ok: true, id: ins.id });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to submit request" });
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
      return res.json(await get(`SELECT * FROM vendor_subscription_requests WHERE id=?`, [id]));
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

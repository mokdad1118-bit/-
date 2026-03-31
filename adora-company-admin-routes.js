/**
 * لوحة الإدارة — قسم «إضافة شركة»: إنشاء شركة كاملة، إدارة الشركات، الطلبات الفرعية، طلبات الإعلان
 */
const bcrypt = require("bcryptjs");
const { get, all, run } = require("./db");
const {
  allocateNextPublicVendorCode,
  setVendorFulfillmentStatus,
  VENDOR_FULFILLMENT_STATUSES,
  VENDOR_STATUS_LABEL_AR,
  deleteMarketplaceVendorCompletely,
} = require("./adora-mv-core");

function subscriptionHealth(subEnds) {
  if (!subEnds) return { key: "unknown", color: "gray" };
  const t = new Date(subEnds).getTime();
  if (Number.isNaN(t)) return { key: "unknown", color: "gray" };
  const now = Date.now();
  if (t < now) return { key: "expired", color: "red" };
  const days = (t - now) / (86400 * 1000);
  if (days <= 14) return { key: "soon", color: "yellow" };
  return { key: "active", color: "green" };
}

function registerAdoraCompanyAdminRoutes(app, { requireAuth, requireAdmin, notifyUserInApp }) {
  const nfy = (userId, title, message, link) => {
    if (typeof notifyUserInApp === "function") notifyUserInApp(userId, title, message, link);
  };

  /** إنشاء شركة + حساب بوابة + اشتراك + حصة منتجات */
  app.post("/api/admin/adora-companies", requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const section_id = Number(b.section_id);
      if (!Number.isFinite(section_id)) return res.status(400).json({ error: "section_id required" });
      const sec = await get(`SELECT id FROM marketplace_sections WHERE id=?`, [section_id]);
      if (!sec) return res.status(404).json({ error: "Section not found" });

      const name_ar = b.company_name_ar != null ? String(b.company_name_ar).trim() : "";
      const name_en = b.company_name_en != null ? String(b.company_name_en).trim() : "";
      if (!name_ar || !name_en) return res.status(400).json({ error: "company_name_ar, company_name_en required" });

      const owner_name = b.owner_name != null ? String(b.owner_name).trim() : "";
      const portal_username = b.portal_username != null ? String(b.portal_username).trim().toLowerCase() : "";
      const portal_password = b.portal_password != null ? String(b.portal_password) : "";
      if (!owner_name) return res.status(400).json({ error: "owner_name required" });
      if (!portal_username || portal_username.length < 2) return res.status(400).json({ error: "portal_username required" });
      if (!portal_password || portal_password.length < 6) return res.status(400).json({ error: "portal_password min 6 chars" });

      const dupU = await get(`SELECT id FROM marketplace_vendors WHERE LOWER(TRIM(portal_username))=?`, [portal_username]);
      if (dupU) return res.status(409).json({ error: "Username already used" });

      const product_quota = Math.max(1, Math.floor(Number(b.product_quota) || 20));
      const months = Math.max(1, Math.floor(Number(b.subscription_months) || 1));
      const ends = new Date();
      ends.setMonth(ends.getMonth() + months);

      const public_vendor_code = await allocateNextPublicVendorCode();
      const hash = await bcrypt.hash(portal_password, 10);

      const ins = await run(
        `INSERT INTO marketplace_vendors (
          section_id, name_ar, name_en, vendor_type, logo_url, cover_image_url, sort_order, is_active,
          paid_product_slots, is_premium, premium_until, premium_subscription_type, search_priority,
          public_vendor_code, owner_name, portal_username, portal_password_hash, must_change_portal_password,
          product_quota, subscription_ends_at
        ) VALUES (?, ?, ?, 'company', NULL, NULL, 999, 1, 0, 0, NULL, 'none', 0,
          ?, ?, ?, ?, 1, ?, ?::timestamptz)`,
        [section_id, name_ar, name_en, public_vendor_code, owner_name, portal_username, hash, product_quota, ends.toISOString()]
      );

      const vid = ins.id;
      const depIns = await run(
        `INSERT INTO marketplace_vendor_departments (vendor_id, name_ar, name_en, sort_order, is_active) VALUES (?, 'رئيسي', 'Main', 0, 1)`,
        [vid]
      );

      const row = await get(`SELECT * FROM marketplace_vendors WHERE id=?`, [vid]);
      return res.status(201).json({ vendor: row, default_department_id: depIns.id });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to create company" });
    }
  });

  app.get("/api/admin/adora-companies", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const rows = await all(
        `SELECT mv.*,
          (SELECT COUNT(*)::int FROM marketplace_products mp WHERE mp.vendor_id = mv.id AND mp.is_active = 1) AS active_products_count
         FROM marketplace_vendors mv
         ORDER BY mv.id DESC`
      );
      const out = rows.map((r) => {
        const h = subscriptionHealth(r.subscription_ends_at);
        const pq = Math.max(0, Number(r.product_quota || 0)) + Math.max(0, Number(r.paid_product_slots || 0));
        const n = Number(r.active_products_count || 0);
        return {
          ...r,
          subscription_health: h,
          product_quota_display: `${n} / ${pq || "—"}`,
        };
      });
      return res.json(out);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.put("/api/admin/adora-companies/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await get(`SELECT * FROM marketplace_vendors WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      const name_ar =
        b.company_name_ar != null ? String(b.company_name_ar).trim() : String(cur.name_ar || "").trim();
      const name_en =
        b.company_name_en != null ? String(b.company_name_en).trim() : String(cur.name_en || "").trim();
      if (!name_ar || !name_en) return res.status(400).json({ error: "company_name_ar, company_name_en required" });
      const product_quota =
        b.product_quota != null ? Math.max(1, Math.floor(Number(b.product_quota))) : cur.product_quota;
      const owner_name = b.owner_name != null ? String(b.owner_name).trim() : cur.owner_name;
      let subscription_ends_at = cur.subscription_ends_at;
      if (Object.prototype.hasOwnProperty.call(b, "subscription_ends_at")) {
        const s = b.subscription_ends_at;
        if (s == null || (typeof s === "string" && !String(s).trim())) {
          subscription_ends_at = null;
        } else {
          subscription_ends_at = String(s).trim();
        }
      }
      let portal_username = cur.portal_username;
      if (b.portal_username != null && String(b.portal_username).trim()) {
        const nu = String(b.portal_username).trim().toLowerCase();
        if (nu.length < 2) return res.status(400).json({ error: "portal_username too short" });
        const curLower = String(cur.portal_username || "")
          .trim()
          .toLowerCase();
        if (nu !== curLower) {
          const dup = await get(
            `SELECT id FROM marketplace_vendors WHERE LOWER(TRIM(portal_username))=? AND id <> ?`,
            [nu, id]
          );
          if (dup) return res.status(409).json({ error: "Username already used" });
        }
        portal_username = nu;
      }
      await run(
        `UPDATE marketplace_vendors SET name_ar=?, name_en=?, product_quota=?, owner_name=?, subscription_ends_at=?::timestamptz, portal_username=? WHERE id=?`,
        [name_ar, name_en, product_quota, owner_name, subscription_ends_at || null, portal_username || null, id]
      );
      if (b.portal_password != null && String(b.portal_password).length >= 6) {
        const hash = await bcrypt.hash(String(b.portal_password), 10);
        await run(`UPDATE marketplace_vendors SET portal_password_hash=?, must_change_portal_password=1 WHERE id=?`, [
          hash,
          id,
        ]);
      }
      return res.json(await get(`SELECT * FROM marketplace_vendors WHERE id=?`, [id]));
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.delete("/api/admin/adora-companies/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const result = await deleteMarketplaceVendorCompletely(Number(req.params.id));
      if (!result.ok) {
        return res.status(404).json({ error: result.error || "Not found" });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to delete company" });
    }
  });

  app.get("/api/admin/order-vendor-fulfillments", requireAuth, requireAdmin, async (req, res) => {
    try {
      const mode = String(req.query.mode || "all").trim();
      const vendorId = req.query.vendor_id != null ? Number(req.query.vendor_id) : null;
      const status = req.query.status != null ? String(req.query.status).trim() : "";
      const orderNo = req.query.order_no != null ? String(req.query.order_no).trim() : "";
      const from = req.query.from != null ? String(req.query.from).trim() : "";
      const to = req.query.to != null ? String(req.query.to).trim() : "";

      let sql = `SELECT f.*, o.order_no, o.user_id, o.created_at AS order_created_at,
        mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en, mv.public_vendor_code,
        u.name AS customer_name
        FROM order_vendor_fulfillments f
        INNER JOIN orders o ON o.id = f.order_id
        INNER JOIN marketplace_vendors mv ON mv.id = f.vendor_id
        LEFT JOIN users u ON u.id = o.user_id
        WHERE 1=1`;
      const params = [];
      if (Number.isFinite(vendorId) && vendorId > 0) {
        sql += ` AND f.vendor_id = ?`;
        params.push(vendorId);
      }
      if (status && VENDOR_FULFILLMENT_STATUSES.includes(status)) {
        sql += ` AND f.status = ?`;
        params.push(status);
      }
      if (orderNo) {
        sql += ` AND o.order_no ILIKE ?`;
        params.push(`%${orderNo}%`);
      }
      const mpPid = req.query.marketplace_product_id != null ? Number(req.query.marketplace_product_id) : null;
      const productCode = req.query.product_code != null ? String(req.query.product_code).trim() : "";
      if (Number.isFinite(mpPid) && mpPid > 0) {
        sql += ` AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.vendor_fulfillment_id = f.id AND oi.marketplace_product_id = ?)`;
        params.push(mpPid);
      } else if (productCode) {
        sql += ` AND EXISTS (
          SELECT 1 FROM order_items oi
          INNER JOIN marketplace_products mp ON mp.id = oi.marketplace_product_id
          WHERE oi.vendor_fulfillment_id = f.id AND mp.public_product_code ILIKE ?
        )`;
        params.push(`%${productCode}%`);
      }
      if (from) {
        sql += ` AND f.created_at >= ?::timestamptz`;
        params.push(from);
      }
      if (to) {
        sql += ` AND f.created_at <= ?::timestamptz`;
        params.push(to);
      }
      sql += ` ORDER BY f.id DESC LIMIT 500`;

      let rows = await all(sql, params);
      if (mode === "multi") {
        const counts = await all(
          `SELECT order_id, COUNT(*)::int AS c FROM order_vendor_fulfillments GROUP BY order_id HAVING COUNT(*) > 1`
        );
        const set = new Set(counts.map((c) => Number(c.order_id)));
        rows = rows.filter((r) => set.has(Number(r.order_id)));
      } else if (mode === "single") {
        const counts = await all(
          `SELECT order_id, COUNT(*)::int AS c FROM order_vendor_fulfillments GROUP BY order_id HAVING COUNT(*) = 1`
        );
        const set = new Set(counts.map((c) => Number(c.order_id)));
        rows = rows.filter((r) => set.has(Number(r.order_id)));
      }
      return res.json(
        rows.map((r) => ({
          ...r,
          status_label_ar: VENDOR_STATUS_LABEL_AR[r.status] || r.status,
        }))
      );
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.put("/api/admin/order-vendor-fulfillments/:id/status", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const st = req.body?.status != null ? String(req.body.status).trim() : "";
      const r = await setVendorFulfillmentStatus(id, st, {
        notifyUserInApp: nfy,
        statusChangedBy: "admin",
      });
      if (!r.ok) return res.status(400).json({ error: r.error });
      return res.json(r);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/admin/vendor-ad-requests", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const rows = await all(
        `SELECT r.*, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en, mv.public_vendor_code
         FROM vendor_ad_requests r
         INNER JOIN marketplace_vendors mv ON mv.id = r.vendor_id
         ORDER BY r.id DESC LIMIT 300`
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.put("/api/admin/vendor-ad-requests/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await get(`SELECT * FROM vendor_ad_requests WHERE id=?`, [id]);
      if (!cur) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};
      const payment_status = ["unpaid", "paid"].includes(String(b.payment_status)) ? b.payment_status : cur.payment_status;
      const lifecycle_status = ["pending", "active", "expired", "rejected"].includes(String(b.lifecycle_status))
        ? b.lifecycle_status
        : cur.lifecycle_status;
      const admin_note = b.admin_note != null ? String(b.admin_note).trim().slice(0, 2000) : cur.admin_note;
      const starts_at = b.starts_at != null && String(b.starts_at).trim() ? String(b.starts_at).trim() : cur.starts_at;
      const ends_at = b.ends_at != null && String(b.ends_at).trim() ? String(b.ends_at).trim() : cur.ends_at;
      await run(
        `UPDATE vendor_ad_requests SET payment_status=?, lifecycle_status=?, admin_note=?, starts_at=?::timestamptz, ends_at=?::timestamptz, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [payment_status, lifecycle_status, admin_note || null, starts_at || null, ends_at || null, id]
      );
      return res.json(await get(`SELECT * FROM vendor_ad_requests WHERE id=?`, [id]));
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });
}

module.exports = { registerAdoraCompanyAdminRoutes };

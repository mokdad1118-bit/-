/**
 * بوابة الشركة (بائع السوق الشامل): تسجيل دخول، طلبات فرعية، طلبات إعلان، منتجات مبسطة
 */
const bcrypt = require("bcryptjs");
const { get, all, run } = require("./db");
const { signMpVendorToken, requireMpVendorAuth } = require("./auth");
const {
  allocateNextPublicProductCode,
  setVendorFulfillmentStatus,
  VENDOR_FULFILLMENT_STATUSES,
  VENDOR_STATUS_LABEL_AR,
} = require("./adora-mv-core");
const { getVendorPlatformSettings } = require("./vendor-platform-settings");
const {
  assertMarketplaceProductQuota,
  resolveDepartmentIdForProduct,
  clampDiscountPercent,
  normalizeMpVariantsForSave,
  getMarketplaceProductMappedAdminById,
} = require("./marketplace-routes");

const REQUEST_TYPES = ["general_ad", "featured_product", "search_boost", "home_featured"];

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function registerVendorPortalRoutes(app, { notifyUserInApp }) {
  const nfy = (userId, title, message, link) => {
    if (typeof notifyUserInApp === "function") notifyUserInApp(userId, title, message, link);
  };

  app.post("/api/vendor-portal/login", async (req, res) => {
    try {
      const username = req.body?.username != null ? String(req.body.username).trim().toLowerCase() : "";
      const password = req.body?.password != null ? String(req.body.password) : "";
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
      const v = await get(
        `SELECT id, name_ar, name_en, portal_password_hash, must_change_portal_password, is_active, public_vendor_code
         FROM marketplace_vendors WHERE LOWER(TRIM(portal_username)) = ?`,
        [username]
      );
      if (!v || Number(v.is_active) !== 1) return res.status(401).json({ error: "Invalid credentials" });
      const hash = v.portal_password_hash != null ? String(v.portal_password_hash) : "";
      if (!hash || !(await bcrypt.compare(password, hash))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const must = Number(v.must_change_portal_password) === 1;
      const token = signMpVendorToken(v.id, must);
      return res.json({
        token,
        must_change_password: must,
        vendor: {
          id: v.id,
          name_ar: v.name_ar,
          name_en: v.name_en,
          public_vendor_code: v.public_vendor_code,
        },
      });
    } catch (_e) {
      return res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/vendor-portal/change-password", requireMpVendorAuth, async (req, res) => {
    try {
      const cur = req.body?.current_password != null ? String(req.body.current_password) : "";
      const nw = req.body?.new_password != null ? String(req.body.new_password) : "";
      if (!nw || nw.length < 6) return res.status(400).json({ error: "New password min 6 characters" });
      const v = await get(
        `SELECT id, portal_password_hash, must_change_portal_password FROM marketplace_vendors WHERE id=?`,
        [req.mpVendor.id]
      );
      if (!v) return res.status(404).json({ error: "Not found" });
      const hash = v.portal_password_hash != null ? String(v.portal_password_hash) : "";
      if (hash && !(await bcrypt.compare(cur, hash))) {
        return res.status(400).json({ error: "Current password incorrect" });
      }
      const newHash = await bcrypt.hash(nw, 10);
      await run(`UPDATE marketplace_vendors SET portal_password_hash=?, must_change_portal_password=0 WHERE id=?`, [
        newHash,
        v.id,
      ]);
      const token = signMpVendorToken(v.id, false);
      return res.json({ ok: true, token });
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/vendor-portal/me", requireMpVendorAuth, async (req, res) => {
    try {
      const v = await get(
        `SELECT id, name_ar, name_en, public_vendor_code, owner_name, product_quota, paid_product_slots, subscription_ends_at, portal_username
         FROM marketplace_vendors WHERE id=?`,
        [req.mpVendor.id]
      );
      if (!v) return res.status(404).json({ error: "Not found" });
      const c = await get(
        `SELECT COUNT(*)::int AS n FROM marketplace_products WHERE vendor_id=? AND is_active=1`,
        [v.id]
      );
      const n = Number(c?.n || 0);
      const quota = Math.max(0, Number(v.product_quota || 0)) + Math.max(0, Number(v.paid_product_slots || 0));
      return res.json({
        vendor: v,
        active_products: n,
        product_quota_display: `${n} / ${quota || "—"}`,
        must_change_password: req.mpVendor.mustChangePassword,
      });
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/vendor-portal/fulfillments", requireMpVendorAuth, async (req, res) => {
    try {
      const vid = req.mpVendor.id;
      const rows = await all(
        `SELECT f.id, f.order_id, f.status, f.subtotal, f.created_at, f.updated_at, o.order_no, o.created_at AS order_created_at,
                mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en
         FROM order_vendor_fulfillments f
         INNER JOIN orders o ON o.id = f.order_id
         INNER JOIN marketplace_vendors mv ON mv.id = f.vendor_id
         WHERE f.vendor_id = ?
         ORDER BY f.id DESC
         LIMIT 200`,
        [vid]
      );
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

  app.get("/api/vendor-portal/fulfillments/:id", requireMpVendorAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const f = await get(
        `SELECT f.*, o.order_no, o.user_id, o.shipping_address, o.shipping_address_json, o.created_at AS order_created_at
         FROM order_vendor_fulfillments f
         INNER JOIN orders o ON o.id = f.order_id
         WHERE f.id=? AND f.vendor_id=?`,
        [id, req.mpVendor.id]
      );
      if (!f) return res.status(404).json({ error: "Not found" });
      const u = await get(`SELECT id, name, phone, email FROM users WHERE id=?`, [f.user_id]);
      const items = await all(
        `SELECT id, product_name, qty, price, image_url, marketplace_product_id, variant_label
         FROM order_items WHERE vendor_fulfillment_id=? ORDER BY id ASC`,
        [id]
      );
      const hist = await all(
        `SELECT status, created_at FROM order_vendor_fulfillment_status_history WHERE fulfillment_id=? ORDER BY id ASC`,
        [id]
      );
      let ship = null;
      try {
        ship = f.shipping_address_json ? JSON.parse(f.shipping_address_json) : null;
      } catch (_e) {
        ship = null;
      }
      return res.json({
        fulfillment: f,
        customer: u,
        shipping_structured: ship,
        items,
        history: hist,
        allowed_statuses: VENDOR_FULFILLMENT_STATUSES,
        status_labels_ar: VENDOR_STATUS_LABEL_AR,
      });
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.put("/api/vendor-portal/fulfillments/:id/status", requireMpVendorAuth, async (req, res) => {
    try {
      if (req.mpVendor.mustChangePassword) {
        return res.status(403).json({ error: "Change password first", must_change_password: true });
      }
      const id = Number(req.params.id);
      const st = req.body?.status != null ? String(req.body.status).trim() : "";
      const f = await get(`SELECT id, vendor_id FROM order_vendor_fulfillments WHERE id=?`, [id]);
      if (!f || Number(f.vendor_id) !== Number(req.mpVendor.id)) return res.status(404).json({ error: "Not found" });
      const r = await setVendorFulfillmentStatus(id, st, { notifyUserInApp: nfy });
      if (!r.ok) return res.status(400).json({ error: r.error || "Invalid status" });
      return res.json(r);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/vendor-portal/products", requireMpVendorAuth, async (req, res) => {
    try {
      if (req.mpVendor.mustChangePassword) {
        return res.status(403).json({ error: "Change password first", must_change_password: true });
      }
      const b = req.body || {};
      const v = await get(`SELECT section_id, id FROM marketplace_vendors WHERE id=?`, [req.mpVendor.id]);
      if (!v) return res.status(404).json({ error: "Vendor not found" });
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : "";
      const name_en = b.name_en != null ? String(b.name_en).trim() : "";
      if (!name_ar || !name_en) return res.status(400).json({ error: "name_ar, name_en required" });
      const description_ar = b.description_ar != null ? String(b.description_ar).trim() : "";
      const description_en = b.description_en != null ? String(b.description_en).trim() : "";
      const price = Number(b.price);
      const { optArr, invArr, stockNum } = normalizeMpVariantsForSave({
        product_options: b.product_options,
        inventory: b.inventory,
        stock: b.stock,
      });
      let images = b.images;
      if (!Array.isArray(images)) images = [];
      images = images.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 12);
      const settings = await getVendorPlatformSettings();
      const is_active = Number(b.is_active) === 0 ? 0 : 1;
      const quota = await assertMarketplaceProductQuota(v.id, settings, is_active === 1);
      if (!quota.ok) return res.status(400).json({ error: quota.error });
      const depRes = await resolveDepartmentIdForProduct(v.id, b.department_id);
      if (!depRes.ok) return res.status(400).json({ error: depRes.error });
      const discount_percent = clampDiscountPercent(b.discount_percent);
      const public_product_code = await allocateNextPublicProductCode();
      const ins = await run(
        `INSERT INTO marketplace_products (
          section_id, vendor_id, department_id, name_ar, name_en, description_ar, description_en, price, discount_percent, stock,
          images_json, inventory_json, product_options_json, is_offer, sort_order, is_active, sku, barcode, public_product_code,
          is_mp_featured, featured_hub_enabled, featured_hub_section, show_in_offers_tab, show_in_marketplace_tab
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 999, ?, NULL, NULL, ?, 0, 0, NULL, 0, 1)`,
        [
          v.section_id,
          v.id,
          depRes.department_id,
          name_ar,
          name_en,
          description_ar,
          description_en,
          Number.isFinite(price) ? price : 0,
          discount_percent,
          stockNum,
          JSON.stringify(images),
          JSON.stringify(invArr),
          JSON.stringify(optArr),
          is_active,
          public_product_code,
        ]
      );
      const mapped = await getMarketplaceProductMappedAdminById(ins.id);
      return res.status(201).json(mapped);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to create product" });
    }
  });

  app.get("/api/vendor-portal/products", requireMpVendorAuth, async (req, res) => {
    try {
      const rows = await all(
        `SELECT mp.id, mp.public_product_code, mp.name_ar, mp.name_en, mp.price, mp.stock, mp.is_active,
                mp.featured_hub_enabled, mp.show_in_offers_tab, mp.show_in_marketplace_tab, mp.created_at
         FROM marketplace_products mp WHERE mp.vendor_id=? ORDER BY mp.id DESC LIMIT 300`,
        [req.mpVendor.id]
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/vendor-portal/ad-requests", requireMpVendorAuth, async (req, res) => {
    try {
      const t = req.body?.request_type != null ? String(req.body.request_type).trim() : "";
      if (!REQUEST_TYPES.includes(t)) return res.status(400).json({ error: "Invalid request_type" });
      const notes = req.body?.notes != null ? String(req.body.notes).trim().slice(0, 2000) : "";
      const ins = await run(
        `INSERT INTO vendor_ad_requests (vendor_id, request_type, notes, payment_status, lifecycle_status) VALUES (?, ?, ?, 'unpaid', 'pending')`,
        [req.mpVendor.id, t, notes || null]
      );
      const row = await get(`SELECT * FROM vendor_ad_requests WHERE id=?`, [ins.id]);
      return res.status(201).json(row);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/vendor-portal/ad-requests", requireMpVendorAuth, async (req, res) => {
    try {
      const rows = await all(`SELECT * FROM vendor_ad_requests WHERE vendor_id=? ORDER BY id DESC LIMIT 100`, [
        req.mpVendor.id,
      ]);
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });
}

module.exports = { registerVendorPortalRoutes, REQUEST_TYPES };

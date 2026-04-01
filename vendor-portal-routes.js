/**
 * بوابة شركاء Adora (بائع السوق الشامل): تسجيل دخول، طلبات فرعية، طلبات إعلان، منتجات
 */
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { get, all, run } = require("./db");
const { signMpVendorToken, requireMpVendorAuth } = require("./auth");
const {
  allocateNextPublicProductCode,
  setVendorFulfillmentStatus,
  VENDOR_FULFILLMENT_STATUSES,
  VENDOR_STATUS_LABEL_AR,
  VENDOR_PORTAL_CUSTOMER_FACING_AR,
} = require("./adora-mv-core");
const { getVendorPlatformSettings } = require("./vendor-platform-settings");
const {
  assertMarketplaceProductQuota,
  resolveDepartmentIdForProduct,
  clampDiscountPercent,
  normalizeMpVariantsForSave,
  getMarketplaceProductMappedAdminById,
  findMarketplaceProductDuplicate,
} = require("./marketplace-routes");
const { isWebPushConfigured } = require("./push-notify");

const REQUEST_TYPES = ["general_ad", "featured_product", "search_boost", "home_featured"];

/** سعر المنتج فوق هذا المبلغ يتطلب اعتماد إداري للظهور في التطبيق؛ مساوٍ أو أقل يُنشر تلقائياً */
const MP_VENDOR_LISTING_APPROVAL_PRICE_ABOVE = 500000;

function vendorPortalListingStatusOnCreate(price) {
  const p = Number(price);
  const n = Number.isFinite(p) ? p : 0;
  return n > MP_VENDOR_LISTING_APPROVAL_PRICE_ABOVE ? "pending" : "published";
}

/** بعد تعديل البائع: ≤ الحد يُنشر مباشرة؛ فوق الحد يبقى منشوراً إن كان كذلك والسعر لم يتغيّر، وإلا قيد المراجعة */
function vendorPortalListingStatusOnVendorUpdate(cur, finalPrice) {
  const p = Number(finalPrice);
  const n = Number.isFinite(p) ? p : 0;
  if (n <= MP_VENDOR_LISTING_APPROVAL_PRICE_ABOVE) return "published";

  const curListing = String(cur.vendor_listing_status || "published").toLowerCase();
  const prev = Number(cur.price);
  const prevOk = Number.isFinite(prev) ? prev : null;

  if (curListing === "published" && prevOk != null && prevOk === n) {
    return "published";
  }
  return "pending";
}

/** حد أقصى 3 صور لكل منتج من البوابة؛ حجم كل صورة يُضبط بالبيئة (افتراضي 1 ميجابايت) */
const VENDOR_PORTAL_MAX_PRODUCT_IMAGES = 3;
const VENDOR_PORTAL_MAX_IMAGE_BYTES = Math.min(
  10 * 1024 * 1024,
  Math.max(1024, Number(process.env.VENDOR_PORTAL_MAX_IMAGE_BYTES) || 1024 * 1024)
);

function createVendorPortalImageUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: VENDOR_PORTAL_MAX_IMAGE_BYTES },
  });
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function registerVendorPortalRoutes(app, { notifyUserInApp, savePublicImageFromBuffer }) {
  const pushCustomerNotify = (userId, title, message, link) => {
    if (typeof notifyUserInApp === "function") notifyUserInApp(userId, title, message, link);
  };
  const vendorImageUpload = createVendorPortalImageUpload();

  async function requireVendorPortalActive(req, res, next) {
    try {
      const id = req.mpVendor?.id;
      if (!id) return res.status(401).json({ error: "Unauthorized" });
      const v = await get(
        `SELECT COALESCE(portal_suspended,0)::int AS portal_suspended, COALESCE(is_active,0)::int AS is_active
         FROM marketplace_vendors WHERE id=?`,
        [id]
      );
      if (!v || Number(v.is_active) !== 1) {
        return res.status(403).json({
          error: "هذه الشركة غير مفعّلة في المنصة.",
          code: "VENDOR_INACTIVE",
        });
      }
      if (Number(v.portal_suspended) === 1) {
        return res.status(403).json({
          error: "تم إيقاف لوحة التحكم مؤقتاً. يُرجى مراجعة إدارة المنصة.",
          code: "PORTAL_SUSPENDED",
        });
      }
      next();
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  }

  const vpGuarded = [requireMpVendorAuth, requireVendorPortalActive];

  app.post("/api/vendor-portal/login", async (req, res) => {
    try {
      const username = req.body?.username != null ? String(req.body.username).trim().toLowerCase() : "";
      const password = req.body?.password != null ? String(req.body.password) : "";
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
      const v = await get(
        `SELECT id, name_ar, name_en, portal_password_hash, must_change_portal_password, is_active, public_vendor_code,
                COALESCE(portal_suspended,0)::int AS portal_suspended
         FROM marketplace_vendors WHERE LOWER(TRIM(portal_username)) = ?`,
        [username]
      );
      if (!v || Number(v.is_active) !== 1) return res.status(401).json({ error: "Invalid credentials" });
      if (Number(v.portal_suspended) === 1) {
        return res.status(403).json({
          error: "تم إيقاف لوحة التحكم مؤقتاً. يُرجى مراجعة إدارة المنصة.",
          code: "PORTAL_SUSPENDED",
        });
      }
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

  app.post("/api/vendor-portal/change-password", ...vpGuarded, async (req, res) => {
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

  app.get("/api/vendor-portal/me", ...vpGuarded, async (req, res) => {
    try {
      const v = await get(
        `SELECT id, name_ar, name_en, public_vendor_code, owner_name, product_quota, paid_product_slots, subscription_ends_at, portal_username, is_active
         FROM marketplace_vendors WHERE id=?`,
        [req.mpVendor.id]
      );
      if (!v) return res.status(404).json({ error: "Not found" });
      const c = await get(
        `SELECT COUNT(*)::int AS n FROM marketplace_products WHERE vendor_id=? AND is_active=1`,
        [v.id]
      );
      const n = Number(c?.n || 0);
      const paid = Math.max(0, Number(v.paid_product_slots || 0));
      const pq = Math.max(0, Number(v.product_quota || 0));
      const settings = await getVendorPlatformSettings();
      const quotaEnabled = settings && Number(settings.product_quota_enabled) === 1;
      const freeDefault = Math.max(0, Math.floor(Number(settings?.free_products_per_vendor) || 0));
      const free = pq > 0 ? pq : freeDefault;
      const limit = quotaEnabled ? free + paid : null;
      const canAdd = !quotaEnabled || limit == null || n < limit;
      const ord = await get(
        `SELECT COUNT(*)::int AS n FROM order_vendor_fulfillments WHERE vendor_id=?`,
        [v.id]
      );
      const orders_count = Number(ord?.n || 0);
      const remaining_product_slots = limit != null ? Math.max(0, limit - n) : null;
      let account_status = "active";
      let account_status_label_ar = "نشط";
      if (req.mpVendor.mustChangePassword) {
        account_status = "password_change_required";
        account_status_label_ar = "يجب تغيير كلمة المرور";
      } else if (Number(v.is_active) !== 1) {
        account_status = "inactive";
        account_status_label_ar = "الحساب موقوف — تواصل مع الإدارة";
      } else if (v.subscription_ends_at) {
        const end = new Date(v.subscription_ends_at);
        if (!Number.isNaN(end.getTime()) && end.getTime() < Date.now()) {
          account_status = "subscription_expired";
          account_status_label_ar = "انتهى الاشتراك — تواصل مع الإدارة";
        }
      }
      return res.json({
        vendor: v,
        active_products: n,
        product_quota_display: quotaEnabled && limit != null ? `${n} / ${limit}` : String(n),
        product_quota_limit: limit,
        remaining_product_slots,
        orders_count,
        account_status,
        account_status_label_ar,
        can_add_product: canAdd,
        product_form_limits: {
          max_images: VENDOR_PORTAL_MAX_PRODUCT_IMAGES,
          max_image_bytes: VENDOR_PORTAL_MAX_IMAGE_BYTES,
        },
        must_change_password: req.mpVendor.mustChangePassword,
      });
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/vendor-portal/departments", ...vpGuarded, async (req, res) => {
    try {
      const rows = await all(
        `SELECT id, name_ar, name_en, sort_order FROM marketplace_vendor_departments WHERE vendor_id=? AND is_active=1 ORDER BY sort_order ASC, id ASC`,
        [req.mpVendor.id]
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.post(
    "/api/vendor-portal/upload/image",
    ...vpGuarded,
    (req, res, next) => {
      if (req.mpVendor.mustChangePassword) {
        return res.status(403).json({ error: "يجب تغيير كلمة المرور أولاً", must_change_password: true });
      }
      vendorImageUpload.single("file")(req, res, (err) => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              error: `حجم الصورة يتجاوز الحد المسموح (${Math.round(VENDOR_PORTAL_MAX_IMAGE_BYTES / 1024)} كيلوبايت كحد أقصى لكل صورة).`,
            });
          }
          return res.status(400).json({ error: err.message || "فشل الرفع" });
        }
        next();
      });
    },
    async (req, res) => {
      try {
        if (typeof savePublicImageFromBuffer !== "function") {
          return res.status(503).json({ error: "الرفع غير مهيأ على الخادم" });
        }
        if (!req.file) return res.status(400).json({ error: "الملف مطلوب" });
        const url = await savePublicImageFromBuffer(req.file.buffer, req.file.originalname);
        return res.json({ url });
      } catch (e) {
        return res.status(500).json({ error: e.message || "فشل الرفع" });
      }
    }
  );

  app.get("/api/vendor-portal/fulfillments", ...vpGuarded, async (req, res) => {
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

  app.get("/api/vendor-portal/fulfillments/:id", ...vpGuarded, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const f = await get(
        `SELECT f.*, o.order_no, o.user_id, o.shipping_address, o.shipping_address_json, o.created_at AS order_created_at,
                o.payment_method, o.total_price, o.status AS parent_order_status
         FROM order_vendor_fulfillments f
         INNER JOIN orders o ON o.id = f.order_id
         WHERE f.id=? AND f.vendor_id=?`,
        [id, req.mpVendor.id]
      );
      if (!f) return res.status(404).json({ error: "Not found" });
      const u = await get(`SELECT id, name, phone, email FROM users WHERE id=?`, [f.user_id]);
      const items = await all(
        `SELECT id, product_name, qty, price, image_url, marketplace_product_id, variant_label, color, size, brand
         FROM order_items WHERE vendor_fulfillment_id=? ORDER BY id ASC`,
        [id]
      );
      const hist = await all(
        `SELECT status, customer_note, created_at FROM order_vendor_fulfillment_status_history WHERE fulfillment_id=? ORDER BY id ASC`,
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
        portal_status_labels_ar: VENDOR_PORTAL_CUSTOMER_FACING_AR,
      });
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.put("/api/vendor-portal/fulfillments/:id/status", ...vpGuarded, async (req, res) => {
    try {
      if (req.mpVendor.mustChangePassword) {
        return res.status(403).json({ error: "Change password first", must_change_password: true });
      }
      const id = Number(req.params.id);
      const st = req.body?.status != null ? String(req.body.status).trim() : "";
      const f = await get(`SELECT id, vendor_id FROM order_vendor_fulfillments WHERE id=?`, [id]);
      if (!f || Number(f.vendor_id) !== Number(req.mpVendor.id)) return res.status(404).json({ error: "Not found" });
      const notifyOff =
        req.body?.notify_user === false || String(req.body?.notify_user || "").toLowerCase() === "false";
      const wantNotify = !notifyOff;
      const customerNote =
        req.body?.customer_note != null ? String(req.body.customer_note).trim().slice(0, 2000) : "";
      const r = await setVendorFulfillmentStatus(id, st, {
        notifyUserInApp: wantNotify ? pushCustomerNotify : null,
        customerNote: customerNote || undefined,
      });
      if (!r.ok) return res.status(400).json({ error: r.error || "Invalid status" });
      const io = app.get("io");
      const syncRow = await get(
        `SELECT f.order_id, o.user_id, o.order_no, o.status FROM order_vendor_fulfillments f INNER JOIN orders o ON o.id = f.order_id WHERE f.id=?`,
        [id]
      );
      if (io && syncRow?.user_id) {
        io.to(`user:${syncRow.user_id}`).emit("order:updated", {
          orderId: syncRow.order_id,
          status: syncRow.status,
          order_no: syncRow.order_no || null,
        });
      }
      if (io) {
        io.to("admin").emit("mp_fulfillment:updated", {
          fulfillment_id: id,
          order_id: syncRow?.order_id,
          vendor_id: f.vendor_id,
          status: st,
        });
      }
      return res.json(r);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/vendor-portal/notifications", ...vpGuarded, async (req, res) => {
    try {
      const rows = await all(
        `SELECT id, title, message, link_url, is_read, created_at, reply_thread_id
         FROM vendor_portal_notifications WHERE vendor_id=? ORDER BY id DESC LIMIT 100`,
        [req.mpVendor.id]
      );
      const c = await get(
        `SELECT
           (SELECT COUNT(*)::int FROM vendor_portal_notifications WHERE vendor_id=? AND COALESCE(is_read,0)=0) +
           (SELECT COUNT(*)::int FROM vendor_contact_threads WHERE vendor_id=? AND COALESCE(vendor_unread,0)>0)
         AS n`,
        [req.mpVendor.id, req.mpVendor.id]
      );
      return res.json({ items: rows, unread_count: Number(c?.n || 0) });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load notifications" });
    }
  });

  app.put("/api/vendor-portal/notifications/:id/read", ...vpGuarded, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await get(
        `SELECT id FROM vendor_portal_notifications WHERE id=? AND vendor_id=?`,
        [id, req.mpVendor.id]
      );
      if (!row) return res.status(404).json({ error: "Not found" });
      await run(`UPDATE vendor_portal_notifications SET is_read=1 WHERE id=?`, [id]);
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  /** عند فتح قسم الإشعارات: تصفير العداد (إشعارات + محادثات غير مقروءة) */
  app.put("/api/vendor-portal/notifications/read-all", ...vpGuarded, async (req, res) => {
    try {
      await run(`UPDATE vendor_portal_notifications SET is_read=1 WHERE vendor_id=? AND COALESCE(is_read,0)=0`, [
        req.mpVendor.id,
      ]);
      await run(
        `UPDATE vendor_contact_threads SET vendor_unread=0, updated_at=CURRENT_TIMESTAMP WHERE vendor_id=? AND COALESCE(vendor_unread,0)>0`,
        [req.mpVendor.id]
      );
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to mark all read" });
    }
  });

  function emitVendorReplyToAdmin(threadId) {
    try {
      const io = app.get("io");
      if (io) io.to("admin").emit("vendor_contact:updated", { thread_id: threadId, at: Date.now() });
    } catch (_e) {
      /* ignore */
    }
  }

  app.get("/api/vendor-portal/contact/threads", ...vpGuarded, async (req, res) => {
    try {
      const rows = await all(
        `SELECT t.id, t.subject, t.vendor_unread, t.updated_at,
                (SELECT m.body FROM vendor_contact_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body
         FROM vendor_contact_threads t
         WHERE t.vendor_id = ?
         ORDER BY t.updated_at DESC NULLS LAST, t.id DESC
         LIMIT 60`,
        [req.mpVendor.id]
      );
      return res.json({ threads: rows });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load threads" });
    }
  });

  app.get("/api/vendor-portal/contact/threads/:id/messages", ...vpGuarded, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const thread = await get(`SELECT * FROM vendor_contact_threads WHERE id=? AND vendor_id=?`, [id, req.mpVendor.id]);
      if (!thread) return res.status(404).json({ error: "Not found" });
      await run(`UPDATE vendor_contact_threads SET vendor_unread=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [id]);
      const messages = await all(
        `SELECT id, author, body, created_at FROM vendor_contact_messages WHERE thread_id=? ORDER BY id ASC`,
        [id]
      );
      return res.json({ thread, messages });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load messages" });
    }
  });

  app.post("/api/vendor-portal/contact/threads/:id/messages", ...vpGuarded, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = req.body?.message != null ? String(req.body.message).trim() : "";
      if (!body) return res.status(400).json({ error: "message required" });
      if (body.length > 8000) return res.status(400).json({ error: "message too long" });
      const thread = await get(`SELECT * FROM vendor_contact_threads WHERE id=? AND vendor_id=?`, [id, req.mpVendor.id]);
      if (!thread) return res.status(404).json({ error: "Not found" });
      await run(`INSERT INTO vendor_contact_messages (thread_id, author, body) VALUES (?, 'vendor', ?)`, [id, body]);
      await run(
        `UPDATE vendor_contact_threads SET admin_unread = admin_unread + 1, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [id]
      );
      emitVendorReplyToAdmin(id);
      return res.json({ ok: true, thread_id: id });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to send" });
    }
  });

  app.post("/api/vendor-portal/notifications/:nid/reply", ...vpGuarded, async (req, res) => {
    try {
      const nid = Number(req.params.nid);
      const body = req.body?.message != null ? String(req.body.message).trim() : "";
      if (!Number.isFinite(nid)) return res.status(400).json({ error: "Invalid notification" });
      if (!body) return res.status(400).json({ error: "message required" });
      if (body.length > 8000) return res.status(400).json({ error: "message too long" });
      const notif = await get(`SELECT * FROM vendor_portal_notifications WHERE id=? AND vendor_id=?`, [nid, req.mpVendor.id]);
      if (!notif) return res.status(404).json({ error: "Not found" });

      let threadId = notif.reply_thread_id != null ? Number(notif.reply_thread_id) : NaN;
      if (Number.isFinite(threadId) && threadId > 0) {
        const th = await get(`SELECT id FROM vendor_contact_threads WHERE id=? AND vendor_id=?`, [threadId, req.mpVendor.id]);
        if (!th) return res.status(404).json({ error: "Thread not found" });
        await run(`INSERT INTO vendor_contact_messages (thread_id, author, body) VALUES (?, 'vendor', ?)`, [threadId, body]);
        await run(
          `UPDATE vendor_contact_threads SET admin_unread = admin_unread + 1, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
          [threadId]
        );
      } else {
        const insT = await run(
          `INSERT INTO vendor_contact_threads (vendor_id, subject, source_notification_id, admin_unread, vendor_unread)
           VALUES (?, ?, ?, 1, 0)`,
          [req.mpVendor.id, String(notif.title || "رد على إشعار").slice(0, 200), nid]
        );
        threadId = Number(insT.id);
        if (!Number.isFinite(threadId) || threadId <= 0) {
          return res.status(500).json({ error: "Failed to create thread" });
        }
        const snap = `${String(notif.title || "").trim()}\n\n${String(notif.message || "").trim()}`.slice(0, 12000);
        await run(`INSERT INTO vendor_contact_messages (thread_id, author, body) VALUES (?, 'system', ?)`, [threadId, snap]);
        await run(`INSERT INTO vendor_contact_messages (thread_id, author, body) VALUES (?, 'vendor', ?)`, [threadId, body]);
        await run(`UPDATE vendor_contact_threads SET updated_at=CURRENT_TIMESTAMP WHERE id=?`, [threadId]);
        await run(`UPDATE vendor_portal_notifications SET reply_thread_id=? WHERE id=?`, [threadId, nid]);
      }
      emitVendorReplyToAdmin(threadId);
      return res.json({ ok: true, thread_id: threadId });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to reply" });
    }
  });

  app.post("/api/vendor-portal/products", ...vpGuarded, async (req, res) => {
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
      if (images.length > VENDOR_PORTAL_MAX_PRODUCT_IMAGES) {
        return res.status(400).json({
          error: `يمكن إضافة ${VENDOR_PORTAL_MAX_PRODUCT_IMAGES} صور فقط لكل منتج.`,
        });
      }
      images = images.map((u) => String(u || "").trim()).filter(Boolean).slice(0, VENDOR_PORTAL_MAX_PRODUCT_IMAGES);
      const settings = await getVendorPlatformSettings();
      const is_active = Number(b.is_active) === 0 ? 0 : 1;
      const quota = await assertMarketplaceProductQuota(v.id, settings, is_active === 1);
      if (!quota.ok) return res.status(400).json({ error: quota.error });
      const depRes = await resolveDepartmentIdForProduct(v.id, b.department_id);
      if (!depRes.ok) return res.status(400).json({ error: depRes.error });
      const discount_percent = clampDiscountPercent(b.discount_percent);
      const public_product_code = await allocateNextPublicProductCode();
      const priceNum = Number.isFinite(price) ? price : 0;
      const listingOnCreate = vendorPortalListingStatusOnCreate(priceNum);
      const ins = await run(
        `INSERT INTO marketplace_products (
          section_id, vendor_id, department_id, name_ar, name_en, description_ar, description_en, price, discount_percent, stock,
          images_json, inventory_json, product_options_json, is_offer, sort_order, is_active, sku, barcode, public_product_code,
          is_mp_featured, featured_hub_enabled, featured_hub_section, show_in_offers_tab, show_in_marketplace_tab, vendor_listing_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 999, ?, NULL, NULL, ?, 0, 0, NULL, 0, 0, ?)`,
        [
          v.section_id,
          v.id,
          depRes.department_id,
          name_ar,
          name_en,
          description_ar,
          description_en,
          priceNum,
          discount_percent,
          stockNum,
          JSON.stringify(images),
          JSON.stringify(invArr),
          JSON.stringify(optArr),
          is_active,
          public_product_code,
          listingOnCreate,
        ]
      );
      const mapped = await getMarketplaceProductMappedAdminById(ins.id);
      return res.status(201).json(mapped);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to create product" });
    }
  });

  app.get("/api/vendor-portal/products/:id", ...vpGuarded, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const mapped = await getMarketplaceProductMappedAdminById(id);
      if (!mapped || Number(mapped.vendor_id) !== Number(req.mpVendor.id)) {
        return res.status(404).json({ error: "Not found" });
      }
      return res.json(mapped);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.put("/api/vendor-portal/products/:id", ...vpGuarded, async (req, res) => {
    try {
      if (req.mpVendor.mustChangePassword) {
        return res.status(403).json({ error: "Change password first", must_change_password: true });
      }
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const cur = await get(`SELECT * FROM marketplace_products WHERE id=?`, [id]);
      if (!cur || Number(cur.vendor_id) !== Number(req.mpVendor.id)) {
        return res.status(404).json({ error: "Not found" });
      }
      const b = req.body || {};
      const name_ar = b.name_ar != null ? String(b.name_ar).trim() : cur.name_ar;
      const name_en = b.name_en != null ? String(b.name_en).trim() : cur.name_en;
      if (!name_ar || !name_en) return res.status(400).json({ error: "name_ar, name_en required" });
      const description_ar = b.description_ar != null ? String(b.description_ar).trim() : cur.description_ar;
      const description_en = b.description_en != null ? String(b.description_en).trim() : cur.description_en;
      const price = b.price != null ? Number(b.price) : cur.price;
      const { optArr, invArr, stockNum } = normalizeMpVariantsForSave({
        product_options: b.product_options,
        inventory: b.inventory,
        stock: b.stock != null ? b.stock : cur.stock,
      });
      let images = b.images;
      if (images != null) {
        if (!Array.isArray(images)) images = [];
        if (images.length > VENDOR_PORTAL_MAX_PRODUCT_IMAGES) {
          return res.status(400).json({
            error: `يمكن إضافة ${VENDOR_PORTAL_MAX_PRODUCT_IMAGES} صور فقط لكل منتج.`,
          });
        }
        images = images.map((u) => String(u || "").trim()).filter(Boolean).slice(0, VENDOR_PORTAL_MAX_PRODUCT_IMAGES);
      } else {
        try {
          const parsed = JSON.parse(cur.images_json || "[]");
          images = Array.isArray(parsed) ? parsed : [];
        } catch (_e) {
          images = [];
        }
      }
      const settings = await getVendorPlatformSettings();
      const is_active = b.is_active != null ? (Number(b.is_active) === 0 ? 0 : 1) : Number(cur.is_active) === 0 ? 0 : 1;
      const wasInactive = Number(cur.is_active) === 0;
      if (wasInactive && is_active === 1) {
        const quota = await assertMarketplaceProductQuota(req.mpVendor.id, settings, true);
        if (!quota.ok) return res.status(400).json({ error: quota.error });
      }
      const depRes = await resolveDepartmentIdForProduct(req.mpVendor.id, b.department_id !== undefined ? b.department_id : cur.department_id);
      if (!depRes.ok) return res.status(400).json({ error: depRes.error });
      const discount_percent = b.discount_percent !== undefined ? clampDiscountPercent(b.discount_percent) : clampDiscountPercent(cur.discount_percent);
      const dup = await findMarketplaceProductDuplicate(
        req.mpVendor.id,
        {
          name_ar,
          name_en,
          sku: cur.sku,
          barcode: cur.barcode,
        },
        id
      );
      if (dup) {
        return res.status(409).json({
          error: "منتج مكرر لنفس الشركة (نفس الاسم أو SKU أو الباركود).",
        });
      }
      const finalPrice = Number.isFinite(price) ? price : 0;
      const nextListing = vendorPortalListingStatusOnVendorUpdate(cur, finalPrice);

      const hasVariantBody = b.product_options != null || b.inventory != null;
      let invJson;
      let optJson;
      let stockFinal;
      if (hasVariantBody) {
        stockFinal = stockNum;
        invJson = JSON.stringify(invArr);
        optJson = JSON.stringify(optArr);
      } else {
        stockFinal = b.stock != null ? Math.max(0, Math.floor(Number(b.stock) || 0)) : cur.stock;
        invJson = cur.inventory_json != null ? cur.inventory_json : "[]";
        optJson = cur.product_options_json != null ? cur.product_options_json : "[]";
      }
      await run(
        `UPDATE marketplace_products SET name_ar=?, name_en=?, description_ar=?, description_en=?,
         price=?, discount_percent=?, stock=?, images_json=?, inventory_json=?, product_options_json=?,
         department_id=?, is_active=?, vendor_listing_status=? WHERE id=? AND vendor_id=?`,
        [
          name_ar,
          name_en,
          description_ar,
          description_en,
          Number.isFinite(price) ? price : 0,
          discount_percent,
          stockFinal,
          JSON.stringify(images),
          invJson,
          optJson,
          depRes.department_id,
          is_active,
          nextListing,
          id,
          req.mpVendor.id,
        ]
      );
      const mapped = await getMarketplaceProductMappedAdminById(id);
      return res.json(mapped);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to update product" });
    }
  });

  app.delete("/api/vendor-portal/products/:id", ...vpGuarded, async (req, res) => {
    try {
      if (req.mpVendor.mustChangePassword) {
        return res.status(403).json({ error: "Change password first", must_change_password: true });
      }
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const cur = await get(`SELECT id, vendor_id FROM marketplace_products WHERE id=?`, [id]);
      if (!cur || Number(cur.vendor_id) !== Number(req.mpVendor.id)) {
        return res.status(404).json({ error: "Not found" });
      }
      const ref = await get(`SELECT 1 AS x FROM order_items WHERE marketplace_product_id=? LIMIT 1`, [id]);
      if (ref) {
        return res.status(409).json({
          error:
            "لا يمكن حذف المنتج لأنه مرتبط بطلبات سابقة. يمكنك إيقاف ظهوره بإلغاء تفعيل «منتج نشط».",
        });
      }
      await run(`DELETE FROM marketplace_products WHERE id=? AND vendor_id=?`, [id, req.mpVendor.id]);
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to delete product" });
    }
  });

  app.get("/api/vendor-portal/products", ...vpGuarded, async (req, res) => {
    try {
      const rows = await all(
        `SELECT mp.id, mp.public_product_code, mp.name_ar, mp.name_en, mp.price, mp.stock, mp.is_active,
                mp.featured_hub_enabled, mp.show_in_offers_tab, mp.show_in_marketplace_tab, mp.created_at,
                COALESCE(mp.vendor_listing_status, 'published') AS vendor_listing_status
         FROM marketplace_products mp WHERE mp.vendor_id=? ORDER BY mp.id DESC LIMIT 300`,
        [req.mpVendor.id]
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/vendor-portal/ad-requests", ...vpGuarded, async (req, res) => {
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

  app.get("/api/vendor-portal/ad-requests", ...vpGuarded, async (req, res) => {
    try {
      const rows = await all(`SELECT * FROM vendor_ad_requests WHERE vendor_id=? ORDER BY id DESC LIMIT 100`, [
        req.mpVendor.id,
      ]);
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/vendor-portal/push/subscribe", ...vpGuarded, async (req, res) => {
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
        `INSERT INTO vendor_push_subscriptions (vendor_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET vendor_id = EXCLUDED.vendor_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
        [req.mpVendor.id, endpoint, p256dh, auth]
      );
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to save subscription" });
    }
  });

  app.post("/api/vendor-portal/push/unsubscribe", ...vpGuarded, async (req, res) => {
    try {
      const endpoint = req.body?.endpoint;
      if (!endpoint || typeof endpoint !== "string") {
        return res.status(400).json({ error: "endpoint required" });
      }
      await run(`DELETE FROM vendor_push_subscriptions WHERE vendor_id=? AND endpoint=?`, [
        req.mpVendor.id,
        String(endpoint).slice(0, 2500),
      ]);
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to remove subscription" });
    }
  });
}

module.exports = { registerVendorPortalRoutes, REQUEST_TYPES };

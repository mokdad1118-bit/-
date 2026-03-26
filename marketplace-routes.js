/**
 * السوق الشامل — أقسام، مولات/شركات، منتجات (عامة + لوحة تحكم)
 */
const { get, all, run } = require("./db");
const { getVendorPlatformSettings } = require("./vendor-platform-settings");

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
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
  const { promo_id: _pid, promo_priority: _pp, promo_slot: _ps, ...rest } = row;
  return {
    ...rest,
    images: safeJsonParse(row.images_json, []),
    is_search_sponsored,
    is_section_featured_promo,
    is_listing_top_promo,
    is_home_featured_promo,
    marketplace_promo_slot: slot && row.promo_id != null ? slot : null,
  };
}

function normLower(s) {
  return String(s ?? "").trim().toLowerCase();
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
      mp.price, mp.stock, mp.images_json, mp.is_offer, mp.sort_order, mp.sales_count, mp.created_at,
      mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
      ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en,
      pr.id AS promo_id, pr.priority AS promo_priority, pr.slot AS promo_slot
     FROM marketplace_product_promotions pr
     INNER JOIN marketplace_products mp ON mp.id = pr.product_id AND mp.is_active = 1
     INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND mv.is_active = 1
     INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
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

async function assertMarketplaceProductQuota(vendorId, settings, willBeActive) {
  if (!willBeActive) return { ok: true };
  if (!settings || Number(settings.product_quota_enabled) !== 1) return { ok: true };
  const v = await get(
    `SELECT COALESCE(paid_product_slots, 0)::int AS paid_product_slots FROM marketplace_vendors WHERE id = ?`,
    [vendorId]
  );
  const paid = Number(v?.paid_product_slots || 0);
  const free = Math.max(0, Math.floor(Number(settings.free_products_per_vendor) || 0));
  const limit = free + paid;
  const c = await get(
    `SELECT COUNT(*)::int AS n FROM marketplace_products WHERE vendor_id = ? AND is_active = 1`,
    [vendorId]
  );
  const n = Number(c?.n || 0);
  if (n >= limit) {
    return {
      ok: false,
      error: `لنفس الشركة: وصلت لحد المنتجات النشطة (${limit}). زِد «حصص المنتجات المدفوعة» في المول/الشركة أو عطّل نظام الحصص من إعدادات المنصة.`,
    };
  }
  return { ok: true };
}

function registerMarketplaceRoutes(app, { requireAuth, requireAdmin }) {
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
                        COALESCE(premium_subscription_type, 'none') AS premium_subscription_type
                 FROM marketplace_vendors WHERE is_active = 1`;
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
                        mp.price, mp.stock, mp.images_json, mp.is_offer, mp.sort_order, mp.sales_count, mp.created_at,
                        mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
                        ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en
                        ${promoSelect}
                 FROM marketplace_products mp
                 INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND mv.is_active = 1
                 INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
                 ${promoJoin}
                 WHERE mp.is_active = 1`;
      const params = [];
      if (promoSlot) params.push(promoSlot);

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
        const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
        sql += ` AND (
          mp.name_ar ILIKE ? OR mp.name_en ILIKE ?
          OR mv.name_ar ILIKE ? OR mv.name_en ILIKE ?
          OR ms.name_ar ILIKE ? OR ms.name_en ILIKE ?
        )`;
        params.push(like, like, like, like, like, like);
      }

      let orderBody = "mp.created_at DESC, mp.id DESC";
      if (sort === "price_asc") orderBody = "mp.price ASC, mp.id ASC";
      else if (sort === "price_desc") orderBody = "mp.price DESC, mp.id DESC";
      else if (sort === "bestsellers") orderBody = "mp.sales_count DESC, mp.created_at DESC";

      const orderSql = promoSlot
        ? `(CASE WHEN pr.id IS NOT NULL THEN 0 ELSE 1 END) ASC, pr.priority DESC NULLS LAST, ${orderBody}`
        : orderBody;
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

  app.get("/api/marketplace/products/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const row = await get(
        `SELECT mp.*, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
                ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en
         FROM marketplace_products mp
         INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id
         INNER JOIN marketplace_sections ms ON ms.id = mp.section_id
         WHERE mp.id = ? AND mp.is_active = 1 AND mv.is_active = 1 AND ms.is_active = 1`,
        [id]
      );
      if (!row) return res.status(404).json({ error: "Not found" });
      return res.json(mapProductRow(row));
    } catch (err) {
      return res.status(500).json({ error: "Failed to load product" });
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
        mp.price, mp.stock, mp.images_json, mp.is_offer, mp.sort_order, mp.sales_count, mp.created_at,
        mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
        ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en
        FROM marketplace_products mp
        INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND mv.is_active = 1
        INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
        WHERE mp.is_active = 1`;

      let promotedHome = [];
      if (adsOn) {
        promotedHome = await fetchMarketplaceProductsByPromotionSlot("home_featured", 12);
        await bumpPromotionImpressionsForRows(promotedHome);
      }

      let featuredBase = [];
      if (mode === "manual") {
        featuredBase = await all(`${baseSelect} AND COALESCE(mp.is_mp_featured,0) = 1 ORDER BY mp.sort_order ASC, mp.id DESC LIMIT 12`, []);
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
        bestsellers = await all(`${baseSelect} ORDER BY mp.sales_count DESC, mp.created_at DESC LIMIT 12`, []);
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
      const ins = await run(
        `INSERT INTO marketplace_vendors (section_id, name_ar, name_en, vendor_type, logo_url, cover_image_url, sort_order, is_active,
          paid_product_slots, is_premium, premium_until, premium_subscription_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?)`,
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
      await run(
        `UPDATE marketplace_vendors SET section_id=?, name_ar=?, name_en=?, vendor_type=?, logo_url=?, cover_image_url=?, sort_order=?, is_active=?,
         paid_product_slots=?, is_premium=?, premium_until=?::timestamptz, premium_subscription_type=?
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
          id,
        ]
      );
      return res.json(await get(`SELECT * FROM marketplace_vendors WHERE id=?`, [id]));
    } catch (err) {
      return res.status(500).json({ error: "Failed to update vendor" });
    }
  });

  app.delete("/api/admin/marketplace/vendors/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await run(`DELETE FROM marketplace_vendors WHERE id=?`, [Number(req.params.id)]);
      return res.json({ ok: true });
    } catch (err) {
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

  /* ---------- Admin: products ---------- */
  app.get("/api/admin/marketplace/products", requireAuth, requireAdmin, async (req, res) => {
    try {
      const sid = req.query.section_id != null ? Number(req.query.section_id) : null;
      const vid = req.query.vendor_id != null ? Number(req.query.vendor_id) : null;
      let sql = `SELECT mp.*, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en, ms.slug AS section_slug
                 FROM marketplace_products mp
                 INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id
                 INNER JOIN marketplace_sections ms ON ms.id = mp.section_id
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
      sql += ` ORDER BY mp.section_id, mp.vendor_id, mp.sort_order ASC, mp.id DESC LIMIT 500`;
      const rows = await all(sql, params);
      return res.json(rows.map(mapProductRow));
    } catch (err) {
      return res.status(500).json({ error: "Failed to load products" });
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
      const stock = Math.max(0, Math.floor(Number(b.stock) || 0));
      let images = b.images;
      if (!Array.isArray(images)) images = [];
      images = images.map((u) => String(u || "").trim()).filter(Boolean).slice(0, 12);
      const is_offer = Number(b.is_offer) === 1 ? 1 : 0;
      const sort_order = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999;
      const is_active = Number(b.is_active) === 0 ? 0 : 1;
      const is_mp_featured = Number(b.is_mp_featured) === 1 ? 1 : 0;
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
      const ins = await run(
        `INSERT INTO marketplace_products (section_id, vendor_id, name_ar, name_en, description_ar, description_en, price, stock, images_json, is_offer, sort_order, is_active, sku, barcode, is_mp_featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          section_id,
          vendor_id,
          name_ar,
          name_en,
          description_ar,
          description_en,
          Number.isFinite(price) ? price : 0,
          stock,
          JSON.stringify(images),
          is_offer,
          sort_order,
          is_active,
          sku || null,
          barcodeNorm || null,
          is_mp_featured,
        ]
      );
      return res.status(201).json(mapProductRow(await get(`SELECT * FROM marketplace_products WHERE id=?`, [ins.id])));
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
      const stock = b.stock != null ? Math.max(0, Math.floor(Number(b.stock) || 0)) : cur.stock;
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
        `UPDATE marketplace_products SET section_id=?, vendor_id=?, name_ar=?, name_en=?, description_ar=?, description_en=?,
         price=?, stock=?, images_json=?, is_offer=?, sort_order=?, is_active=?, sku=?, barcode=?, is_mp_featured=? WHERE id=?`,
        [
          section_id,
          vendor_id,
          name_ar,
          name_en,
          description_ar,
          description_en,
          price,
          stock,
          images_json,
          is_offer,
          sort_order,
          is_active,
          sku || null,
          barcode || null,
          is_mp_featured,
          id,
        ]
      );
      return res.json(mapProductRow(await get(`SELECT * FROM marketplace_products WHERE id=?`, [id])));
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
}

module.exports = { registerMarketplaceRoutes };

/**
 * السوق الشامل — أقسام، مولات/شركات، منتجات (عامة + لوحة تحكم)
 */
const { get, all, run } = require("./db");

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function mapProductRow(row) {
  if (!row) return row;
  return {
    ...row,
    images: safeJsonParse(row.images_json, []),
  };
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
      let sql = `SELECT id, section_id, name_ar, name_en, vendor_type, logo_url, cover_image_url, sort_order
                 FROM marketplace_vendors WHERE is_active = 1`;
      const params = [];
      if (sid != null && Number.isFinite(sid)) {
        sql += ` AND section_id = ?`;
        params.push(sid);
      }
      sql += ` ORDER BY sort_order ASC, id ASC`;
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

      let sql = `SELECT mp.id, mp.section_id, mp.vendor_id, mp.name_ar, mp.name_en, mp.description_ar, mp.description_en,
                        mp.price, mp.stock, mp.images_json, mp.is_offer, mp.sort_order, mp.sales_count, mp.created_at,
                        mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en,
                        ms.slug AS section_slug, ms.name_ar AS section_name_ar, ms.name_en AS section_name_en
                 FROM marketplace_products mp
                 INNER JOIN marketplace_vendors mv ON mv.id = mp.vendor_id AND mv.is_active = 1
                 INNER JOIN marketplace_sections ms ON ms.id = mp.section_id AND ms.is_active = 1
                 WHERE mp.is_active = 1`;
      const params = [];

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

      if (sort === "price_asc") sql += ` ORDER BY mp.price ASC, mp.id ASC`;
      else if (sort === "price_desc") sql += ` ORDER BY mp.price DESC, mp.id DESC`;
      else if (sort === "bestsellers") sql += ` ORDER BY mp.sales_count DESC, mp.created_at DESC`;
      else sql += ` ORDER BY mp.created_at DESC, mp.id DESC`;

      sql += ` LIMIT 200`;
      const rows = await all(sql, params);
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
      const ins = await run(
        `INSERT INTO marketplace_vendors (section_id, name_ar, name_en, vendor_type, logo_url, cover_image_url, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [section_id, name_ar, name_en, vendor_type, logo_url || null, cover_image_url || null, sort_order, is_active]
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
      await run(
        `UPDATE marketplace_vendors SET section_id=?, name_ar=?, name_en=?, vendor_type=?, logo_url=?, cover_image_url=?, sort_order=?, is_active=?
         WHERE id=?`,
        [section_id, name_ar, name_en, vendor_type, logo_url, cover_image_url, sort_order, is_active, id]
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
      const ins = await run(
        `INSERT INTO marketplace_products (section_id, vendor_id, name_ar, name_en, description_ar, description_en, price, stock, images_json, is_offer, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      await run(
        `UPDATE marketplace_products SET section_id=?, vendor_id=?, name_ar=?, name_en=?, description_ar=?, description_en=?,
         price=?, stock=?, images_json=?, is_offer=?, sort_order=?, is_active=? WHERE id=?`,
        [section_id, vendor_id, name_ar, name_en, description_ar, description_en, price, stock, images_json, is_offer, sort_order, is_active, id]
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

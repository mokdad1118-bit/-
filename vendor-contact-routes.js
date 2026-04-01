/**
 * تواصل الإدارة مع شركات المشتركين — محادثات ثنائية الاتجاه مرتبطة بإشعارات البوابة
 */
const { get, all, run } = require("./db");

function registerVendorContactAdminRoutes(app, { requireAuth, requireAdmin }) {
  function emitVendorContactToAdmin() {
    try {
      const io = app.get("io");
      if (io) io.to("admin").emit("vendor_contact:updated", { at: Date.now() });
    } catch (_e) {
      /* ignore */
    }
  }

  app.get("/api/admin/vendor-contact/threads", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const rows = await all(
        `SELECT t.id, t.vendor_id, t.subject, t.admin_unread, t.vendor_unread, t.created_at, t.updated_at,
                mv.name_ar, mv.name_en, mv.public_vendor_code,
                (SELECT m.body FROM vendor_contact_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
                (SELECT m.created_at FROM vendor_contact_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message_at
         FROM vendor_contact_threads t
         INNER JOIN marketplace_vendors mv ON mv.id = t.vendor_id
         ORDER BY t.updated_at DESC NULLS LAST, t.id DESC
         LIMIT 400`
      );
      return res.json(rows);
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load threads" });
    }
  });

  app.get("/api/admin/vendor-contact/threads/:id/messages", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const thread = await get(`SELECT * FROM vendor_contact_threads WHERE id=?`, [id]);
      if (!thread) return res.status(404).json({ error: "Not found" });
      await run(`UPDATE vendor_contact_threads SET admin_unread=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [id]);
      const messages = await all(
        `SELECT id, author, body, created_at FROM vendor_contact_messages WHERE thread_id=? ORDER BY id ASC`,
        [id]
      );
      const vendor = await get(
        `SELECT id, name_ar, name_en, public_vendor_code FROM marketplace_vendors WHERE id=?`,
        [thread.vendor_id]
      );
      return res.json({ thread, messages, vendor });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to load messages" });
    }
  });

  app.post("/api/admin/vendor-contact/threads/:id/messages", requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = req.body?.message != null ? String(req.body.message).trim() : "";
      if (!body) return res.status(400).json({ error: "message required" });
      if (body.length > 8000) return res.status(400).json({ error: "message too long" });
      const thread = await get(`SELECT * FROM vendor_contact_threads WHERE id=?`, [id]);
      if (!thread) return res.status(404).json({ error: "Not found" });
      await run(`INSERT INTO vendor_contact_messages (thread_id, author, body) VALUES (?, 'admin', ?)`, [id, body]);
      await run(
        `UPDATE vendor_contact_threads SET vendor_unread = vendor_unread + 1, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [id]
      );
      emitVendorContactToAdmin();
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to send" });
    }
  });

  app.post("/api/admin/vendor-contact/send", requireAuth, requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const title = b.title != null ? String(b.title).trim().slice(0, 200) : "";
      const message = b.message != null ? String(b.message).trim() : "";
      const broadcast = b.broadcast === true || String(b.broadcast || "").toLowerCase() === "true";
      const vendorIdRaw = b.vendor_id;
      if (!title || !message) return res.status(400).json({ error: "title and message required" });
      if (message.length > 8000) return res.status(400).json({ error: "message too long" });

      let vendorIds = [];
      if (broadcast) {
        const rows = await all(`SELECT id FROM marketplace_vendors WHERE COALESCE(is_active,0)=1 ORDER BY id ASC`);
        vendorIds = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
      } else {
        const vid = Number(vendorIdRaw);
        if (!Number.isFinite(vid)) return res.status(400).json({ error: "vendor_id required unless broadcast" });
        const v = await get(`SELECT id FROM marketplace_vendors WHERE id=?`, [vid]);
        if (!v) return res.status(404).json({ error: "Vendor not found" });
        vendorIds = [vid];
      }

      let count = 0;
      for (const vid of vendorIds) {
        const insT = await run(
          `INSERT INTO vendor_contact_threads (vendor_id, subject, admin_unread, vendor_unread) VALUES (?, ?, 0, 1)`,
          [vid, title]
        );
        const tid = insT.id;
        if (!Number.isFinite(Number(tid)) || Number(tid) <= 0) continue;
        await run(`INSERT INTO vendor_contact_messages (thread_id, author, body) VALUES (?, 'admin', ?)`, [tid, message]);
        await run(`UPDATE vendor_contact_threads SET updated_at=CURRENT_TIMESTAMP WHERE id=?`, [tid]);
        const preview = message.length > 400 ? message.slice(0, 400) + "…" : message;
        await run(
          `INSERT INTO vendor_portal_notifications (vendor_id, title, message, link_url, is_read, reply_thread_id)
           VALUES (?, ?, ?, NULL, 0, ?)`,
          [vid, title, `${preview}\n\n[محادثة مع الإدارة — يمكنك الرد من هذا الإشعار.]`, tid]
        );
        count++;
      }
      emitVendorContactToAdmin();
      return res.json({ ok: true, threads_created: count });
    } catch (_e) {
      return res.status(500).json({ error: "Failed to broadcast" });
    }
  });
}

module.exports = { registerVendorContactAdminRoutes };

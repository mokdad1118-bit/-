/**
 * نواة نظام متعدد البائعين: رموز CMP/PRD، طلبات التنفيذ الفرعية، مزامنة حالة الطلب الأب
 */
const { get, all, run } = require("./db");

const VENDOR_FULFILLMENT_STATUSES = [
  "vendor_new",
  "vendor_accepted",
  "vendor_preparing",
  "vendor_shipped",
  "vendor_delivered",
  "vendor_cancelled",
];

const VENDOR_STATUS_LABEL_AR = {
  vendor_new: "طلب جديد",
  vendor_accepted: "تم القبول",
  vendor_preparing: "قيد التحضير",
  vendor_shipped: "تم الشحن",
  vendor_delivered: "تم التسليم",
  vendor_cancelled: "ملغي",
};

function isValidVendorFulfillmentStatus(s) {
  return VENDOR_FULFILLMENT_STATUSES.includes(String(s || "").trim());
}

async function allocateNextPublicVendorCode() {
  const row = await get(
    `SELECT MAX(CAST(SUBSTRING(public_vendor_code FROM 5) AS INTEGER)) AS m FROM marketplace_vendors WHERE public_vendor_code ~ '^CMP-[0-9]+$'`
  );
  const m = row && row.m != null ? Number(row.m) : 1000;
  const next = (Number.isFinite(m) && m >= 1000 ? m : 1000) + 1;
  return `CMP-${next}`;
}

async function allocateNextPublicProductCode() {
  const row = await get(
    `SELECT MAX(CAST(SUBSTRING(public_product_code FROM 5) AS INTEGER)) AS m FROM marketplace_products WHERE public_product_code ~ '^PRD-[0-9]+$'`
  );
  const m = row && row.m != null ? Number(row.m) : 1000;
  const next = (Number.isFinite(m) && m >= 1000 ? m : 1000) + 1;
  return `PRD-${next}`;
}

/** بعد إدراج بنود الطلب: إنشاء صف تنفيذ لكل شركة (سوق شامل) وربط البنود */
async function createFulfillmentsForOrder(orderId) {
  const oid = Number(orderId);
  if (!Number.isFinite(oid)) return;
  const items = await all(
    `SELECT oi.id, oi.marketplace_product_id, oi.price, oi.qty, mp.vendor_id
     FROM order_items oi
     INNER JOIN marketplace_products mp ON mp.id = oi.marketplace_product_id
     WHERE oi.order_id = ? AND oi.marketplace_product_id IS NOT NULL`,
    [oid]
  );
  if (!items.length) return;
  const byVendor = new Map();
  for (const it of items) {
    const vid = Number(it.vendor_id);
    if (!Number.isFinite(vid)) continue;
    if (!byVendor.has(vid)) {
      byVendor.set(vid, { lineIds: [], subtotal: 0 });
    }
    const g = byVendor.get(vid);
    g.lineIds.push(Number(it.id));
    g.subtotal += Number(it.price || 0) * Math.max(1, Math.floor(Number(it.qty || 1)));
  }
  for (const [vid, { lineIds, subtotal }] of byVendor) {
    const ins = await run(
      `INSERT INTO order_vendor_fulfillments (order_id, vendor_id, status, subtotal) VALUES (?, ?, 'vendor_new', ?)`,
      [oid, vid, subtotal]
    );
    const fid = ins.id;
    await run(`INSERT INTO order_vendor_fulfillment_status_history (fulfillment_id, status) VALUES (?, 'vendor_new')`, [fid]);
    for (const lid of lineIds) {
      await run(`UPDATE order_items SET vendor_fulfillment_id=? WHERE id=?`, [fid, lid]);
    }
  }
  await syncParentOrderStatusFromFulfillments(oid);
}

function deriveParentStatusFromFulfillmentStatuses(statuses) {
  const list = (statuses || []).map((s) => String(s || "").trim());
  if (!list.length) return null;
  if (list.every((s) => s === "vendor_cancelled")) return "cancelled";
  if (list.every((s) => s === "vendor_delivered")) return "delivered";
  if (list.some((s) => s === "vendor_shipped" || s === "vendor_delivered")) return "shipping";
  if (list.some((s) => s === "vendor_preparing" || s === "vendor_accepted")) return "in_progress";
  return "pending_receipt";
}

async function syncParentOrderStatusFromFulfillments(orderId) {
  const oid = Number(orderId);
  const splits = await all(`SELECT status FROM order_vendor_fulfillments WHERE order_id=?`, [oid]);
  if (!splits.length) return;
  const next = deriveParentStatusFromFulfillmentStatuses(splits.map((r) => r.status));
  if (!next) return;
  const cur = await get(`SELECT id, status FROM orders WHERE id=?`, [oid]);
  if (!cur || String(cur.status) === next) return;
  await run(`UPDATE orders SET status=? WHERE id=?`, [next, oid]);
  await run(`INSERT INTO order_status_history (order_id, status) VALUES (?, ?)`, [oid, next]);
}

async function setVendorFulfillmentStatus(fulfillmentId, newStatus, { notifyUserInApp } = {}) {
  const fid = Number(fulfillmentId);
  if (!Number.isFinite(fid) || !isValidVendorFulfillmentStatus(newStatus)) {
    return { ok: false, error: "Invalid fulfillment or status" };
  }
  const row = await get(
    `SELECT f.*, o.user_id, o.order_no, mv.name_ar AS vendor_name_ar, mv.name_en AS vendor_name_en
     FROM order_vendor_fulfillments f
     INNER JOIN orders o ON o.id = f.order_id
     INNER JOIN marketplace_vendors mv ON mv.id = f.vendor_id
     WHERE f.id=?`,
    [fid]
  );
  if (!row) return { ok: false, error: "Not found" };
  await run(`UPDATE order_vendor_fulfillments SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [newStatus, fid]);
  await run(`INSERT INTO order_vendor_fulfillment_status_history (fulfillment_id, status) VALUES (?, ?)`, [fid, newStatus]);
  await syncParentOrderStatusFromFulfillments(Number(row.order_id));

  const uid = Number(row.user_id);
  if (typeof notifyUserInApp === "function" && Number.isFinite(uid) && uid > 0) {
    const vname = String(row.vendor_name_ar || row.vendor_name_en || "الشركة").trim();
    const label = VENDOR_STATUS_LABEL_AR[newStatus] || newStatus;
    const ord = row.order_no != null ? String(row.order_no).trim() : "";
    const title = ord ? `تحديث طلب ${ord}` : "تحديث الطلب";
    const msgAr = `تم تغيير حالة طلبك إلى (${label}) من شركة (${vname}) — Adora`;
    const msgEn = `Your order status: ${label} — from ${vname} — Adora`;
    await notifyUserInApp(uid, title, `${msgAr}\n${msgEn}`, "/");
  }
  return { ok: true, fulfillment: await get(`SELECT * FROM order_vendor_fulfillments WHERE id=?`, [fid]) };
}

function parseShippingStructured(body) {
  const raw = body?.shipping_structured;
  if (!raw || typeof raw !== "object") return null;
  const full_name = raw.full_name != null ? String(raw.full_name).trim() : "";
  const phone = raw.phone != null ? String(raw.phone).trim() : "";
  const governorate = raw.governorate != null ? String(raw.governorate).trim() : "";
  const region = raw.region != null ? String(raw.region).trim() : "";
  const address = raw.address != null ? String(raw.address).trim() : "";
  return { full_name, phone, governorate, region, address };
}

function shippingStructuredComplete(s) {
  if (!s) return false;
  return [s.full_name, s.phone, s.governorate, s.region, s.address].every((x) => String(x || "").trim().length > 0);
}

function formatShippingStructuredForDisplay(s, locale) {
  if (!s) return "";
  const lines = [
    s.full_name,
    s.phone,
    `${s.governorate} — ${s.region}`,
    s.address,
  ].filter(Boolean);
  return lines.join(locale === "en" ? "\n" : "\n");
}

module.exports = {
  VENDOR_FULFILLMENT_STATUSES,
  VENDOR_STATUS_LABEL_AR,
  isValidVendorFulfillmentStatus,
  allocateNextPublicVendorCode,
  allocateNextPublicProductCode,
  createFulfillmentsForOrder,
  syncParentOrderStatusFromFulfillments,
  setVendorFulfillmentStatus,
  deriveParentStatusFromFulfillmentStatuses,
  parseShippingStructured,
  shippingStructuredComplete,
  formatShippingStructuredForDisplay,
};

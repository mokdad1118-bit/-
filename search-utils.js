/** توحيد نص البحث العربي (تشكيل، همزات) — للمطابقة مع أسماء المخزن */
function normalizeArabicSearchQuery(q) {
  let t = String(q || "").trim();
  if (!t) return t;
  t = t.replace(/\u0640/g, "");
  t = t.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
  t = t.replace(/[\u0622\u0623\u0625]/g, "\u0627");
  return t.replace(/\s+/g, " ").trim();
}

/** ه/ة ونص منطقي: يطابق «كنزه» من الصوت مع «كنزة» في قاعدة البيانات */
function arabicSearchQueryVariants(q) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const set = new Set();
  set.add(raw);
  const norm = normalizeArabicSearchQuery(raw);
  if (norm) set.add(norm);
  if (/ه$/.test(raw)) set.add(raw.slice(0, -1) + "\u0629");
  if (/ة$/.test(raw)) set.add(raw.slice(0, -1) + "\u0647");
  if (norm && /ه$/.test(norm)) set.add(norm.slice(0, -1) + "\u0629");
  if (norm && /ة$/.test(norm)) set.add(norm.slice(0, -1) + "\u0647");
  return [...set].filter(Boolean);
}

/** بادئة آمنة لـ SQL LIKE */
function sqlLikePrefixParam(v) {
  const s = String(v || "")
    .replace(/\\/g, "")
    .replace(/%/g, "")
    .replace(/_/g, "");
  return `${s}%`;
}

/** تضمين آمن لـ ILIKE/LIKE (بدون أحرف خاصة للنمط) — لمطابقة جزئية مثل اسم شركة */
function sqlLikeContainsParam(v) {
  const s = String(v || "")
    .replace(/\\/g, "")
    .replace(/%/g, "")
    .replace(/_/g, "");
  return `%${s}%`;
}

module.exports = {
  normalizeArabicSearchQuery,
  arabicSearchQueryVariants,
  sqlLikePrefixParam,
  sqlLikeContainsParam,
};

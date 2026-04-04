/**
 * باقات انضمام الشركاء — افتراضيات أدورا + دمج JSON من لوحة التحكم
 */

const DEFAULT_VENDOR_JOIN_PLANS = [
  {
    key: "starter",
    sort_order: 0,
    title_ar: "الباقة المجانية (Starter)",
    title_en: "Starter (Free)",
    price_usd_monthly: 0,
    price_label_ar: "مجاني",
    price_label_en: "Free",
    commission_percent: 5,
    product_quota: 20,
    bullets_ar: [
      "عدد المنتجات: 20 منتج",
      "دعم فني",
      "ظهور عادي داخل المنصة",
      "بدون منتجات مميزة",
      "بدون إعلانات",
      "بدون شركة مميزة",
      "العمولة: 5% على كل طلب",
      "السعر: مجاني",
    ],
    bullets_en: [
      "Up to 20 products",
      "Technical support",
      "Standard visibility on the platform",
      "No featured products",
      "No ads",
      "No featured company badge",
      "5% commission per order",
      "Free",
    ],
  },
  {
    key: "basic",
    sort_order: 1,
    title_ar: "الباقة الأساسية (Basic)",
    title_en: "Basic",
    price_usd_monthly: 20,
    price_label_ar: "20$ شهرياً",
    price_label_en: "$20 / month",
    commission_percent: 4,
    product_quota: 35,
    bullets_ar: [
      "عدد المنتجات: 35 منتج",
      "دعم فني",
      "عدد المنتجات المميزة: 4 منتجات",
      "ظهور داخل الأقسام",
      "بدون شركة مميزة",
      "بدون إعلانات",
      "العمولة: 4% على كل طلب",
      "السعر: 20$ شهري",
    ],
    bullets_en: [
      "Up to 35 products",
      "Technical support",
      "4 featured products",
      "Visibility in categories",
      "No featured company",
      "No ads",
      "4% commission per order",
      "$20 / month",
    ],
  },
  {
    key: "growth",
    sort_order: 2,
    title_ar: "الباقة المتقدمة (Growth)",
    title_en: "Growth",
    price_usd_monthly: 35,
    price_label_ar: "35$ شهرياً",
    price_label_en: "$35 / month",
    commission_percent: 3.5,
    product_quota: 60,
    bullets_ar: [
      "عدد المنتجات: 60 منتج",
      "دعم فني",
      "عدد المنتجات المميزة: 8 منتجات",
      "ظهور داخل الأقسام",
      "ظهور داخل «قد يعجبك»",
      "إعلان واحد لمدة 15 يوم",
      "العمولة: 3.5% على كل طلب",
      "السعر: 35$ شهري",
    ],
    bullets_en: [
      "Up to 60 products",
      "Technical support",
      "8 featured products",
      "Category placement",
      "«You may also like» placement",
      "1 ad for 15 days",
      "3.5% commission per order",
      "$35 / month",
    ],
  },
  {
    key: "premium",
    sort_order: 3,
    title_ar: "الباقة الاحترافية (Premium)",
    title_en: "Premium",
    price_usd_monthly: 50,
    price_label_ar: "50$ شهرياً",
    price_label_en: "$50 / month",
    commission_percent: 3,
    product_quota: 80,
    bullets_ar: [
      "عدد المنتجات: 80 منتج",
      "دعم فني أولوية",
      "عدد المنتجات المميزة: 10 منتجات",
      "شركة مميزة",
      "ظهور داخل تبويب «مميز»",
      "ظهور داخل «قد يعجبك»",
      "إعلانان لمدة 20 يوم",
      "أولوية في البحث",
      "العمولة: 3% على كل طلب",
      "السعر: 50$ شهري",
    ],
    bullets_en: [
      "Up to 80 products",
      "Priority support",
      "10 featured products",
      "Featured company",
      "Featured hub tab",
      "«You may also like» placement",
      "2 ads for 20 days",
      "Search priority",
      "3% commission per order",
      "$50 / month",
    ],
  },
];

function clampNum(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, x));
}

function normalizePlanRow(p) {
  if (!p || typeof p !== "object") return null;
  const key = String(p.key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  if (!key || key.length > 48) return null;
  const title_ar = String(p.title_ar || "").trim().slice(0, 200);
  const title_en = String(p.title_en || "").trim().slice(0, 200);
  if (!title_ar && !title_en) return null;
  const toLines = (v) => {
    if (Array.isArray(v)) return v.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 24).map((s) => s.slice(0, 500));
    if (typeof v === "string") {
      return v
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 24)
        .map((s) => s.slice(0, 500));
    }
    return [];
  };
  const bullets_ar = toLines(p.bullets_ar);
  const bullets_en = toLines(p.bullets_en);
  return {
    key,
    sort_order: clampNum(p.sort_order, 0, 999, 99),
    title_ar,
    title_en,
    price_usd_monthly: clampNum(p.price_usd_monthly, 0, 99999, 0),
    price_label_ar: String(p.price_label_ar || "").trim().slice(0, 120),
    price_label_en: String(p.price_label_en || "").trim().slice(0, 120),
    commission_percent: clampNum(p.commission_percent, 0, 100, 5),
    product_quota: clampNum(p.product_quota, 1, 99999, 20),
    bullets_ar,
    bullets_en,
  };
}

function mergePlansFromSettingsJson(raw) {
  const trimmed = raw != null ? String(raw).trim() : "";
  if (!trimmed) {
    return DEFAULT_VENDOR_JOIN_PLANS.map((d) => normalizePlanRow(d)).filter(Boolean);
  }
  try {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed?.plans) ? parsed.plans : Array.isArray(parsed) ? parsed : null;
    if (!arr || !arr.length) {
      return DEFAULT_VENDOR_JOIN_PLANS.map((d) => normalizePlanRow(d)).filter(Boolean);
    }
    const out = arr.map(normalizePlanRow).filter(Boolean);
    return out.length ? out.sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key)) : DEFAULT_VENDOR_JOIN_PLANS.map((d) => normalizePlanRow(d)).filter(Boolean);
  } catch {
    return DEFAULT_VENDOR_JOIN_PLANS.map((d) => normalizePlanRow(d)).filter(Boolean);
  }
}

function getPlanByKey(plans, key) {
  const k = String(key || "")
    .trim()
    .toLowerCase();
  return plans.find((p) => p.key === k) || null;
}

function planSnapshotForStorage(plan) {
  if (!plan) return {};
  return {
    key: plan.key,
    title_ar: plan.title_ar,
    title_en: plan.title_en,
    price_usd_monthly: plan.price_usd_monthly,
    price_label_ar: plan.price_label_ar,
    price_label_en: plan.price_label_en,
    commission_percent: plan.commission_percent,
    product_quota: plan.product_quota,
    captured_at: new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_VENDOR_JOIN_PLANS,
  mergePlansFromSettingsJson,
  getPlanByKey,
  planSnapshotForStorage,
  normalizePlanRow,
};

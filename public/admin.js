const ADMIN_TOKEN_KEY = "adora_admin_token";
const ADMIN_LANG_KEY = "adora_admin_lang";

const TX = {
  en: {
    edit: "Edit",
    delete: "Delete",
    yes: "Yes",
    no: "No",
    save: "Save",
    refresh: "Refresh",
    reset: "Reset",
    confirmDeleteProduct: "Delete product?",
    confirmDeleteBrand: "Delete brand?",
    confirmDeleteCategory: "Delete category?",
    confirmDeleteOffer: "Delete offer?",
    brandNameRequired: "Brand name required.",
    brandSaved: "Brand saved.",
    loginRequired: "Session missing. Please log in again.",
    adminOnlyLogin:
      "Admin panel: sign in with an admin account only. The seeded admin is phone 0000000000 (password set at first DB init — often admin123). App user accounts cannot add brands or products here.",
    categoryNameRequired: "Category name required.",
    fillProductRequired: "Please fill required product fields.",
    contactSaved: "Contact saved.",
    brandProductsHint: "Choose a brand, then Men / Women / Kids. Add or edit products — same options as the Products tab (price, discount, stock, images).",
    selectBrandFirst: "Select a brand first.",
    brandProductsEmpty: "No products in this section yet. Use “Add product in this section”.",
    addProductInSection: "Add product in this section",
    openProductsTab: "Open in Products tab",
    subcategory: "Subcategory",
    discountPct: "Disc. %",
  },
  ar: {
    edit: "تعديل",
    delete: "حذف",
    yes: "نعم",
    no: "لا",
    save: "حفظ",
    refresh: "تحديث",
    reset: "إعادة",
    confirmDeleteProduct: "حذف المنتج؟",
    confirmDeleteBrand: "حذف العلامة؟",
    confirmDeleteCategory: "حذف القسم؟",
    confirmDeleteOffer: "حذف العرض؟",
    brandNameRequired: "اسم العلامة مطلوب.",
    brandSaved: "تم حفظ العلامة.",
    loginRequired: "انتهت الجلسة. سجّل الدخول من جديد.",
    adminOnlyLogin:
      "لوحة المشرفين: سجّل الدخول بحساب يملك دور admin فقط. الحساب الافتراضي عند أول تشغيل: هاتف 0000000000 وكلمة المرور الافتراضية غالباً admin123. حسابات تطبيق الزبائن لا تستطيع الإضافة هنا.",
    categoryNameRequired: "اسم القسم مطلوب.",
    fillProductRequired: "يرجى تعبئة الحقول المطلوبة للمنتج.",
    contactSaved: "تم حفظ بيانات التواصل.",
    brandProductsHint: "اختر العلامة ثم رجالي / نسائي / أطفال. أضف أو عدّل المنتجات — نفس خيارات تبويب المنتجات (سعر، خصم، مخزون، صور…).",
    selectBrandFirst: "اختر علامة أولاً.",
    brandProductsEmpty: "لا منتجات في هذا القسم بعد. استخدم «إضافة منتج في هذا القسم».",
    addProductInSection: "إضافة منتج في هذا القسم",
    openProductsTab: "فتح في تبويب المنتجات",
    subcategory: "الفرعي",
    discountPct: "خصم %",
  },
};

function adminT(key) {
  const lang = getAdminLang();
  return TX[lang]?.[key] || TX.en[key] || key;
}

function getAdminLang() {
  return localStorage.getItem(ADMIN_LANG_KEY) || "ar";
}

function setAdminLang(lang) {
  localStorage.setItem(ADMIN_LANG_KEY, lang === "ar" ? "ar" : "en");
  applyAdminLang();
  const token = getToken();
  if (!token) return;
  Promise.all([
    loadProducts().catch(() => {}),
    loadBrands().catch(() => {}),
    loadCategories().catch(() => {}),
    loadOffers().catch(() => {}),
    loadOrders().catch(() => {}),
    loadFlashSales().catch(() => {}),
    loadUsers().catch(() => {}),
    loadSiteRatings().catch(() => {}),
    loadAdminProductReviews().catch(() => {}),
    loadAdminMarketplaceProductReviews().catch(() => {}),
    loadBroadcasts().catch(() => {}),
    loadBrandProductsSection().catch(() => {}),
    loadDatabaseOverview().catch(() => {}),
    loadBanners().catch(() => {}),
  ]).catch(() => {});
}

function applyAdminLang() {
  const ar = getAdminLang() === "ar";
  document.documentElement.setAttribute("dir", ar ? "rtl" : "ltr");
  document.documentElement.setAttribute("lang", ar ? "ar" : "en");
  document.querySelectorAll("[data-en][data-ar]").forEach((el) => {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
    if (el.querySelector && el.querySelector("*")) return;
    const v = ar ? el.getAttribute("data-ar") : el.getAttribute("data-en");
    if (v !== null) el.textContent = v;
  });
  document.querySelectorAll("[data-en-ph][data-ar-ph]").forEach((el) => {
    const ph = ar ? el.getAttribute("data-ar-ph") : el.getAttribute("data-en-ph");
    if (ph !== null) el.placeholder = ph;
  });
  const lab = document.getElementById("admin-lang-label");
  if (lab) lab.textContent = ar ? "عربي" : "English";
  const titleEl = document.querySelector("title");
  if (titleEl && titleEl.hasAttribute("data-en")) {
    document.title = ar ? titleEl.getAttribute("data-ar") : titleEl.getAttribute("data-en");
  }
  syncOrdersAdminI18n();
  const ordPanel = document.getElementById("tab-orders");
  if (ordPanel && !ordPanel.classList.contains("hidden")) {
    renderOrdersTable();
  }
}

function getToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

let mpEntrancePreviewObjectUrl = null;

function revokeMpEntrancePreviewObjectUrl() {
  if (mpEntrancePreviewObjectUrl) {
    URL.revokeObjectURL(mpEntrancePreviewObjectUrl);
    mpEntrancePreviewObjectUrl = null;
  }
}

function syncMpEntrancePreview() {
  const prev = document.getElementById("mp-entrance-preview");
  const inp = document.getElementById("mp-entrance-image");
  if (!prev || !inp) return;
  const v = inp.value.trim();
  if (v) {
    let src = v;
    if (v.startsWith("//")) {
      src = `${typeof window !== "undefined" ? window.location.protocol : "https:"}${v}`;
    }
    prev.src = src;
    prev.classList.remove("hidden");
  } else {
    prev.removeAttribute("src");
    prev.classList.add("hidden");
  }
}

/** يجب أن يكون role في قاعدة البيانات = admin (حسابات تطبيق الزبائن = user ولن تعمل عمليات الحفظ). */
function isAdminRole(role) {
  return String(role ?? "").trim().toLowerCase() === "admin";
}

async function isStoredTokenAdmin(token) {
  if (!token) return false;
  try {
    const bundle = await api("/api/profile", { token });
    return !!(bundle.user && isAdminRole(bundle.user.role));
  } catch {
    return false;
  }
}

async function api(path, { method = "GET", token, body, isFormData = false } = {}) {
  const headers = {};
  if (!isFormData && body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers: isFormData ? (token ? { Authorization: `Bearer ${token}` } : {}) : headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function showError(el, message) {
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideError(el) {
  el.textContent = "";
  el.classList.add("hidden");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function phoneDigitsForWa(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.slice(1);
  return d;
}

function getAdminFilter() {
  return String(document.getElementById("admin-table-search")?.value || "")
    .trim()
    .toLowerCase();
}

let adminProductsCache = [];
let adminBrandsCache = [];
let adminCategoriesListCache = [];
let adminOffersCache = [];
let adminOrdersCache = [];
/** تبويب حالة الطلبات في لوحة الطلبات: all | pending_receipt | … */
let adminOrdersStatusTab = "all";
let ordersAdminUiBound = false;
let adminUsersCache = [];
let adminSiteRatingsCache = [];
let adminProductReviewsCache = [];
let adminProductReviewsLoadError = null;
let adminMpProductReviewsCache = [];
let adminMpProductReviewsLoadError = null;
let adminCustomerFeedbackCache = [];
let adminCustomerFeedbackLoadError = null;
let adminFlashCache = [];
let adminBannersCache = [];
/** منتجات العلامة المختارة حسب القسم الرئيسي (Men/Women/Kids) */
let adminBrandProductsCache = [];
let brandProductsSelection = { mainCat: "Men" };

/** مفاتيح الحالة بالتسلسل (نفس السيرفر) — التعديل للمشرف فقط */
const ORDER_STATUS_KEYS = ["pending_receipt", "in_progress", "fulfilled", "shipping", "delivered"];
const ORDER_STATUS_LABELS = {
  pending_receipt: { en: "Receiving your order", ar: "جاري استلام طلبك" },
  in_progress: { en: "Picking your order", ar: "جاري تجميع طلبك" },
  fulfilled: { en: "Order assembled", ar: "تم تجميع طلبك" },
  shipping: { en: "Shipping", ar: "جاري الشحن" },
  delivered: { en: "Delivered to customer", ar: "تم تسليم الطلب للعميل" },
};

function formatOrderStatusLabel(status) {
  const s = String(status || "").trim();
  const o = ORDER_STATUS_LABELS[s];
  if (o) return getAdminLang() === "ar" ? o.ar : o.en;
  return s;
}

function startOfAdminDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfAdminDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** بداية الأسبوع الحالي: الاثنين (وفقاً للتقويم المحلي للمشرف) */
function startOfWeekMondayAdmin(d) {
  const x = startOfAdminDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function getAdminOrdersDateRange() {
  const preset = document.getElementById("orders-date-preset")?.value || "all";
  const now = new Date();
  if (preset === "all") return { start: null, end: null };
  if (preset === "today") return { start: startOfAdminDay(now), end: endOfAdminDay(now) };
  if (preset === "week") return { start: startOfWeekMondayAdmin(now), end: endOfAdminDay(now) };
  if (preset === "month") {
    const start = startOfAdminDay(new Date(now.getFullYear(), now.getMonth(), 1));
    return { start, end: endOfAdminDay(now) };
  }
  if (preset === "year") {
    const start = startOfAdminDay(new Date(now.getFullYear(), 0, 1));
    return { start, end: endOfAdminDay(now) };
  }
  if (preset === "custom") {
    const df = document.getElementById("orders-date-from")?.value;
    const dt = document.getElementById("orders-date-to")?.value;
    if (!df || !dt) return { start: null, end: null };
    const hf = document.getElementById("orders-time-from")?.value;
    const ht = document.getElementById("orders-time-to")?.value;
    let start = startOfAdminDay(new Date(df));
    let end = endOfAdminDay(new Date(dt));
    if (hf && String(hf).trim()) {
      const p = hf.split(":");
      start = new Date(df);
      start.setHours(Number(p[0]) || 0, Number(p[1]) || 0, 0, 0);
    }
    if (ht && String(ht).trim()) {
      const p = ht.split(":");
      end = new Date(dt);
      end.setHours(Number(p[0]) || 23, Number(p[1]) || 59, 59, 999);
    }
    if (start.getTime() > end.getTime()) {
      const t = start;
      start = end;
      end = t;
    }
    return { start, end };
  }
  return { start: null, end: null };
}

function orderMatchesAdminDateFilter(o, range) {
  if (range.start == null && range.end == null) return true;
  const t = o.created_at ? new Date(o.created_at).getTime() : NaN;
  if (Number.isNaN(t)) return false;
  if (range.start != null && t < range.start.getTime()) return false;
  if (range.end != null && t > range.end.getTime()) return false;
  return true;
}

function syncOrdersAdminI18n() {
  const ar = getAdminLang() === "ar";
  document.querySelectorAll("#orders-date-preset option").forEach((opt) => {
    const t = ar ? opt.getAttribute("data-ar") : opt.getAttribute("data-en");
    if (t) opt.textContent = t;
  });
  document.querySelectorAll(".orders-status-tab").forEach((btn) => {
    const t = ar ? btn.getAttribute("data-ar") : btn.getAttribute("data-en");
    if (t) btn.textContent = t;
  });
  const applyBtn = document.getElementById("orders-apply-filters");
  if (applyBtn) {
    const t = ar ? applyBtn.getAttribute("data-ar") : applyBtn.getAttribute("data-en");
    if (t) applyBtn.textContent = t;
  }
}

function highlightOrdersStatusTabs() {
  document.querySelectorAll(".orders-status-tab").forEach((btn) => {
    const st = btn.getAttribute("data-orders-status");
    const on = st === adminOrdersStatusTab;
    btn.classList.toggle("bg-purple-50", on);
    btn.classList.toggle("text-purple-700", on);
    btn.classList.toggle("border-purple-200", on);
    btn.classList.toggle("bg-white", !on);
    btn.classList.toggle("text-gray-700", !on);
    btn.classList.toggle("border-gray-200", !on);
  });
}

function bindOrdersAdminUi() {
  if (ordersAdminUiBound) return;
  ordersAdminUiBound = true;
  const tabs = document.getElementById("orders-status-tabs");
  tabs?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-orders-status]");
    if (!btn || !tabs.contains(btn)) return;
    adminOrdersStatusTab = btn.getAttribute("data-orders-status") || "all";
    highlightOrdersStatusTabs();
    renderOrdersTable();
  });
  const preset = document.getElementById("orders-date-preset");
  preset?.addEventListener("change", () => {
    const custom = document.getElementById("orders-custom-dates");
    const v = preset.value;
    if (custom) custom.classList.toggle("hidden", v !== "custom");
    renderOrdersTable();
  });
  document.getElementById("orders-apply-filters")?.addEventListener("click", () => renderOrdersTable());
}

function setActiveTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.remove("bg-purple-50", "text-purple-700");
    b.classList.add("border", "border-gray-200", "text-gray-700");
  });
  document.getElementById(tabId).classList.remove("hidden");
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (btn) {
    btn.classList.remove("border", "border-gray-200", "text-gray-700");
    btn.classList.add("bg-purple-50", "text-purple-700");
  }
  if (tabId === "tab-users") {
    loadUsers().catch(() => {});
    loadBroadcasts().catch(() => {});
  }
  if (tabId === "tab-orders") {
    bindOrdersAdminUi();
    syncOrdersAdminI18n();
    loadOrders().catch(() => {});
  }
  if (tabId === "tab-flash") loadFlashSales().catch(() => {});
  if (tabId === "tab-categories") loadCategories().catch(() => {});
  if (tabId === "tab-offers") {
    loadOfferProductsIntoSelect().catch(() => {});
    loadOffers().catch(() => {});
  }
  if (tabId === "tab-contact") loadContact().catch(() => {});
  if (tabId === "tab-home-layout") loadHomeLayoutTab().catch(() => {});
  if (tabId === "tab-ratings") {
    loadSiteRatings().catch(() => {});
    loadAdminProductReviews().catch(() => {});
    loadAdminMarketplaceProductReviews().catch(() => {});
    loadAdminCustomerFeedbackNotes().catch(() => {});
  }
  if (tabId === "tab-notifications") {
    loadNotificationTargetOptions().catch(() => {});
    loadPushDiagnostics().catch(() => {});
  }
  if (tabId === "tab-brands") {
    populateBrandProductsBrandSelect();
    loadBrandProductsSection().catch(() => {});
  }
  if (tabId === "tab-database") loadDatabaseOverview().catch(() => {});
  if (tabId === "tab-banners") {
    loadBanners().catch(() => {});
    loadVendorPlatformSettingsUi().catch(() => {});
    bindVendorPlatformAdminListenersOnce();
  }
  if (tabId === "tab-marketplace") initMarketplaceAdminTab().catch(() => {});
  if (tabId === "tab-vendor-platform") initVendorPlatformAdminTab().catch(() => {});
  if (tabId === "tab-vendor-subscriptions") {
    loadVendorSubscriptionRequests().catch(() => {});
    loadAppAdInquiriesUi().catch(() => {});
  }
}

function vpLocalDateTimeToIso(val) {
  if (!val || !String(val).trim()) return "";
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? String(val).trim() : d.toISOString();
}

let vendorPlatformListenersBound = false;

const VP_PARTNER_CTA_PLACEMENT_KEYS = [
  "home_under_search",
  "home_above_marketplace",
  "marketplace_screen",
  "offers_screen",
  "listing_screen",
];

const VP_APP_AD_PLACEMENT_KEYS = [
  "home_above_partner",
  "home_below_partner",
  "home_between_main_and_brands",
  "home_above_marketplace",
  "side_menu_account",
  "profile_screen",
  "marketplace_screen",
  "offers_screen",
  "listing_screen",
];

async function loadVendorPlatformSettingsUi() {
  const token = getToken();
  if (!token) return;
  const s = await api("/api/admin/vendor-platform/settings", { token });
  document.getElementById("vp-quota-on").checked = Number(s.product_quota_enabled) !== 0;
  document.getElementById("vp-free-n").value = String(s.free_products_per_vendor ?? 20);
  document.getElementById("vp-extra-price").value = String(s.extra_product_price_usd ?? 0.5);
  document.getElementById("vp-commission").value = String(s.commission_percent ?? 5);
  document.getElementById("vp-ads-on").checked = Number(s.ads_module_enabled) !== 0;
  document.getElementById("vp-banner-on").checked = Number(s.partner_banner_enabled) !== 0;
  document.getElementById("vp-banner-ar").value = s.partner_banner_text_ar || "";
  document.getElementById("vp-banner-en").value = s.partner_banner_text_en || "";
  const subAr = document.getElementById("vp-cta-sub-ar");
  const subEn = document.getElementById("vp-cta-sub-en");
  if (subAr) subAr.value = s.partner_cta_subtitle_ar || "";
  if (subEn) subEn.value = s.partner_cta_subtitle_en || "";
  let placements = [];
  try {
    placements = JSON.parse(s.partner_cta_placements_json || "[]");
  } catch (_e) {
    placements = [];
  }
  if (!Array.isArray(placements)) placements = [];
  const pset = new Set(placements.map((x) => String(x).trim()));
  for (const k of VP_PARTNER_CTA_PLACEMENT_KEYS) {
    const el = document.getElementById(`vp-pl-${k}`);
    if (el) el.checked = pset.has(k);
  }
  document.getElementById("vp-featured-mode").value = s.featured_products_mode || "manual";
  let ids = [];
  try {
    ids = JSON.parse(s.featured_vendor_ids_json || "[]");
  } catch (_e) {
    ids = [];
  }
  document.getElementById("vp-featured-vendors").value = Array.isArray(ids) ? ids.join(", ") : "";
  document.getElementById("vp-bestsellers-boost").checked = Number(s.bestsellers_boost_enabled) !== 0;
  const jtAr = document.getElementById("vp-join-terms-ar");
  const jtEn = document.getElementById("vp-join-terms-en");
  if (jtAr) jtAr.value = s.vendor_join_terms_ar || "";
  if (jtEn) jtEn.value = s.vendor_join_terms_en || "";
  const appAdOn = document.getElementById("vp-app-ad-on");
  if (appAdOn) appAdOn.checked = Number(s.app_ad_banner_enabled) !== 0;
  const aar = document.getElementById("vp-app-ad-ar");
  const aen = document.getElementById("vp-app-ad-en");
  if (aar) aar.value = s.app_ad_banner_text_ar || "";
  if (aen) aen.value = s.app_ad_banner_text_en || "";
  const asar = document.getElementById("vp-app-ad-sub-ar");
  const asen = document.getElementById("vp-app-ad-sub-en");
  if (asar) asar.value = s.app_ad_banner_subtitle_ar || "";
  if (asen) asen.value = s.app_ad_banner_subtitle_en || "";
  let appAdPl = [];
  try {
    appAdPl = JSON.parse(s.app_ad_banner_placements_json || "[]");
  } catch (_e) {
    appAdPl = [];
  }
  if (!Array.isArray(appAdPl)) appAdPl = [];
  const adset = new Set(appAdPl.map((x) => String(x).trim()));
  for (const k of VP_APP_AD_PLACEMENT_KEYS) {
    const el = document.getElementById(`vp-aad-pl-${k}`);
    if (el) el.checked = adset.has(k);
  }
  const ata = document.getElementById("vp-app-ad-terms-ar");
  const ate = document.getElementById("vp-app-ad-terms-en");
  if (ata) ata.value = s.app_ad_terms_ar || "";
  if (ate) ate.value = s.app_ad_terms_en || "";
  const psj = document.getElementById("vp-partner-slides-json");
  if (psj) psj.value = s.partner_cta_slides_json && String(s.partner_cta_slides_json).trim() !== "[]" ? s.partner_cta_slides_json : "";
  const asj = document.getElementById("vp-app-ad-slides-json");
  if (asj) asj.value = s.app_ad_cta_slides_json && String(s.app_ad_cta_slides_json).trim() !== "[]" ? s.app_ad_cta_slides_json : "";
}

async function loadAppAdInquiriesUi() {
  const token = getToken();
  const tbody = document.getElementById("app-ad-inq-tbody");
  if (!token || !tbody) return;
  const ar = getAdminLang() === "ar";
  let rows;
  try {
    rows = await api("/api/admin/app-ad-inquiries", { token });
  } catch (_e) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-3 text-center text-red-600">${ar ? "تعذر التحميل." : "Failed to load."}</td></tr>`;
    return;
  }
  if (!Array.isArray(rows) || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-3 text-center text-gray-500">${ar ? "لا طلبات بعد." : "No inquiries yet."}</td></tr>`;
    return;
  }
  const stLabel = (st) => {
    const x = String(st || "").toLowerCase();
    if (x === "reviewed") return ar ? "تمت المراجعة" : "Reviewed";
    if (x === "approved") return ar ? "تمت الموافقة على الإعلان" : "Ad approved";
    if (x === "archived") return ar ? "مؤرشف" : "Archived";
    return ar ? "قيد الانتظار" : "Pending";
  };
  tbody.innerHTML = rows
    .map((r) => {
      const imgUrl = r.product_image_url ? String(r.product_image_url) : "";
      const imgCell = imgUrl
        ? `<a href="${escapeHtml(imgUrl)}" target="_blank" rel="noopener noreferrer" class="text-violet-600 font-bold underline">${ar ? "عرض" : "View"}</a>`
        : "—";
      return `<tr class="border-t border-gray-100 align-top" data-app-ad-inq-id="${r.id}">
        <td class="p-2 font-mono">${r.id}</td>
        <td class="p-2 max-w-[120px]"><div class="font-semibold">${escapeHtml(r.full_name || "")}</div><div class="text-gray-600">${escapeHtml(r.company_name || "")}</div></td>
        <td class="p-2 max-w-[130px] text-[10px] break-all"><div>${escapeHtml(r.email || "")}</div><div class="mt-0.5">${escapeHtml(r.phone || "")}</div><div class="mt-0.5 text-gray-500">${escapeHtml(r.residence || "")}</div></td>
        <td class="p-2 max-w-[72px] break-words">${escapeHtml(r.product_price || "")}</td>
        <td class="p-2">${imgCell}</td>
        <td class="p-2">
          <select class="app-ad-inq-status w-full p-1.5 rounded-lg border border-gray-200 text-[11px]" data-app-ad-inq-status="${r.id}">
            <option value="pending"${String(r.status).toLowerCase() === "pending" ? " selected" : ""}>${stLabel("pending")}</option>
            <option value="reviewed"${String(r.status).toLowerCase() === "reviewed" ? " selected" : ""}>${stLabel("reviewed")}</option>
            <option value="approved"${String(r.status).toLowerCase() === "approved" ? " selected" : ""}>${stLabel("approved")}</option>
            <option value="archived"${String(r.status).toLowerCase() === "archived" ? " selected" : ""}>${stLabel("archived")}</option>
          </select>
        </td>
        <td class="p-2"><textarea class="app-ad-inq-note w-full min-h-[52px] p-1.5 rounded-lg border border-gray-200 text-[11px]" rows="2" data-app-ad-inq-note="${r.id}"></textarea></td>
        <td class="p-2"><button type="button" class="text-xs px-2 py-1.5 rounded-lg bg-violet-600 text-white font-bold app-ad-inq-save" data-app-ad-inq-save="${r.id}">${ar ? "حفظ" : "Save"}</button></td>
      </tr>`;
    })
    .join("");
  for (const r of rows) {
    const ta = tbody.querySelector(`textarea[data-app-ad-inq-note="${Number(r.id)}"]`);
    if (ta) ta.value = r.admin_note != null ? String(r.admin_note) : "";
  }
  tbody.querySelectorAll(".app-ad-inq-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-app-ad-inq-save");
      const token2 = getToken();
      if (!token2 || !id) return;
      const ar2 = getAdminLang() === "ar";
      const sel = tbody.querySelector(`[data-app-ad-inq-status="${id}"]`);
      const ta = tbody.querySelector(`[data-app-ad-inq-note="${id}"]`);
      const status = sel && sel.value ? String(sel.value).trim() : "pending";
      const admin_note = ta ? String(ta.value) : "";
      try {
        await api(`/api/admin/app-ad-inquiries/${id}`, {
          method: "PATCH",
          token: token2,
          body: { status, admin_note },
        });
        alert(ar2 ? "تم الحفظ." : "Saved.");
        await loadAppAdInquiriesUi();
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  });
}

async function loadVendorPromotionsUi() {
  const token = getToken();
  if (!token) return;
  const rows = await api("/api/admin/vendor-platform/promotions", { token });
  const tbody = document.getElementById("vp-promo-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  if (!Array.isArray(rows) || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-gray-500">${ar ? "لا إعلانات." : "No promotions."}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((r) => {
      const pn = ar ? r.product_name_ar || r.product_name_en : r.product_name_en || r.product_name_ar;
      const imp = `${r.impressions_count ?? 0}${r.max_impressions != null ? ` / ${r.max_impressions}` : ""}`;
      return `<tr class="border-t border-gray-100">
        <td class="p-2">${r.id}</td>
        <td class="p-2 max-w-[100px] truncate" title="${escapeHtml(pn)}">#${r.product_id} ${escapeHtml(pn || "")}</td>
        <td class="p-2 font-mono text-[10px]">${escapeHtml(r.slot)}</td>
        <td class="p-2">${escapeHtml(imp)}</td>
        <td class="p-2"><button type="button" class="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700" data-vp-prom-del="${r.id}">${ar ? "حذف" : "Del"}</button></td>
      </tr>`;
    })
    .join("");
  tbody.querySelectorAll("[data-vp-prom-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-vp-prom-del");
      if (!confirm(getAdminLang() === "ar" ? "حذف الإعلان؟" : "Delete promotion?")) return;
      await api(`/api/admin/vendor-platform/promotions/${id}`, { method: "DELETE", token });
      await loadVendorPromotionsUi();
    });
  });
}

async function loadVendorCommissionReportUi() {
  const token = getToken();
  if (!token) return;
  const ar = getAdminLang() === "ar";
  const from = document.getElementById("vp-comm-from")?.value?.trim();
  const to = document.getElementById("vp-comm-to")?.value?.trim();
  const q = new URLSearchParams();
  if (from) q.set("from", vpLocalDateTimeToIso(from));
  if (to) q.set("to", vpLocalDateTimeToIso(to));
  const qs = q.toString();
  const data = await api(`/api/admin/vendor-platform/commission-report${qs ? `?${qs}` : ""}`, { token });
  const out = document.getElementById("vp-comm-out");
  if (out) {
    const lines = [];
    lines.push(`${ar ? "إجمالي عمولة أدورا" : "Adora commission total"}: ${Number(data.adora_commission_total || 0).toFixed(4)}`);
    if (data.summary) {
      lines.push(`${ar ? "إجمالي مبيعات السوق" : "Marketplace gross"}: ${Number(data.summary.marketplace_gross_sales || 0).toFixed(2)}`);
      lines.push(
        `${ar ? "صافي تقديري للشركات بعد العمولة" : "Est. vendor net"}: ${Number(data.summary.estimated_vendors_net_after_commission || 0).toFixed(2)}`
      );
    }
    lines.push("");
    const bv = Array.isArray(data.by_vendor) ? data.by_vendor : [];
    for (const row of bv) {
      const vn = ar ? row.vendor_name_ar || row.vendor_name_en : row.vendor_name_en || row.vendor_name_ar;
      lines.push(
        `#${row.vendor_id ?? "—"} ${vn || ""} — gross: ${Number(row.gross_sales || 0).toFixed(2)} — commission: ${Number(row.commission_total || 0).toFixed(4)}`
      );
    }
    out.textContent = lines.join("\n");
  }
}

function collectVendorPlatformSettingsBody() {
  const fv = document.getElementById("vp-featured-vendors")?.value?.trim() ?? "";
  const vendorIds = fv
    ? fv
        .split(/[\s,]+/)
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const partner_cta_placements = VP_PARTNER_CTA_PLACEMENT_KEYS.filter((k) => {
    const el = document.getElementById(`vp-pl-${k}`);
    return el && el.checked;
  });
  const app_ad_banner_placements = VP_APP_AD_PLACEMENT_KEYS.filter((k) => {
    const el = document.getElementById(`vp-aad-pl-${k}`);
    return el && el.checked;
  });
  return {
    product_quota_enabled: document.getElementById("vp-quota-on")?.checked ? 1 : 0,
    free_products_per_vendor: Number(document.getElementById("vp-free-n")?.value || 0),
    extra_product_price_usd: Number(document.getElementById("vp-extra-price")?.value || 0),
    commission_percent: Number(document.getElementById("vp-commission")?.value || 0),
    ads_module_enabled: document.getElementById("vp-ads-on")?.checked ? 1 : 0,
    partner_banner_enabled: document.getElementById("vp-banner-on")?.checked ? 1 : 0,
    partner_banner_text_ar: document.getElementById("vp-banner-ar")?.value?.trim() ?? "",
    partner_banner_text_en: document.getElementById("vp-banner-en")?.value?.trim() ?? "",
    partner_cta_subtitle_ar: document.getElementById("vp-cta-sub-ar")?.value?.trim() ?? "",
    partner_cta_subtitle_en: document.getElementById("vp-cta-sub-en")?.value?.trim() ?? "",
    partner_cta_placements,
    vendor_join_terms_ar: document.getElementById("vp-join-terms-ar")?.value ?? "",
    vendor_join_terms_en: document.getElementById("vp-join-terms-en")?.value ?? "",
    app_ad_banner_enabled: document.getElementById("vp-app-ad-on")?.checked ? 1 : 0,
    app_ad_banner_text_ar: document.getElementById("vp-app-ad-ar")?.value?.trim() ?? "",
    app_ad_banner_text_en: document.getElementById("vp-app-ad-en")?.value?.trim() ?? "",
    app_ad_banner_subtitle_ar: document.getElementById("vp-app-ad-sub-ar")?.value?.trim() ?? "",
    app_ad_banner_subtitle_en: document.getElementById("vp-app-ad-sub-en")?.value?.trim() ?? "",
    app_ad_banner_placements,
    app_ad_terms_ar: document.getElementById("vp-app-ad-terms-ar")?.value ?? "",
    app_ad_terms_en: document.getElementById("vp-app-ad-terms-en")?.value ?? "",
    partner_cta_slides_json: document.getElementById("vp-partner-slides-json")?.value ?? "",
    app_ad_cta_slides_json: document.getElementById("vp-app-ad-slides-json")?.value ?? "",
    featured_products_mode: document.getElementById("vp-featured-mode")?.value ?? "manual",
    featured_vendor_ids: vendorIds,
    bestsellers_boost_enabled: document.getElementById("vp-bestsellers-boost")?.checked ? 1 : 0,
  };
}

async function saveVendorPlatformSettingsFromForm() {
  const token = getToken();
  if (!token) return;
  const ar = getAdminLang() === "ar";
  const body = collectVendorPlatformSettingsBody();
  await api("/api/admin/vendor-platform/settings", { method: "PUT", token, body });
  await loadVendorPlatformSettingsUi();
  alert(ar ? "تم حفظ الإعدادات." : "Settings saved.");
}

function bindVendorPlatformAdminListenersOnce() {
  if (vendorPlatformListenersBound) return;
  vendorPlatformListenersBound = true;
  document.getElementById("vp-settings-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!getToken()) return;
    try {
      await saveVendorPlatformSettingsFromForm();
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  document.getElementById("btn-save-app-cta-banners")?.addEventListener("click", async () => {
    if (!getToken()) return;
    try {
      await saveVendorPlatformSettingsFromForm();
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  document.getElementById("btn-save-partner-cta-banner")?.addEventListener("click", async () => {
    if (!getToken()) return;
    try {
      await saveVendorPlatformSettingsFromForm();
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  document.getElementById("vp-promo-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    const ar = getAdminLang() === "ar";
    const maxRaw = document.getElementById("vp-promo-max-imp").value.trim();
    const body = {
      product_id: Number(document.getElementById("vp-promo-pid").value),
      slot: document.getElementById("vp-promo-slot").value,
      priority: Number(document.getElementById("vp-promo-priority").value || 0),
      price_usd: Number(document.getElementById("vp-promo-price").value || 0),
      starts_at: vpLocalDateTimeToIso(document.getElementById("vp-promo-start").value),
      ends_at: vpLocalDateTimeToIso(document.getElementById("vp-promo-end").value),
      max_impressions: maxRaw === "" ? null : Number(maxRaw),
      is_active: document.getElementById("vp-promo-active").checked ? 1 : 0,
    };
    if (!Number.isFinite(body.product_id) || !body.starts_at || !body.ends_at) {
      alert(ar ? "أدخل معرّف المنتج وتواريخ البداية والنهاية." : "Enter product id and start/end dates.");
      return;
    }
    try {
      await api("/api/admin/vendor-platform/promotions", { method: "POST", token, body });
      await loadVendorPromotionsUi();
      alert(ar ? "تمت الإضافة." : "Added.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  document.getElementById("btn-vp-comm-refresh")?.addEventListener("click", () => loadVendorCommissionReportUi().catch((err) => alert(err.message || err)));
}

async function initVendorPlatformAdminTab() {
  await loadVendorPlatformSettingsUi();
  await loadVendorPromotionsUi();
  bindVendorPlatformAdminListenersOnce();
}

const VP_SUB_STATUS_LABELS_AR = {
  pending: "قيد المراجعة",
  approved: "تمت الموافقة",
  rejected: "تم الرفض",
  incomplete: "طلب ناقص",
};

async function loadVendorSubscriptionRequests() {
  const token = getToken();
  if (!token) return;
  const rows = await api("/api/admin/vendor-subscription-requests", { token });
  const tbody = document.getElementById("vp-sub-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  if (!Array.isArray(rows) || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-500">${ar ? "لا طلبات." : "No requests."}</td></tr>`;
    return;
  }
  const docCell = (r) => {
    const parts = [];
    if (r.id_front_url) parts.push(`<a class="text-purple-600 underline text-[11px] block" target="_blank" rel="noopener" href="${escapeHtml(r.id_front_url)}">${ar ? "وجه الهوية" : "ID front"}</a>`);
    if (r.id_back_url) parts.push(`<a class="text-purple-600 underline text-[11px] block" target="_blank" rel="noopener" href="${escapeHtml(r.id_back_url)}">${ar ? "خلف الهوية" : "ID back"}</a>`);
    if (r.commercial_register_url) {
      parts.push(
        `<a class="text-purple-600 underline text-[11px] block" target="_blank" rel="noopener" href="${escapeHtml(r.commercial_register_url)}">${ar ? "سجل تجاري" : "Commercial"}</a>`
      );
    }
    if (!parts.length && r.id_document) {
      parts.push(`<span class="text-[11px] text-gray-500">${escapeHtml(String(r.id_document).slice(0, 80))}</span>`);
    }
    return parts.length ? `<div class="max-w-[140px] space-y-0.5">${parts.join("")}</div>` : "—";
  };
  tbody.innerHTML = rows
    .map((r) => {
      return `<tr class="border-t border-gray-100 align-top">
        <td class="p-2">${r.id}</td>
        <td class="p-2 max-w-[100px]">${escapeHtml(r.full_name || "")}</td>
        <td class="p-2 max-w-[100px]">${escapeHtml(r.company_name || "")}</td>
        <td class="p-2 whitespace-nowrap">${escapeHtml(r.phone || "")}</td>
        <td class="p-2 max-w-[120px] truncate" title="${escapeHtml(r.email || "")}">${escapeHtml(r.email || "")}</td>
        <td class="p-2 align-top text-[11px]">${docCell(r)}</td>
        <td class="p-2">
          <select class="w-full text-xs p-1 rounded border border-gray-200 vp-sub-status" data-vp-sub-id="${r.id}">
            <option value="pending"${r.status === "pending" ? " selected" : ""}>${VP_SUB_STATUS_LABELS_AR.pending}</option>
            <option value="approved"${r.status === "approved" ? " selected" : ""}>${VP_SUB_STATUS_LABELS_AR.approved}</option>
            <option value="rejected"${r.status === "rejected" ? " selected" : ""}>${VP_SUB_STATUS_LABELS_AR.rejected}</option>
            <option value="incomplete"${r.status === "incomplete" ? " selected" : ""}>${VP_SUB_STATUS_LABELS_AR.incomplete}</option>
          </select>
        </td>
        <td class="p-2 min-w-[200px] space-y-1">
          <textarea class="w-full text-xs p-1 rounded border border-gray-200 vp-sub-msg" data-vp-sub-id="${r.id}" rows="2" placeholder="${ar ? "ملاحظة للطلب" : "Admin note"}">${escapeHtml(r.admin_message || "")}</textarea>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-purple-600 text-white vp-sub-save" data-vp-sub-id="${r.id}">${ar ? "حفظ" : "Save"}</button>
        </td>
      </tr>`;
    })
    .join("");
  tbody.querySelectorAll(".vp-sub-save").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-vp-sub-id");
      const st = tbody.querySelector(`.vp-sub-status[data-vp-sub-id="${id}"]`)?.value;
      const msg = tbody.querySelector(`.vp-sub-msg[data-vp-sub-id="${id}"]`)?.value ?? "";
      try {
        await api(`/api/admin/vendor-subscription-requests/${id}`, {
          method: "PATCH",
          token,
          body: { status: st, admin_message: msg },
        });
        alert(getAdminLang() === "ar" ? "تم التحديث." : "Updated.");
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  });
}


let adminMpSectionsCache = [];
let adminMpVendorsCache = [];
let adminMpProductsCache = [];
let adminMpDeptsCache = [];
let adminMpHomePlacementsAll = [];
let adminMpListenersBound = false;

function setMpSubtab(name) {
  document.querySelectorAll(".mp-pane").forEach((p) => p.classList.add("hidden"));
  const pane = document.getElementById(`mp-pane-${name}`);
  if (pane) pane.classList.remove("hidden");
  document.querySelectorAll(".mp-subtab").forEach((b) => {
    const on = b.getAttribute("data-mp-sub") === name;
    b.classList.toggle("bg-purple-50", on);
    b.classList.toggle("text-purple-700", on);
    b.classList.toggle("border-purple-100", on);
    b.classList.toggle("bg-gray-50", !on);
    b.classList.toggle("text-gray-700", !on);
    b.classList.toggle("border-gray-200", !on);
  });
}

function mpParseImageUrls(raw) {
  return String(raw || "")
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function loadMpSections() {
  const token = getToken();
  if (!token) return;
  try {
    adminMpSectionsCache = await api("/api/admin/marketplace/sections", { token });
  } catch (_e) {
    adminMpSectionsCache = [];
  }
  renderMpSectionsTable();
  fillMpSectionSelectsAll();
}

function fillMpSectionSelectsAll() {
  const ar = getAdminLang() === "ar";
  const secs = adminMpSectionsCache.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id);
  const opts = secs
    .map((s) => {
      const lab = ar ? s.name_ar || s.name_en : s.name_en || s.name_ar;
      return `<option value="${s.id}">${escapeHtml(lab)}</option>`;
    })
    .join("");
  const blank = ar ? "— الكل / اختر —" : "— All / choose —";
  [
    "mp-vendor-section-filter",
    "mp-v-section",
    "mp-prod-section-filter",
    "mp-dept-section-filter",
    "mp-p-section",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    const needBlank = id !== "mp-v-section" && id !== "mp-p-section";
    el.innerHTML = (needBlank ? `<option value="">${blank}</option>` : `<option value="">${ar ? "— اختر القسم —" : "— Section —"}</option>`) + opts;
    if (cur && [...el.options].some((o) => o.value === cur)) el.value = cur;
  });
}

function renderMpSectionsTable() {
  const tbody = document.getElementById("mp-sections-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  const rows = adminMpSectionsCache.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">${ar ? "لا أقسام بعد." : "No sections yet."}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((s) => {
      const name = ar ? s.name_ar || s.name_en : s.name_en || s.name_ar;
      return `<tr class="border-t border-gray-100">
        <td class="p-2">${s.id}</td>
        <td class="p-2 font-mono text-xs">${escapeHtml(s.slug)}</td>
        <td class="p-2">${escapeHtml(name)}</td>
        <td class="p-2">${escapeHtml(String(s.sort_order))}</td>
        <td class="p-2">${s.is_active ? adminT("yes") : adminT("no")}</td>
        <td class="p-2 flex flex-wrap gap-1">
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-gray-100" data-mp-sec-up="${s.id}">↑</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-gray-100" data-mp-sec-down="${s.id}">↓</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700" data-mp-sec-edit="${s.id}">${adminT("edit")}</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700" data-mp-sec-del="${s.id}">${adminT("delete")}</button>
        </td>
      </tr>`;
    })
    .join("");
}

async function mpReorderSectionsByMove(id, dir) {
  const token = getToken();
  if (!token) return;
  const rows = adminMpSectionsCache.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id);
  const idx = rows.findIndex((r) => r.id === id);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= rows.length) return;
  const next = rows.slice();
  [next[idx], next[j]] = [next[j], next[idx]];
  await api("/api/admin/marketplace/sections/reorder", {
    method: "POST",
    token,
    body: { orderedIds: next.map((r) => r.id) },
  });
  await loadMpSections();
}

function mpFillSectionForm(s) {
  document.getElementById("mp-sec-id").value = s ? s.id : "";
  document.getElementById("mp-sec-slug").value = s ? s.slug || "" : "";
  document.getElementById("mp-sec-name-ar").value = s ? s.name_ar || "" : "";
  document.getElementById("mp-sec-name-en").value = s ? s.name_en || "" : "";
  document.getElementById("mp-sec-sub-ar").value = s ? s.subtitle_ar || "" : "";
  document.getElementById("mp-sec-sub-en").value = s ? s.subtitle_en || "" : "";
  document.getElementById("mp-sec-card").value = s ? s.card_image_url || "" : "";
  document.getElementById("mp-sec-sort").value = s ? String(s.sort_order ?? 0) : "0";
  document.getElementById("mp-sec-active").checked = !s || Number(s.is_active) !== 0;
  const cf = document.getElementById("mp-sec-card-file");
  if (cf) cf.value = "";
}

async function loadMpVendorsForAdminFilter() {
  const token = getToken();
  if (!token) return;
  const sid = document.getElementById("mp-vendor-section-filter")?.value?.trim();
  if (!sid) {
    adminMpVendorsCache = [];
    renderMpVendorsTable();
    return;
  }
  try {
    adminMpVendorsCache = await api(`/api/admin/marketplace/vendors?section_id=${encodeURIComponent(sid)}`, { token });
  } catch (_e) {
    adminMpVendorsCache = [];
  }
  renderMpVendorsTable();
}

function renderMpVendorsTable() {
  const tbody = document.getElementById("mp-vendors-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  const rows = adminMpVendorsCache.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">${ar ? "لا مولات/شركات (اختر قسماً)." : "No vendors (pick a section)."}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((v) => {
      const name = ar ? v.name_ar || v.name_en : v.name_en || v.name_ar;
      const ty = v.vendor_type === "mall" ? (ar ? "مول" : "Mall") : ar ? "شركة" : "Company";
      return `<tr class="border-t border-gray-100">
        <td class="p-2">${v.id}</td>
        <td class="p-2">${escapeHtml(name)}</td>
        <td class="p-2">${escapeHtml(ty)}</td>
        <td class="p-2">${escapeHtml(String(v.sort_order))}</td>
        <td class="p-2 flex flex-wrap gap-1">
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-gray-100" data-mp-v-up="${v.id}">↑</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-gray-100" data-mp-v-down="${v.id}">↓</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700" data-mp-v-edit="${v.id}">${adminT("edit")}</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700" data-mp-v-del="${v.id}">${adminT("delete")}</button>
        </td>
      </tr>`;
    })
    .join("");
}

async function mpReorderVendorsByMove(id, dir) {
  const token = getToken();
  const sid = document.getElementById("mp-vendor-section-filter")?.value?.trim();
  if (!token || !sid) return;
  const rows = adminMpVendorsCache.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id);
  const idx = rows.findIndex((r) => r.id === id);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= rows.length) return;
  const next = rows.slice();
  [next[idx], next[j]] = [next[j], next[idx]];
  await api("/api/admin/marketplace/vendors/reorder", {
    method: "POST",
    token,
    body: { section_id: Number(sid), orderedIds: next.map((r) => r.id) },
  });
  await loadMpVendorsForAdminFilter();
}

function mpFillVendorForm(v) {
  document.getElementById("mp-v-id").value = v ? v.id : "";
  const sec = document.getElementById("mp-v-section");
  if (sec && v) sec.value = String(v.section_id);
  document.getElementById("mp-v-name-ar").value = v ? v.name_ar || "" : "";
  document.getElementById("mp-v-name-en").value = v ? v.name_en || "" : "";
  document.getElementById("mp-v-type").value = v && v.vendor_type === "mall" ? "mall" : "company";
  document.getElementById("mp-v-logo").value = v ? v.logo_url || "" : "";
  document.getElementById("mp-v-cover").value = v ? v.cover_image_url || "" : "";
  document.getElementById("mp-v-sort").value = v ? String(v.sort_order ?? 0) : "0";
  const spEl = document.getElementById("mp-v-search-priority");
  if (spEl) spEl.value = v ? String(v.search_priority ?? 0) : "0";
  document.getElementById("mp-v-paid-slots").value = v ? String(v.paid_product_slots ?? 0) : "0";
  document.getElementById("mp-v-premium").checked = v && Number(v.is_premium) === 1;
  const ptype = v && v.premium_subscription_type ? String(v.premium_subscription_type) : "none";
  document.getElementById("mp-v-premium-type").value = ["none", "permanent", "monthly", "weekly"].includes(ptype) ? ptype : "none";
  const pu = document.getElementById("mp-v-premium-until");
  if (pu) {
    if (v && v.premium_until) {
      const d = new Date(v.premium_until);
      if (!Number.isNaN(d.getTime())) {
        const pad = (n) => String(n).padStart(2, "0");
        pu.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } else pu.value = "";
    } else pu.value = "";
  }
  document.getElementById("mp-v-active").checked = !v || Number(v.is_active) !== 0;
  const lf = document.getElementById("mp-v-logo-file");
  const cf = document.getElementById("mp-v-cover-file");
  if (lf) lf.value = "";
  if (cf) cf.value = "";
}

async function fillMpVendorSelectForProductForm(sectionId) {
  const token = getToken();
  const sel = document.getElementById("mp-p-vendor");
  if (!sel || !token) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${getAdminLang() === "ar" ? "— اختر المورد —" : "— Vendor —"}</option>`;
  if (!sectionId) return;
  try {
    const rows = await api(`/api/admin/marketplace/vendors?section_id=${encodeURIComponent(sectionId)}`, { token });
    const ar = getAdminLang() === "ar";
    for (const v of rows || []) {
      const lab = ar ? v.name_ar || v.name_en : v.name_en || v.name_ar;
      const o = document.createElement("option");
      o.value = String(v.id);
      o.textContent = lab;
      sel.appendChild(o);
    }
    if (cur && [...sel.options].some((x) => x.value === cur)) sel.value = cur;
  } catch (_e) {}
}

async function fillMpProdVendorFilterDropdown() {
  const token = getToken();
  const secSel = document.getElementById("mp-prod-section-filter");
  const venSel = document.getElementById("mp-prod-vendor-filter");
  if (!venSel || !token) return;
  const cur = venSel.value;
  const sid = secSel?.value?.trim();
  venSel.innerHTML = `<option value="">${getAdminLang() === "ar" ? "— الكل —" : "— All —"}</option>`;
  if (!sid) return;
  try {
    const rows = await api(`/api/admin/marketplace/vendors?section_id=${encodeURIComponent(sid)}`, { token });
    const ar = getAdminLang() === "ar";
    for (const v of rows || []) {
      const lab = ar ? v.name_ar || v.name_en : v.name_en || v.name_ar;
      const o = document.createElement("option");
      o.value = String(v.id);
      o.textContent = lab;
      venSel.appendChild(o);
    }
    if (cur && [...venSel.options].some((x) => x.value === cur)) venSel.value = cur;
  } catch (_e) {}
}

async function fillMpDeptVendorFilterDropdown() {
  const token = getToken();
  const secSel = document.getElementById("mp-dept-section-filter");
  const venSel = document.getElementById("mp-dept-vendor-filter");
  if (!venSel || !token) return;
  const cur = venSel.value;
  const sid = secSel?.value?.trim();
  venSel.innerHTML = `<option value="">${getAdminLang() === "ar" ? "— اختر الشركة —" : "— Choose vendor —"}</option>`;
  if (!sid) return;
  try {
    const rows = await api(`/api/admin/marketplace/vendors?section_id=${encodeURIComponent(sid)}`, { token });
    const ar = getAdminLang() === "ar";
    for (const v of rows || []) {
      const lab = ar ? v.name_ar || v.name_en : v.name_en || v.name_ar;
      const o = document.createElement("option");
      o.value = String(v.id);
      o.textContent = lab;
      venSel.appendChild(o);
    }
    if (cur && [...venSel.options].some((x) => x.value === cur)) venSel.value = cur;
  } catch (_e) {}
}

async function loadMpEntranceForm() {
  const token = getToken();
  if (!token) return;
  try {
    const d = await api("/api/marketplace/entrance", { token });
    revokeMpEntrancePreviewObjectUrl();
    document.getElementById("mp-entrance-image").value = d.image_url || "";
    const mpEntFile = document.getElementById("mp-entrance-image-file");
    if (mpEntFile) mpEntFile.value = "";
    document.getElementById("mp-entrance-title-ar").value = d.title_ar || "";
    document.getElementById("mp-entrance-title-en").value = d.title_en || "";
    document.getElementById("mp-entrance-sub-ar").value = d.subtitle_ar || "";
    document.getElementById("mp-entrance-sub-en").value = d.subtitle_en || "";
    syncMpEntrancePreview();
  } catch (_e) {}
}

async function loadMpDepartmentsAdmin() {
  const token = getToken();
  const vid = document.getElementById("mp-dept-vendor-filter")?.value?.trim();
  if (!token || !vid) {
    adminMpDeptsCache = [];
    renderMpDepartmentsTable();
    return;
  }
  try {
    adminMpDeptsCache = await api(`/api/admin/marketplace/vendors/${encodeURIComponent(vid)}/departments`, { token });
  } catch (_e) {
    adminMpDeptsCache = [];
  }
  renderMpDepartmentsTable();
}

function renderMpDepartmentsTable() {
  const tbody = document.getElementById("mp-departments-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  const rows = Array.isArray(adminMpDeptsCache)
    ? adminMpDeptsCache.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id)
    : [];
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">${
      ar ? "لا أقسام (اختر شركة)." : "No departments (pick a vendor)."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((d) => {
      return `<tr class="border-t border-gray-100">
        <td class="p-2">${d.id}</td>
        <td class="p-2">${escapeHtml(d.name_ar || "")}</td>
        <td class="p-2">${escapeHtml(d.name_en || "")}</td>
        <td class="p-2">${escapeHtml(String(d.sort_order ?? 0))}</td>
        <td class="p-2">${d.is_active ? adminT("yes") : adminT("no")}</td>
        <td class="p-2 flex flex-wrap gap-1">
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-gray-100" data-mp-d-up="${d.id}">↑</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-gray-100" data-mp-d-down="${d.id}">↓</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700" data-mp-d-edit="${d.id}">${adminT("edit")}</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700" data-mp-d-del="${d.id}">${adminT("delete")}</button>
        </td>
      </tr>`;
    })
    .join("");
}

function mpFillDepartmentForm(d) {
  document.getElementById("mp-d-id").value = d ? String(d.id) : "";
  document.getElementById("mp-d-name-ar").value = d ? d.name_ar || "" : "";
  document.getElementById("mp-d-name-en").value = d ? d.name_en || "" : "";
  document.getElementById("mp-d-sort").value = d ? String(d.sort_order ?? 0) : "0";
  document.getElementById("mp-d-active").checked = !d || Number(d.is_active) !== 0;
}

async function mpReorderDepartmentsByMove(id, dir) {
  const token = getToken();
  const vid = document.getElementById("mp-dept-vendor-filter")?.value?.trim();
  if (!token || !vid) return;
  const rows = adminMpDeptsCache.slice().sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id);
  const idx = rows.findIndex((r) => r.id === id);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= rows.length) return;
  const next = rows.slice();
  [next[idx], next[j]] = [next[j], next[idx]];
  await api(`/api/admin/marketplace/vendors/${encodeURIComponent(vid)}/departments/reorder`, {
    method: "POST",
    token,
    body: { orderedIds: next.map((r) => r.id) },
  });
  await loadMpDepartmentsAdmin();
}

async function fillMpDepartmentSelectForProductForm(vendorId) {
  const token = getToken();
  const sel = document.getElementById("mp-p-department");
  if (!sel || !token) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${getAdminLang() === "ar" ? "— القسم داخل الشركة —" : "— Department —"}</option>`;
  const vid = Number(vendorId);
  if (!Number.isFinite(vid)) return;
  try {
    const rows = await api(`/api/admin/marketplace/vendors/${vid}/departments`, { token });
    const ar = getAdminLang() === "ar";
    for (const d of rows || []) {
      if (Number(d.is_active) === 0) continue;
      const lab = ar ? d.name_ar || d.name_en : d.name_en || d.name_ar;
      const o = document.createElement("option");
      o.value = String(d.id);
      o.textContent = lab;
      sel.appendChild(o);
    }
    if (cur && [...sel.options].some((x) => x.value === cur)) sel.value = cur;
  } catch (_e) {}
}

async function loadMpProductsAdmin() {
  const token = getToken();
  if (!token) return;
  const sid = document.getElementById("mp-prod-section-filter")?.value?.trim();
  const vid = document.getElementById("mp-prod-vendor-filter")?.value?.trim();
  const q = new URLSearchParams();
  if (sid) q.set("section_id", sid);
  if (vid) q.set("vendor_id", vid);
  const qs = q.toString();
  const path = qs ? `/api/admin/marketplace/products?${qs}` : "/api/admin/marketplace/products";
  try {
    adminMpProductsCache = await api(path, { token });
  } catch (_e) {
    adminMpProductsCache = [];
  }
  renderMpProductsTable();
}

function renderMpProductsTable() {
  const tbody = document.getElementById("mp-products-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  const rows = Array.isArray(adminMpProductsCache) ? adminMpProductsCache : [];
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">${ar ? "لا منتجات." : "No products."}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((p) => {
      const name = ar ? p.name_ar || p.name_en : p.name_en || p.name_ar;
      return `<tr class="border-t border-gray-100">
        <td class="p-2">${p.id}</td>
        <td class="p-2 max-w-[180px] truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</td>
        <td class="p-2">${escapeHtml(String(p.price))}</td>
        <td class="p-2">${escapeHtml(String(p.stock ?? 0))}</td>
        <td class="p-2 flex flex-wrap gap-1">
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-gray-100" data-mp-p-up="${p.id}">↑</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-gray-100" data-mp-p-down="${p.id}">↓</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700" data-mp-p-edit="${p.id}">${adminT("edit")}</button>
          <button type="button" class="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700" data-mp-p-del="${p.id}">${adminT("delete")}</button>
        </td>
      </tr>`;
    })
    .join("");
}

async function mpReorderProductsByMove(id, dir) {
  const token = getToken();
  if (!token) return;
  const ar = getAdminLang() === "ar";
  const vidFilter = document.getElementById("mp-prod-vendor-filter")?.value?.trim();
  if (!vidFilter) {
    alert(ar ? "اختر مول/شركة في الفلاتر أولاً لترتيب منتجاته فقط." : "Pick a vendor in the filters first to reorder that vendor's products.");
    return;
  }
  const p = adminMpProductsCache.find((x) => x.id === id);
  if (!p) return;
  const vid = p.vendor_id;
  const same = adminMpProductsCache.filter((x) => x.vendor_id === vid).sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id);
  const idx = same.findIndex((r) => r.id === id);
  const j = idx + dir;
  if (idx < 0 || j < 0 || j >= same.length) return;
  const next = same.slice();
  [next[idx], next[j]] = [next[j], next[idx]];
  await api("/api/admin/marketplace/products/reorder", {
    method: "POST",
    token,
    body: { vendor_id: vid, orderedIds: next.map((r) => r.id) },
  });
  await loadMpProductsAdmin();
}

function mpFillProductForm(p) {
  document.getElementById("mp-p-id").value = p ? String(p.id) : "";
  const secEl = document.getElementById("mp-p-section");
  if (p) {
    secEl.value = String(p.section_id);
  } else if (secEl && secEl.options.length > 1) {
    secEl.selectedIndex = 1;
  }
  document.getElementById("mp-p-name-ar").value = p ? p.name_ar || "" : "";
  document.getElementById("mp-p-name-en").value = p ? p.name_en || "" : "";
  document.getElementById("mp-p-desc-ar").value = p ? p.description_ar || "" : "";
  document.getElementById("mp-p-desc-en").value = p ? p.description_en || "" : "";
  document.getElementById("mp-p-price").value = p ? String(p.price ?? "") : "";
  const discEl = document.getElementById("mp-p-discount");
  if (discEl) discEl.value = p ? String(p.discount_percent ?? 0) : "0";
  document.getElementById("mp-p-stock").value = p ? String(p.stock ?? 0) : "0";
  document.getElementById("mp-p-sku").value = p ? p.sku || "" : "";
  document.getElementById("mp-p-barcode").value = p ? p.barcode || "" : "";
  const imgs = Array.isArray(p?.images) ? p.images : [];
  document.getElementById("mp-p-images").value = imgs.join("\n");
  document.getElementById("mp-p-sort").value = p ? String(p.sort_order ?? 0) : "0";
  document.getElementById("mp-p-offer").checked = p && Number(p.is_offer) === 1;
  document.getElementById("mp-p-featured").checked = p && Number(p.is_mp_featured) === 1;
  document.getElementById("mp-p-active").checked = !p || Number(p.is_active) !== 0;
  const f = document.getElementById("mp-p-images-file");
  if (f) f.value = "";
  const sid = p ? p.section_id : secEl?.value;
  if (p) {
    fillMpVendorSelectForProductForm(sid)
      .then(() => {
        const vs = document.getElementById("mp-p-vendor");
        if (vs) vs.value = String(p.vendor_id);
        return fillMpDepartmentSelectForProductForm(p.vendor_id);
      })
      .then(() => {
        const ds = document.getElementById("mp-p-department");
        if (ds && p.department_id != null) ds.value = String(p.department_id);
        pvHydrateFromProduct(p, "mpv-builder-root");
      })
      .catch(() => {
        pvHydrateFromProduct(p, "mpv-builder-root");
      });
  } else {
    pvHydrateFromProduct(null, "mpv-builder-root");
    fillMpVendorSelectForProductForm(sid || "")
      .then(() => {
        const vs = document.getElementById("mp-p-vendor");
        return fillMpDepartmentSelectForProductForm(vs?.value);
      })
      .catch(() => {});
  }
}

async function initMarketplaceAdminTab() {
  setMpSubtab("sections");
  await loadMpSections();
  await loadMpEntranceForm();
  await loadMpVendorsForAdminFilter();
  await fillMpProdVendorFilterDropdown();
  await fillMpDeptVendorFilterDropdown();
  await loadMpDepartmentsAdmin();
  await loadMpProductsAdmin();
  bindMarketplaceAdminListeners();
  initMarketplaceProductVariantBuilderUi();
}

async function loadMpHomePlacementsAdmin() {
  const token = getToken();
  if (!token) return;
  try {
    adminMpHomePlacementsAll = await api("/api/admin/marketplace/home-placements", { token });
  } catch (_e) {
    adminMpHomePlacementsAll = [];
  }
  renderMpHomePlacementsTable();
}

function renderMpHomePlacementsTable() {
  const tbody = document.getElementById("mp-hp-tbody");
  const slotEl = document.getElementById("mp-hp-slot");
  if (!tbody || !slotEl) return;
  const slot = slotEl.value;
  const ar = getAdminLang() === "ar";
  const rows = adminMpHomePlacementsAll
    .filter((r) => r.slot === slot)
    .sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-gray-500">${ar ? "لا عناصر في هذا الشريط." : "No items in this strip."}</td></tr>`;
    return;
  }
  const ttLab = (tt) =>
    tt === "vendor" ? (ar ? "شركة" : "Company") : tt === "department" ? (ar ? "قسم" : "Dept") : ar ? "منتج" : "Product";
  tbody.innerHTML = rows
    .map(
      (r) => `<tr>
      <td class="p-2">${r.sort_order}</td>
      <td class="p-2">${escapeHtml(ttLab(r.target_type))}</td>
      <td class="p-2 font-mono">${r.target_id}</td>
      <td class="p-2"><button type="button" class="text-red-600 font-bold text-xs" data-mp-hp-del="${r.id}">${ar ? "حذف" : "Remove"}</button></td>
    </tr>`
    )
    .join("");
}

async function mpHomePlacementSaveSlotItems(slot, items) {
  const token = getToken();
  if (!token) return;
  await api(`/api/admin/marketplace/home-placements/${encodeURIComponent(slot)}`, {
    method: "PUT",
    token,
    body: { items },
  });
  await loadMpHomePlacementsAdmin();
}

function bindMarketplaceAdminListeners() {
  if (adminMpListenersBound) return;
  adminMpListenersBound = true;

  document.querySelectorAll(".mp-subtab").forEach((b) => {
    b.addEventListener("click", () => {
      const sub = b.getAttribute("data-mp-sub");
      if (sub) {
        setMpSubtab(sub);
        if (sub === "homeplacements") loadMpHomePlacementsAdmin().catch(() => {});
      }
    });
  });

  document.getElementById("btn-mp-refresh-sections")?.addEventListener("click", () => loadMpSections().catch(() => {}));
  document.getElementById("btn-mp-new-section")?.addEventListener("click", () => mpFillSectionForm(null));

  document.getElementById("mp-sections-tbody")?.addEventListener("click", (e) => {
    const u = e.target.closest("[data-mp-sec-up]");
    const d = e.target.closest("[data-mp-sec-down]");
    const ed = e.target.closest("[data-mp-sec-edit]");
    const del = e.target.closest("[data-mp-sec-del]");
    if (u) mpReorderSectionsByMove(Number(u.getAttribute("data-mp-sec-up")), -1).catch((err) => alert(err.message || err));
    if (d) mpReorderSectionsByMove(Number(d.getAttribute("data-mp-sec-down")), 1).catch((err) => alert(err.message || err));
    if (ed) {
      const id = Number(ed.getAttribute("data-mp-sec-edit"));
      const s = adminMpSectionsCache.find((x) => x.id === id);
      if (s) mpFillSectionForm(s);
    }
    if (del) {
      const id = Number(del.getAttribute("data-mp-sec-del"));
      if (!confirm(adminT("confirmDeleteCategory"))) return;
      api(`/api/admin/marketplace/sections/${id}`, { method: "DELETE", token: getToken() })
        .then(() => loadMpSections())
        .catch((err) => alert(err.message || err));
    }
  });

  document.getElementById("mp-section-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    const id = document.getElementById("mp-sec-id").value.trim();
    let card_image_url = document.getElementById("mp-sec-card").value.trim() || null;
    const cardFile = document.getElementById("mp-sec-card-file")?.files?.[0];
    if (cardFile) {
      try {
        const up = await uploadImageFile(cardFile, token);
        if (up) card_image_url = up;
      } catch (err) {
        alert(err.message || String(err));
        return;
      }
    }
    const body = {
      slug: document.getElementById("mp-sec-slug").value.trim(),
      name_ar: document.getElementById("mp-sec-name-ar").value.trim(),
      name_en: document.getElementById("mp-sec-name-en").value.trim(),
      subtitle_ar: document.getElementById("mp-sec-sub-ar").value.trim(),
      subtitle_en: document.getElementById("mp-sec-sub-en").value.trim(),
      card_image_url,
      sort_order: Number(document.getElementById("mp-sec-sort").value || 0),
      is_active: document.getElementById("mp-sec-active").checked ? 1 : 0,
    };
    try {
      if (id) {
        await api(`/api/admin/marketplace/sections/${id}`, { method: "PUT", token, body });
      } else {
        await api("/api/admin/marketplace/sections", { method: "POST", token, body });
      }
      const cfin = document.getElementById("mp-sec-card-file");
      if (cfin) cfin.value = "";
      if (card_image_url) document.getElementById("mp-sec-card").value = card_image_url;
      await loadMpSections();
      alert(getAdminLang() === "ar" ? "تم الحفظ." : "Saved.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("mp-vendor-section-filter")?.addEventListener("change", () => loadMpVendorsForAdminFilter().catch(() => {}));
  document.getElementById("btn-mp-refresh-vendors")?.addEventListener("click", () => loadMpVendorsForAdminFilter().catch(() => {}));
  document.getElementById("btn-mp-new-vendor")?.addEventListener("click", () => {
    mpFillVendorForm(null);
    const sid = document.getElementById("mp-vendor-section-filter")?.value;
    if (sid) document.getElementById("mp-v-section").value = sid;
  });

  document.getElementById("mp-vendors-tbody")?.addEventListener("click", (e) => {
    const u = e.target.closest("[data-mp-v-up]");
    const d = e.target.closest("[data-mp-v-down]");
    const ed = e.target.closest("[data-mp-v-edit]");
    const del = e.target.closest("[data-mp-v-del]");
    if (u) mpReorderVendorsByMove(Number(u.getAttribute("data-mp-v-up")), -1).catch((err) => alert(err.message || err));
    if (d) mpReorderVendorsByMove(Number(d.getAttribute("data-mp-v-down")), 1).catch((err) => alert(err.message || err));
    if (ed) {
      const id = Number(ed.getAttribute("data-mp-v-edit"));
      const v = adminMpVendorsCache.find((x) => x.id === id);
      if (v) mpFillVendorForm(v);
    }
    if (del) {
      const id = Number(del.getAttribute("data-mp-v-del"));
      if (!confirm(adminT("confirmDeleteBrand"))) return;
      api(`/api/admin/marketplace/vendors/${id}`, { method: "DELETE", token: getToken() })
        .then(() => loadMpVendorsForAdminFilter())
        .catch((err) => alert(err.message || err));
    }
  });

  document.getElementById("mp-vendor-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    const id = document.getElementById("mp-v-id").value.trim();
    let logo_url = document.getElementById("mp-v-logo").value.trim() || null;
    let cover_image_url = document.getElementById("mp-v-cover").value.trim() || null;
    const logoFile = document.getElementById("mp-v-logo-file")?.files?.[0];
    const coverFile = document.getElementById("mp-v-cover-file")?.files?.[0];
    if (logoFile) {
      try {
        const up = await uploadImageFile(logoFile, token);
        if (up) logo_url = up;
      } catch (err) {
        alert(err.message || String(err));
        return;
      }
    }
    if (coverFile) {
      try {
        const up = await uploadImageFile(coverFile, token);
        if (up) cover_image_url = up;
      } catch (err) {
        alert(err.message || String(err));
        return;
      }
    }
    const premiumUntilRaw = document.getElementById("mp-v-premium-until")?.value?.trim();
    const premium_until = premiumUntilRaw
      ? new Date(premiumUntilRaw).toISOString()
      : null;
    const body = {
      section_id: Number(document.getElementById("mp-v-section").value),
      name_ar: document.getElementById("mp-v-name-ar").value.trim(),
      name_en: document.getElementById("mp-v-name-en").value.trim(),
      vendor_type: document.getElementById("mp-v-type").value === "mall" ? "mall" : "company",
      logo_url,
      cover_image_url,
      sort_order: Number(document.getElementById("mp-v-sort").value || 0),
      search_priority: Math.max(
        0,
        Math.min(1000, Math.floor(Number(document.getElementById("mp-v-search-priority")?.value || 0)))
      ),
      is_active: document.getElementById("mp-v-active").checked ? 1 : 0,
      paid_product_slots: Number(document.getElementById("mp-v-paid-slots").value || 0),
      is_premium: document.getElementById("mp-v-premium").checked ? 1 : 0,
      premium_subscription_type: document.getElementById("mp-v-premium-type").value || "none",
      premium_until,
    };
    if (!Number.isFinite(body.section_id)) {
      alert(getAdminLang() === "ar" ? "اختر القسم." : "Choose section.");
      return;
    }
    try {
      if (id) {
        await api(`/api/admin/marketplace/vendors/${id}`, { method: "PUT", token, body });
      } else {
        await api("/api/admin/marketplace/vendors", { method: "POST", token, body });
      }
      const lfin = document.getElementById("mp-v-logo-file");
      const cfin = document.getElementById("mp-v-cover-file");
      if (lfin) lfin.value = "";
      if (cfin) cfin.value = "";
      if (logo_url) document.getElementById("mp-v-logo").value = logo_url;
      if (cover_image_url) document.getElementById("mp-v-cover").value = cover_image_url;
      const fsid = String(body.section_id);
      const f = document.getElementById("mp-vendor-section-filter");
      if (f) f.value = fsid;
      await loadMpVendorsForAdminFilter();
      alert(getAdminLang() === "ar" ? "تم الحفظ." : "Saved.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("mp-prod-section-filter")?.addEventListener("change", () => {
    fillMpProdVendorFilterDropdown()
      .then(() => loadMpProductsAdmin())
      .catch(() => {});
  });
  document.getElementById("mp-prod-vendor-filter")?.addEventListener("change", () => loadMpProductsAdmin().catch(() => {}));
  document.getElementById("btn-mp-refresh-products")?.addEventListener("click", () => loadMpProductsAdmin().catch(() => {}));
  document.getElementById("btn-mp-new-product")?.addEventListener("click", () => mpFillProductForm(null));

  document.getElementById("btn-mp-save-entrance")?.addEventListener("click", async () => {
    const token = getToken();
    if (!token) return;
    let image_url = document.getElementById("mp-entrance-image").value.trim() || "";
    const entranceImgFile = document.getElementById("mp-entrance-image-file")?.files?.[0];
    if (entranceImgFile) {
      try {
        const up = await uploadImageFile(entranceImgFile, token);
        if (!up) {
          alert(getAdminLang() === "ar" ? "الرفع لم يُرجع رابطاً للصورة." : "Upload did not return an image URL.");
          return;
        }
        image_url = up;
      } catch (err) {
        alert(err.message || String(err));
        return;
      }
    }
    const body = {
      image_url,
      title_ar: document.getElementById("mp-entrance-title-ar").value.trim(),
      title_en: document.getElementById("mp-entrance-title-en").value.trim(),
      subtitle_ar: document.getElementById("mp-entrance-sub-ar").value.trim(),
      subtitle_en: document.getElementById("mp-entrance-sub-en").value.trim(),
    };
    try {
      const saved = await api("/api/admin/marketplace/entrance", { method: "PUT", token, body });
      revokeMpEntrancePreviewObjectUrl();
      const fin = document.getElementById("mp-entrance-image-file");
      if (fin) fin.value = "";
      const persisted = saved && saved.image_url != null ? String(saved.image_url).trim() : "";
      if (persisted) document.getElementById("mp-entrance-image").value = persisted;
      else if (image_url) document.getElementById("mp-entrance-image").value = image_url;
      syncMpEntrancePreview();
      alert(getAdminLang() === "ar" ? "تم حفظ واجهة الدخول." : "Entrance saved.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("mp-entrance-image")?.addEventListener("input", () => {
    revokeMpEntrancePreviewObjectUrl();
    const fileInp = document.getElementById("mp-entrance-image-file");
    if (fileInp) fileInp.value = "";
    syncMpEntrancePreview();
  });

  document.getElementById("mp-entrance-image-file")?.addEventListener("change", (e) => {
    revokeMpEntrancePreviewObjectUrl();
    const prev = document.getElementById("mp-entrance-preview");
    const f = e.target && e.target.files && e.target.files[0];
    if (!prev) return;
    if (f) {
      mpEntrancePreviewObjectUrl = URL.createObjectURL(f);
      prev.src = mpEntrancePreviewObjectUrl;
      prev.classList.remove("hidden");
    } else {
      syncMpEntrancePreview();
    }
  });

  document.getElementById("mp-dept-section-filter")?.addEventListener("change", () => {
    fillMpDeptVendorFilterDropdown()
      .then(() => loadMpDepartmentsAdmin())
      .catch(() => {});
  });
  document.getElementById("mp-dept-vendor-filter")?.addEventListener("change", () => loadMpDepartmentsAdmin().catch(() => {}));
  document.getElementById("btn-mp-refresh-departments")?.addEventListener("click", () => loadMpDepartmentsAdmin().catch(() => {}));
  document.getElementById("btn-mp-new-department")?.addEventListener("click", () => mpFillDepartmentForm(null));

  document.getElementById("mp-departments-tbody")?.addEventListener("click", (e) => {
    const u = e.target.closest("[data-mp-d-up]");
    const d = e.target.closest("[data-mp-d-down]");
    const ed = e.target.closest("[data-mp-d-edit]");
    const del = e.target.closest("[data-mp-d-del]");
    if (u) mpReorderDepartmentsByMove(Number(u.getAttribute("data-mp-d-up")), -1).catch((err) => alert(err.message || err));
    if (d) mpReorderDepartmentsByMove(Number(d.getAttribute("data-mp-d-down")), 1).catch((err) => alert(err.message || err));
    if (ed) {
      const id = Number(ed.getAttribute("data-mp-d-edit"));
      const row = adminMpDeptsCache.find((x) => x.id === id);
      if (row) mpFillDepartmentForm(row);
    }
    if (del) {
      const id = Number(del.getAttribute("data-mp-d-del"));
      if (!confirm(adminT("confirmDeleteCategory"))) return;
      api(`/api/admin/marketplace/departments/${id}`, { method: "DELETE", token: getToken() })
        .then(() => loadMpDepartmentsAdmin())
        .catch((err) => alert(err.message || err));
    }
  });

  document.getElementById("mp-department-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    const vid = document.getElementById("mp-dept-vendor-filter")?.value?.trim();
    if (!vid) {
      alert(getAdminLang() === "ar" ? "اختر الشركة أولاً." : "Choose a vendor first.");
      return;
    }
    const id = document.getElementById("mp-d-id").value.trim();
    const body = {
      name_ar: document.getElementById("mp-d-name-ar").value.trim(),
      name_en: document.getElementById("mp-d-name-en").value.trim(),
      sort_order: Number(document.getElementById("mp-d-sort").value || 0),
      is_active: document.getElementById("mp-d-active").checked ? 1 : 0,
    };
    try {
      if (id) {
        await api(`/api/admin/marketplace/departments/${id}`, { method: "PUT", token, body });
      } else {
        await api(`/api/admin/marketplace/vendors/${encodeURIComponent(vid)}/departments`, { method: "POST", token, body });
      }
      mpFillDepartmentForm(null);
      await loadMpDepartmentsAdmin();
      alert(getAdminLang() === "ar" ? "تم الحفظ." : "Saved.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("mp-p-section")?.addEventListener("change", () => {
    const sid = document.getElementById("mp-p-section").value;
    fillMpVendorSelectForProductForm(sid)
      .then(() => {
        const vs = document.getElementById("mp-p-vendor");
        return fillMpDepartmentSelectForProductForm(vs?.value);
      })
      .catch(() => {});
  });

  document.getElementById("mp-p-vendor")?.addEventListener("change", () => {
    const vs = document.getElementById("mp-p-vendor");
    fillMpDepartmentSelectForProductForm(vs?.value).catch(() => {});
  });

  document.getElementById("mp-products-tbody")?.addEventListener("click", (e) => {
    const u = e.target.closest("[data-mp-p-up]");
    const d = e.target.closest("[data-mp-p-down]");
    const ed = e.target.closest("[data-mp-p-edit]");
    const del = e.target.closest("[data-mp-p-del]");
    if (u) mpReorderProductsByMove(Number(u.getAttribute("data-mp-p-up")), -1).catch((err) => alert(err.message || err));
    if (d) mpReorderProductsByMove(Number(d.getAttribute("data-mp-p-down")), 1).catch((err) => alert(err.message || err));
    if (ed) {
      const id = Number(ed.getAttribute("data-mp-p-edit"));
      const p = adminMpProductsCache.find((x) => x.id === id);
      if (p) mpFillProductForm(p);
    }
    if (del) {
      const id = Number(del.getAttribute("data-mp-p-del"));
      if (!confirm(adminT("confirmDeleteProduct"))) return;
      api(`/api/admin/marketplace/products/${id}`, { method: "DELETE", token: getToken() })
        .then(() => loadMpProductsAdmin())
        .catch((err) => alert(err.message || err));
    }
  });

  document.getElementById("mp-product-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    const id = document.getElementById("mp-p-id").value.trim();
    let images = mpParseImageUrls(document.getElementById("mp-p-images").value);
    const fileInput = document.getElementById("mp-p-images-file");
    if (fileInput && fileInput.files && fileInput.files.length) {
      for (const file of fileInput.files) {
        try {
          const url = await uploadImageFile(file, token);
          if (url) images.push(url);
        } catch (err) {
          alert(err.message || String(err));
          return;
        }
      }
    }
    const mpvPack = pvSerializeForPayload("mpv-builder-root");
    let product_options = mpvPack.product_options || [];
    let inventory = [];
    let stockVal = Number(document.getElementById("mp-p-stock").value || 0);
    if (product_options.length) {
      inventory = Array.isArray(mpvPack.inventoryFromBuilder) ? mpvPack.inventoryFromBuilder : [];
      stockVal = inventory.reduce((a, r) => a + Math.max(0, Math.floor(Number(r.stock) || 0)), 0);
    }
    const body = {
      section_id: Number(document.getElementById("mp-p-section").value),
      vendor_id: Number(document.getElementById("mp-p-vendor").value),
      name_ar: document.getElementById("mp-p-name-ar").value.trim(),
      name_en: document.getElementById("mp-p-name-en").value.trim(),
      description_ar: document.getElementById("mp-p-desc-ar").value.trim(),
      description_en: document.getElementById("mp-p-desc-en").value.trim(),
      price: Number(document.getElementById("mp-p-price").value || 0),
      stock: stockVal,
      sku: document.getElementById("mp-p-sku").value.trim(),
      barcode: document.getElementById("mp-p-barcode").value.trim(),
      images,
      product_options,
      inventory,
      is_offer: document.getElementById("mp-p-offer").checked ? 1 : 0,
      is_mp_featured: document.getElementById("mp-p-featured").checked ? 1 : 0,
      sort_order: Number(document.getElementById("mp-p-sort").value || 0),
      is_active: document.getElementById("mp-p-active").checked ? 1 : 0,
      discount_percent: Number(document.getElementById("mp-p-discount")?.value || 0),
      department_id: (() => {
        const v = document.getElementById("mp-p-department")?.value?.trim();
        return v ? Number(v) : undefined;
      })(),
    };
    if (!Number.isFinite(body.section_id) || !Number.isFinite(body.vendor_id)) {
      alert(getAdminLang() === "ar" ? "اختر القسم والمورد." : "Choose section and vendor.");
      return;
    }
    try {
      if (id) {
        await api(`/api/admin/marketplace/products/${id}`, { method: "PUT", token, body });
      } else {
        await api("/api/admin/marketplace/products", { method: "POST", token, body });
      }
      await loadMpProductsAdmin();
      alert(getAdminLang() === "ar" ? "تم الحفظ." : "Saved.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById("mp-hp-slot")?.addEventListener("change", () => renderMpHomePlacementsTable());
  document.getElementById("btn-mp-hp-refresh")?.addEventListener("click", () => loadMpHomePlacementsAdmin().catch(() => {}));
  document.getElementById("mp-hp-tbody")?.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-mp-hp-del]");
    if (!del) return;
    const id = del.getAttribute("data-mp-hp-del");
    const token = getToken();
    if (!token || !id) return;
    if (!confirm(getAdminLang() === "ar" ? "إزالة هذا العنصر من الشريط؟" : "Remove this item from the strip?")) return;
    try {
      await api(`/api/admin/marketplace/home-placements/item/${id}`, { method: "DELETE", token });
      await loadMpHomePlacementsAdmin();
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  document.getElementById("btn-mp-hp-add")?.addEventListener("click", async () => {
    const slot = document.getElementById("mp-hp-slot")?.value;
    const tt = document.getElementById("mp-hp-tt")?.value;
    const tid = Number(document.getElementById("mp-hp-id")?.value);
    const token = getToken();
    if (!token || !slot || !tt || !Number.isFinite(tid)) {
      alert(getAdminLang() === "ar" ? "أكمل الحقول." : "Fill all fields.");
      return;
    }
    const cur = adminMpHomePlacementsAll.filter((r) => r.slot === slot);
    const items = cur.map((r) => ({ target_type: r.target_type, target_id: r.target_id, sort_order: r.sort_order }));
    const maxO = items.reduce((m, r) => Math.max(m, r.sort_order), -1);
    items.push({ target_type: tt, target_id: tid, sort_order: maxO + 1 });
    try {
      await mpHomePlacementSaveSlotItems(slot, items);
      document.getElementById("mp-hp-id").value = "";
      alert(getAdminLang() === "ar" ? "تمت الإضافة." : "Added.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  document.getElementById("btn-mp-hp-bulk-vendor")?.addEventListener("click", async () => {
    const slot = document.getElementById("mp-hp-slot")?.value;
    const vendor_id = Number(document.getElementById("mp-hp-bulk-vid")?.value);
    const token = getToken();
    if (!token || !slot || !Number.isFinite(vendor_id)) {
      alert(getAdminLang() === "ar" ? "اختر الشريط ومعرّف الشركة." : "Choose strip and company ID.");
      return;
    }
    try {
      await api("/api/admin/marketplace/home-placements/bulk-vendor", {
        method: "POST",
        token,
        body: { slot, vendor_id },
      });
      await loadMpHomePlacementsAdmin();
      alert(getAdminLang() === "ar" ? "تمت الإضافة." : "Added.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  document.getElementById("btn-mp-hp-bulk-dept")?.addEventListener("click", async () => {
    const slot = document.getElementById("mp-hp-slot")?.value;
    const department_id = Number(document.getElementById("mp-hp-bulk-did")?.value);
    const token = getToken();
    if (!token || !slot || !Number.isFinite(department_id)) {
      alert(getAdminLang() === "ar" ? "اختر الشريط ومعرّف القسم." : "Choose strip and department ID.");
      return;
    }
    try {
      await api("/api/admin/marketplace/home-placements/bulk-department", {
        method: "POST",
        token,
        body: { slot, department_id },
      });
      await loadMpHomePlacementsAdmin();
      alert(getAdminLang() === "ar" ? "تمت الإضافة." : "Added.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });
}

async function loadBanners() {
  const token = getToken();
  if (!token) return;
  try {
    adminBannersCache = await api("/api/admin/banners", { token });
  } catch (_e) {
    adminBannersCache = [];
  }
  renderBannersTable();
}

/** تمييز صف بانر الشريط: إعلان ممول vs رابط ينتهي بانضمام شركة أو طلب إعلان (استدلال من الرابط والنص) */
function classifyAppBannerKind(b) {
  const bk = String(b.banner_kind || "").toLowerCase().replace(/-/g, "_");
  if (bk === "customer_note") return "customer_note";
  const link = String(b.link_url || "").toLowerCase();
  const blob = `${link} ${String(b.title_ar || "").toLowerCase()} ${String(b.title_en || "").toLowerCase()} ${String(b.body_ar || "").toLowerCase()} ${String(b.body_en || "").toLowerCase()}`;
  if (/screen-vendor-join|vendor-join|vendor_join|openvendorjoin|partner_with|انضم\s*كشركة|انضمام|join\s*adora|join-company/.test(blob)) return "vendor_join";
  if (/screen-app-ad|app-ad-inquir|app_ad_inquir|openappad|طلب\s*إعلان|إعلان\s*منتج|advertise|bullhorn/.test(blob)) return "ad_inquiry";
  return "sponsored";
}

function bannerKindLabelHtml(kind, ar) {
  if (kind === "customer_note") {
    return ar
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap" title="ملاحظات زبائن — يفتح نموذج إرسال"><i class="fas fa-message text-[9px] opacity-80"></i>ملاحظات الزبائن</span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap" title="Customer notes — opens submit form"><i class="fas fa-message text-[9px] opacity-80"></i>Customer notes</span>`;
  }
  if (kind === "vendor_join") {
    return ar
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap" title="رابط أو نص يشير لصفحة انضمام شركة"><i class="fas fa-handshake text-[9px] opacity-80"></i>انضم لشركة أدورا</span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap" title="Link/text points to vendor join"><i class="fas fa-handshake text-[9px] opacity-80"></i>Join Adora company</span>`;
  }
  if (kind === "ad_inquiry") {
    return ar
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-fuchsia-50 text-fuchsia-900 border border-fuchsia-200 whitespace-nowrap" title="رابط أو نص يشير لطلب إعلان"><i class="fas fa-bullhorn text-[9px] opacity-80"></i>إعلان / طلب إعلان</span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-fuchsia-50 text-fuchsia-900 border border-fuchsia-200 whitespace-nowrap" title="Link/text points to ad inquiry"><i class="fas fa-bullhorn text-[9px] opacity-80"></i>Ad / inquiry</span>`;
  }
  return ar
    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-violet-50 text-violet-800 border border-violet-200 whitespace-nowrap" title="بانر شريط ترويجي في الموضع المختار"><i class="fas fa-rectangle-ad text-[9px] opacity-80"></i>إعلان ممول (شريط)</span>`
    : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-violet-50 text-violet-800 border border-violet-200 whitespace-nowrap" title="Promotional strip banner"><i class="fas fa-rectangle-ad text-[9px] opacity-80"></i>Sponsored (strip)</span>`;
}

function renderBannersTable() {
  const tbody = document.getElementById("banners-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  const list = Array.isArray(adminBannersCache) ? adminBannersCache : [];
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-gray-500">${
      ar ? "لا بانرات بعد." : "No banners yet."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((b) => {
      const kind = classifyAppBannerKind(b);
      return `<tr>
        <td class="py-2">${b.id}</td>
        <td class="py-2 align-top">${bannerKindLabelHtml(kind, ar)}</td>
        <td class="py-2 font-mono text-xs">${escapeHtml(b.placement)}</td>
        <td class="py-2 max-w-[140px] truncate">${
          b.image_url && String(b.image_url).trim()
            ? `<a href="${escapeHtml(b.image_url)}" target="_blank" rel="noopener" class="text-purple-600">${ar ? "صورة" : "Image"}</a>`
            : `<span class="text-gray-400">${ar ? "نص فقط" : "Text only"}</span>`
        }</td>
        <td class="py-2">${b.active ? adminT("yes") : adminT("no")}</td>
        <td class="py-2">
          <button type="button" class="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs" data-banner-edit="${b.id}">${adminT("edit")}</button>
          <button type="button" class="px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs mr-1" data-banner-del="${b.id}">${adminT("delete")}</button>
        </td>
      </tr>`;
    })
    .join("");
  const token = getToken();
  tbody.querySelectorAll("[data-banner-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-banner-edit"));
      const b = list.find((x) => x.id === id);
      if (!b) return;
      document.getElementById("banner-id").value = b.id;
      document.getElementById("banner-title-ar").value = b.title_ar || "";
      document.getElementById("banner-title-en").value = b.title_en || "";
      document.getElementById("banner-body-ar").value = b.body_ar || "";
      document.getElementById("banner-body-en").value = b.body_en || "";
      document.getElementById("banner-image-url").value = b.image_url || "";
      document.getElementById("banner-link-url").value = b.link_url || "";
      document.getElementById("banner-placement").value = b.placement || "home_top";
      const bkEl = document.getElementById("banner-kind");
      if (bkEl) bkEl.value = String(b.banner_kind || "standard").toLowerCase() === "customer_note" ? "customer_note" : "standard";
      document.getElementById("banner-sort").value = String(b.sort_order ?? 0);
      document.getElementById("banner-active").checked = Number(b.active) !== 0;
      document.getElementById("banner-image-file").value = "";
    });
  });
  tbody.querySelectorAll("[data-banner-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(ar ? "حذف البانر؟" : "Delete banner?")) return;
      const id = btn.getAttribute("data-banner-del");
      await api(`/api/admin/banners/${id}`, { method: "DELETE", token });
      await loadBanners();
    });
  });
}

async function saveBanner(e) {
  e.preventDefault();
  const token = getToken();
  if (!token) return;
  const ar = getAdminLang() === "ar";
  const id = document.getElementById("banner-id").value ? Number(document.getElementById("banner-id").value) : null;
  let image_url = document.getElementById("banner-image-url").value.trim();
  const file = document.getElementById("banner-image-file")?.files?.[0];
  if (file) {
    const up = await uploadImageFile(file, token);
    if (up) image_url = up;
  }
  const banner_kind = document.getElementById("banner-kind")?.value || "standard";
  const body = {
    title_ar: document.getElementById("banner-title-ar").value.trim(),
    title_en: document.getElementById("banner-title-en").value.trim(),
    body_ar: document.getElementById("banner-body-ar").value.trim(),
    body_en: document.getElementById("banner-body-en").value.trim(),
    image_url: image_url || "",
    link_url: document.getElementById("banner-link-url").value.trim(),
    placement: document.getElementById("banner-placement").value.trim(),
    sort_order: Number(document.getElementById("banner-sort").value || 0),
    active: document.getElementById("banner-active").checked ? 1 : 0,
    banner_kind,
  };
  if (!body.placement) {
    alert(ar ? "اختر موضع العرض." : "Choose placement.");
    return;
  }
  if (banner_kind !== "customer_note") {
    if (!body.title_ar && !body.title_en) {
      alert(ar ? "أدخل عنواناً عربياً أو إنجليزياً." : "Enter a title in Arabic or English.");
      return;
    }
    if (!body.body_ar && !body.body_en) {
      alert(ar ? "أدخل نصاً عربياً أو إنجليزياً." : "Enter body text in Arabic or English.");
      return;
    }
  } else {
    const hasImg = !!body.image_url;
    const hasCta = (body.title_ar || body.title_en) && (body.body_ar || body.body_en);
    if (!hasImg && !hasCta) {
      alert(ar ? "لملاحظات الزبائن: أضف صورة أو عنواناً ونصاً (مثل بنر انضم كشركة)." : "For customer notes: add an image or title+body (like join CTA).");
      return;
    }
  }
  if (id) {
    await api(`/api/admin/banners/${id}`, { method: "PUT", token, body });
  } else {
    await api("/api/admin/banners", { method: "POST", token, body });
  }
  document.getElementById("banner-id").value = "";
  document.getElementById("banner-image-file").value = "";
  await loadBanners();
  alert(ar ? "تم حفظ البانر." : "Banner saved.");
}

function resetBannerForm() {
  document.getElementById("banner-id").value = "";
  document.getElementById("banner-title-ar").value = "";
  document.getElementById("banner-title-en").value = "";
  document.getElementById("banner-body-ar").value = "";
  document.getElementById("banner-body-en").value = "";
  document.getElementById("banner-image-url").value = "";
  document.getElementById("banner-link-url").value = "";
  document.getElementById("banner-placement").value = "home_top";
  const bkEl = document.getElementById("banner-kind");
  if (bkEl) bkEl.value = "standard";
  document.getElementById("banner-sort").value = "0";
  document.getElementById("banner-active").checked = true;
  document.getElementById("banner-image-file").value = "";
}

async function login() {
  const phone = document.getElementById("admin-phone").value.trim();
  const password = document.getElementById("admin-password").value;
  const errEl = document.getElementById("auth-error");
  hideError(errEl);
  try {
    const data = await api("/api/auth/login", { method: "POST", body: { phone, password } });
    if (!isAdminRole(data.user?.role)) {
      showError(errEl, adminT("adminOnlyLogin"));
      return;
    }
    setToken(data.token);
    await bootstrapAuthed();
  } catch (e) {
    showError(errEl, e.message);
  }
}

async function uploadImageFile(file, token) {
  const fd = new FormData();
  fd.append("file", file);
  const data = await api("/api/upload/image", { method: "POST", token, body: fd, isFormData: true });
  return data.url;
}

/** بنّاء مواصفات ديناميكية + صفوف مخزون (خيارات / سعر / مخزون / صورة) */
function pvGenId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function pvLegacyToBuilderState(product) {
  const inv = Array.isArray(product.inventory) ? product.inventory : [];
  const sizeSet = new Set();
  const colorSet = new Set();
  for (const row of inv) {
    if (row.size != null && String(row.size).trim()) sizeSet.add(String(row.size).trim());
    if (row.color != null && String(row.color).trim()) colorSet.add(String(row.color).trim());
  }
  const sizes = (Array.isArray(product.sizes) && product.sizes.length ? product.sizes : [...sizeSet])
    .map((s) => String(s).trim())
    .filter(Boolean);
  const colors = (Array.isArray(product.colors) && product.colors.length ? product.colors : [...colorSet])
    .map((c) => String(c).trim())
    .filter(Boolean);
  const groups = [];
  if (sizes.length) {
    groups.push({
      id: "size",
      name_ar: "المقاس",
      name_en: "Size",
      values: sizes.map((s, i) => ({ id: `size_v_${i}`, label_ar: s, label_en: s })),
    });
  }
  if (colors.length) {
    groups.push({
      id: "color",
      name_ar: "اللون",
      name_en: "Color",
      values: colors.map((c, i) => ({ id: `color_v_${i}`, label_ar: c, label_en: c })),
    });
  }
  const sizeVals = groups.find((g) => g.id === "size")?.values || [];
  const colorVals = groups.find((g) => g.id === "color")?.values || [];
  const findV = (vals, label) => {
    const t = String(label || "").trim();
    const hit = vals.find((v) => String(v.label_en).trim() === t || String(v.label_ar).trim() === t);
    return hit ? hit.id : "";
  };
  const variants = inv.map((row) => ({
    options: {
      ...(sizeVals.length ? { size: findV(sizeVals, row.size) } : {}),
      ...(colorVals.length ? { color: findV(colorVals, row.color) } : {}),
    },
    price: row.price != null && row.price !== "" ? row.price : "",
    stock: row.stock != null ? row.stock : 0,
    image: row.image || "",
  }));
  return { groups, variants };
}

function pvDeriveFilterArrays(groups) {
  const sizes = [];
  const colors = [];
  for (const g of groups || []) {
    const id = String(g.id || "").toLowerCase();
    const ne = String(g.name_en || "").toLowerCase();
    const nar = String(g.name_ar || "");
    const labels = (g.values || []).map((v) => String(v.label_en || v.label_ar || "").trim()).filter(Boolean);
    if (id === "size" || ne.includes("size") || nar.includes("مقاس")) sizes.push(...labels);
    else if (id === "color" || ne.includes("color") || nar.includes("لون")) colors.push(...labels);
  }
  return { sizes: [...new Set(sizes)], colors: [...new Set(colors)] };
}

function pvGetBuilderRoot(rootId) {
  const id = rootId || "pv-builder-root";
  return document.getElementById(id);
}

function pvReadBuilderFromDom(rootId = "pv-builder-root") {
  const root = pvGetBuilderRoot(rootId);
  if (!root) return { groups: [], variants: [] };
  const groups = [];
  root.querySelectorAll(".pv-group-card").forEach((card) => {
    const id = card.querySelector(".pv-g-id")?.value?.trim() || pvGenId("opt");
    const name_en = card.querySelector(".pv-g-ne")?.value?.trim() || "Option";
    const name_ar = card.querySelector(".pv-g-na")?.value?.trim() || "خيار";
    const values = [];
    card.querySelectorAll(".pv-val-row").forEach((vr) => {
      const vid = vr.getAttribute("data-vid") || pvGenId("v");
      const label_en = vr.querySelector(".pv-v-en")?.value?.trim() || "";
      const label_ar = vr.querySelector(".pv-v-ar")?.value?.trim() || "";
      if (label_en || label_ar) values.push({ id: vid, label_en: label_en || label_ar, label_ar: label_ar || label_en });
    });
    groups.push({ id, name_en, name_ar, values });
  });
  const variants = [];
  root.querySelectorAll(".pv-variant-tr").forEach((tr) => {
    const options = {};
    tr.querySelectorAll(".pv-var-opt").forEach((sel) => {
      const gid = sel.getAttribute("data-pv-gid");
      if (gid && sel.value) options[gid] = sel.value;
    });
    const pr = tr.querySelector(".pv-var-price")?.value?.trim();
    const st = tr.querySelector(".pv-var-stock")?.value ?? "0";
    const im = tr.querySelector(".pv-var-img")?.value?.trim() || "";
    const row = { options, stock: Math.max(0, Math.floor(Number(st) || 0)) };
    if (pr !== undefined && pr !== "") {
      const pn = Number(pr);
      if (!Number.isNaN(pn)) row.price = pn;
    }
    if (im) row.image = im;
    variants.push(row);
  });
  return { groups, variants };
}

function pvSerializeForPayload(rootId = "pv-builder-root") {
  const { groups, variants } = pvReadBuilderFromDom(rootId);
  if (!groups.length) {
    return { product_options: [], inventoryFromBuilder: null, sizes: [], colors: [] };
  }
  const inventory = variants.map((v) => {
    const out = { options: { ...v.options }, stock: v.stock };
    if (v.price != null && !Number.isNaN(Number(v.price))) out.price = Number(v.price);
    if (v.image) out.image = v.image;
    return out;
  });
  const { sizes, colors } = pvDeriveFilterArrays(groups);
  return { product_options: groups, inventoryFromBuilder: inventory, sizes, colors };
}

function pvRenderBuilder(groups, variants, rootId = "pv-builder-root") {
  const root = pvGetBuilderRoot(rootId);
  if (!root) return;
  const ar = getAdminLang() === "ar";
  const L = (e, a) => (ar ? a : e);
  let html = "";
  (groups || []).forEach((g, gi) => {
    html += `<div class="pv-group-card rounded-xl border border-violet-100 bg-white p-3 mb-3 space-y-2">`;
    html += `<div class="flex flex-wrap gap-2 items-end">`;
    html += `<div><span class="text-[10px] font-semibold text-gray-500">${L("Id", "المعرّف")}</span><input class="pv-g-id w-full p-2 rounded-lg border border-gray-200 text-xs font-mono" value="${escapeHtml(g.id)}" /></div>`;
    html += `<div class="flex-1 min-w-[100px]"><span class="text-[10px] font-semibold text-gray-500">EN</span><input class="pv-g-ne w-full p-2 rounded-lg border border-gray-200 text-xs" value="${escapeHtml(g.name_en)}" /></div>`;
    html += `<div class="flex-1 min-w-[100px]"><span class="text-[10px] font-semibold text-gray-500">AR</span><input class="pv-g-na w-full p-2 rounded-lg border border-gray-200 text-xs" value="${escapeHtml(g.name_ar)}" /></div>`;
    html += `<button type="button" class="pv-rm-group px-2 py-2 text-red-600 text-xs font-bold border border-red-100 rounded-lg" data-pv-rm-group="${gi}">${L("Remove", "حذف")}</button>`;
    html += `</div><div class="flex flex-wrap gap-2 items-center">`;
    (g.values || []).forEach((v, vi) => {
      html += `<div class="pv-val-row flex gap-1 items-center bg-gray-50 rounded-lg px-2 py-1 border border-gray-100" data-vid="${escapeHtml(v.id)}">`;
      html += `<input class="pv-v-en w-20 p-1 text-xs border border-gray-200 rounded" value="${escapeHtml(v.label_en)}" placeholder="EN"/>`;
      html += `<input class="pv-v-ar w-20 p-1 text-xs border border-gray-200 rounded" value="${escapeHtml(v.label_ar)}" placeholder="AR"/>`;
      html += `<button type="button" class="text-red-500 text-sm px-1" data-pv-rm-val="${gi}-${vi}">×</button>`;
      html += `</div>`;
    });
    html += `<button type="button" class="text-xs font-bold text-violet-700" data-pv-add-val="${gi}">+ ${L("value", "قيمة")}</button>`;
    html += `</div></div>`;
  });

  if (groups.length) {
    html += `<div class="overflow-x-auto border border-gray-200 rounded-xl"><table class="min-w-full text-xs"><thead class="bg-gray-50"><tr>`;
    groups.forEach((g) => {
      html += `<th class="p-2 text-left border-b">${escapeHtml(g.name_en || g.id)}</th>`;
    });
    html += `<th class="p-2 border-b">${L("Price (opt.)", "سعر (اختياري)")}</th><th class="p-2 border-b">${L("Stock", "مخزون")}</th><th class="p-2 border-b">${L("Image URL", "صورة")}</th><th class="p-2 border-b"></th></tr></thead><tbody>`;
    (variants || []).forEach((row, ri) => {
      html += `<tr class="pv-variant-tr border-b border-gray-50">`;
      groups.forEach((g) => {
        const cur = row.options && row.options[g.id] ? row.options[g.id] : "";
        html += `<td class="p-2"><select class="pv-var-opt w-full p-1 border rounded" data-pv-gid="${escapeHtml(g.id)}">`;
        html += `<option value="">—</option>`;
        (g.values || []).forEach((v) => {
          const sel = String(v.id) === String(cur) ? " selected" : "";
          html += `<option value="${escapeHtml(v.id)}"${sel}>${escapeHtml(v.label_en || v.label_ar)}</option>`;
        });
        html += `</select></td>`;
      });
      const pv = row.price === "" || row.price == null ? "" : String(row.price);
      html += `<td class="p-2"><input type="number" step="0.01" class="pv-var-price w-full p-1 border rounded" value="${escapeHtml(pv)}" placeholder="base"/></td>`;
      html += `<td class="p-2"><input type="number" class="pv-var-stock w-full p-1 border rounded" value="${escapeHtml(String(row.stock ?? 0))}"/></td>`;
      html += `<td class="p-2"><input type="text" class="pv-var-img w-40 max-w-[50vw] p-1 border rounded font-mono text-[10px]" value="${escapeHtml(row.image || "")}" placeholder="https://"/></td>`;
      html += `<td class="p-2"><button type="button" class="text-red-600 font-bold" data-pv-rm-var="${ri}">×</button></td>`;
      html += `</tr>`;
    });
    html += `</tbody></table></div>`;
  } else {
    html += `<p class="text-xs text-gray-500">${L('Add "Option group" first.', "ابدأ بإضافة «مجموعة مواصفات».")}</p>`;
  }
  root.innerHTML = html;

  root.querySelectorAll("[data-pv-rm-group]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.getAttribute("data-pv-rm-group"));
      const { groups: gg, variants: vv } = pvReadBuilderFromDom(rootId);
      gg.splice(i, 1);
      pvRenderBuilder(gg, vv, rootId);
    });
  });
  root.querySelectorAll("[data-pv-rm-val]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const parts = btn.getAttribute("data-pv-rm-val").split("-");
      const gi = Number(parts[0]);
      const vi = Number(parts[1]);
      const { groups: gg, variants: vv } = pvReadBuilderFromDom(rootId);
      if (gg[gi] && gg[gi].values) gg[gi].values.splice(vi, 1);
      pvRenderBuilder(gg, vv, rootId);
    });
  });
  root.querySelectorAll("[data-pv-add-val]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const gi = Number(btn.getAttribute("data-pv-add-val"));
      const { groups: gg, variants: vv } = pvReadBuilderFromDom(rootId);
      if (!gg[gi]) return;
      gg[gi].values.push({ id: pvGenId("v"), label_en: "", label_ar: "" });
      pvRenderBuilder(gg, vv, rootId);
    });
  });
  root.querySelectorAll("[data-pv-rm-var]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ri = Number(btn.getAttribute("data-pv-rm-var"));
      const { groups: gg, variants: vv } = pvReadBuilderFromDom(rootId);
      vv.splice(ri, 1);
      pvRenderBuilder(gg, vv, rootId);
    });
  });
}

function pvHydrateFromProduct(product, rootId = "pv-builder-root") {
  const root = pvGetBuilderRoot(rootId);
  if (!root) return;
  if (!product) {
    root.innerHTML = `<p class="text-xs text-gray-500">${getAdminLang() === "ar" ? "لا مجموعات بعد — اضغط «مجموعة مواصفات»." : 'No option groups yet — use “+ Option group”.'}</p>`;
    return;
  }
  let groups;
  let variants;
  const po = product.product_options;
  if (Array.isArray(po) && po.length) {
    groups = JSON.parse(JSON.stringify(po));
    variants = (Array.isArray(product.inventory) ? product.inventory : []).map((row) => ({
      options: row.options && typeof row.options === "object" ? { ...row.options } : {},
      price: row.price != null && row.price !== "" ? row.price : "",
      stock: row.stock != null ? row.stock : 0,
      image: row.image || "",
    }));
  } else {
    const st = pvLegacyToBuilderState(product);
    groups = st.groups;
    variants = st.variants;
  }
  pvRenderBuilder(groups, variants, rootId);
}

function bindProductVariantBuilderForRoot(rootId) {
  const suffix = rootId === "pv-builder-root" ? "" : `-${rootId}`;
  const gbtn = document.getElementById(rootId === "pv-builder-root" ? "pv-add-group" : "mpv-add-group");
  if (gbtn && !gbtn.dataset.pvBound) {
    gbtn.dataset.pvBound = `1${suffix}`;
    gbtn.addEventListener("click", () => {
      const { groups, variants } = pvReadBuilderFromDom(rootId);
      groups.push({
        id: pvGenId("opt"),
        name_en: "Option",
        name_ar: "خيار",
        values: [{ id: pvGenId("v"), label_en: "A", label_ar: "أ" }],
      });
      pvRenderBuilder(groups, variants, rootId);
    });
  }
  const vbtn = document.getElementById(rootId === "pv-builder-root" ? "pv-add-variant-row" : "mpv-add-variant-row");
  if (vbtn && !vbtn.dataset.pvBound) {
    vbtn.dataset.pvBound = `1${suffix}`;
    vbtn.addEventListener("click", () => {
      const { groups, variants } = pvReadBuilderFromDom(rootId);
      if (!groups.length) {
        alert(getAdminLang() === "ar" ? "أضف مجموعة مواصفات أولاً." : "Add an option group first.");
        return;
      }
      variants.push({ options: {}, price: "", stock: 0, image: "" });
      pvRenderBuilder(groups, variants, rootId);
    });
  }
}

function initProductVariantBuilderUi() {
  bindProductVariantBuilderForRoot("pv-builder-root");
  pvHydrateFromProduct(null, "pv-builder-root");
}

function initMarketplaceProductVariantBuilderUi() {
  const gbtn = document.getElementById("mpv-add-group");
  const firstBind = gbtn && !gbtn.dataset.pvBound;
  bindProductVariantBuilderForRoot("mpv-builder-root");
  if (firstBind) pvHydrateFromProduct(null, "mpv-builder-root");
}

function readProductForm() {
  const productId = document.getElementById("product-id").value ? Number(document.getElementById("product-id").value) : null;

  const name_ar = document.getElementById("product-name-ar").value.trim();
  const name_en = document.getElementById("product-name-en").value.trim();
  const description = document.getElementById("product-description").value.trim();
  const price = Number(document.getElementById("product-price").value);
  const discount = Number(document.getElementById("product-discount").value || 0);
  const category = document.getElementById("product-category").value.trim();
  const subcategory = document.getElementById("product-subcategory").value.trim();
  const brand = document.getElementById("product-brand").value.trim();
  const stock = Number(document.getElementById("product-stock").value || 0);
  const badge = document.getElementById("product-badge").value.trim();

  const images = document.getElementById("product-images").value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const imageFiles = Array.from(document.getElementById("product-images-files")?.files || []);

  let sizes = document.getElementById("product-sizes").value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  let colors = document.getElementById("product-colors").value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const pvPack = pvSerializeForPayload();
  let product_options = pvPack.product_options || [];
  let inventory = [];
  if (product_options.length) {
    inventory = Array.isArray(pvPack.inventoryFromBuilder) ? pvPack.inventoryFromBuilder : [];
    sizes = pvPack.sizes || [];
    colors = pvPack.colors || [];
  } else {
    const invEl = document.getElementById("product-inventory-json");
    if (invEl && invEl.value.trim()) {
      try {
        const parsed = JSON.parse(invEl.value.trim());
        inventory = Array.isArray(parsed) ? parsed : [];
      } catch {
        inventory = [];
      }
    }
  }

  const is_featured = document.getElementById("product-is-featured").checked ? 1 : 0;
  const is_flash_sale = document.getElementById("product-is-flash-sale").checked ? 1 : 0;
  const is_new_collection = document.getElementById("product-is-new-collection")?.checked ? 1 : 0;
  const flash_sale_end_time = document.getElementById("product-flash-end").value.trim() || null;

  return {
    productId,
    imageFiles,
    payload: {
      name_ar,
      name_en,
      description,
      price,
      discount,
      images,
      category,
      subcategory,
      brand,
      stock,
      badge: badge || null,
      is_featured,
      is_flash_sale,
      is_new_collection,
      flash_sale_end_time: is_flash_sale ? flash_sale_end_time : null,
      sizes,
      colors,
      inventory,
      product_options,
    },
  };
}

function resetProductForm() {
  document.getElementById("product-id").value = "";
  document.getElementById("product-name-ar").value = "";
  document.getElementById("product-name-en").value = "";
  document.getElementById("product-description").value = "";
  document.getElementById("product-price").value = "";
  document.getElementById("product-discount").value = "0";
  const catSel = document.getElementById("product-category");
  const menRadio = document.querySelector('.product-placement-radio[value="Men"]');
  if (catSel && categoriesCache.some((x) => x.name === "Men")) {
    catSel.value = "Men";
    fillSubcategoryOptionsForCategory("Men", "");
    if (menRadio) menRadio.checked = true;
  } else {
    catSel.value = "";
    fillSubcategoryOptionsForCategory("", "");
    document.querySelectorAll(".product-placement-radio").forEach((el) => {
      el.checked = false;
    });
  }
  syncPlacementRadiosFromCategory();
  document.getElementById("product-brand").value = "";
  document.getElementById("product-stock").value = "0";
  document.getElementById("product-badge").value = "";
  document.getElementById("product-images").value = "";
  document.getElementById("product-images-files").value = "";
  document.getElementById("product-sizes").value = "";
  document.getElementById("product-colors").value = "";
  const invTa = document.getElementById("product-inventory-json");
  if (invTa) invTa.value = "[]";
  pvHydrateFromProduct(null);
  document.getElementById("product-is-featured").checked = false;
  document.getElementById("product-is-flash-sale").checked = false;
  const nc = document.getElementById("product-is-new-collection");
  if (nc) nc.checked = false;
  document.getElementById("product-flash-end").value = "";
  syncProductBrandStrip();
}

/** يظهر شريط «ضمن العلامة» فقط عند تعديل/إضافة منتج تابع لعلامة؛ الكتالوج العام بدون حقل علامة. */
function syncProductBrandStrip() {
  const hid = document.getElementById("product-brand");
  const strip = document.getElementById("product-brand-strip");
  const generalNote = document.getElementById("product-general-catalog-note");
  if (!hid || !strip) return;
  const b = (hid.value || "").trim();
  strip.classList.toggle("hidden", !b);
  const nameEl = strip.querySelector("[data-brand-strip-name]");
  if (nameEl) nameEl.textContent = b;
  if (generalNote) generalNote.classList.toggle("hidden", !!b);
}

function fillProductFormFromProduct(product) {
  if (!product) return;
  document.getElementById("product-id").value = product.id;
  document.getElementById("product-name-ar").value = product.name_ar;
  document.getElementById("product-name-en").value = product.name_en;
  document.getElementById("product-description").value = product.description;
  document.getElementById("product-price").value = product.price;
  document.getElementById("product-discount").value = product.discount ?? 0;
  document.getElementById("product-category").value = product.category ?? "";
  fillSubcategoryOptionsForCategory(product.category ?? "", product.subcategory ?? "");
  syncPlacementRadiosFromCategory();
  document.getElementById("product-brand").value = product.brand ?? "";
  document.getElementById("product-stock").value = product.stock ?? 0;
  document.getElementById("product-badge").value = product.badge ?? "";
  document.getElementById("product-images").value = (product.images || []).join(", ");
  document.getElementById("product-sizes").value = (product.sizes || []).join(", ");
  document.getElementById("product-colors").value = (product.colors || []).join(", ");
  const invTa = document.getElementById("product-inventory-json");
  if (invTa) {
    const inv = Array.isArray(product.inventory) ? product.inventory : [];
    invTa.value = JSON.stringify(inv.length ? inv : [], null, 2);
  }
  pvHydrateFromProduct(product);
  document.getElementById("product-is-featured").checked = !!product.is_featured;
  document.getElementById("product-is-flash-sale").checked = !!product.is_flash_sale;
  const ncEl = document.getElementById("product-is-new-collection");
  if (ncEl) ncEl.checked = !!product.is_new_collection;
  document.getElementById("product-flash-end").value = product.flash_sale_end_time ?? "";
  syncProductBrandStrip();
}

function prepareNewProductForBrand(brandName, mainCat) {
  resetProductForm();
  document.getElementById("product-brand").value = brandName;
  document.getElementById("product-category").value = mainCat;
  fillSubcategoryOptionsForCategory(mainCat, "");
  syncPlacementRadiosFromCategory();
  syncProductBrandStrip();
  setActiveTab("tab-products");
  document.getElementById("product-name-ar")?.focus();
}

function populateBrandProductsBrandSelect() {
  const sel = document.getElementById("brand-products-brand-select");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">${getAdminLang() === "ar" ? "— اختر علامة —" : "— Select brand —"}</option>`;
  for (const b of adminBrandsCache) {
    const o = document.createElement("option");
    o.value = b.name;
    o.textContent = b.name;
    sel.appendChild(o);
  }
  if (prev && adminBrandsCache.some((x) => x.name === prev)) sel.value = prev;
}

function updateBrandMainCatButtons() {
  document.querySelectorAll(".brand-main-cat-btn").forEach((btn) => {
    const on = btn.getAttribute("data-cat") === brandProductsSelection.mainCat;
    btn.classList.toggle("bg-purple-50", on);
    btn.classList.toggle("text-purple-700", on);
    btn.classList.toggle("border-purple-200", on);
    btn.classList.toggle("font-bold", on);
    btn.classList.toggle("bg-white", !on);
    btn.classList.toggle("text-gray-600", !on);
    btn.classList.toggle("border-gray-200", !on);
  });
}

async function loadBrandProductsSection() {
  const token = getToken();
  const tbody = document.getElementById("brand-products-tbody");
  if (!tbody) return;
  const brand = (document.getElementById("brand-products-brand-select")?.value || "").trim();
  const mainCat = brandProductsSelection.mainCat || "Men";
  if (!brand) {
    adminBrandProductsCache = [];
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-gray-400">${adminT("selectBrandFirst")}</td></tr>`;
    updateBrandMainCatButtons();
    return;
  }
  let rows = [];
  try {
    rows = await api(`/api/products?brand=${encodeURIComponent(brand)}&category=${encodeURIComponent(mainCat)}`, { token });
  } catch (e) {
    console.error(e);
  }
  adminBrandProductsCache = Array.isArray(rows) ? rows : [];
  updateBrandMainCatButtons();
  renderBrandProductsTable();
}

function renderBrandProductsTable() {
  const tbody = document.getElementById("brand-products-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  const list = adminBrandProductsCache;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-gray-500">${adminT("brandProductsEmpty")}</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((p) => {
      const disc = Number(p.discount || 0).toFixed(1);
      return `
        <tr>
          <td class="py-2">${p.id}</td>
          <td class="py-2">
            <div class="font-semibold">${escapeHtml(p.name_en)}</div>
            <div class="text-xs text-gray-500">${escapeHtml(p.name_ar)}</div>
          </td>
          <td class="py-2">${escapeHtml(p.subcategory || "—")}</td>
          <td class="py-2">${Number(p.price).toLocaleString()} ل.س</td>
          <td class="py-2">${disc}%</td>
          <td class="py-2">
            <button type="button" class="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 text-xs" data-brand-p-edit="${p.id}">${adminT("edit")}</button>
            <button type="button" class="px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 text-xs ml-1" data-brand-p-del="${p.id}">${adminT("delete")}</button>
          </td>
        </tr>
      `;
    })
    .join("");

  const token = getToken();
  tbody.querySelectorAll("button[data-brand-p-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-brand-p-edit"));
      const product = adminBrandProductsCache.find((x) => x.id === id);
      if (!product) return;
      fillProductFormFromProduct(product);
      setActiveTab("tab-products");
    });
  });
  tbody.querySelectorAll("button[data-brand-p-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(adminT("confirmDeleteProduct"))) return;
      const id = Number(btn.getAttribute("data-brand-p-del"));
      await api(`/api/products/${id}`, { method: "DELETE", token });
      await loadProducts();
      await loadBrandProductsSection();
    });
  });
}

function renderProductsTable() {
  const products = adminProductsCache;
  const f = getAdminFilter();
  const list = f
    ? products.filter((p) => {
        const hay = `${p.id} ${p.name_en} ${p.name_ar} ${p.category} ${p.brand || ""} ${p.subcategory || ""}`.toLowerCase();
        return hay.includes(f);
      })
    : products;
  const tbody = document.getElementById("products-tbody");
  const ar = getAdminLang() === "ar";
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="py-6 text-center text-gray-500">${
      products.length && f ? (ar ? "لا نتائج تطابق البحث." : "No matches for this search.") : ar ? "لا منتجات بعد." : "No products yet."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((p) => {
      const stockN = Number(p.stock);
      const stockDisp = Number.isFinite(stockN) ? stockN : 0;
      const inv = Array.isArray(p.inventory) ? p.inventory : [];
      const invNote =
        inv.length > 0
          ? `<div class="text-[10px] text-violet-600 font-semibold">${inv.length} ${ar ? "صف مخزون" : "variant rows"}</div>`
          : "";
      return `
        <tr>
          <td class="py-2">${p.id}</td>
          <td class="py-2">
            <div class="font-semibold">${escapeHtml(p.name_en)}</div>
            <div class="text-xs text-gray-500">${escapeHtml(p.name_ar)}</div>
          </td>
          <td class="py-2">${escapeHtml(p.category)}</td>
          <td class="py-2 text-xs text-gray-600 max-w-[100px] truncate" title="${escapeHtml(p.brand || "")}">${escapeHtml(p.brand || "—")}</td>
          <td class="py-2">${Number(p.price).toLocaleString()} ل.س</td>
          <td class="py-2">${stockDisp}${invNote}</td>
          <td class="py-2">${p.is_featured ? adminT("yes") : adminT("no")}</td>
          <td class="py-2">${p.is_flash_sale ? adminT("yes") : adminT("no")}</td>
          <td class="py-2">${p.is_new_collection ? adminT("yes") : adminT("no")}</td>
          <td class="py-2">
            <button class="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100" data-act="edit" data-id="${p.id}">${adminT("edit")}</button>
            <button class="px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 ml-2" data-act="del" data-id="${p.id}">${adminT("delete")}</button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(btn.getAttribute("data-id"));
      const act = btn.getAttribute("data-act");
      const token = getToken();
      if (!token) return;
      if (act === "edit") {
        const product = adminProductsCache.find((x) => x.id === id);
        if (!product) return;
        fillProductFormFromProduct(product);
      }
      if (act === "del") {
        if (!confirm(adminT("confirmDeleteProduct"))) return;
        await api(`/api/products/${id}`, { method: "DELETE", token });
        loadProducts();
        loadBrandProductsSection().catch(() => {});
      }
    });
  });
}

async function loadProducts() {
  const token = getToken();
  let products = [];
  try {
    products = await api("/api/products", { token });
  } catch (e) {
    console.error(e);
  }
  adminProductsCache = Array.isArray(products) ? products : [];
  renderProductsTable();
}

async function saveProduct(e) {
  e.preventDefault();
  const token = getToken();
  if (!token) return;
  const { productId, payload, imageFiles } = readProductForm();
  if (!payload.name_ar || !payload.name_en || !payload.description || !payload.category) {
    alert(adminT("fillProductRequired"));
    return;
  }

  // Optional image file upload (in addition to comma-separated URLs).
  if (imageFiles && imageFiles.length) {
    const uploadedUrls = [];
    for (const file of imageFiles) {
      const url = await uploadImageFile(file, token);
      if (url) uploadedUrls.push(url);
    }
    payload.images = [...(payload.images || []), ...uploadedUrls];
  }
  if (productId) {
    await api(`/api/products/${productId}`, { method: "PUT", token, body: payload });
  } else {
    await api("/api/products", { method: "POST", token, body: payload });
  }
  resetProductForm();
  await loadProducts();
  loadBrandProductsSection().catch(() => {});
}

function renderBrandsTable() {
  const token = getToken();
  const f = getAdminFilter();
  const list = f
    ? adminBrandsCache.filter((b) => `${b.id} ${b.name}`.toLowerCase().includes(f))
    : adminBrandsCache;
  const tbody = document.getElementById("brands-tbody");
  if (!tbody) return;
  if (!list.length) {
    const ar = getAdminLang() === "ar";
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-gray-500">${
      adminBrandsCache.length && f ? (ar ? "لا نتائج." : "No matches.") : ar ? "لا علامات بعد." : "No brands yet."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((b) => {
      return `
        <tr>
          <td class="py-2">${b.id}</td>
          <td class="py-2">
            <div class="font-semibold">${escapeHtml(b.name)}</div>
          </td>
          <td class="py-2">
            ${b.logo ? `<img src="${escapeHtml(b.logo)}" class="w-10 h-10 rounded-full object-cover" />` : "-"}
          </td>
          <td class="py-2">${b.is_top_brand ? adminT("yes") : adminT("no")}</td>
          <td class="py-2 text-xs text-gray-600">${escapeHtml((b.showcase_categories || []).join(", ") || "—")}</td>
          <td class="py-2">
            <button type="button" class="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 mr-1" data-edit-brand="${b.id}">${adminT("edit")}</button>
            <button type="button" class="px-2 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-800 hover:bg-violet-100 mr-1 text-xs font-semibold" data-brand-focus="${encodeURIComponent(b.name)}">${getAdminLang() === "ar" ? "منتجات" : "Products"}</button>
            <button class="px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100" data-del="${b.id}">${adminT("delete")}</button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("button[data-edit-brand]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-edit-brand"));
      const b = adminBrandsCache.find((x) => x.id === id);
      if (!b) return;
      document.getElementById("brand-id").value = b.id;
      document.getElementById("brand-name").value = b.name || "";
      document.getElementById("brand-is-top").checked = !!b.is_top_brand;
      document.getElementById("brand-logo-file").value = "";
      const sc = Array.isArray(b.showcase_categories) ? b.showcase_categories : ["Men", "Women", "Kids"];
      document.getElementById("brand-showcase-men").checked = sc.includes("Men");
      document.getElementById("brand-showcase-women").checked = sc.includes("Women");
      document.getElementById("brand-showcase-kids").checked = sc.includes("Kids");
    });
  });

  tbody.querySelectorAll("button[data-brand-focus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = decodeURIComponent(btn.getAttribute("data-brand-focus") || "");
      const sel = document.getElementById("brand-products-brand-select");
      if (sel) sel.value = name;
      brandProductsSelection.mainCat = "Men";
      setActiveTab("tab-brands");
      requestAnimationFrame(() => {
        document.getElementById("brand-products-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  });

  tbody.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(adminT("confirmDeleteBrand"))) return;
      await api(`/api/brands/${btn.getAttribute("data-del")}`, { method: "DELETE", token });
      loadBrands();
    });
  });
}

async function loadBrands() {
  const token = getToken();
  let brands = [];
  try {
    brands = await api("/api/brands", { token });
  } catch (e) {
    console.error(e);
  }
  adminBrandsCache = Array.isArray(brands) ? brands : [];
  renderBrandsTable();
  populateBrandProductsBrandSelect();
}

function readBrandForm() {
  const id = document.getElementById("brand-id").value ? Number(document.getElementById("brand-id").value) : null;
  const name = document.getElementById("brand-name").value.trim();
  const logoFile = document.getElementById("brand-logo-file").files[0] || null;
  const is_top_brand = document.getElementById("brand-is-top").checked ? 1 : 0;
  const showcase_categories = [];
  if (document.getElementById("brand-showcase-men")?.checked) showcase_categories.push("Men");
  if (document.getElementById("brand-showcase-women")?.checked) showcase_categories.push("Women");
  if (document.getElementById("brand-showcase-kids")?.checked) showcase_categories.push("Kids");
  return { id, name, logoFile, is_top_brand, showcase_categories };
}

async function saveBrand(e) {
  e.preventDefault();
  const token = getToken();
  if (!token) {
    alert(adminT("loginRequired"));
    return;
  }
  const { id, name, logoFile, is_top_brand, showcase_categories } = readBrandForm();
  if (!name) return alert(adminT("brandNameRequired"));
  let logo = "";
  try {
    if (logoFile) logo = await uploadImageFile(logoFile, token);
    else if (id) {
      const prev = adminBrandsCache.find((x) => x.id === id);
      if (prev && prev.logo) logo = prev.logo;
    }

    const body = { name, logo, is_top_brand, showcase_categories };
    if (id) {
      await api(`/api/brands/${id}`, { method: "PUT", token, body });
    } else {
      await api("/api/brands", { method: "POST", token, body });
    }
    document.getElementById("brand-logo-file").value = "";
    document.getElementById("brand-id").value = "";
    document.getElementById("brand-name").value = "";
    document.getElementById("brand-is-top").checked = false;
    document.getElementById("brand-showcase-men").checked = true;
    document.getElementById("brand-showcase-women").checked = true;
    document.getElementById("brand-showcase-kids").checked = true;
    await loadBrands();
    alert(adminT("brandSaved"));
  } catch (err) {
    alert(err.message || String(err));
  }
}

/** Cached for product form dropdowns */
let categoriesCache = [];

function populateProductCategoryDropdowns(cats) {
  categoriesCache = Array.isArray(cats) ? cats : [];
  const catSel = document.getElementById("product-category");
  const subSel = document.getElementById("product-subcategory");
  if (!catSel || !subSel) return;
  const prevCat = catSel.value;
  catSel.innerHTML = `<option value="">—</option>`;
  for (const c of categoriesCache) {
    const opt = document.createElement("option");
    opt.value = c.name || "";
    opt.textContent = c.name || "";
    catSel.appendChild(opt);
  }
  if (prevCat && categoriesCache.some((x) => x.name === prevCat)) {
    catSel.value = prevCat;
  }
  fillSubcategoryOptionsForCategory(catSel.value, subSel.value);
  syncPlacementRadiosFromCategory();
}

function fillSubcategoryOptionsForCategory(categoryName, selectedSub) {
  const subSel = document.getElementById("product-subcategory");
  if (!subSel) return;
  const prev = selectedSub != null ? String(selectedSub) : subSel.value;
  subSel.innerHTML = `<option value="">—</option>`;
  const cat = categoriesCache.find((x) => x.name === categoryName);
  const subs = Array.isArray(cat?.subcategories) ? cat.subcategories : [];
  for (const s of subs) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    subSel.appendChild(opt);
  }
  if (prev && subs.includes(prev)) subSel.value = prev;
  else subSel.value = "";
}

const PLACEMENT_STANDARD = ["Men", "Women", "Kids"];

function syncPlacementRadiosFromCategory() {
  const sel = document.getElementById("product-category");
  const hint = document.getElementById("product-category-custom-hint");
  if (!sel) return;
  const v = sel.value;
  document.querySelectorAll(".product-placement-radio").forEach((el) => {
    el.checked = v && el.value === v;
  });
  if (hint) {
    const isStd = !v || PLACEMENT_STANDARD.includes(v);
    hint.classList.toggle("hidden", isStd);
  }
}

function initProductPlacementRadios() {
  document.querySelectorAll(".product-placement-radio").forEach((el) => {
    el.addEventListener("change", () => {
      if (!el.checked) return;
      const sel = document.getElementById("product-category");
      if (!sel) return;
      sel.value = el.value;
      sel.dispatchEvent(new Event("change"));
    });
  });
}

function renderCategoriesTable() {
  const token = getToken();
  const cats = adminCategoriesListCache;
  const f = getAdminFilter();
  const list = f
    ? cats.filter((c) =>
        `${c.id} ${c.name} ${(Array.isArray(c.subcategories) ? c.subcategories : []).join(" ")}`.toLowerCase().includes(f)
      )
    : cats;
  const tbody = document.getElementById("categories-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-gray-500">${
      cats.length && f ? (ar ? "لا نتائج." : "No matches.") : ar ? "لا أقسام." : "No categories yet."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((c) => {
      const subs = Array.isArray(c.subcategories) ? c.subcategories.join(", ") : "";
      return `
        <tr>
          <td class="py-2">${c.id}</td>
          <td class="py-2">
            <div class="font-semibold">${escapeHtml(c.name)}</div>
          </td>
          <td class="py-2">${escapeHtml(subs)}</td>
          <td class="py-2">
            <button class="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 mr-2" data-edit="${c.id}">${adminT("edit")}</button>
            <button class="px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100" data-del="${c.id}">${adminT("delete")}</button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-edit"));
      const cat = adminCategoriesListCache.find((x) => x.id === id);
      if (!cat) return;
      document.getElementById("category-id").value = cat.id;
      document.getElementById("category-name").value = cat.name || "";
      document.getElementById("category-subcategories").value = (cat.subcategories || []).join(", ");
    });
  });

  tbody.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-del"));
      if (!confirm(adminT("confirmDeleteCategory"))) return;
      await api(`/api/categories/${id}`, { method: "DELETE", token });
      await loadCategories();
    });
  });
}

async function loadCategories() {
  const token = getToken();
  let cats = [];
  try {
    cats = await api("/api/categories", { token });
  } catch (e) {
    console.error(e);
  }
  if (!Array.isArray(cats)) cats = [];
  adminCategoriesListCache = cats;
  populateProductCategoryDropdowns(cats);
  renderCategoriesTable();
}

async function saveCategory(e) {
  e.preventDefault();
  const token = getToken();
  const id = document.getElementById("category-id").value ? Number(document.getElementById("category-id").value) : null;
  const name = document.getElementById("category-name").value.trim();
  const subcategories = document.getElementById("category-subcategories").value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!name) return alert(adminT("categoryNameRequired"));
  const body = { name, subcategories };
  if (id) {
    await api(`/api/categories/${id}`, { method: "PUT", token, body });
  } else {
    await api("/api/categories", { method: "POST", token, body });
  }
  document.getElementById("category-id").value = "";
  await loadCategories();
}

function renderOffersTable() {
  const token = getToken();
  const f = getAdminFilter();
  const list = f
    ? adminOffersCache.filter((o) =>
        `${o.id} ${o.name_en} ${o.name_ar} ${o.discount_percent}`.toLowerCase().includes(f)
      )
    : adminOffersCache;
  const tbody = document.getElementById("offers-tbody");
  if (!tbody) return;
  if (!list.length) {
    const ar = getAdminLang() === "ar";
    const msg =
      adminOffersCache.length && f
        ? ar
          ? "لا نتائج تطابق البحث."
          : "No matches for this search."
        : ar
          ? "لا توجد عروض."
          : "No offers yet.";
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-gray-500">${msg}</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((o) => {
      return `
        <tr>
          <td class="py-2">${o.id}</td>
          <td class="py-2">
            <div class="font-semibold">${escapeHtml(o.name_en)}</div>
            <div class="text-xs text-gray-500">${escapeHtml(o.name_ar)}</div>
          </td>
          <td class="py-2">${Number(o.discount_percent).toFixed(2)}%</td>
          <td class="py-2">${escapeHtml(o.offer_end_time || "-")}</td>
          <td class="py-2">
            ${o.banner_image_url ? `<img src="${escapeHtml(o.banner_image_url)}" class="w-10 h-10 rounded object-cover" />` : "-"}
          </td>
          <td class="py-2">
            <button type="button" class="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 mr-2" data-edit="${o.id}">${adminT("edit")}</button>
            <button class="px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100" data-del="${o.id}">${adminT("delete")}</button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-edit"));
      const o = adminOffersCache.find((x) => x.id === id);
      if (!o) return;
      document.getElementById("offer-id").value = o.id;
      const sel = document.getElementById("offer-product");
      if (sel) sel.value = String(o.product_id);
      document.getElementById("offer-discount").value = o.discount_percent ?? 0;
      document.getElementById("offer-end").value = o.offer_end_time || "";
      document.getElementById("offer-banner-file").value = "";
      setActiveTab("tab-offers");
    });
  });

  tbody.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(adminT("confirmDeleteOffer"))) return;
      await api(`/api/offers/${btn.getAttribute("data-del")}`, { method: "DELETE", token });
      loadOffers();
    });
  });
}

async function loadOffers() {
  const token = getToken();
  let offers = [];
  try {
    offers = await api("/api/offers", { token });
  } catch (e) {
    console.error(e);
  }
  adminOffersCache = Array.isArray(offers) ? offers : [];
  renderOffersTable();
}

async function loadOfferProductsIntoSelect() {
  const select = document.getElementById("offer-product");
  if (!select) return;
  const token = getToken();
  try {
    const products = await api("/api/products", { token });
    const list = Array.isArray(products) ? products : [];
    select.innerHTML = list
      .slice(0, 200)
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name_en)} (${escapeHtml(p.category)})</option>`)
      .join("");
  } catch (e) {
    console.error(e);
    select.innerHTML = `<option value="">${getAdminLang() === "ar" ? "تعذر تحميل المنتجات" : "Failed to load products"}</option>`;
  }
}

async function saveOffer(e) {
  e.preventDefault();
  const token = getToken();
  const id = document.getElementById("offer-id").value ? Number(document.getElementById("offer-id").value) : null;
  const product_id = Number(document.getElementById("offer-product").value);
  const discount_percent = Number(document.getElementById("offer-discount").value || 0);
  const offer_end_time = document.getElementById("offer-end").value.trim() || null;
  const file = document.getElementById("offer-banner-file").files[0] || null;
  let banner_image_url = "";
  if (file) banner_image_url = await uploadImageFile(file, token);
  else if (id) {
    const prev = adminOffersCache.find((x) => x.id === id);
    if (prev) banner_image_url = prev.banner_image_url || "";
  }

  const body = { product_id, banner_image_url, discount_percent, offer_end_time };
  if (id) await api(`/api/offers/${id}`, { method: "PUT", token, body });
  else await api("/api/offers", { method: "POST", token, body });

  document.getElementById("offer-id").value = "";
  document.getElementById("offer-banner-file").value = "";
  await loadOffers();
}

async function loadBroadcasts() {
  const token = getToken();
  const tbody = document.getElementById("broadcasts-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  const loc = ar ? "ar-EG" : "en-US";
  try {
    const rows = await api("/api/admin/broadcasts", { token });
    if (!Array.isArray(rows) || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="2" class="py-3 text-gray-400">${ar ? "لا توجد رسائل بعد." : "No messages yet."}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .slice(0, 20)
      .map((r) => {
        const title = ar ? r.title_ar : r.title_en;
        const dt = r.created_at ? new Date(r.created_at).toLocaleString(loc) : "—";
        return `<tr><td class="py-1 pr-2">${escapeHtml(title)}</td><td class="py-1 text-gray-500 whitespace-nowrap">${escapeHtml(dt)}</td></tr>`;
      })
      .join("");
  } catch (err) {
    const ar = getAdminLang() === "ar";
    tbody.innerHTML = `<tr><td colspan="2" class="py-3 text-sm text-red-600">${
      ar ? "تعذر تحميل الرسائل: " : "Failed to load messages: "
    }${escapeHtml(err.message || String(err))}</td></tr>`;
  }
}

function renderUsersTable() {
  const tbody = document.getElementById("users-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  const loc = ar ? "ar-EG" : "en-US";
  const f = getAdminFilter();
  const filtered = f
    ? adminUsersCache.filter((u) =>
        `${u.name} ${u.phone || ""} ${u.email || ""} ${u.role || ""}`.toLowerCase().includes(f)
      )
    : adminUsersCache;
  if (!adminUsersCache.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-gray-500">${
      ar ? "لا يوجد مستخدمون مسجّلون بعد (بعد التسجيل في التطبيق يظهرون هنا)." : "No registered app users yet — they appear after sign-up in the app."
    }</td></tr>`;
    return;
  }
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-gray-500">${ar ? "لا نتائج تطابق البحث." : "No matches for this search."}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered
    .map((u) => {
      const reg = u.created_at ? new Date(u.created_at).toLocaleString(loc) : "—";
      const lastRaw = u.last_activity_at || u.last_order_at;
      const lastStr = lastRaw ? new Date(lastRaw).toLocaleString(loc) : "—";
      const pushOn = Number(u.notifications_enabled) === 1;
      let pushLabel = pushOn ? (ar ? "مفعّل" : "On") : ar ? "غير مفعّل" : "Off";
      const sn = u.notifications_snoozed_until;
      if (sn && new Date(sn) > new Date()) {
        pushLabel += ar ? " · مؤجل" : " · snoozed";
      }
      const wa = phoneDigitsForWa(u.phone);
      const waHref = wa ? `https://wa.me/${wa}` : "#";
      const waCell = wa
        ? `<a href="${escapeHtml(waHref)}" target="_blank" rel="noopener noreferrer" class="text-green-600 font-semibold text-xs"><i class="fab fa-whatsapp"></i> WA</a>`
        : "—";
      return `
        <tr>
          <td class="py-2 font-semibold">${escapeHtml(u.name)}</td>
          <td class="py-2 font-mono text-xs">${escapeHtml(u.email || "—")}</td>
          <td class="py-2 font-mono text-xs">${escapeHtml(u.phone || "—")}</td>
          <td class="py-2 text-xs text-gray-600">${escapeHtml(u.role || "user")}</td>
          <td class="py-2 text-xs">${escapeHtml(pushLabel)}</td>
          <td class="py-2 whitespace-nowrap">${escapeHtml(reg)}</td>
          <td class="py-2">${u.order_count ?? 0}</td>
          <td class="py-2 whitespace-nowrap">${escapeHtml(lastStr)}</td>
          <td class="py-2">${waCell}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadUsers() {
  const token = getToken();
  let rows = [];
  try {
    rows = await api("/api/admin/users", { token });
  } catch (e) {
    console.error(e);
  }
  adminUsersCache = Array.isArray(rows) ? rows : [];
  renderUsersTable();
}

async function loadSiteRatings() {
  const token = getToken();
  let rows = [];
  try {
    rows = await api("/api/admin/site-ratings", { token });
  } catch (e) {
    console.error(e);
  }
  adminSiteRatingsCache = Array.isArray(rows) ? rows : [];
  renderSiteRatingsTable();
}

function renderSiteRatingsTable() {
  const tbody = document.getElementById("site-ratings-tbody");
  if (!tbody) return;
  const f = getAdminFilter();
  const list = f
    ? adminSiteRatingsCache.filter((r) =>
        `${r.user_name || ""} ${r.user_phone || ""} ${r.comment || ""} ${r.stars}`.toLowerCase().includes(f)
      )
    : adminSiteRatingsCache;
  const ar = getAdminLang() === "ar";
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-gray-500">${
      adminSiteRatingsCache.length && f ? (ar ? "لا نتائج." : "No matches.") : ar ? "لا تقييمات بعد." : "No ratings yet."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((r) => {
      const stars = Math.min(5, Math.max(1, Number(r.stars) || 1));
      const starsLabel = `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
      return `
        <tr>
          <td class="py-2 pr-2 font-semibold">${escapeHtml(r.user_name || "—")}</td>
          <td class="py-2 pr-2 font-mono text-xs text-gray-600">${escapeHtml(r.user_phone || "")}</td>
          <td class="py-2 pr-2 whitespace-nowrap"><span class="text-amber-500">${starsLabel}</span> <span class="text-xs text-gray-500">(${stars}/5)</span></td>
          <td class="py-2 pr-2 text-gray-700 max-w-md break-words">${escapeHtml(r.comment || "—")}</td>
          <td class="py-2 text-xs text-gray-500 whitespace-nowrap">${escapeHtml(r.created_at || "—")}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadAdminProductReviews() {
  const token = getToken();
  adminProductReviewsLoadError = null;
  let rows = [];
  try {
    rows = await api("/api/admin/product-reviews", { token });
  } catch (e) {
    console.error(e);
    adminProductReviewsLoadError = e.message || String(e);
    rows = [];
  }
  adminProductReviewsCache = Array.isArray(rows) ? rows : [];
  renderAdminProductReviewsTable();
}

async function loadAdminMarketplaceProductReviews() {
  const token = getToken();
  adminMpProductReviewsLoadError = null;
  let rows = [];
  try {
    rows = await api("/api/admin/marketplace-product-reviews", { token });
  } catch (e) {
    console.error(e);
    adminMpProductReviewsLoadError = e.message || String(e);
    rows = [];
  }
  adminMpProductReviewsCache = Array.isArray(rows) ? rows : [];
  renderAdminMpProductReviewsTable();
}

async function loadAdminCustomerFeedbackNotes() {
  const token = getToken();
  adminCustomerFeedbackLoadError = null;
  let rows = [];
  try {
    rows = await api("/api/admin/customer-feedback-notes", { token });
  } catch (e) {
    console.error(e);
    adminCustomerFeedbackLoadError = e.message || String(e);
    rows = [];
  }
  adminCustomerFeedbackCache = Array.isArray(rows) ? rows : [];
  renderAdminCustomerFeedbackNotesTable();
}

function renderAdminCustomerFeedbackNotesTable() {
  const tbody = document.getElementById("customer-feedback-notes-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  if (adminCustomerFeedbackLoadError) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-red-600 text-sm break-words">${escapeHtml(
      adminCustomerFeedbackLoadError
    )}</td></tr>`;
    return;
  }
  const list = adminCustomerFeedbackCache;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-gray-500">${
      ar ? "لا ملاحظات زبائن بعد." : "No customer notes yet."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((r) => {
      const contact = [r.phone, r.email].filter(Boolean).join(" · ");
      return `
        <tr>
          <td class="py-2 pr-2 text-xs">${r.id ?? "—"}</td>
          <td class="py-2 pr-2 text-xs max-w-md break-words text-gray-800">${escapeHtml(r.note || "—")}</td>
          <td class="py-2 pr-2 text-xs font-semibold">${escapeHtml(r.user_name || "—")}</td>
          <td class="py-2 pr-2 text-xs font-mono text-gray-600">${escapeHtml(contact || "—")}</td>
          <td class="py-2 pr-2 text-xs">${r.banner_id != null ? escapeHtml(String(r.banner_id)) : "—"}</td>
          <td class="py-2 text-xs text-gray-500 whitespace-nowrap">${escapeHtml(String(r.created_at || "—"))}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAdminProductReviewsTable() {
  const tbody = document.getElementById("product-reviews-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  if (adminProductReviewsLoadError) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-red-600 text-sm break-words">${escapeHtml(
      adminProductReviewsLoadError
    )}</td></tr>`;
    return;
  }
  const f = getAdminFilter();
  const list = f
    ? adminProductReviewsCache.filter((r) =>
        `${r.user_name || ""} ${r.user_phone || ""} ${r.comment || ""} ${r.stars} ${r.product_name_en || ""} ${r.product_name_ar || ""} ${r.product_id || ""}`
          .toLowerCase()
          .includes(f)
      )
    : adminProductReviewsCache;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-gray-500">${
      adminProductReviewsCache.length && f ? (ar ? "لا نتائج." : "No matches.") : ar ? "لا تقييمات منتجات بعد." : "No product reviews yet."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((r) => {
      const stars = Math.min(5, Math.max(1, Number(r.stars) || 1));
      const starsLabel = `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
      const pname = ar ? r.product_name_ar || r.product_name_en : r.product_name_en || r.product_name_ar;
      return `
        <tr>
          <td class="py-2 pr-2">
            <div class="font-semibold">${escapeHtml(pname || "—")}</div>
            <div class="text-xs text-gray-500">#${r.product_id ?? "—"}</div>
          </td>
          <td class="py-2 pr-2 font-semibold">${escapeHtml(r.user_name || "—")}</td>
          <td class="py-2 pr-2 font-mono text-xs text-gray-600">${escapeHtml(r.user_phone || "")}</td>
          <td class="py-2 pr-2 whitespace-nowrap"><span class="text-amber-500">${starsLabel}</span> <span class="text-xs text-gray-500">(${stars}/5)</span></td>
          <td class="py-2 pr-2 text-gray-700 max-w-md break-words">${escapeHtml(r.comment || "—")}</td>
          <td class="py-2 text-xs text-gray-500 whitespace-nowrap">${escapeHtml(r.created_at || "—")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAdminMpProductReviewsTable() {
  const tbody = document.getElementById("mp-product-reviews-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  if (adminMpProductReviewsLoadError) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-red-600 text-sm break-words">${escapeHtml(
      adminMpProductReviewsLoadError
    )}</td></tr>`;
    return;
  }
  const f = getAdminFilter();
  const list = f
    ? adminMpProductReviewsCache.filter((r) =>
        `${r.user_name || ""} ${r.user_phone || ""} ${r.comment || ""} ${r.stars} ${r.product_name_en || ""} ${r.product_name_ar || ""} ${r.vendor_name_en || ""} ${r.vendor_name_ar || ""} ${r.marketplace_product_id || ""}`
          .toLowerCase()
          .includes(f)
      )
    : adminMpProductReviewsCache;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-gray-500">${
      adminMpProductReviewsCache.length && f ? (ar ? "لا نتائج." : "No matches.") : ar ? "لا تقييمات لمنتجات السوق بعد." : "No marketplace product reviews yet."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((r) => {
      const stars = Math.min(5, Math.max(1, Number(r.stars) || 1));
      const starsLabel = `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
      const pname = ar ? r.product_name_ar || r.product_name_en : r.product_name_en || r.product_name_ar;
      const vname = ar ? r.vendor_name_ar || r.vendor_name_en : r.vendor_name_en || r.vendor_name_ar;
      return `
        <tr>
          <td class="py-2 pr-2">
            <div class="font-semibold">${escapeHtml(pname || "—")}</div>
            <div class="text-xs text-gray-500">#${r.marketplace_product_id ?? "—"}</div>
          </td>
          <td class="py-2 pr-2 text-gray-800">${escapeHtml(vname || "—")}</td>
          <td class="py-2 pr-2 font-semibold">${escapeHtml(r.user_name || "—")}</td>
          <td class="py-2 pr-2 font-mono text-xs text-gray-600">${escapeHtml(r.user_phone || "")}</td>
          <td class="py-2 pr-2 whitespace-nowrap"><span class="text-amber-500">${starsLabel}</span> <span class="text-xs text-gray-500">(${stars}/5)</span></td>
          <td class="py-2 pr-2 text-gray-700 max-w-md break-words">${escapeHtml(r.comment || "—")}</td>
          <td class="py-2 text-xs text-gray-500 whitespace-nowrap">${escapeHtml(r.created_at || "—")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderFlashSalesTable() {
  const token = getToken();
  const tbody = document.getElementById("flash-tbody");
  if (!tbody) return;
  const f = getAdminFilter();
  const list = f
    ? adminFlashCache.filter((p) =>
        `${p.id} ${p.name_en} ${p.name_ar} ${p.flash_sale_end_time || ""}`.toLowerCase().includes(f)
      )
    : adminFlashCache;
  const ar = getAdminLang() === "ar";
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-gray-500">${
      adminFlashCache.length && f
        ? ar
          ? "لا نتائج."
          : "No matches."
        : ar
          ? 'فعّل «عروض سريعة» على منتج من تبويب المنتجات، أو أضف عروضاً من تبويب «العروض».'
          : 'Mark products as flash sale in Products tab, or add offers in the Offers tab.'
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((p) => {
      return `
        <tr>
          <td class="py-2">${p.id}</td>
          <td class="py-2">
            <div class="font-semibold">${escapeHtml(p.name_en)}</div>
            <div class="text-xs text-gray-500">${escapeHtml(p.name_ar)}</div>
          </td>
          <td class="py-2">${Number(p.price).toLocaleString()} ل.س</td>
          <td class="py-2">
            <input type="text" class="flash-end-input w-full max-w-xs p-2 rounded-lg border border-gray-200 text-xs font-mono" data-flash-product="${p.id}" value="${escapeHtml(p.flash_sale_end_time || "")}" placeholder="2026-03-25T12:00:00.000Z" />
          </td>
          <td class="py-2">
            <button type="button" class="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-bold" data-flash-save="${p.id}">${adminT("save")}</button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("button[data-flash-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.getAttribute("data-flash-save"));
      const inp = tbody.querySelector(`input[data-flash-product="${id}"]`);
      const flash_sale_end_time = inp ? inp.value.trim() || null : null;
      try {
        const full = await api(`/api/products/${id}`, { token });
        const body = {
          name_ar: full.name_ar,
          name_en: full.name_en,
          description: full.description,
          price: full.price,
          discount: full.discount,
          category: full.category,
          subcategory: full.subcategory || "",
          brand: full.brand || "",
          sizes: full.sizes || [],
          colors: full.colors || [],
          stock: full.stock,
          inventory: Array.isArray(full.inventory) ? full.inventory : [],
          product_options: full.product_options || [],
          badge: full.badge || "",
          images: full.images || [],
          is_featured: full.is_featured ? 1 : 0,
          is_flash_sale: 1,
          is_new_collection: full.is_new_collection ? 1 : 0,
          flash_sale_end_time,
        };
        await api(`/api/products/${id}`, { method: "PUT", token, body });
        await loadFlashSales();
        await loadProducts();
      } catch (e) {
        alert(e.message || String(e));
      }
    });
  });
}

async function loadFlashSales() {
  const token = getToken();
  let products = [];
  try {
    products = await api("/api/products?flash=1", { token });
  } catch (e) {
    console.error(e);
  }
  adminFlashCache = Array.isArray(products) ? products : [];
  renderFlashSalesTable();
}

function renderOrdersTable() {
  const token = getToken();
  const tbody = document.getElementById("orders-tbody");
  if (!tbody) return;
  highlightOrdersStatusTabs();

  const range = getAdminOrdersDateRange();
  let list = adminOrdersCache.filter((o) => orderMatchesAdminDateFilter(o, range));
  if (adminOrdersStatusTab !== "all") {
    list = list.filter((o) => o.status === adminOrdersStatusTab);
  }
  const f = getAdminFilter();
  if (f) {
    list = list.filter((o) => {
      const hay = `${o.order_no} ${o.customer_name || ""} ${o.customer_phone || ""} ${o.user_id} ${o.status}`.toLowerCase();
      return hay.includes(f);
    });
  }
  list.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });

  const ar = getAdminLang() === "ar";
  if (!adminOrdersCache.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-gray-500">${
      ar ? "لا طلبات بعد — تظهر هنا طلبات التطبيق بعد إتمام الشراء." : "No orders yet — app orders appear here after checkout."
    }</td></tr>`;
    return;
  }
  if (!list.length) {
    const msg = f
      ? ar
        ? "لا نتائج للبحث أو الفلاتر الحالية."
        : "No matches for search or current filters."
      : ar
        ? "لا طلبات في هذا القسم ضمن الفترة المحددة."
        : "No orders in this section for the selected period.";
    tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-gray-500">${msg}</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((o) => {
      const cust = o.customer_name || o.customer_phone ? `${escapeHtml(o.customer_name || "—")}` : "—";
      const phone = o.customer_phone ? `<div class="text-xs text-gray-500 font-mono">${escapeHtml(o.customer_phone)}</div>` : "";
      const dtRaw = o.created_at ? new Date(o.created_at) : null;
      const dtStr = dtRaw && !Number.isNaN(dtRaw.getTime())
        ? dtRaw.toLocaleString(ar ? "ar-SY" : "en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—";
      return `
        <tr>
          <td class="py-2 font-semibold">${escapeHtml(o.order_no)}</td>
          <td class="py-2 text-xs text-gray-600 whitespace-nowrap">${escapeHtml(dtStr)}</td>
          <td class="py-2 text-sm text-gray-700">
            <div>${cust}</div>
            ${phone}
            <div class="text-[10px] text-gray-400">id: ${o.user_id}</div>
          </td>
          <td class="py-2">${Number(o.total_price).toLocaleString()} ل.س</td>
          <td class="py-2">${escapeHtml(formatOrderStatusLabel(o.status))}</td>
          <td class="py-2">${escapeHtml(o.source)}</td>
          <td class="py-2">
            <button type="button" class="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 text-sm" data-order-detail="${o.id}">
              ${ar ? "عرض" : "View"}
            </button>
          </td>
          <td class="py-2">
            <div class="flex items-center gap-2">
              <select class="p-2 rounded-lg border border-gray-200 text-sm max-w-[11rem]" data-status-sel="${o.id}">
                ${ORDER_STATUS_KEYS.map(
                  (k) =>
                    `<option value="${k}" ${o.status === k ? "selected" : ""}>${escapeHtml(
                      getAdminLang() === "ar" ? ORDER_STATUS_LABELS[k].ar : ORDER_STATUS_LABELS[k].en
                    )}</option>`
                ).join("")}
              </select>
              <button class="px-3 py-2 rounded-lg bg-purple-600 text-white font-bold text-sm" data-status-save="${o.id}">
                ${adminT("save")}
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("button[data-order-detail]").forEach((btn) => {
    btn.addEventListener("click", () => openOrderDetailModal(Number(btn.getAttribute("data-order-detail"))));
  });

  tbody.querySelectorAll("button[data-status-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const orderId = btn.getAttribute("data-status-save");
      const select = tbody.querySelector(`select[data-status-sel="${orderId}"]`);
      const status = select.value;
      try {
        await api(`/api/orders/${orderId}/status`, { method: "PUT", token, body: { status } });
        await loadOrders();
      } catch (e) {
        alert(e.message || String(e));
      }
    });
  });
}

async function loadNotificationTargetOptions() {
  const sel = document.getElementById("admin-notif-target");
  if (!sel) return;
  const token = getToken();
  const ar = getAdminLang() === "ar";
  let users = [];
  try {
    users = await api("/api/admin/users", { token });
  } catch (e) {
    console.error(e);
  }
  const list = Array.isArray(users) ? users : [];
  sel.innerHTML = `<option value="">${ar ? "جميع مستخدمي التطبيق" : "All app users"}</option>`;
  for (const u of list) {
    const o = document.createElement("option");
    o.value = String(u.id);
    o.textContent = `${u.name} — ${u.email || u.phone || "—"}`;
    sel.appendChild(o);
  }
}

async function refreshPushDiagnostics() {
  const out = document.getElementById("push-diagnostics-text");
  if (!out) return;
  const token = getToken();
  if (!token) return;
  const ar = getAdminLang() === "ar";
  try {
    const d = await api("/api/admin/push-diagnostics", { token });
    const vapidOk = d.vapidConfigured
      ? ar
        ? "مفعّل"
        : "on"
      : ar
        ? "غير مضبوط — أضف VAPID على Render"
        : "missing — set VAPID on Render";
    const lines = [
      `${ar ? "VAPID" : "VAPID"}: ${vapidOk}`,
      `${ar ? "اشتراكات محفوظة" : "Saved subscriptions"}: ${d.subscriptionRows ?? 0}`,
      `${ar ? "مؤهلون للبث (إشعارات مفعّلة)" : "Eligible for broadcast"}: ${d.subscriptionsEligibleForBroadcastPush ?? 0}`,
      ar ? d.hintAr : d.hintEn,
    ];
    out.textContent = lines.join("\n");
    out.classList.remove("hidden");
  } catch (e) {
    out.textContent = ar ? `خطأ: ${e.message || e}` : `Error: ${e.message || e}`;
    out.classList.remove("hidden");
  }
}

async function loadPushDiagnostics() {
  await refreshPushDiagnostics();
}

async function sendAdminNotification(e) {
  e.preventDefault();
  const token = getToken();
  if (!token) return;
  const title = document.getElementById("admin-notif-title")?.value.trim() || "";
  const message = document.getElementById("admin-notif-message")?.value.trim() || "";
  let image_url = document.getElementById("admin-notif-image")?.value.trim() || "";
  const link_url = document.getElementById("admin-notif-link")?.value.trim() || "";
  const target = document.getElementById("admin-notif-target")?.value || "";
  const ar = getAdminLang() === "ar";
  if (!message) {
    alert(ar ? "اكتب نص الإشعار." : "Enter a message.");
    return;
  }
  const imgFile = document.getElementById("admin-notif-image-file")?.files?.[0];
  if (imgFile) {
    try {
      const up = await uploadImageFile(imgFile, token);
      if (up) {
        image_url = up;
        const imgEl = document.getElementById("admin-notif-image");
        if (imgEl) imgEl.value = up;
      }
    } catch (err) {
      alert(err.message || String(err));
      return;
    }
  }
  const body = { message };
  if (title) body.title = title.slice(0, 200);
  if (target) body.target_user_id = Number(target);
  if (image_url) body.image_url = image_url;
  if (link_url) body.link_url = link_url;
  try {
    await api("/api/admin/notifications/send", { method: "POST", token, body });
    const titleEl = document.getElementById("admin-notif-title");
    if (titleEl) titleEl.value = "";
    document.getElementById("admin-notif-message").value = "";
    const imgEl = document.getElementById("admin-notif-image");
    const linkEl = document.getElementById("admin-notif-link");
    const imgFileEl = document.getElementById("admin-notif-image-file");
    if (imgEl) imgEl.value = "";
    if (linkEl) linkEl.value = "";
    if (imgFileEl) imgFileEl.value = "";
    alert(ar ? "تم الإرسال." : "Sent.");
  } catch (err) {
    alert(err.message || String(err));
  }
}

async function openOrderDetailModal(orderId) {
  const backdrop = document.getElementById("order-detail-backdrop");
  const body = document.getElementById("order-detail-body");
  if (!backdrop || !body) return;
  const token = getToken();
  const ar = getAdminLang() === "ar";
  backdrop.classList.remove("hidden");
  body.innerHTML = `<p class="text-center text-gray-500 py-6">${ar ? "جاري التحميل…" : "Loading…"}</p>`;
  try {
    const data = await api(`/api/admin/orders/${orderId}`, { token });
    const o = data.order;
    const items = data.items || [];
    const history = data.history || [];
    const lines = items
      .map((it) => {
        const img = it.image_url
          ? `<img src="${escapeHtml(it.image_url)}" alt="" class="w-16 h-20 object-cover rounded-xl border border-gray-100 shrink-0 bg-gray-50" loading="lazy" />`
          : `<div class="w-16 h-20 rounded-xl border border-dashed border-gray-200 bg-gray-50 shrink-0 flex items-center justify-center text-[10px] text-gray-400">—</div>`;
        const colorLine =
          it.color && String(it.color).trim()
            ? `<div class="text-xs text-gray-600">${ar ? "اللون" : "Color"}: <span class="font-semibold">${escapeHtml(it.color)}</span></div>`
            : "";
        const sizeLine =
          it.size && String(it.size).trim()
            ? `<div class="text-xs text-gray-600">${ar ? "المقاس" : "Size"}: <span class="font-semibold">${escapeHtml(it.size)}</span></div>`
            : "";
        const variantLine =
          it.variant_label && String(it.variant_label).trim()
            ? `<div class="text-xs text-gray-700 mt-0.5 leading-snug">${escapeHtml(it.variant_label)}</div>`
            : "";
        const brandLine =
          it.brand && String(it.brand).trim()
            ? `<div class="text-xs text-violet-700 font-semibold mt-0.5">${ar ? "الشركة" : "Brand"}: ${escapeHtml(it.brand)}</div>`
            : `<div class="text-xs text-violet-700 font-semibold mt-0.5">${ar ? "الشركة: أدورا" : "Brand: Adora"}</div>`;
        return `<div class="flex gap-3 py-3 border-b border-gray-100">
          ${img}
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-gray-900">${escapeHtml(it.product_name)} <span class="text-gray-500 font-normal">× ${it.qty}</span></div>
            ${brandLine}${variantLine}${colorLine}${sizeLine}
            <div class="text-sm font-mono mt-1">${Number(it.price).toLocaleString()} ل.س</div>
          </div>
        </div>`;
      })
      .join("");
    const hist = history
      .map(
        (h) =>
          `<div class="text-xs text-gray-600 py-0.5">${escapeHtml(formatOrderStatusLabel(h.status))} — ${escapeHtml(h.created_at || "")}</div>`
      )
      .join("");
    const statusOpts = ORDER_STATUS_KEYS.map(
      (k) =>
        `<option value="${k}" ${o.status === k ? "selected" : ""}>${escapeHtml(
          ar ? ORDER_STATUS_LABELS[k].ar : ORDER_STATUS_LABELS[k].en
        )}</option>`
    ).join("");
    body.innerHTML = `
      <div class="mb-4 p-3 rounded-xl bg-purple-50 border border-purple-100 space-y-2">
        <div class="text-sm font-bold text-purple-900">${ar ? "تغيير حالة الطلب" : "Change order status"}</div>
        <p class="text-xs text-purple-800/90 leading-relaxed">${ar ? "عند الحفظ ينتقل الطلب تلقائياً للقسم المناسب في القائمة." : "Saving moves the order to the matching section in the list."}</p>
        <div class="flex flex-wrap gap-2 items-center">
          <select id="order-detail-status-sel" class="flex-1 min-w-[10rem] p-2 rounded-lg border border-gray-200 bg-white text-sm">${statusOpts}</select>
          <button type="button" id="order-detail-status-save" class="px-4 py-2 rounded-lg bg-purple-600 text-white font-bold text-sm shrink-0">${escapeHtml(adminT("save"))}</button>
        </div>
      </div>
      <div class="space-y-2 mb-4">
        <div><strong>${ar ? "رقم الطلب" : "Order"}:</strong> ${escapeHtml(o.order_no)}</div>
        <div><strong>${ar ? "المستخدم" : "User"}:</strong> ${escapeHtml(o.customer_name || "—")} <span class="font-mono text-xs">${escapeHtml(o.customer_phone || "")}</span></div>
        <div><strong>${ar ? "الإجمالي" : "Total"}:</strong> ${Number(o.total_price).toLocaleString()} ل.س</div>
        <div><strong>${ar ? "الحالة الحالية" : "Current status"}:</strong> ${escapeHtml(formatOrderStatusLabel(o.status))}</div>
        <div><strong>${ar ? "الدفع" : "Payment"}:</strong> ${escapeHtml(o.payment_method)}</div>
      </div>
      <div class="font-bold mb-1">${ar ? "المنتجات" : "Items"}</div>
      <div class="mb-4">${lines || `<p class="text-gray-400">${ar ? "لا بنود." : "No line items."}</p>`}</div>
      <div class="font-bold mb-1">${ar ? "سجل الحالة" : "Status history"}</div>
      <div>${hist || "—"}</div>
    `;
    document.getElementById("order-detail-status-save")?.addEventListener("click", async () => {
      const sel = document.getElementById("order-detail-status-sel");
      const status = sel?.value;
      if (!status) return;
      try {
        await api(`/api/orders/${orderId}/status`, { method: "PUT", token, body: { status } });
        await loadOrders();
        renderOrdersTable();
        closeOrderDetailModal();
        alert(ar ? "تم تحديث حالة الطلب." : "Order status updated.");
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  } catch (err) {
    body.innerHTML = `<p class="text-red-600">${escapeHtml(err.message || String(err))}</p>`;
  }
}

function closeOrderDetailModal() {
  document.getElementById("order-detail-backdrop")?.classList.add("hidden");
}
window.closeOrderDetailModal = closeOrderDetailModal;

async function loadOrders() {
  const token = getToken();
  let orders = [];
  try {
    orders = await api("/api/orders", { token });
  } catch (e) {
    console.error(e);
  }
  adminOrdersCache = Array.isArray(orders) ? orders : [];
  renderOrdersTable();
}

async function loadDatabaseOverview() {
  const token = getToken();
  const tbody = document.getElementById("database-overview-tbody");
  const totalEl = document.getElementById("database-overview-total");
  if (!tbody) return;
  if (!token) {
    tbody.innerHTML = "";
    return;
  }
  try {
    const data = await api("/api/admin/database/overview", { token });
    const ar = getAdminLang() === "ar";
    if (totalEl) {
      const n = Number(data.totalRows ?? 0);
      totalEl.textContent = ar
        ? `المجموع: ${n} صفاً — PostgreSQL`
        : `Total rows: ${n} — PostgreSQL`;
    }
    const rows = Array.isArray(data.tables) ? data.tables : [];
    tbody.innerHTML = rows
      .map(
        (t) =>
          `<tr><td class="py-2 pr-2 font-mono text-xs">${escapeHtml(t.name)}</td><td class="py-2">${Number(
            t.rowCount ?? 0
          )}</td></tr>`
      )
      .join("");
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="2" class="py-2 text-red-600">${escapeHtml(e.message || String(e))}</td></tr>`;
    if (totalEl) totalEl.textContent = "";
  }
}

function refilterAdminActiveTab() {
  const vis = document.querySelector(".tab-panel:not(.hidden)")?.id;
  if (vis === "tab-products") renderProductsTable();
  else if (vis === "tab-brands") {
    renderBrandsTable();
    renderBrandProductsTable();
  }
  else if (vis === "tab-categories") renderCategoriesTable();
  else if (vis === "tab-offers") renderOffersTable();
  else if (vis === "tab-orders") renderOrdersTable();
  else if (vis === "tab-users") renderUsersTable();
  else if (vis === "tab-ratings") {
    renderSiteRatingsTable();
    renderAdminProductReviewsTable();
    renderAdminMpProductReviewsTable();
    renderAdminCustomerFeedbackNotesTable();
  }
  else if (vis === "tab-flash") renderFlashSalesTable();
  else if (vis === "tab-banners") renderBannersTable();
}

const HOME_SECTION_VIS_KEYS_FALLBACK = [
  "banners",
  "comprehensive_market",
  "main_categories",
  "brands",
  "top_brands",
  "flash_sale",
  "curated",
  "home_featured",
  "promo_collection",
  "bestsellers",
];

/** Populated from GET /api/admin/home-sections/keys */
let homeSectionVisKeysRuntime = HOME_SECTION_VIS_KEYS_FALLBACK.slice();

const HOME_SECTION_ORDER_VIS_PREFIX = "layout-vis-";

async function renderHomeSectionsCheckboxes() {
  const container = document.getElementById("home-layout-sections-checkboxes");
  if (!container) return;
  const token = getToken();
  const langAr = document.documentElement.getAttribute("lang") !== "en";
  try {
    const meta = await api("/api/admin/home-sections/keys", { token });
    homeSectionVisKeysRuntime = Array.isArray(meta.keys) && meta.keys.length ? meta.keys : HOME_SECTION_VIS_KEYS_FALLBACK;
    container.innerHTML = "";
    for (const s of meta.sections || []) {
      const lab = langAr ? s.label_ar : s.label_en;
      const wrap = document.createElement("label");
      wrap.className = "flex items-center gap-2 cursor-pointer";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = `${HOME_SECTION_ORDER_VIS_PREFIX}${s.key}`;
      cb.className = "rounded border-gray-300";
      cb.checked = s.default !== false;
      const span = document.createElement("span");
      span.setAttribute("data-en", s.label_en || s.key);
      span.setAttribute("data-ar", s.label_ar || s.key);
      span.textContent = lab || s.key;
      wrap.appendChild(cb);
      wrap.appendChild(span);
      container.appendChild(wrap);
    }
  } catch (e) {
    console.error(e);
    homeSectionVisKeysRuntime = HOME_SECTION_VIS_KEYS_FALLBACK.slice();
    container.innerHTML = "";
    for (const k of HOME_SECTION_VIS_KEYS_FALLBACK) {
      const wrap = document.createElement("label");
      wrap.className = "flex items-center gap-2 cursor-pointer";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = `${HOME_SECTION_ORDER_VIS_PREFIX}${k}`;
      cb.className = "rounded border-gray-300";
      cb.checked = true;
      const span = document.createElement("span");
      span.textContent = k;
      wrap.appendChild(cb);
      wrap.appendChild(span);
      container.appendChild(wrap);
    }
  }
}

/** ترتيب الكتل على الرئيسية — يُحمّل من السيرفر */
let homeSectionOrderKeysRuntime = [];

function setHomeSectionsVisibilityToggles(vis) {
  const v = vis && typeof vis === "object" ? vis : {};
  const keys = homeSectionVisKeysRuntime.length ? homeSectionVisKeysRuntime : HOME_SECTION_VIS_KEYS_FALLBACK;
  for (const k of keys) {
    const el = document.getElementById(`${HOME_SECTION_ORDER_VIS_PREFIX}${k}`);
    if (el) el.checked = v[k] !== false;
  }
}

function collectHomeSectionsVisibilityFromForm() {
  const o = {};
  const keys = homeSectionVisKeysRuntime.length ? homeSectionVisKeysRuntime : HOME_SECTION_VIS_KEYS_FALLBACK;
  for (const k of keys) {
    const el = document.getElementById(`${HOME_SECTION_ORDER_VIS_PREFIX}${k}`);
    o[k] = el ? !!el.checked : true;
  }
  return o;
}

function renderHomeSectionsOrderList(order) {
  const ul = document.getElementById("home-sections-order-list");
  if (!ul) return;
  const langAr = document.documentElement.getAttribute("lang") !== "en";
  const keys = Array.isArray(order) && order.length ? order : homeSectionOrderKeysRuntime;
  if (!keys.length) {
    ul.innerHTML = `<li class="text-xs text-gray-400">${langAr ? "جاري التحميل…" : "Loading…"}</li>`;
    return;
  }
  ul.innerHTML = "";
  const metaByKey = {};
  try {
    const raw = ul.getAttribute("data-order-labels");
    if (raw) {
      const arr = JSON.parse(raw);
      for (const row of arr) {
        if (row && row.key) metaByKey[row.key] = row;
      }
    }
  } catch (_e) {
    /* ignore */
  }
  keys.forEach((key, idx) => {
    const row = metaByKey[key];
    const lab = row ? (langAr ? row.label_ar : row.label_en) : key;
    const li = document.createElement("li");
    li.className =
      "flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2 text-sm";
    li.dataset.key = key;
    li.innerHTML = `<span class="flex-1 min-w-0 font-medium text-gray-800">${escapeHtml(String(lab || key))}</span>
      <button type="button" class="home-order-move px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40" data-dir="up" aria-label="Up" ${idx === 0 ? "disabled" : ""}><i class="fas fa-arrow-up text-xs"></i></button>
      <button type="button" class="home-order-move px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40" data-dir="down" aria-label="Down" ${
        idx === keys.length - 1 ? "disabled" : ""
      }><i class="fas fa-arrow-down text-xs"></i></button>`;
    ul.appendChild(li);
  });
  refreshHomeOrderMoveButtons(ul);
}

function refreshHomeOrderMoveButtons(ul) {
  [...ul.children].forEach((row, idx) => {
    const up = row.querySelector('[data-dir="up"]');
    const down = row.querySelector('[data-dir="down"]');
    if (up) up.disabled = idx === 0;
    if (down) down.disabled = idx === ul.children.length - 1;
  });
}

function bindHomeSectionsOrderList() {
  const ul = document.getElementById("home-sections-order-list");
  if (!ul || ul.dataset.bound === "1") return;
  ul.dataset.bound = "1";
  ul.addEventListener("click", (e) => {
    const btn = e.target.closest(".home-order-move");
    if (!btn || btn.disabled) return;
    const li = btn.closest("li");
    if (!li || !ul.contains(li)) return;
    const dir = btn.getAttribute("data-dir");
    if (dir === "up") {
      const prev = li.previousElementSibling;
      if (prev) ul.insertBefore(li, prev);
    } else if (dir === "down") {
      const next = li.nextElementSibling;
      if (next) ul.insertBefore(next, li);
    }
    refreshHomeOrderMoveButtons(ul);
  });
}

function collectHomeSectionsOrderFromList() {
  const ul = document.getElementById("home-sections-order-list");
  if (!ul) return [];
  return [...ul.querySelectorAll("li[data-key]")].map((li) => li.dataset.key).filter(Boolean);
}

async function loadHomeLayoutTab() {
  bindHomeSectionsOrderList();
  await renderHomeSectionsCheckboxes();
  try {
    const data = await api("/api/contact", {});
    const token = getToken();
    const meta = await api("/api/admin/home-sections/keys", { token });
    homeSectionOrderKeysRuntime = Array.isArray(meta.order_keys) && meta.order_keys.length ? meta.order_keys : [];
    const ul = document.getElementById("home-sections-order-list");
    if (ul && Array.isArray(meta.order_sections)) {
      ul.setAttribute("data-order-labels", JSON.stringify(meta.order_sections));
    }
    setHomeSectionsVisibilityToggles(data.home_sections_visibility);
    const stickyCb = document.getElementById("home-top-banners-sticky");
    if (stickyCb) {
      stickyCb.checked = data.home_top_banners_sticky === true || data.home_top_banners_sticky === 1;
    }
    const ord = Array.isArray(data.home_sections_order) && data.home_sections_order.length ? data.home_sections_order : homeSectionOrderKeysRuntime;
    renderHomeSectionsOrderList(ord);
  } catch (e) {
    console.error(e);
    renderHomeSectionsOrderList(homeSectionOrderKeysRuntime);
  }
}

async function saveHomeLayout() {
  const token = getToken();
  let cur = {};
  try {
    cur = await api("/api/contact", {});
  } catch (_e) {
    alert("Failed to load settings");
    return;
  }
  const body = {
    address: cur.address || "",
    phones: Array.isArray(cur.phones) ? cur.phones : [],
    whatsapp_phone: cur.whatsapp_phone || "",
    home_main_section_images:
      cur.home_main_section_images && typeof cur.home_main_section_images === "object"
        ? cur.home_main_section_images
        : { men: "", women: "", kids: "" },
    home_sections_visibility: collectHomeSectionsVisibilityFromForm(),
    home_sections_order: collectHomeSectionsOrderFromList(),
    home_top_banners_sticky: document.getElementById("home-top-banners-sticky")?.checked === true,
  };
  if (cur.home_subcategory_slides != null && typeof cur.home_subcategory_slides === "object") {
    body.home_subcategory_slides = cur.home_subcategory_slides;
  }
  try {
    await api("/api/contact", { method: "PUT", token, body });
    alert(adminT("contactSaved") || "Saved");
  } catch (e) {
    alert(e.message || String(e));
  }
}

async function loadContact() {
  try {
    const data = await api("/api/contact", {});
    const addr = document.getElementById("contact-address");
    const phones = document.getElementById("contact-phones");
    const wa = document.getElementById("contact-whatsapp");
    if (addr) addr.value = data.address || "";
    if (phones) phones.value = (data.phones || []).join(", ");
    if (wa) wa.value = data.whatsapp_phone || "";
    const hm = data.home_main_section_images || {};
    const m = document.getElementById("contact-home-img-men");
    const w = document.getElementById("contact-home-img-women");
    const k = document.getElementById("contact-home-img-kids");
    if (m) m.value = hm.men || "";
    if (w) w.value = hm.women || "";
    if (k) k.value = hm.kids || "";
    const slidesTa = document.getElementById("contact-home-subcat-slides-json");
    if (slidesTa) {
      const slides = data.home_subcategory_slides;
      slidesTa.value =
        slides && typeof slides === "object" ? JSON.stringify(slides, null, 2) : "";
    }
  } catch (e) {
    console.error(e);
  }
}

async function saveContact(e) {
  e.preventDefault();
  const token = getToken();
  const address = document.getElementById("contact-address").value.trim();
  const phones = document.getElementById("contact-phones").value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const whatsapp_phone = document.getElementById("contact-whatsapp").value.trim();
  const mEl = document.getElementById("contact-home-img-men");
  const wEl = document.getElementById("contact-home-img-women");
  const kEl = document.getElementById("contact-home-img-kids");
  let men = mEl ? mEl.value.trim() : "";
  let women = wEl ? wEl.value.trim() : "";
  let kids = kEl ? kEl.value.trim() : "";
  const mf = document.getElementById("contact-home-img-men-file")?.files?.[0];
  const wf = document.getElementById("contact-home-img-women-file")?.files?.[0];
  const kf = document.getElementById("contact-home-img-kids-file")?.files?.[0];
  try {
    if (mf) {
      const up = await uploadImageFile(mf, token);
      if (up) {
        men = up;
        if (mEl) mEl.value = up;
      }
    }
    if (wf) {
      const up = await uploadImageFile(wf, token);
      if (up) {
        women = up;
        if (wEl) wEl.value = up;
      }
    }
    if (kf) {
      const up = await uploadImageFile(kf, token);
      if (up) {
        kids = up;
        if (kEl) kEl.value = up;
      }
    }
  } catch (err) {
    alert(err.message || String(err));
    return;
  }
  document.getElementById("contact-home-img-men-file") && (document.getElementById("contact-home-img-men-file").value = "");
  document.getElementById("contact-home-img-women-file") && (document.getElementById("contact-home-img-women-file").value = "");
  document.getElementById("contact-home-img-kids-file") && (document.getElementById("contact-home-img-kids-file").value = "");
  const home_main_section_images = {
    men,
    women,
    kids,
  };
  const slidesTa = document.getElementById("contact-home-subcat-slides-json");
  const body = { address, phones, whatsapp_phone, home_main_section_images };
  if (slidesTa && slidesTa.value.trim()) {
    try {
      const home_subcategory_slides = JSON.parse(slidesTa.value);
      if (home_subcategory_slides == null || typeof home_subcategory_slides !== "object") {
        alert(adminT("invalidJson") || "Invalid JSON in subcategory sliders");
        return;
      }
      body.home_subcategory_slides = home_subcategory_slides;
    } catch (e) {
      alert(adminT("invalidJson") || "Invalid JSON in subcategory sliders");
      return;
    }
  }
  await api("/api/contact", {
    method: "PUT",
    token,
    body,
  });
  alert(adminT("contactSaved"));
}

async function bootstrapAuthed() {
  const token = getToken();
  if (!token) return;

  document.getElementById("btn-logout").classList.remove("hidden");
  document.getElementById("dash-panel").classList.remove("hidden");
  document.getElementById("auth-panel").classList.add("hidden");

  // tabs
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.getAttribute("data-tab")));
  });

  document.getElementById("btn-logout").addEventListener("click", () => {
    clearToken();
    location.reload();
  });

  document.getElementById("btn-refresh-products").addEventListener("click", loadProducts);
  document.getElementById("product-form").addEventListener("submit", saveProduct);
  initProductVariantBuilderUi();
  document.getElementById("product-category")?.addEventListener("change", () => {
    syncPlacementRadiosFromCategory();
    fillSubcategoryOptionsForCategory(document.getElementById("product-category").value, "");
  });
  initProductPlacementRadios();

  document.getElementById("btn-refresh-brands").addEventListener("click", loadBrands);

  document.getElementById("brand-form").addEventListener("submit", saveBrand);
  document.getElementById("brand-products-brand-select")?.addEventListener("change", () => {
    loadBrandProductsSection().catch(() => {});
  });
  document.querySelectorAll(".brand-main-cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      brandProductsSelection.mainCat = btn.getAttribute("data-cat") || "Men";
      updateBrandMainCatButtons();
      loadBrandProductsSection().catch(() => {});
    });
  });
  document.getElementById("btn-brand-add-product-in-section")?.addEventListener("click", () => {
    const brand = document.getElementById("brand-products-brand-select")?.value?.trim();
    if (!brand) {
      alert(adminT("selectBrandFirst"));
      return;
    }
    prepareNewProductForBrand(brand, brandProductsSelection.mainCat || "Men");
  });

  document.getElementById("category-form").addEventListener("submit", saveCategory);
  document.getElementById("btn-refresh-categories").addEventListener("click", loadCategories);

  document.getElementById("btn-refresh-offers").addEventListener("click", async () => {
    await loadOffers();
  });
  document.getElementById("offer-form").addEventListener("submit", saveOffer);

  document.getElementById("btn-refresh-orders").addEventListener("click", loadOrders);
  document.getElementById("btn-refresh-flash")?.addEventListener("click", () => loadFlashSales().catch(() => {}));
  document.getElementById("admin-table-search")?.addEventListener("input", () => refilterAdminActiveTab());
  document.getElementById("btn-refresh-users")?.addEventListener("click", () => {
    loadUsers().catch(() => {});
    loadBroadcasts().catch(() => {});
  });
  document.getElementById("broadcast-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;
    const ar = getAdminLang() === "ar";
    const title_ar = document.getElementById("bc-title-ar").value.trim();
    const title_en = document.getElementById("bc-title-en").value.trim();
    const body_ar = document.getElementById("bc-body-ar").value.trim();
    const body_en = document.getElementById("bc-body-en").value.trim();
    if (!title_ar || !title_en) {
      alert(ar ? "أدخل العنوان بالعربي والإنجليزي." : "Enter title in Arabic and English.");
      return;
    }
    try {
      await api("/api/admin/broadcasts", { method: "POST", token, body: { title_ar, title_en, body_ar, body_en } });
      document.getElementById("bc-body-ar").value = "";
      document.getElementById("bc-body-en").value = "";
      await loadBroadcasts();
      alert(ar ? "تم إرسال الرسالة لمستخدمي التطبيق." : "Message sent to app users.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  document.getElementById("btn-clear-all-notifications")?.addEventListener("click", async () => {
    const token = getToken();
    if (!token) return;
    const ar = getAdminLang() === "ar";
    if (
      !confirm(
        ar
          ? "سيتم حذف جميع رسائل البث والإشعارات الداخلية من قاعدة البيانات لجميع المستخدمين. هل أنت متأكد؟"
          : "This will delete ALL broadcast messages and in-app notifications for every user. Continue?"
      )
    )
      return;
    try {
      await api("/api/admin/notifications/all", { method: "DELETE", token });
      await loadBroadcasts();
      alert(ar ? "تم حذف الإشعارات." : "All notifications cleared.");
    } catch (err) {
      alert(err.message || String(err));
    }
  });
  document.getElementById("contact-form").addEventListener("submit", saveContact);
  document.getElementById("btn-save-home-layout")?.addEventListener("click", () => saveHomeLayout().catch(() => {}));
  document.getElementById("admin-notif-form")?.addEventListener("submit", sendAdminNotification);
  document.getElementById("btn-push-diagnostics")?.addEventListener("click", () => refreshPushDiagnostics().catch(() => {}));
  document.getElementById("btn-refresh-site-ratings")?.addEventListener("click", () => loadSiteRatings().catch(() => {}));
  document.getElementById("btn-refresh-product-reviews")?.addEventListener("click", () => loadAdminProductReviews().catch(() => {}));
  document.getElementById("btn-refresh-mp-product-reviews")?.addEventListener("click", () => loadAdminMarketplaceProductReviews().catch(() => {}));
  document.getElementById("btn-refresh-customer-feedback-notes")?.addEventListener("click", () => loadAdminCustomerFeedbackNotes().catch(() => {}));
  document.getElementById("btn-refresh-database-overview")?.addEventListener("click", () => loadDatabaseOverview().catch(() => {}));
  document.getElementById("banner-form")?.addEventListener("submit", (ev) => saveBanner(ev).catch((err) => alert(err.message || String(err))));
  document.getElementById("btn-refresh-banners")?.addEventListener("click", () => loadBanners().catch(() => {}));
  document.getElementById("btn-reset-banner")?.addEventListener("click", () => resetBannerForm());
  document.getElementById("btn-vp-sub-refresh")?.addEventListener("click", () => {
    loadVendorSubscriptionRequests().catch(() => {});
    loadAppAdInquiriesUi().catch(() => {});
  });
  document.getElementById("btn-app-ad-inq-refresh")?.addEventListener("click", () =>
    loadAppAdInquiriesUi().catch((err) => alert(err.message || err))
  );

  try {
    await loadOfferProductsIntoSelect();
  } catch (e) {
    console.error(e);
  }

  const loaders = [
    ["products", () => loadProducts()],
    ["brands", () => loadBrands()],
    ["categories", () => loadCategories()],
    ["offers", () => loadOffers()],
    ["orders", () => loadOrders()],
    ["flash", () => loadFlashSales()],
    ["users", () => loadUsers()],
    ["siteRatings", () => loadSiteRatings()],
    ["productReviews", () => loadAdminProductReviews()],
    ["mpProductReviews", () => loadAdminMarketplaceProductReviews()],
    ["broadcasts", () => loadBroadcasts()],
    ["contact", () => loadContact()],
    ["banners", () => loadBanners()],
  ];
  const settled = await Promise.allSettled(loaders.map(([, fn]) => fn()));
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[admin] ${loaders[i][0]} failed:`, r.reason);
    }
  });

  setActiveTab("tab-products");
  hideError(document.getElementById("auth-error"));
  applyAdminLang();
}

async function init() {
  applyAdminLang();
  document.getElementById("btn-admin-lang")?.addEventListener("click", () => {
    setAdminLang(getAdminLang() === "ar" ? "en" : "ar");
  });

  const token = getToken();
  const dashPanel = document.getElementById("dash-panel");
  const authPanel = document.getElementById("auth-panel");
  const btnLogout = document.getElementById("btn-logout");

  document.getElementById("btn-login").addEventListener("click", login);
  document.getElementById("btn-refresh").addEventListener("click", () => location.reload());

  if (token) {
    const ok = await isStoredTokenAdmin(token);
    if (!ok) {
      clearToken();
      authPanel.classList.remove("hidden");
      dashPanel.classList.add("hidden");
      btnLogout.classList.add("hidden");
      showError(document.getElementById("auth-error"), adminT("adminOnlyLogin"));
    } else {
      authPanel.classList.add("hidden");
      dashPanel.classList.remove("hidden");
      btnLogout.classList.remove("hidden");
      await bootstrapAuthed();
    }
  } else {
    dashPanel.classList.add("hidden");
    authPanel.classList.remove("hidden");
    btnLogout.classList.add("hidden");
  }

  // Buttons reset placeholders: keep forms as-is.
  document.getElementById("btn-reset-product").addEventListener("click", () => resetProductForm());
}

init().catch((e) => {
  const errEl = document.getElementById("auth-error");
  if (errEl) {
    showError(errEl, e.message);
  } else {
    // eslint-disable-next-line no-console
    console.error(e);
  }
});


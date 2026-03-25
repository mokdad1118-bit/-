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
let adminUsersCache = [];
let adminSiteRatingsCache = [];
let adminProductReviewsCache = [];
let adminFlashCache = [];
let adminBannersCache = [];
/** منتجات العلامة المختارة حسب القسم الرئيسي (Men/Women/Kids) */
let adminBrandProductsCache = [];
let brandProductsSelection = { mainCat: "Men" };

/** مفاتيح الحالة بالتسلسل (نفس السيرفر) — التعديل للمشرف فقط */
const ORDER_STATUS_KEYS = ["pending_receipt", "in_progress", "fulfilled", "shipping", "delivered"];
const ORDER_STATUS_LABELS = {
  pending_receipt: { en: "Pending receipt", ar: "قيد الاستلام" },
  in_progress: { en: "In progress", ar: "قيد التنفيذ" },
  fulfilled: { en: "Fulfilled", ar: "تم التنفيذ" },
  shipping: { en: "Out for delivery", ar: "جاري الشحن" },
  delivered: { en: "Received", ar: "تم استلام طلبك" },
};

function formatOrderStatusLabel(status) {
  const s = String(status || "").trim();
  const o = ORDER_STATUS_LABELS[s];
  if (o) return getAdminLang() === "ar" ? o.ar : o.en;
  return s;
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
  if (tabId === "tab-orders") loadOrders().catch(() => {});
  if (tabId === "tab-flash") loadFlashSales().catch(() => {});
  if (tabId === "tab-categories") loadCategories().catch(() => {});
  if (tabId === "tab-offers") {
    loadOfferProductsIntoSelect().catch(() => {});
    loadOffers().catch(() => {});
  }
  if (tabId === "tab-contact") loadContact().catch(() => {});
  if (tabId === "tab-ratings") {
    loadSiteRatings().catch(() => {});
    loadAdminProductReviews().catch(() => {});
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
  if (tabId === "tab-banners") loadBanners().catch(() => {});
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

function renderBannersTable() {
  const tbody = document.getElementById("banners-tbody");
  if (!tbody) return;
  const ar = getAdminLang() === "ar";
  const list = Array.isArray(adminBannersCache) ? adminBannersCache : [];
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-gray-500">${
      ar ? "لا بانرات بعد." : "No banners yet."
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((b) => {
      return `<tr>
        <td class="py-2">${b.id}</td>
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
  };
  if (!body.placement) {
    alert(ar ? "اختر موضع العرض." : "Choose placement.");
    return;
  }
  if (!body.title_ar && !body.title_en) {
    alert(ar ? "أدخل عنواناً عربياً أو إنجليزياً." : "Enter a title in Arabic or English.");
    return;
  }
  if (!body.body_ar && !body.body_en) {
    alert(ar ? "أدخل نصاً عربياً أو إنجليزياً." : "Enter body text in Arabic or English.");
    return;
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

  const sizes = document.getElementById("product-sizes").value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const colors = document.getElementById("product-colors").value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  let inventory = [];
  const invEl = document.getElementById("product-inventory-json");
  if (invEl && invEl.value.trim()) {
    try {
      const parsed = JSON.parse(invEl.value.trim());
      inventory = Array.isArray(parsed) ? parsed : [];
    } catch {
      inventory = [];
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
        `${u.name} ${u.phone} ${u.role || ""}`.toLowerCase().includes(f)
      )
    : adminUsersCache;
  if (!adminUsersCache.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-gray-500">${
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
          <td class="py-2 font-mono text-xs">${escapeHtml(u.phone)}</td>
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
  let rows = [];
  try {
    rows = await api("/api/admin/product-reviews", { token });
  } catch (e) {
    console.error(e);
  }
  adminProductReviewsCache = Array.isArray(rows) ? rows : [];
  renderAdminProductReviewsTable();
}

function renderAdminProductReviewsTable() {
  const tbody = document.getElementById("product-reviews-tbody");
  if (!tbody) return;
  const f = getAdminFilter();
  const list = f
    ? adminProductReviewsCache.filter((r) =>
        `${r.user_name || ""} ${r.user_phone || ""} ${r.comment || ""} ${r.stars} ${r.product_name_en || ""} ${r.product_name_ar || ""} ${r.product_id || ""}`
          .toLowerCase()
          .includes(f)
      )
    : adminProductReviewsCache;
  const ar = getAdminLang() === "ar";
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
  const f = getAdminFilter();
  const list = f
    ? adminOrdersCache.filter((o) => {
        const hay = `${o.order_no} ${o.customer_name || ""} ${o.customer_phone || ""} ${o.user_id} ${o.status}`.toLowerCase();
        return hay.includes(f);
      })
    : adminOrdersCache;
  const ar = getAdminLang() === "ar";
  if (!adminOrdersCache.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-gray-500">${
      ar ? "لا طلبات بعد — تظهر هنا طلبات التطبيق بعد إتمام الشراء." : "No orders yet — app orders appear here after checkout."
    }</td></tr>`;
    return;
  }
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-gray-500">${ar ? "لا نتائج للبحث." : "No search matches."}</td></tr>`;
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
    o.textContent = `${u.name} — ${u.phone}`;
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
        const brandLine =
          it.brand && String(it.brand).trim()
            ? `<div class="text-xs text-violet-700 font-semibold mt-0.5">${ar ? "الشركة" : "Brand"}: ${escapeHtml(it.brand)}</div>`
            : `<div class="text-xs text-violet-700 font-semibold mt-0.5">${ar ? "الشركة: أدورا" : "Brand: Adora"}</div>`;
        return `<div class="flex gap-3 py-3 border-b border-gray-100">
          ${img}
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-gray-900">${escapeHtml(it.product_name)} <span class="text-gray-500 font-normal">× ${it.qty}</span></div>
            ${brandLine}${colorLine}${sizeLine}
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
    body.innerHTML = `
      <div class="space-y-2 mb-4">
        <div><strong>${ar ? "رقم الطلب" : "Order"}:</strong> ${escapeHtml(o.order_no)}</div>
        <div><strong>${ar ? "المستخدم" : "User"}:</strong> ${escapeHtml(o.customer_name || "—")} <span class="font-mono text-xs">${escapeHtml(o.customer_phone || "")}</span></div>
        <div><strong>${ar ? "الإجمالي" : "Total"}:</strong> ${Number(o.total_price).toLocaleString()} ل.س</div>
        <div><strong>${ar ? "الحالة" : "Status"}:</strong> ${escapeHtml(formatOrderStatusLabel(o.status))}</div>
        <div><strong>${ar ? "الدفع" : "Payment"}:</strong> ${escapeHtml(o.payment_method)}</div>
      </div>
      <div class="font-bold mb-1">${ar ? "المنتجات" : "Items"}</div>
      <div class="mb-4">${lines || `<p class="text-gray-400">${ar ? "لا بنود." : "No line items."}</p>`}</div>
      <div class="font-bold mb-1">${ar ? "سجل الحالة" : "Status history"}</div>
      <div>${hist || "—"}</div>
    `;
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
  }
  else if (vis === "tab-flash") renderFlashSalesTable();
  else if (vis === "tab-banners") renderBannersTable();
}

const HOME_SECTION_VIS_KEYS_FALLBACK = [
  "banners",
  "main_categories",
  "brands",
  "top_brands",
  "flash_sale",
  "curated",
  "promo_collection",
  "bestsellers",
];

/** Populated from GET /api/admin/home-sections/keys */
let homeSectionVisKeysRuntime = HOME_SECTION_VIS_KEYS_FALLBACK.slice();

async function renderHomeSectionsCheckboxes() {
  const container = document.getElementById("home-sections-all-checkboxes");
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
      cb.id = `contact-vis-${s.key}`;
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
      cb.id = `contact-vis-${k}`;
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

function setHomeSectionsVisibilityToggles(vis) {
  const v = vis && typeof vis === "object" ? vis : {};
  const keys = homeSectionVisKeysRuntime.length ? homeSectionVisKeysRuntime : HOME_SECTION_VIS_KEYS_FALLBACK;
  for (const k of keys) {
    const el = document.getElementById(`contact-vis-${k}`);
    if (el) el.checked = v[k] !== false;
  }
}

function collectHomeSectionsVisibilityFromForm() {
  const o = {};
  const keys = homeSectionVisKeysRuntime.length ? homeSectionVisKeysRuntime : HOME_SECTION_VIS_KEYS_FALLBACK;
  for (const k of keys) {
    const el = document.getElementById(`contact-vis-${k}`);
    o[k] = el ? !!el.checked : true;
  }
  return o;
}

async function loadContact() {
  try {
    await renderHomeSectionsCheckboxes();
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
    setHomeSectionsVisibilityToggles(data.home_sections_visibility);
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
  const body = { address, phones, whatsapp_phone, home_main_section_images, home_sections_visibility: collectHomeSectionsVisibilityFromForm() };
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
  document.getElementById("admin-notif-form")?.addEventListener("submit", sendAdminNotification);
  document.getElementById("btn-push-diagnostics")?.addEventListener("click", () => refreshPushDiagnostics().catch(() => {}));
  document.getElementById("btn-refresh-site-ratings")?.addEventListener("click", () => loadSiteRatings().catch(() => {}));
  document.getElementById("btn-refresh-product-reviews")?.addEventListener("click", () => loadAdminProductReviews().catch(() => {}));
  document.getElementById("btn-refresh-database-overview")?.addEventListener("click", () => loadDatabaseOverview().catch(() => {}));
  document.getElementById("banner-form")?.addEventListener("submit", (ev) => saveBanner(ev).catch((err) => alert(err.message || String(err))));
  document.getElementById("btn-refresh-banners")?.addEventListener("click", () => loadBanners().catch(() => {}));
  document.getElementById("btn-reset-banner")?.addEventListener("click", () => resetBannerForm());

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


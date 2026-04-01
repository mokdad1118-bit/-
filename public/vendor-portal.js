(function () {
  const TOKEN_KEY = "adora_mp_vendor_token";
  let lastVendorMe = null;
  let vpContactOpenThreadId = null;
  let productImageUrls = [];
  /** { product_options: group[], inventory: { options, stock, price }[] } — نفس بنية لوحة الإدارة */
  let vpVariantState = { product_options: [], inventory: [] };
  const VP_MAX_VARIANT_COMBOS = 120;

  const VP_SECTION_IDS = ["dashboard", "notifications", "products", "add-product", "ad", "orders", "stats"];
  /** يطابق الخادم: فوق هذا السعر يحتاج اعتماد إداري للظهور العام */
  const VP_LISTING_APPROVAL_PRICE_ABOVE = 500000;
  /** يُلحق برسالة نجاح إضافة منتج جديد */
  const VP_MSG_AFTER_ADD_CHECK_APP =
    "\n\nيرجى الدخول إلى التطبيق والتأكد بأن مواصفات منتجك (الصور، الخيارات، الوصف، السعر…) تظهر كما وصفتها.";

  function vpNavigate(section) {
    const id = VP_SECTION_IDS.includes(section) ? section : "dashboard";
    VP_SECTION_IDS.forEach((s) => {
      const sec = document.getElementById("vp-section-" + s);
      if (sec) sec.classList.toggle("hidden", s !== id);
    });
    document.querySelectorAll(".vp-nav-item[data-vp-nav]").forEach((btn) => {
      const on = btn.getAttribute("data-vp-nav") === id;
      btn.classList.toggle("vp-nav-active", on);
      btn.setAttribute("aria-current", on ? "page" : "false");
    });
    if (id === "notifications") {
      refreshVendorNotifications().catch(() => {});
    }
    try {
      history.replaceState(null, "", "#" + id);
    } catch (_e) {
      /* ignore */
    }
  }

  function vpProductPublicUrl(productId) {
    const u = new URL("/", window.location.origin);
    u.searchParams.set("mp", String(productId));
    return u.href;
  }

  function vpListingStatusBadge(st) {
    const s = String(st || "published").trim().toLowerCase();
    if (s === "pending") {
      return "<span class=\"vp-badge vp-badge-pending\"><i class=\"fas fa-clock\"></i> قيد المراجعة</span>";
    }
    if (s === "rejected") {
      return "<span class=\"vp-badge vp-badge-rejected\"><i class=\"fas fa-circle-xmark\"></i> مرفوض</span>";
    }
    return "<span class=\"vp-badge vp-badge-published\"><i class=\"fas fa-circle-check\"></i> منشور</span>";
  }

  function refreshStatsFromMe(me) {
    if (!me) return;
    const sp = el("vp-stat-products");
    const sr = el("vp-stat-remaining");
    const so = el("vp-stat-orders");
    const sa = el("vp-stat-account");
    if (sp) sp.textContent = String(me.active_products ?? "—");
    if (sr) {
      if (me.remaining_product_slots != null) {
        sr.textContent = String(me.remaining_product_slots);
      } else {
        sr.textContent = "غير محدود";
      }
    }
    if (so) so.textContent = String(me.orders_count ?? "—");
    if (sa) sa.textContent = me.account_status_label_ar || "—";
    const dp = el("vp-detail-products");
    const dl = el("vp-detail-limit");
    const dr = el("vp-detail-remaining");
    const dor = el("vp-detail-orders");
    const dac = el("vp-detail-account");
    if (dp) dp.textContent = String(me.active_products ?? "—");
    if (dl) {
      dl.textContent =
        me.product_quota_limit != null ? String(me.product_quota_limit) : "بدون حد (حسب إعدادات المنصة)";
    }
    if (dr) {
      dr.textContent =
        me.remaining_product_slots != null ? String(me.remaining_product_slots) : "—";
    }
    if (dor) dor.textContent = String(me.orders_count ?? "—");
    if (dac) dac.textContent = me.account_status_label_ar || "—";
  }

  const api = (path, opts = {}) => {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) headers.Authorization = "Bearer " + t;
    return fetch(path, { ...opts, headers }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.code === "PORTAL_SUSPENDED" || j.code === "VENDOR_INACTIVE") {
          vpRevokePortalSession();
        }
        const err = new Error(j.error || r.statusText);
        err.code = j.code;
        throw err;
      }
      return j;
    });
  };

  async function uploadVendorImageFile(file) {
    const t = localStorage.getItem(TOKEN_KEY);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/vendor-portal/upload/image", {
      method: "POST",
      headers: t ? { Authorization: "Bearer " + t } : {},
      body: fd,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.code === "PORTAL_SUSPENDED" || j.code === "VENDOR_INACTIVE") {
        vpRevokePortalSession();
      }
      throw new Error(j.error || r.statusText);
    }
    return j.url;
  }

  const el = (id) => document.getElementById(id);

  function vpGenId(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 10);
  }

  function vpSplitValueTokens(raw) {
    return String(raw || "")
      .split(/[,،;\n\r]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function vpApplyPricingMode(variantOn) {
    const stockInp = el("vp-prod-stock");
    const wrap = el("vp-prod-stock-wrap");
    if (wrap) wrap.classList.toggle("hidden", !!variantOn);
    if (stockInp) {
      if (variantOn) stockInp.removeAttribute("required");
      else stockInp.setAttribute("required", "required");
    }
    const price = el("vp-prod-price");
    if (price) {
      price.placeholder = variantOn ? "سعر افتراضي للتركيبات" : "السعر";
    }
  }

  function vpRenderVariantTable() {
    const wrap = el("vp-var-table-wrap");
    if (!wrap) return;
    if (!vpVariantState.product_options.length || !vpVariantState.inventory.length) {
      wrap.innerHTML = "";
      return;
    }
    const groups = vpVariantState.product_options;
    let header = groups.map((gg) => `<th>${gg.name_ar}</th>`).join("");
    header += "<th>السعر</th><th>المخزون</th>";
    const body = vpVariantState.inventory
      .map((row, ri) => {
        let tds = groups
          .map((gg) => {
            const vid = row.options[gg.id];
            const val = (gg.values || []).find((v) => String(v.id) === String(vid));
            const lab = val ? val.label_ar || val.label_en : "—";
            return `<td>${String(lab).replace(/</g, "&lt;")}</td>`;
          })
          .join("");
        const pr = row.price != null && row.price !== "" ? String(row.price) : "";
        const st = row.stock != null ? String(row.stock) : "0";
        tds += `<td><input type="number" min="0" step="0.01" class="vp-vt-pr" data-vp-i="${ri}" value="${pr}" /></td>`;
        tds += `<td><input type="number" min="0" step="1" class="vp-vt-st" data-vp-i="${ri}" value="${st}" /></td>`;
        return `<tr>${tds}</tr>`;
      })
      .join("");
    wrap.innerHTML = "<table><thead><tr>" + header + "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  function vpReadVariantInputsIntoState() {
    if (!vpVariantState.inventory.length) return;
    document.querySelectorAll(".vp-vt-pr").forEach((inp) => {
      const i = Number(inp.getAttribute("data-vp-i"));
      if (Number.isFinite(i) && vpVariantState.inventory[i]) {
        const n = Number(inp.value);
        vpVariantState.inventory[i].price = Number.isFinite(n) ? n : 0;
      }
    });
    document.querySelectorAll(".vp-vt-st").forEach((inp) => {
      const i = Number(inp.getAttribute("data-vp-i"));
      if (Number.isFinite(i) && vpVariantState.inventory[i]) {
        vpVariantState.inventory[i].stock = Math.max(0, Math.floor(Number(inp.value) || 0));
      }
    });
  }

  function vpBuildVariantMatrix() {
    const g1ar = el("vp-var-g1-ar")?.value?.trim() || "اللون";
    const g1en = el("vp-var-g1-en")?.value?.trim() || "Color";
    const v1 = vpSplitValueTokens(el("vp-var-g1-vals")?.value);
    if (!v1.length) {
      alert("أدخل قيمة واحدة على الأقل للمواصفة الأولى (مفصولة بفاصلة أو سطر جديد).");
      return;
    }
    const g2ar = el("vp-var-g2-ar")?.value?.trim() || "المقاس";
    const g2en = el("vp-var-g2-en")?.value?.trim() || "Size";
    const v2 = vpSplitValueTokens(el("vp-var-g2-vals")?.value);

    const gid1 = vpGenId("opt");
    const group1 = {
      id: gid1,
      name_ar: g1ar,
      name_en: g1en,
      values: v1.map((t) => ({ id: vpGenId("v"), label_ar: t, label_en: t })),
    };
    let product_options = [group1];
    let combos = group1.values.map((val) => ({
      options: { [gid1]: val.id },
      labels: [val.label_ar],
    }));

    if (v2.length) {
      const gid2 = vpGenId("opt");
      const group2 = {
        id: gid2,
        name_ar: g2ar,
        name_en: g2en,
        values: v2.map((t) => ({ id: vpGenId("v"), label_ar: t, label_en: t })),
      };
      product_options.push(group2);
      const next = [];
      for (const row of combos) {
        for (const val2 of group2.values) {
          next.push({
            options: { ...row.options, [gid2]: val2.id },
            labels: [...row.labels, val2.label_ar],
          });
        }
      }
      combos = next;
    }

    if (combos.length > VP_MAX_VARIANT_COMBOS) {
      alert(
        "عدد التركيبات كبير جداً (" +
          combos.length +
          "). قلّل عدد القيم (الحد الأقصى " +
          VP_MAX_VARIANT_COMBOS +
          " تركيبة)."
      );
      return;
    }

    const defPrice = Number(el("vp-prod-price")?.value);
    if (!Number.isFinite(defPrice) || defPrice < 0) {
      alert("أدخل سعراً صالحاً في حقل السعر لاستخدامه كقيمة افتراضية لكل تركيبة.");
      return;
    }

    vpVariantState = {
      product_options,
      inventory: combos.map((c) => ({
        options: { ...c.options },
        stock: 0,
        price: defPrice,
      })),
    };
    vpRenderVariantTable();
  }

  function vpResetVariantUi() {
    vpVariantState = { product_options: [], inventory: [] };
    const w = el("vp-var-table-wrap");
    if (w) w.innerHTML = "";
    const cb = el("vp-prod-use-variants");
    if (cb) cb.checked = false;
    el("vp-variants-panel")?.classList.add("hidden");
    vpApplyPricingMode(false);
  }

  function showErr(msg) {
    const e = el("vp-err");
    if (!e) return;
    e.textContent = msg || "";
    e.classList.toggle("hidden", !msg);
  }

  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function vpRevokePortalSession() {
    setToken(null);
    el("vp-app")?.classList.add("hidden");
    el("vp-change-card")?.classList.add("hidden");
    el("vp-login-card")?.classList.remove("hidden");
    el("vp-marketing-head")?.classList.remove("hidden");
  }

  let vpOrderDetailFulfillmentId = null;

  function vpAbsMediaUrl(u) {
    const s = String(u || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("//")) return (typeof location !== "undefined" ? location.protocol : "https:") + s;
    if (s.startsWith("/")) return (typeof location !== "undefined" ? location.origin : "") + s;
    return s;
  }

  function closeVpOrderOverlay() {
    const overlay = el("vp-order-overlay");
    if (overlay) overlay.classList.add("hidden");
    document.body.style.overflow = "";
    vpOrderDetailFulfillmentId = null;
  }

  async function openVpOrderDetail(fid) {
    const id = Number(fid);
    if (!Number.isFinite(id)) return;
    vpOrderDetailFulfillmentId = id;
    const overlay = el("vp-order-overlay");
    const scroll = el("vp-order-detail-scroll");
    const title = el("vp-order-detail-title");
    const sel = el("vp-order-status-select");
    const note = el("vp-order-status-note");
    const notifyCb = el("vp-order-notify-user");
    const msg = el("vp-order-status-msg");
    if (!overlay || !scroll) return;
    if (msg) msg.textContent = "";
    if (note) note.value = "";
    if (notifyCb) notifyCb.checked = true;
    scroll.innerHTML = '<p class="text-gray-500">جاري التحميل…</p>';
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    const data = await api("/api/vendor-portal/fulfillments/" + encodeURIComponent(id));
    const f = data.fulfillment;
    const cust = data.customer || {};
    if (title) title.textContent = "طلب " + (f.order_no || "#" + f.order_id);
    const pay = String(f.payment_method || "").trim();
    const payLab = pay === "cod" ? "الدفع عند الاستلام" : pay === "card" ? "بطاقة" : pay || "—";
    let shipBlock = "";
    if (data.shipping_structured && typeof data.shipping_structured === "object") {
      const s = data.shipping_structured;
      shipBlock =
        '<div class="rounded-xl border border-gray-200 p-3 bg-gray-50/80 space-y-1 text-xs">' +
        '<p class="font-black text-gray-900 mb-2">بيانات التوصيل</p>' +
        "<p><strong>الاسم:</strong> " +
        vpEscNotif(s.full_name) +
        "</p>" +
        '<p><strong>واتساب:</strong> <a class="text-violet-700 font-bold" href="tel:' +
        vpEscNotif(s.phone) +
        '">' +
        vpEscNotif(s.phone) +
        "</a></p>" +
        "<p><strong>المحافظة:</strong> " +
        vpEscNotif(s.governorate) +
        "</p>" +
        "<p><strong>المنطقة:</strong> " +
        vpEscNotif(s.region) +
        "</p>" +
        "<p><strong>العنوان:</strong> " +
        vpEscNotif(s.address) +
        "</p></div>";
    } else if (f.shipping_address) {
      shipBlock =
        '<div class="rounded-xl border border-gray-200 p-3 bg-gray-50/80"><p class="font-black text-gray-900 mb-1 text-xs">العنوان</p><pre class="whitespace-pre-wrap text-xs">' +
        vpEscNotif(f.shipping_address) +
        "</pre></div>";
    }
    const custBlock =
      '<div class="rounded-xl border border-violet-200 p-3 bg-violet-50/40 space-y-1 text-xs">' +
      '<p class="font-black text-violet-950 mb-2">بيانات الزبون</p>' +
      "<p><strong>الاسم:</strong> " +
      vpEscNotif(cust.name) +
      "</p>" +
      "<p><strong>الهاتف:</strong> " +
      (cust.phone
        ? '<a class="text-violet-700 font-bold" href="tel:' +
          vpEscNotif(cust.phone) +
          '">' +
          vpEscNotif(cust.phone) +
          "</a>"
        : "—") +
      "</p>" +
      "<p><strong>البريد:</strong> " +
      (cust.email
        ? '<a class="text-violet-700 break-all" href="mailto:' +
          vpEscNotif(cust.email) +
          '">' +
          vpEscNotif(cust.email) +
          "</a>"
        : "—") +
      "</p></div>";
    let itemsHtml = (data.items || [])
      .map((it) => {
        const img = it.image_url ? vpAbsMediaUrl(it.image_url) : "";
        const imgCell = img
          ? '<a href="' +
            vpEscNotif(img) +
            '" target="_blank" rel="noopener noreferrer" class="inline-block mt-1"><img src="' +
            vpEscNotif(img) +
            '" alt="" class="h-16 w-16 object-cover rounded-lg border border-gray-200 hover:opacity-90" /></a><div class="mt-1"><a href="' +
            vpEscNotif(img) +
            '" target="_blank" rel="noopener" class="text-[10px] font-bold text-violet-700">فتح الصورة</a></div>'
          : "";
        const meta = [it.variant_label, it.color, it.size, it.brand].filter(Boolean).join(" · ");
        return (
          '<div class="rounded-xl border border-gray-100 p-3 flex gap-3">' +
          '<div class="flex-1 min-w-0">' +
          '<p class="font-bold text-gray-900">' +
          vpEscNotif(it.product_name) +
          "</p>" +
          '<p class="text-[11px] text-gray-600 mt-1">الكمية: ' +
          vpEscNotif(String(it.qty)) +
          " × السعر: " +
          vpEscNotif(String(it.price)) +
          "</p>" +
          (meta ? '<p class="text-[11px] text-gray-500 mt-1">' + vpEscNotif(meta) + "</p>" : "") +
          "</div>" +
          '<div class="shrink-0 text-center">' +
          imgCell +
          "</div></div>"
        );
      })
      .join("");
    if (!itemsHtml) itemsHtml = '<p class="text-gray-400">لا بنود.</p>';
    const portalLab = data.portal_status_labels_ar || {};
    const slabAr = data.status_labels_ar || {};
    const hist = (data.history || [])
      .map((h) => {
        const slab = portalLab[h.status] || slabAr[h.status] || h.status;
        const nt = h.customer_note
          ? '<div class="text-[10px] text-gray-600 mt-1">ملاحظة: ' + vpEscNotif(h.customer_note) + "</div>"
          : "";
        return (
          '<div class="border-b border-gray-100 py-2 text-xs"><span class="font-bold">' +
          vpEscNotif(slab) +
          '</span><span class="text-gray-400 mr-2">' +
          vpEscNotif(h.created_at || "") +
          "</span>" +
          nt +
          "</div>"
        );
      })
      .join("");
    scroll.innerHTML =
      '<div class="flex flex-wrap gap-2 text-xs">' +
      '<span class="px-2 py-1 rounded-lg bg-gray-100 font-mono">تنفيذ #' +
      f.id +
      '</span><span class="px-2 py-1 rounded-lg bg-indigo-100 font-bold">الطلب: ' +
      vpEscNotif(f.order_no || "") +
      '</span><span class="px-2 py-1 rounded-lg bg-emerald-50">مجموع الشركة: ' +
      vpEscNotif(String(f.subtotal)) +
      '</span><span class="px-2 py-1 rounded-lg bg-amber-50">الدفع: ' +
      vpEscNotif(payLab) +
      "</span></div>" +
      custBlock +
      shipBlock +
      '<div><p class="font-black text-gray-900 mb-2">المنتجات</p>' +
      itemsHtml +
      '</div><div><p class="font-black text-gray-900 mb-2">سجل الحالات</p><div class="max-h-40 overflow-y-auto">' +
      (hist || '<p class="text-gray-400 text-xs">—</p>') +
      "</div></div>";
    const allowed = data.allowed_statuses || [];
    if (sel) {
      sel.innerHTML = allowed
        .map((st) => {
          const lab = portalLab[st] || slabAr[st] || st;
          const v = String(st).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          const selAttr = String(f.status) === String(st) ? " selected" : "";
          return '<option value="' + v + '"' + selAttr + ">" + vpEscNotif(lab) + "</option>";
        })
        .join("");
    }
  }

  async function refreshOrders() {
    const list = el("vp-orders");
    if (!list) return;
    list.innerHTML = "جاري التحميل…";
    try {
      const rows = await api("/api/vendor-portal/fulfillments");
      list.innerHTML = (Array.isArray(rows) ? rows : [])
        .map((r) => {
          const fid = Number(r.id);
          return (
            '<button type="button" class="vp-order-row w-full text-start flex justify-between items-center gap-2 py-3 px-2 rounded-xl border border-gray-100 hover:bg-violet-50/80 hover:border-violet-200 transition" data-vp-ff-id="' +
            fid +
            '">' +
            '<span class="font-mono text-xs font-extrabold text-violet-900">' +
            vpEscNotif(r.order_no || "") +
            '</span><span class="text-indigo-600 text-xs font-bold shrink-0">' +
            vpEscNotif(r.status_label_ar || r.status) +
            "</span></button>"
          );
        })
        .join("") || "<p class='text-gray-400'>لا طلبات.</p>";
    } catch (e) {
      list.innerHTML = "<p class='text-red-600'>" + (e.message || "").replace(/</g, "&lt;") + "</p>";
    }
  }

  function isVpEditingProduct() {
    return !!(el("vp-prod-edit-id")?.value && String(el("vp-prod-edit-id").value).trim());
  }

  function updateProductFormState(me) {
    const lim = me?.product_form_limits || { max_images: 3, max_image_bytes: 1024 * 1024 };
    const hint = el("vp-prod-limits-hint");
    if (hint) {
      hint.textContent =
        "يسمح بحد أقصى " +
        lim.max_images +
        " صور لكل منتج، وبحد أقصى " +
        Math.round(lim.max_image_bytes / 1024) +
        " كيلوبايت لكل صورة.";
    }
    const block = el("vp-prod-quota-block");
    const subs = document.querySelectorAll(".vp-prod-submit");
    const editing = isVpEditingProduct();
    if (me && me.can_add_product === false && !editing) {
      block?.classList.remove("hidden");
      if (block) {
        block.textContent =
          "وصلتَ للحد الأقصى من المنتجات النشطة (كل منتج = وحدة واحدة، بما فيه المنتج بمواصفات لون/قياس). يمكن للإدارة زيادة الحصة من لوحة التحكم (إضافة شركة — عدد المنتجات المسموح). لا يزال بإمكانك تعديل منتجاتك الحالية.";
      }
      subs.forEach((sub) => {
        sub.disabled = true;
        sub.textContent = "الحصة مكتملة — لا يمكن إضافة منتج";
        sub.setAttribute("title", "اطلب من الإدارة زيادة عدد المنتجات المسموح.");
      });
    } else {
      block?.classList.add("hidden");
      subs.forEach((sub) => {
        sub.disabled = false;
        sub.textContent = editing ? "حفظ التعديلات" : "إضافة المنتج";
        sub.removeAttribute("title");
      });
    }
  }

  function vpFillVariantBuilderFieldsFromState() {
    const po = vpVariantState.product_options;
    if (!po || !po.length) return;
    const g1 = po[0];
    const g1ar = el("vp-var-g1-ar");
    const g1en = el("vp-var-g1-en");
    const g1vals = el("vp-var-g1-vals");
    if (g1ar) g1ar.value = g1.name_ar || "";
    if (g1en) g1en.value = g1.name_en || "";
    if (g1vals) g1vals.value = (g1.values || []).map((v) => v.label_ar || v.label_en || "").join("، ");
    const g2 = po[1];
    const g2ar = el("vp-var-g2-ar");
    const g2en = el("vp-var-g2-en");
    const g2vals = el("vp-var-g2-vals");
    if (g2) {
      if (g2ar) g2ar.value = g2.name_ar || "";
      if (g2en) g2en.value = g2.name_en || "";
      if (g2vals) g2vals.value = (g2.values || []).map((v) => v.label_ar || v.label_en || "").join("، ");
    } else {
      if (g2ar) g2ar.value = "المقاس";
      if (g2en) g2en.value = "Size";
      if (g2vals) g2vals.value = "";
    }
  }

  function vpClearProductEditUi() {
    const hid = el("vp-prod-edit-id");
    if (hid) hid.value = "";
    el("vp-prod-cancel-edit")?.classList.add("hidden");
    const title = el("vp-prod-form-title");
    if (title) title.textContent = "إضافة منتج جديد";
    const ic = el("vp-prod-form-icon");
    if (ic) {
      ic.className = "fas fa-plus-circle text-emerald-600";
    }
  }

  async function vpLoadProductForEdit(productId) {
    const id = Number(productId);
    if (!Number.isFinite(id)) return;
    await loadVendorDepartments();
    const p = await api("/api/vendor-portal/products/" + id);
    el("vp-prod-edit-id").value = String(p.id);
    el("vp-prod-cancel-edit")?.classList.remove("hidden");
    const title = el("vp-prod-form-title");
    if (title) title.textContent = "تعديل منتج — " + (p.public_product_code || "#" + p.id);
    const ic = el("vp-prod-form-icon");
    if (ic) ic.className = "fas fa-pen-to-square text-violet-600";
    el("vp-prod-name-ar").value = p.name_ar || "";
    el("vp-prod-name-en").value = p.name_en || "";
    el("vp-prod-desc-ar").value = p.description_ar || "";
    el("vp-prod-desc-en").value = p.description_en || "";
    el("vp-prod-discount").value = String(p.discount_percent ?? 0);
    const dept = el("vp-prod-dept");
    if (dept && p.department_id != null) dept.value = String(p.department_id);
    const act = el("vp-prod-active");
    if (act) act.checked = Number(p.is_active) !== 0;
    productImageUrls = Array.isArray(p.images) ? p.images.slice() : [];
    renderProductPreview();
    const po = Array.isArray(p.product_options) ? p.product_options : [];
    const inv = Array.isArray(p.inventory) ? p.inventory : [];
    if (po.length && inv.length) {
      el("vp-prod-use-variants").checked = true;
      el("vp-variants-panel")?.classList.remove("hidden");
      vpApplyPricingMode(true);
      vpVariantState = {
        product_options: JSON.parse(JSON.stringify(po)),
        inventory: JSON.parse(JSON.stringify(inv)),
      };
      vpFillVariantBuilderFieldsFromState();
      vpRenderVariantTable();
      const prices = inv.map((r) => Number(r.price)).filter((n) => Number.isFinite(n) && n >= 0);
      const base = prices.length ? Math.min(...prices) : Number(p.price);
      el("vp-prod-price").value = Number.isFinite(base) ? String(base) : "";
      el("vp-prod-stock").value = String(p.stock ?? 0);
    } else {
      el("vp-prod-use-variants").checked = false;
      el("vp-variants-panel")?.classList.add("hidden");
      vpVariantState = { product_options: [], inventory: [] };
      el("vp-var-table-wrap").innerHTML = "";
      vpApplyPricingMode(false);
      el("vp-prod-price").value = String(p.price ?? "");
      el("vp-prod-stock").value = String(p.stock ?? 0);
    }
    updateProductFormState(lastVendorMe);
    vpNavigate("add-product");
    requestAnimationFrame(() => {
      el("vp-prod-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function refreshVpFileChosenHint() {
    const p = el("vp-file-chosen");
    if (!p) return;
    const n = productImageUrls.length;
    p.textContent = n
      ? "مرفوع حالياً: " + n + " صورة — يمكنك إضافة المزيد حتى الحد الأقصى"
      : "لم يُرفع بعد — اضغط الزر البنفسجي أعلاه لاختيار الصور";
  }

  function renderProductPreview() {
    const box = el("vp-prod-preview");
    if (!box) return;
    box.innerHTML = "";
    box.className = "vp-preview-grid";
    productImageUrls.forEach((url, i) => {
      const wrap = document.createElement("div");
      wrap.className = "vp-preview-item";
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "vp-preview-rm";
      rm.setAttribute("aria-label", "إزالة الصورة");
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        productImageUrls.splice(i, 1);
        renderProductPreview();
      });
      wrap.appendChild(img);
      wrap.appendChild(rm);
      box.appendChild(wrap);
    });
    refreshVpFileChosenHint();
  }

  async function refreshProductsList() {
    const list = el("vp-products-list");
    if (!list) return;
    list.innerHTML = "<p class=\"text-gray-500 py-2\">جاري التحميل…</p>";
    try {
      const rows = await api("/api/vendor-portal/products");
      if (!Array.isArray(rows) || !rows.length) {
        list.innerHTML = "<p class='text-gray-400 py-4 text-center'>لا منتجات بعد.</p>";
        return;
      }
      list.innerHTML = rows
        .map((r) => {
          const code = String(r.public_product_code || "").replace(/</g, "&lt;");
          const name = String(r.name_ar || r.name_en || "—")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;");
          const act = Number(r.is_active) === 1 ? "" : " <span class='text-amber-800 font-semibold'>(موقوف)</span>";
          const pid = Number(r.id);
          const st = r.vendor_listing_status;
          const badge = vpListingStatusBadge(st);
          const pub = String(st || "").toLowerCase() === "published";
          const viewBtn = Number.isFinite(pid)
            ? "<a href=\"" +
              vpProductPublicUrl(pid).replace(/"/g, "&quot;") +
              "\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"vp-prod-action vp-prod-action-view\"><i class=\"fas fa-eye\"></i> عرض</a>"
            : "";
          const editBtn = Number.isFinite(pid)
            ? "<button type=\"button\" class=\"vp-prod-action vp-prod-action-edit vp-edit-product\" data-vp-product-id=\"" +
              pid +
              "\"><i class=\"fas fa-pen\"></i> تعديل</button>"
            : "";
          const delBtn = Number.isFinite(pid)
            ? "<button type=\"button\" class=\"vp-prod-action vp-prod-action-del vp-delete-product\" data-vp-product-id=\"" +
              pid +
              "\"><i class=\"fas fa-trash\"></i> حذف</button>"
            : "";
          return (
            "<article class=\"vp-product-card\">" +
            "<div class=\"vp-product-card-main\">" +
            "<div class=\"vp-product-card-titles\">" +
            "<span class=\"vp-product-code\">" +
            code +
            "</span>" +
            "<h3 class=\"vp-product-name\">" +
            name +
            act +
            "</h3>" +
            "<p class=\"vp-product-meta\"><span class=\"vp-product-price\">" +
            String(r.price ?? "") +
            "</span></p>" +
            "<div class=\"vp-product-badges\">" +
            badge +
            (!pub
              ? "<span class=\"vp-badge-hint\">يُعرض في التطبيق بعد اعتماد الإدارة (سعر فوق " +
                String(VP_LISTING_APPROVAL_PRICE_ABOVE).replace(/</g, "&lt;") +
                ")</span>"
              : "") +
            "</div></div>" +
            "<div class=\"vp-product-actions\">" +
            viewBtn +
            editBtn +
            delBtn +
            "</div></div></article>"
          );
        })
        .join("");
    } catch (e) {
      list.innerHTML = "<p class='text-red-600'>" + (e.message || "").replace(/</g, "&lt;") + "</p>";
    }
  }

  async function loadVendorDepartments() {
    const sel = el("vp-prod-dept");
    if (!sel) return;
    try {
      const rows = await api("/api/vendor-portal/departments");
      sel.innerHTML = (Array.isArray(rows) ? rows : [])
        .map((d) => {
          const id = Number(d.id);
          const label = String(d.name_ar || d.name_en || "قسم")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;");
          return "<option value=\"" + id + "\">" + label + "</option>";
        })
        .join("");
    } catch (_e) {
      sel.innerHTML = "";
    }
  }

  async function refreshAdList() {
    const list = el("vp-ad-list");
    if (!list) return;
    try {
      const rows = await api("/api/vendor-portal/ad-requests");
      list.innerHTML = (Array.isArray(rows) ? rows : [])
        .map(
          (r) =>
            `<div>${r.request_type} — ${r.payment_status} / ${r.lifecycle_status} — ${r.created_at || ""}</div>`
        )
        .join("") || "";
    } catch (_e) {
      list.innerHTML = "";
    }
  }

  function vpEscNotif(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function vpRenderNotificationArticleHtml(n) {
    const isUnread = Number(n.is_read) === 0;
    const cls = isUnread ? "vp-portal-notif vp-portal-notif--unread" : "vp-portal-notif";
    const nid = Number(n.id);
    const btn = isUnread
      ? "<button type=\"button\" class=\"vp-notif-read-btn text-xs font-extrabold text-amber-900 border border-amber-300 rounded-lg px-2 py-1 bg-white hover:bg-amber-50\">تم الاطلاع</button>"
      : "";
    const tid = n.reply_thread_id != null ? Number(n.reply_thread_id) : NaN;
    const hasT = Number.isFinite(tid) && tid > 0;
    const replyBlock =
      "<div class=\"mt-2 pt-2 border-t border-dashed border-amber-200 space-y-1.5\">" +
      (hasT
        ? `<button type="button" class="vp-thread-open w-full text-start text-[11px] font-extrabold text-violet-800 py-1.5 rounded-lg hover:bg-violet-50/80" data-vp-thread-id="${tid}">▸ متابعة المحادثة مع الإدارة</button>`
        : "") +
      "<button type=\"button\" class=\"vp-notif-toggle-reply text-[11px] font-bold text-gray-700\">✎ رد على الإشعار</button>" +
      "<div class=\"vp-notif-reply-box hidden space-y-1\">" +
      "<textarea class=\"vp-notif-reply-ta w-full text-xs border border-gray-200 rounded-lg p-2\" rows=\"2\" placeholder=\"اكتب ردك… يصل إلى لوحة تحكم الإدارة.\"></textarea>" +
      "<button type=\"button\" class=\"vp-notif-send-reply text-xs font-extrabold px-3 py-1.5 rounded-lg bg-violet-600 text-white\" data-vp-notif-id=\"" +
      nid +
      "\" data-vp-thread-id=\"" +
      (hasT ? String(tid) : "") +
      "\">إرسال الرد</button>" +
      "</div></div>";
    return (
      "<article class=\"" +
      cls +
      "\" data-vp-notif-id=\"" +
      nid +
      "\">" +
      "<div class=\"font-extrabold text-amber-950 text-xs sm:text-sm\">" +
      vpEscNotif(n.title) +
      "</div>" +
      "<div class=\"text-gray-800 whitespace-pre-wrap text-xs mt-1 leading-relaxed\">" +
      vpEscNotif(n.message) +
      "</div>" +
      "<div class=\"flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-amber-100\">" +
      "<span class=\"text-[10px] text-gray-500 font-mono\">" +
      vpEscNotif(n.created_at || "") +
      "</span>" +
      btn +
      "</div>" +
      replyBlock +
      "</article>"
    );
  }

  function closeVpContactModal() {
    vpContactOpenThreadId = null;
    el("vp-contact-overlay")?.classList.add("hidden");
    const r = el("vp-contact-modal-reply");
    if (r) r.value = "";
  }

  async function openVpContactThreadModal(threadId) {
    const id = Number(threadId);
    if (!Number.isFinite(id)) return;
    vpContactOpenThreadId = id;
    const ov = el("vp-contact-overlay");
    const box = el("vp-contact-modal-msgs");
    const rep = el("vp-contact-modal-reply");
    if (rep) rep.value = "";
    if (ov) ov.classList.remove("hidden");
    if (box) box.innerHTML = "<p class=\"text-xs text-gray-500\">جاري التحميل…</p>";
    try {
      const data = await api("/api/vendor-portal/contact/threads/" + encodeURIComponent(id) + "/messages");
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      if (box) {
        box.innerHTML = msgs
          .map((m) => {
            const who =
              m.author === "admin" ? "الإدارة" : m.author === "vendor" ? "أنت" : "النظام";
            const bubble =
              m.author === "admin"
                ? "bg-violet-100 border-violet-200 text-violet-950 ms-auto"
                : m.author === "vendor"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-950 me-auto"
                  : "bg-gray-100 border-gray-200 text-gray-800";
            return (
              "<div class=\"rounded-xl border p-2 max-w-[95%] " +
              bubble +
              "\">" +
              "<div class=\"font-extrabold text-[10px] opacity-80 mb-1\">" +
              vpEscNotif(who) +
              " · " +
              vpEscNotif(m.created_at || "") +
              "</div>" +
              "<div class=\"whitespace-pre-wrap leading-relaxed\">" +
              vpEscNotif(m.body || "") +
              "</div></div>"
            );
          })
          .join("");
        box.scrollTop = box.scrollHeight;
      }
    } catch (e) {
      if (box) box.innerHTML = "<p class=\"text-red-600 text-xs\">" + vpEscNotif(e.message || String(e)) + "</p>";
    }
  }

  async function refreshVendorNotifications() {
    const list = el("vp-notifications-list");
    const empty = el("vp-notifications-empty");
    const prompt = el("vp-dashboard-notif-prompt");
    const promptLine = el("vp-notif-prompt-line");
    const navBadge = el("vp-nav-notif-badge");
    const sectionBadge = el("vp-section-notif-badge");
    if (!list) return;
    try {
      const [data, thData] = await Promise.all([
        api("/api/vendor-portal/notifications"),
        api("/api/vendor-portal/contact/threads").catch(() => ({ threads: [] })),
      ]);
      const items = Array.isArray(data.items) ? data.items : [];
      const unread = Number(data.unread_count || 0);
      const threads = Array.isArray(thData.threads) ? thData.threads : [];
      const twrap = el("vp-contact-threads-wrap");
      const tlist = el("vp-contact-threads-list");
      if (twrap && tlist) {
        if (threads.length) {
          twrap.classList.remove("hidden");
          tlist.innerHTML = threads
            .map((t) => {
              const ur = Number(t.vendor_unread) > 0;
              const rowCls = ur
                ? "rounded-lg border-2 border-violet-300 bg-violet-50/60 p-2.5"
                : "rounded-lg border border-gray-200 bg-white p-2.5";
              const lb = String(t.last_body || "").slice(0, 140);
              return (
                "<div class=\"" +
                rowCls +
                " text-xs\">" +
                "<div class=\"flex justify-between gap-2 flex-wrap items-start\">" +
                "<div class=\"min-w-0\"><span class=\"font-extrabold text-gray-900\">" +
                vpEscNotif(t.subject || "محادثة") +
                "</span> <span class=\"text-[10px] font-mono text-gray-500\">#" +
                t.id +
                "</span>" +
                (ur ? " <span class=\"text-[10px] font-bold text-violet-700\">جديد</span>" : "") +
                "</div>" +
                "<button type=\"button\" class=\"vp-thread-open shrink-0 text-violet-700 font-extrabold text-[11px] underline\" data-vp-thread-id=\"" +
                t.id +
                "\">فتح</button></div>" +
                "<p class=\"text-[10px] text-gray-600 mt-1 line-clamp-2\">" +
                vpEscNotif(lb) +
                (String(t.last_body || "").length > 140 ? "…" : "") +
                "</p></div>"
              );
            })
            .join("");
        } else {
          twrap.classList.add("hidden");
          tlist.innerHTML = "";
        }
      }
      list.innerHTML = items.map((n) => vpRenderNotificationArticleHtml(n)).join("");
      list.classList.toggle("hidden", items.length === 0);
      if (empty) {
        empty.classList.toggle("hidden", items.length > 0);
        if (items.length === 0) {
          empty.textContent =
            "لا توجد إشعارات بعد. عند وصول طلب جديد أو إشعار من النظام سيظهر هنا.";
        }
      }
      if (prompt && promptLine) {
        if (items.length === 0) {
          prompt.classList.add("hidden");
        } else {
          prompt.classList.remove("hidden");
          promptLine.textContent =
            unread > 0
              ? `لديك ${unread} إشعار غير مقروء — اضغط «فتح الإشعارات» لعرض كل الرسائل (طلبات، تحديثات، تمييز منتجات 🔥، تمييز الشركة…).`
              : "سجل كامل للإشعارات: طلبات، تحديثات الإدارة، تمييز منتجاتكم أو شركتكم. افتح القسم لمراجعته.";
        }
      }
      const setBadge = (badgeEl) => {
        if (!badgeEl) return;
        if (unread > 0) {
          badgeEl.classList.remove("hidden");
          badgeEl.textContent = unread > 99 ? "99+" : String(unread);
        } else {
          badgeEl.classList.add("hidden");
        }
      };
      setBadge(navBadge);
      setBadge(sectionBadge);
    } catch (_e) {
      list.innerHTML = "";
      list.classList.add("hidden");
      if (empty) {
        empty.classList.remove("hidden");
        empty.textContent = "تعذر تحميل الإشعارات. جرّب «تحديث القائمة» لاحقاً.";
      }
      if (prompt) prompt.classList.add("hidden");
      el("vp-contact-threads-wrap")?.classList.add("hidden");
    }
  }

  async function bootApp() {
    el("vp-login-card")?.classList.add("hidden");
    el("vp-app")?.classList.remove("hidden");
    el("vp-marketing-head")?.classList.add("hidden");
    try {
      const me = await api("/api/vendor-portal/me");
      lastVendorMe = me;
      const co = el("vp-co-name");
      const vn = (me.vendor && (me.vendor.name_ar || me.vendor.name_en)) || "";
      if (co) {
        co.textContent = vn;
        co.setAttribute("title", vn);
      }
      el("vp-quota").textContent = "المنتجات النشطة: " + (me.product_quota_display || "—");
      refreshStatsFromMe(me);
      updateProductFormState(me);
      if (me.must_change_password) {
        el("vp-change-card")?.classList.remove("hidden");
        el("vp-app")?.classList.add("hidden");
        el("vp-marketing-head")?.classList.remove("hidden");
        return;
      }
      el("vp-change-card")?.classList.add("hidden");
      let initial = "dashboard";
      try {
        const h = (location.hash || "").replace(/^#/, "");
        if (VP_SECTION_IDS.includes(h)) initial = h;
      } catch (_e) {
        /* ignore */
      }
      vpNavigate(initial);
      await Promise.all([
        refreshOrders(),
        refreshAdList(),
        refreshProductsList(),
        loadVendorDepartments(),
        refreshVendorNotifications(),
      ]);
    } catch (e) {
      showErr(e.message || String(e));
      setToken(null);
      el("vp-login-card")?.classList.remove("hidden");
      el("vp-app")?.classList.add("hidden");
      el("vp-marketing-head")?.classList.remove("hidden");
    }
  }

  function postJsonNoAuth(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    });
  }

  el("vp-btn-login")?.addEventListener("click", async () => {
    showErr("");
    try {
      const username = el("vp-user").value.trim().toLowerCase();
      const password = el("vp-pass").value;
      const data = await postJsonNoAuth("/api/vendor-portal/login", { username, password });
      setToken(data.token);
      if (data.must_change_password) {
        el("vp-change-card")?.classList.remove("hidden");
        el("vp-login-card")?.classList.add("hidden");
        return;
      }
      await bootApp();
    } catch (e) {
      showErr(e.message || "فشل الدخول");
    }
  });

  el("vp-btn-chpass")?.addEventListener("click", async () => {
    const a = el("vp-new1").value;
    const b = el("vp-new2").value;
    if (a !== b || a.length < 6) {
      showErr("كلمتا المرور غير متطابقتين أو أقل من 6 أحرف");
      return;
    }
    showErr("");
    try {
      const cur = el("vp-pass").value;
      const data = await api("/api/vendor-portal/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: cur, new_password: a }),
      });
      if (data.token) setToken(data.token);
      el("vp-change-card")?.classList.add("hidden");
      await bootApp();
    } catch (e) {
      showErr(e.message || "فشل التغيير");
    }
  });

  function vpDoLogout() {
    setToken(null);
    location.reload();
  }

  el("vp-btn-out-sidebar")?.addEventListener("click", vpDoLogout);

  el("vp-order-overlay")?.addEventListener("click", (ev) => {
    if (ev.target === ev.currentTarget) closeVpOrderOverlay();
  });
  el("vp-order-detail-close")?.addEventListener("click", () => closeVpOrderOverlay());
  el("vp-order-close-footer")?.addEventListener("click", () => closeVpOrderOverlay());
  el("vp-order-save-status")?.addEventListener("click", async () => {
    const fid = vpOrderDetailFulfillmentId;
    const sel = el("vp-order-status-select");
    const note = el("vp-order-status-note");
    const notifyCb = el("vp-order-notify-user");
    const msg = el("vp-order-status-msg");
    if (!fid || !sel) return;
    const st = sel.value;
    if (!st) return;
    if (msg) msg.textContent = "جاري الحفظ…";
    try {
      await api("/api/vendor-portal/fulfillments/" + encodeURIComponent(fid) + "/status", {
        method: "PUT",
        body: JSON.stringify({
          status: st,
          customer_note: note && note.value ? note.value.trim() : "",
          notify_user: notifyCb ? notifyCb.checked : true,
        }),
      });
      if (msg) msg.textContent = "تم الحفظ.";
      await openVpOrderDetail(fid);
      await refreshOrders();
    } catch (e) {
      if (msg) msg.textContent = e.message || String(e);
    }
  });
  el("vp-orders")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest && ev.target.closest("[data-vp-ff-id]");
    if (!btn) return;
    const id = Number(btn.getAttribute("data-vp-ff-id"));
    if (!Number.isFinite(id)) return;
    openVpOrderDetail(id).catch((e) => alert(e.message || String(e)));
  });

  document.querySelectorAll(".vp-nav-item[data-vp-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = btn.getAttribute("data-vp-nav");
      if (s) vpNavigate(s);
    });
  });

  document.querySelectorAll("[data-vp-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = btn.getAttribute("data-vp-go");
      if (s) vpNavigate(s);
    });
  });

  el("vp-app")?.addEventListener("click", (ev) => {
    const tg = ev.target.closest && ev.target.closest(".vp-notif-toggle-reply");
    if (tg) {
      const box = tg.closest("article")?.querySelector(".vp-notif-reply-box");
      if (box) box.classList.toggle("hidden");
      return;
    }
    const send = ev.target.closest && ev.target.closest(".vp-notif-send-reply");
    if (send) {
      const art = send.closest("[data-vp-notif-id]");
      const nid = Number(art && art.getAttribute("data-vp-notif-id"));
      const tidRaw = send.getAttribute("data-vp-thread-id");
      const tid = tidRaw != null && String(tidRaw).trim() !== "" ? Number(tidRaw) : NaN;
      const ta = art && art.querySelector(".vp-notif-reply-ta");
      const msg = ta && ta.value ? String(ta.value).trim() : "";
      if (!Number.isFinite(nid) || !msg) {
        alert("اكتب نص الرد.");
        return;
      }
      const url =
        Number.isFinite(tid) && tid > 0
          ? "/api/vendor-portal/contact/threads/" + encodeURIComponent(tid) + "/messages"
          : "/api/vendor-portal/notifications/" + encodeURIComponent(nid) + "/reply";
      api(url, { method: "POST", body: JSON.stringify({ message: msg }) })
        .then(() => {
          if (ta) ta.value = "";
          return refreshVendorNotifications();
        })
        .catch((err) => alert(err.message || String(err)));
      return;
    }
    const thOpen = ev.target.closest && ev.target.closest(".vp-thread-open");
    if (thOpen) {
      const tid = Number(thOpen.getAttribute("data-vp-thread-id"));
      if (Number.isFinite(tid)) openVpContactThreadModal(tid).catch((e) => alert(e.message || String(e)));
      return;
    }
    const btn = ev.target.closest && ev.target.closest(".vp-notif-read-btn");
    if (!btn) return;
    const art = btn.closest("[data-vp-notif-id]");
    const raw = art && art.getAttribute("data-vp-notif-id");
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    api("/api/vendor-portal/notifications/" + encodeURIComponent(id) + "/read", { method: "PUT" })
      .then(() => refreshVendorNotifications())
      .catch((err) => alert(err.message || String(err)));
  });

  el("vp-contact-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeVpContactModal();
  });
  el("vp-contact-modal-close")?.addEventListener("click", closeVpContactModal);
  el("vp-contact-modal-send")?.addEventListener("click", () => {
    const id = vpContactOpenThreadId;
    const msg = el("vp-contact-modal-reply")?.value?.trim() || "";
    if (id == null || !Number.isFinite(Number(id))) return;
    if (!msg) {
      alert("اكتب نص الرسالة.");
      return;
    }
    api("/api/vendor-portal/contact/threads/" + encodeURIComponent(id) + "/messages", {
      method: "POST",
      body: JSON.stringify({ message: msg }),
    })
      .then(() => {
        const r = el("vp-contact-modal-reply");
        if (r) r.value = "";
        return openVpContactThreadModal(id);
      })
      .then(() => refreshVendorNotifications())
      .catch((err) => alert(err.message || String(err)));
  });

  el("vp-notifications-refresh")?.addEventListener("click", () => {
    refreshVendorNotifications().catch((err) => alert(err.message || String(err)));
  });

  el("vp-prod-files")?.addEventListener("change", async () => {
    const input = el("vp-prod-files");
    const errEl = el("vp-prod-upload-err");
    if (errEl) {
      errEl.classList.add("hidden");
      errEl.textContent = "";
    }
    const lim = lastVendorMe?.product_form_limits || { max_images: 3, max_image_bytes: 1024 * 1024 };
    const files = Array.from(input?.files || []);
    if (input) input.value = "";
    if (!files.length) return;
    const room = lim.max_images - productImageUrls.length;
    if (room <= 0) {
      alert("يمكن إضافة " + lim.max_images + " صور فقط لكل منتج.");
      return;
    }
    if (files.length > room) {
      alert(
        "يمكن إضافة " +
          lim.max_images +
          " صور فقط لكل منتج. تم اختيار عدد أكبر؛ سيتم رفع أول " +
          room +
          " صور فقط من الاختيار."
      );
    }
    const toAdd = files.slice(0, room);
    for (const f of toAdd) {
      if (f.size > lim.max_image_bytes) {
        alert(
          "الصورة «" +
            f.name +
            "» تتجاوز الحد المسموح (" +
            Math.round(lim.max_image_bytes / 1024) +
            " كيلوبايت لكل صورة)."
        );
        continue;
      }
      try {
        const url = await uploadVendorImageFile(f);
        productImageUrls.push(url);
      } catch (e) {
        if (errEl) {
          errEl.textContent = e.message || "فشل رفع صورة";
          errEl.classList.remove("hidden");
        }
      }
    }
    renderProductPreview();
  });

  el("vp-prod-use-variants")?.addEventListener("change", () => {
    const on = !!el("vp-prod-use-variants")?.checked;
    el("vp-variants-panel")?.classList.toggle("hidden", !on);
    vpApplyPricingMode(on);
    if (!on) {
      vpVariantState = { product_options: [], inventory: [] };
      const w = el("vp-var-table-wrap");
      if (w) w.innerHTML = "";
    }
  });

  el("vp-var-build")?.addEventListener("click", () => vpBuildVariantMatrix());

  el("vp-products-list")?.addEventListener("click", (ev) => {
    const del = ev.target && ev.target.closest && ev.target.closest(".vp-delete-product");
    if (del) {
      const raw = del.getAttribute("data-vp-product-id");
      const id = Number(raw);
      if (!Number.isFinite(id)) return;
      if (!confirm("حذف هذا المنتج نهائياً؟ لا يمكن التراجع.")) return;
      api("/api/vendor-portal/products/" + encodeURIComponent(id), { method: "DELETE" })
        .then(async () => {
          const me = await api("/api/vendor-portal/me");
          lastVendorMe = me;
          el("vp-quota").textContent = "المنتجات النشطة: " + (me.product_quota_display || "—");
          refreshStatsFromMe(me);
          updateProductFormState(me);
          await refreshProductsList();
        })
        .catch((err) => alert(err.message || String(err)));
      return;
    }
    const btn = ev.target && ev.target.closest && ev.target.closest(".vp-edit-product");
    if (!btn) return;
    const raw = btn.getAttribute("data-vp-product-id");
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    vpLoadProductForEdit(id).catch((err) => alert(err.message || String(err)));
  });

  el("vp-prod-cancel-edit")?.addEventListener("click", () => {
    el("vp-prod-form")?.reset();
    productImageUrls = [];
    vpResetVariantUi();
    vpClearProductEditUi();
    renderProductPreview();
    const act = el("vp-prod-active");
    if (act) act.checked = true;
    updateProductFormState(lastVendorMe);
  });

  el("vp-prod-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const editRaw = el("vp-prod-edit-id")?.value?.trim();
    const editing = !!editRaw;
    if (!editing && (!lastVendorMe || lastVendorMe.can_add_product === false)) {
      alert("لا يمكن إضافة منتج نشط جديد؛ بلغت الحد الأقصى للحصة. راجع الإدارة لزيادة العدد المسموح.");
      return;
    }
    try {
      const deptVal = el("vp-prod-dept")?.value;
      const useVar = !!el("vp-prod-use-variants")?.checked;
      let body;

      if (useVar) {
        vpReadVariantInputsIntoState();
        if (!vpVariantState.product_options.length || !vpVariantState.inventory.length) {
          alert("فعّل «مواصفات ديناميكية» ثم اضغط «إنشاء / تحديث جدول التركيبات» قبل الحفظ.");
          return;
        }
        const invOut = vpVariantState.inventory.map((row) => {
          const p = Number(row.price);
          const st = Math.max(0, Math.floor(Number(row.stock) || 0));
          const out = { options: { ...row.options }, stock: st };
          if (Number.isFinite(p) && p >= 0) out.price = p;
          return out;
        });
        for (const row of invOut) {
          const p = Number(row.price);
          if (!Number.isFinite(p) || p < 0) {
            alert("كل تركيبة تحتاج سعراً صالحاً (رقماً ≥ 0).");
            return;
          }
        }
        const prices = invOut.map((r) => Number(r.price));
        const basePrice = Math.min(...prices);
        const stockSum = invOut.reduce((a, r) => a + r.stock, 0);
        body = {
          name_ar: el("vp-prod-name-ar")?.value?.trim(),
          name_en: el("vp-prod-name-en")?.value?.trim(),
          description_ar: el("vp-prod-desc-ar")?.value?.trim() || "",
          description_en: el("vp-prod-desc-en")?.value?.trim() || "",
          price: basePrice,
          stock: stockSum,
          discount_percent: Number(el("vp-prod-discount")?.value) || 0,
          department_id: deptVal ? Number(deptVal) : undefined,
          images: productImageUrls.slice(),
          is_active: el("vp-prod-active")?.checked ? 1 : 0,
          product_options: vpVariantState.product_options,
          inventory: invOut,
        };
      } else {
        body = {
          name_ar: el("vp-prod-name-ar")?.value?.trim(),
          name_en: el("vp-prod-name-en")?.value?.trim(),
          description_ar: el("vp-prod-desc-ar")?.value?.trim() || "",
          description_en: el("vp-prod-desc-en")?.value?.trim() || "",
          price: Number(el("vp-prod-price")?.value),
          stock: Number(el("vp-prod-stock")?.value),
          discount_percent: Number(el("vp-prod-discount")?.value) || 0,
          department_id: deptVal ? Number(deptVal) : undefined,
          images: productImageUrls.slice(),
          is_active: el("vp-prod-active")?.checked ? 1 : 0,
        };
      }

      if (editing) {
        const saved = await api("/api/vendor-portal/products/" + encodeURIComponent(editRaw), {
          method: "PUT",
          body: JSON.stringify(body),
        });
        const st = String(saved.vendor_listing_status || "published").toLowerCase();
        if (st === "pending") {
          alert(
            "تم حفظ التعديلات. حالة النشر: قيد المراجعة — السعر فوق " +
              VP_LISTING_APPROVAL_PRICE_ABOVE +
              " يتطلب اعتماد الإدارة قبل الظهور للزبائن."
          );
        } else {
          alert("تم حفظ التعديلات.");
        }
      } else {
        const saved = await api("/api/vendor-portal/products", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const st = String(saved.vendor_listing_status || "published").toLowerCase();
        if (st === "pending") {
          alert(
            "تم إضافة المنتج. السعر فوق " +
              VP_LISTING_APPROVAL_PRICE_ABOVE +
              " — سيظهر للزبائن بعد اعتماد الإدارة." +
              VP_MSG_AFTER_ADD_CHECK_APP
          );
        } else {
          alert(
            "تم إضافة المنتج. يظهر للزبائن عند تفعيله (لا يتطلب اعتماد إداري لهذا السعر)." +
              VP_MSG_AFTER_ADD_CHECK_APP
          );
        }
      }
      e.target.reset();
      productImageUrls = [];
      renderProductPreview();
      vpResetVariantUi();
      vpClearProductEditUi();
      const act = el("vp-prod-active");
      if (act) act.checked = true;
      const me = await api("/api/vendor-portal/me");
      lastVendorMe = me;
      el("vp-quota").textContent = "المنتجات النشطة: " + (me.product_quota_display || "—");
      refreshStatsFromMe(me);
      updateProductFormState(me);
      await refreshProductsList();
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  el("vp-btn-ad")?.addEventListener("click", async () => {
    try {
      await api("/api/vendor-portal/ad-requests", {
        method: "POST",
        body: JSON.stringify({
          request_type: el("vp-ad-type").value,
          notes: el("vp-ad-notes").value.trim(),
        }),
      });
      el("vp-ad-notes").value = "";
      await refreshAdList();
      alert("تم إرسال الطلب.");
    } catch (e) {
      alert(e.message || String(e));
    }
  });

  const qp = new URLSearchParams(location.search);
  const preUser = qp.get("user");
  if (preUser && el("vp-user")) {
    el("vp-user").value = preUser.trim().toLowerCase();
  }

  if (localStorage.getItem(TOKEN_KEY)) {
    bootApp().catch(() => {
      el("vp-login-card")?.classList.remove("hidden");
    });
  }
})();

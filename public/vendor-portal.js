(function () {
  const TOKEN_KEY = "adora_mp_vendor_token";
  let lastVendorMe = null;
  let productImageUrls = [];
  /** { product_options: group[], inventory: { options, stock, price }[] } — نفس بنية لوحة الإدارة */
  let vpVariantState = { product_options: [], inventory: [] };
  const VP_MAX_VARIANT_COMBOS = 120;

  const api = (path, opts = {}) => {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) headers.Authorization = "Bearer " + t;
    return fetch(path, { ...opts, headers }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
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
    if (!r.ok) throw new Error(j.error || r.statusText);
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

  async function refreshOrders() {
    const list = el("vp-orders");
    if (!list) return;
    list.innerHTML = "جاري التحميل…";
    try {
      const rows = await api("/api/vendor-portal/fulfillments");
      list.innerHTML = (Array.isArray(rows) ? rows : [])
        .map(
          (r) =>
            `<div class="flex justify-between gap-2 py-2 border-b border-gray-100">
            <span class="font-mono text-xs">${r.order_no || ""}</span>
            <span class="text-indigo-600">${r.status_label_ar || r.status}</span>
          </div>`
        )
        .join("") || "<p class='text-gray-400'>لا طلبات.</p>";
    } catch (e) {
      list.innerHTML = "<p class='text-red-600'>" + (e.message || "") + "</p>";
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
    el("vp-prod-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    list.textContent = "جاري التحميل…";
    try {
      const rows = await api("/api/vendor-portal/products");
      if (!Array.isArray(rows) || !rows.length) {
        list.innerHTML = "<p class='text-gray-400'>لا منتجات بعد.</p>";
        return;
      }
      list.innerHTML = rows
        .map((r) => {
          const code = String(r.public_product_code || "").replace(/</g, "&lt;");
          const name = String(r.name_ar || r.name_en || "—")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;");
          const act = Number(r.is_active) === 1 ? "" : " <span class='text-amber-700'>(موقوف)</span>";
          const pid = Number(r.id);
          const editBtn = Number.isFinite(pid)
            ? "<button type='button' class='vp-edit-product shrink-0 text-violet-700 font-bold text-xs border border-violet-200 rounded-lg px-2 py-0.5' data-vp-product-id='" +
              pid +
              "'>تعديل</button>"
            : "";
          return (
            "<div class='flex flex-wrap items-start justify-between gap-2 py-2 border-b border-gray-100'>" +
            "<div class='flex flex-col gap-0.5 min-w-0'>" +
            "<span class='font-mono text-xs text-gray-500'>" +
            code +
            "</span>" +
            "<span>" +
            name +
            " — " +
            String(r.price ?? "") +
            act +
            "</span></div>" +
            editBtn +
            "</div>"
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

  async function bootApp() {
    el("vp-login-card")?.classList.add("hidden");
    el("vp-app")?.classList.remove("hidden");
    try {
      const me = await api("/api/vendor-portal/me");
      lastVendorMe = me;
      el("vp-co-name").textContent =
        (me.vendor && (me.vendor.name_ar || me.vendor.name_en)) || "";
      el("vp-quota").textContent = "المنتجات النشطة: " + (me.product_quota_display || "—");
      updateProductFormState(me);
      if (me.must_change_password) {
        el("vp-change-card")?.classList.remove("hidden");
        el("vp-app")?.classList.add("hidden");
        return;
      }
      el("vp-change-card")?.classList.add("hidden");
      await Promise.all([refreshOrders(), refreshAdList(), refreshProductsList(), loadVendorDepartments()]);
    } catch (e) {
      showErr(e.message || String(e));
      setToken(null);
      el("vp-login-card")?.classList.remove("hidden");
      el("vp-app")?.classList.add("hidden");
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

  el("vp-btn-out")?.addEventListener("click", () => {
    setToken(null);
    location.reload();
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
        await api("/api/vendor-portal/products/" + encodeURIComponent(editRaw), {
          method: "PUT",
          body: JSON.stringify(body),
        });
        alert("تم حفظ التعديلات.");
      } else {
        await api("/api/vendor-portal/products", {
          method: "POST",
          body: JSON.stringify(body),
        });
        alert("تم إضافة المنتج.");
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

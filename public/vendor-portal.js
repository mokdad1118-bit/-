(function () {
  const TOKEN_KEY = "adora_mp_vendor_token";
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

  const el = (id) => document.getElementById(id);

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
      el("vp-co-name").textContent =
        (me.vendor && (me.vendor.name_ar || me.vendor.name_en)) || "";
      el("vp-quota").textContent = "المنتجات النشطة: " + (me.product_quota_display || "—");
      if (me.must_change_password) {
        el("vp-change-card")?.classList.remove("hidden");
        el("vp-app")?.classList.add("hidden");
        return;
      }
      el("vp-change-card")?.classList.add("hidden");
      await refreshOrders();
      await refreshAdList();
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

  if (localStorage.getItem(TOKEN_KEY)) {
    bootApp().catch(() => {
      el("vp-login-card")?.classList.remove("hidden");
    });
  }
})();

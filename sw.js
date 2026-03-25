/* PWA + Web Push: تثبيت التطبيق وإشعارات النظام عند وصول Push من السيرفر */
self.addEventListener("install", (_e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "Adora", body: "", url: "/", icon: "/icons/adora-icon.svg" };
  try {
    const j = event.data && event.data.json();
    if (j && typeof j === "object") Object.assign(data, j);
  } catch (_e) {
    if (event.data) data.body = String(event.data.text());
  }
  const title = data.title || "Adora";
  const icon = data.icon || "/icons/adora-icon.svg";
  const options = {
    body: (data.body || "").slice(0, 500),
    icon,
    badge: data.badge || icon,
    data: { url: typeof data.url === "string" && data.url ? data.url : "/" },
    tag: data.tag || "adora",
    renotify: true,
    /* نغمة الإشعار: الافتراضية من النظام (لا نضع silent ولا رابط صوت مخصص) */
    silent: false,
    timestamp: Date.now(),
    vibrate: [180, 80, 120],
  };
  if (data.image) options.image = data.image;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const path = typeof raw === "string" && raw.length ? raw : "/";
  const abs =
    path.startsWith("http://") || path.startsWith("https://")
      ? path
      : self.location.origin + (path.startsWith("/") ? path : `/${path}`);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const c of clientList) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.focus();
          if ("navigate" in c && typeof c.navigate === "function") {
            return c.navigate(abs).catch(() => self.clients.openWindow(abs));
          }
          return self.clients.openWindow(abs);
        }
      }
      return self.clients.openWindow(abs);
    })
  );
});

/* اعتراض طلبات نفس أصل الموقع فقط — لا نمرّر طلبات الـ API (نطاق آخر) عبر الـ SW لتفادي أخطاء fetch */
self.addEventListener("fetch", (event) => {
  try {
    const url = new URL(event.request.url);
    if (url.origin === self.location.origin) {
      event.respondWith(fetch(event.request));
    }
  } catch (_e) {
    /* ignore */
  }
});

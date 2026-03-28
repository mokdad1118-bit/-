/* PWA + Web Push: تثبيت التطبيق وإشعارات النظام عند وصول Push من السيرفر */
const ADORA_IMAGE_CACHE = "adora-images-v2";

self.addEventListener("install", (_e) => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("adora-images-") && k !== ADORA_IMAGE_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

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

function adoraIsCacheableImageRequest(url, request) {
  if (request.method !== "GET") return false;
  const path = url.pathname.toLowerCase();
  const dest = request.destination;
  const looksLikeImage =
    dest === "image" ||
    path.startsWith("/uploads/") ||
    /\.(jpg|jpeg|png|webp|gif|svg|avif|ico)(\?|$)/.test(path);
  if (!looksLikeImage) return false;
  if (url.origin === self.location.origin) return true;
  if (/\.cloudinary\.com$/i.test(url.hostname)) return true;
  return false;
}

async function adoraCacheFirstImage(request) {
  const cache = await caches.open(ADORA_IMAGE_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      try {
        await cache.put(request, response.clone());
      } catch (_e) {
        /* تجاهل إن كان الحجم أو السياسة تمنع التخزين */
      }
    }
    return response;
  } catch (_e) {
    return hit || new Response("", { status: 504, statusText: "Offline" });
  }
}

/* اعتراض طلبات نفس أصل الموقع؛ تخزين مؤقت للصور (نفس الأصل + Cloudinary) لتقليل الإنترنت وتسريع إعادة العرض */
self.addEventListener("fetch", (event) => {
  try {
    const url = new URL(event.request.url);
    if (adoraIsCacheableImageRequest(url, event.request)) {
      event.respondWith(adoraCacheFirstImage(event.request));
      return;
    }
    if (url.origin === self.location.origin) {
      event.respondWith(fetch(event.request));
    }
  } catch (_e) {
    /* ignore */
  }
});

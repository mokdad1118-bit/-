/* PWA + Web Push: تثبيت التطبيق وإشعارات النظام عند وصول Push من السيرفر */
const ADORA_IMAGE_CACHE = "adora-images-v3";

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

const ADORA_PUSH_ICON = "/icons/adora-icon.png";
const ADORA_PUSH_BADGE = "/icons/adora-badge.png";
const ADORA_PUSH_IMAGE = "/icons/adora-image.png";

self.addEventListener("push", (event) => {
  let data = {
    title: "Adora",
    body: "",
    url: "/",
    icon: ADORA_PUSH_ICON,
    badge: ADORA_PUSH_BADGE,
    image: ADORA_PUSH_IMAGE,
  };
  try {
    const j = event.data && event.data.json();
    if (j && typeof j === "object") Object.assign(data, j);
  } catch (_e) {
    if (event.data) data.body = String(event.data.text());
  }
  const title = data.title || "Adora";
  const icon = data.icon || ADORA_PUSH_ICON;
  const richImage = data.image != null && String(data.image).trim() ? String(data.image).trim() : ADORA_PUSH_IMAGE;
  const options = {
    body: (data.body || "").slice(0, 500),
    icon,
    badge: data.badge || ADORA_PUSH_BADGE,
    image: richImage,
    data: { url: typeof data.url === "string" && data.url ? data.url : "/" },
    tag: data.tag || "adora",
    renotify: true,
    /* نغمة الإشعار: الافتراضية من النظام (لا نضع silent ولا رابط صوت مخصص) */
    silent: false,
    timestamp: Date.now(),
    vibrate: [180, 80, 120],
  };
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

/** صور نفس أصل التطبيق فقط — لا نمرّر Cloudinary عبر cache-first لأن ذلك سبب net::ERR_FAILED مع بعض المتصفحات/CORS */
function adoraIsSameOriginCacheableImageRequest(url, request) {
  if (url.origin !== self.location.origin) return false;
  if (request.method !== "GET") return false;
  const path = url.pathname.toLowerCase();
  const dest = request.destination;
  const looksLikeImage =
    dest === "image" ||
    path.startsWith("/uploads/") ||
    /\.(jpg|jpeg|png|webp|gif|svg|avif|ico)(\?|$)/.test(path);
  return looksLikeImage;
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

/* اعتراض طلبات نفس الأصل فقط؛ تخزين مؤقت لصور /uploads/ ونحوها. روابط Cloudinary تُحمّل مباشرة بدون SW. */
self.addEventListener("fetch", (event) => {
  try {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (adoraIsSameOriginCacheableImageRequest(url, event.request)) {
      event.respondWith(adoraCacheFirstImage(event.request));
      return;
    }
    event.respondWith(fetch(event.request));
  } catch (_e) {
    /* ignore */
  }
});

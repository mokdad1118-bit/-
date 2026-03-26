/**
 * Web Push (VAPID) — إشعارات نظام الجوال/المتصفح عند إغلاق التطبيق.
 * يتطلب VAPID_PUBLIC_KEY و VAPID_PRIVATE_KEY في البيئة (انظر .env.example).
 */
const webpush = require("web-push");
const { get, all, run } = require("./db");

let configured = false;

function ensureWebPushConfigured() {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_CONTACT_EMAIL || "mailto:support@adora.local", pub, priv);
  configured = true;
  return true;
}

function isWebPushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function sanitizeHttpsUrl(s, maxLen = 2048) {
  if (s == null || s === "") return null;
  const t = String(s).trim();
  if (!t || t.length > maxLen) return null;
  if (!/^https:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** مثل CORS: يقبل domain بدون https لـ PUBLIC_URL / أول CORS_ORIGIN */
function normalizeFrontendBase(raw) {
  if (raw == null || !String(raw).trim()) return "";
  let s = String(raw).split(",")[0].trim().replace(/\/+$/, "");
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s.replace(/^\/+/, "")}`;
  }
  return s.replace(/\/$/, "");
}

/** أصل الواجهة العامة (أيقونات الـ Push تحتاج روابط مطلقة غالباً) */
function getPublicAssetBase() {
  const raw = process.env.PUBLIC_URL || (process.env.CORS_ORIGIN && String(process.env.CORS_ORIGIN).split(",")[0].trim());
  return normalizeFrontendBase(raw);
}

/** عنوان فتح التطبيق عند الضغط: مسار / أو رابط https */
function resolvePushOpenUrl(linkUrl) {
  if (linkUrl == null || linkUrl === "") return "/";
  const s = String(linkUrl).trim();
  if (s.startsWith("/")) {
    if (s.includes("..")) return "/";
    return s.length > 2048 ? "/" : s;
  }
  const https = sanitizeHttpsUrl(s);
  return https || "/";
}

async function removeDeadSubscription(endpoint) {
  await run(`DELETE FROM push_subscriptions WHERE endpoint=?`, [endpoint]);
}

async function sendWebPushToSubscriptions(subscriptionRows, payload) {
  if (!ensureWebPushConfigured() || !subscriptionRows.length) return;
  const body = JSON.stringify(payload);
  await Promise.all(
    subscriptionRows.map(async (row) => {
      const sub = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        /* urgency: high — أقرب لسلوك رسائل فورية (واتساب) عند إغلاق التطبيق أو توفير الشبكة */
        await webpush.sendNotification(sub, body, { TTL: 86400, urgency: "high" });
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          await removeDeadSubscription(row.endpoint).catch(() => {});
        } else {
          const bodySnippet =
            err && err.body != null ? String(err.body).slice(0, 500) : err && err.message ? String(err.message) : String(err);
          // eslint-disable-next-line no-console
          console.error("[Adora] Web Push send failed", { code, endpoint: row.endpoint?.slice?.(0, 80), body: bodySnippet });
        }
      }
    })
  );
}

function userSnoozeActive(snoozedUntil) {
  if (snoozedUntil == null || String(snoozedUntil).trim() === "") return false;
  const t = new Date(snoozedUntil).getTime();
  return !Number.isNaN(t) && t > Date.now();
}

async function getEligibleSubscriptionRowsForUser(userId) {
  const u = await get(
    `SELECT id, notifications_enabled, notifications_snoozed_until FROM users WHERE id=?`,
    [userId]
  );
  if (!u || Number(u.notifications_enabled) !== 1) return [];
  if (userSnoozeActive(u.notifications_snoozed_until)) return [];
  return all(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?`, [userId]);
}

async function getEligibleSubscriptionRowsBroadcast() {
  const raw = await all(
    `SELECT ps.endpoint, ps.p256dh, ps.auth, u.notifications_snoozed_until
     FROM push_subscriptions ps
     INNER JOIN users u ON u.id = ps.user_id
     WHERE COALESCE(u.notifications_enabled, 0) = 1`
  );
  return raw
    .filter((r) => !userSnoozeActive(r.notifications_snoozed_until))
    .map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth }));
}

function buildPushPayloadFromRow(row) {
  const img = row.image_url ? sanitizeHttpsUrl(row.image_url) : null;
  const base = getPublicAssetBase();
  const iconPath = "/icons/adora-icon.svg";
  const icon = base ? `${base}${iconPath}` : iconPath;
  const badge = icon;
  const titleRaw = row.title != null && String(row.title).trim() ? String(row.title).trim() : "";
  const title = titleRaw.slice(0, 120) || "Adora";
  return {
    title,
    body: String(row.message || "").slice(0, 500),
    tag: `adora-inapp-${row.id}`,
    url: resolvePushOpenUrl(row.link_url),
    icon,
    badge,
    image: img || undefined,
  };
}

/**
 * إرسال Web Push بعد حفظ صف in_app_notifications.
 * @param {object} row — يحتوي id, message, image_url?, link_url?
 * @param {number|null} targetUserId — مستخدم محدد أو null لجميع المشتركين المؤهلين
 */
async function notifyInAppRow(row, targetUserId) {
  if (!row || !isWebPushConfigured()) return;
  const payload = buildPushPayloadFromRow(row);
  if (targetUserId != null && Number.isFinite(Number(targetUserId))) {
    const rows = await getEligibleSubscriptionRowsForUser(Number(targetUserId));
    await sendWebPushToSubscriptions(rows, payload);
  } else {
    const rows = await getEligibleSubscriptionRowsBroadcast();
    await sendWebPushToSubscriptions(rows, payload);
  }
}

module.exports = {
  isWebPushConfigured,
  ensureWebPushConfigured,
  sanitizeHttpsUrl,
  notifyInAppRow,
  removeDeadSubscription,
};

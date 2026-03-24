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
        await webpush.sendNotification(sub, body, { TTL: 3600 });
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          await removeDeadSubscription(row.endpoint).catch(() => {});
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
  const link = row.link_url ? sanitizeHttpsUrl(row.link_url) : null;
  return {
    title: "Adora",
    body: String(row.message || "").slice(0, 500),
    tag: `adora-inapp-${row.id}`,
    url: link || "/",
    icon: "/icons/adora-icon.svg",
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

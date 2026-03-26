/**
 * إرسال رمز التحقق عند التسجيل — Nodemailer + قالب HTML متوافق مع هوية Adora
 * المتغيرات: EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM (اختياري)
 */
const nodemailer = require("nodemailer");

const BRAND_NAME = "Adora Photo";

function isEmailTransportConfigured() {
  const host = String(process.env.EMAIL_HOST || "").trim();
  const user = String(process.env.EMAIL_USER || "").trim();
  const pass = String(process.env.EMAIL_PASS || "").trim();
  return !!(host && user && pass);
}

function createTransport() {
  const host = String(process.env.EMAIL_HOST || "").trim();
  const port = Number(process.env.EMAIL_PORT || 587) || 587;
  const user = String(process.env.EMAIL_USER || "").trim();
  const pass = String(process.env.EMAIL_PASS || "").trim();
  if (!host || !user || !pass) {
    throw new Error("Email SMTP is not configured (EMAIL_HOST, EMAIL_USER, EMAIL_PASS)");
  }
  const secure = String(process.env.EMAIL_SECURE || "").trim() === "true" || port === 465;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED !== "false" },
  });
}

function fromAddress() {
  const raw = String(process.env.EMAIL_FROM || process.env.EMAIL_USER || "").trim();
  if (!raw) return `"${BRAND_NAME}" <noreply@adora.local>`;
  if (/^[^\s<]+@[^\s<]+$/i.test(raw)) {
    return `"${BRAND_NAME}" <${raw}>`;
  }
  return raw;
}

function buildSignupOtpEmail({ to, code, name }) {
  const greeting = name ? `مرحباً ${escapeHtml(name)}،` : "مرحباً،";
  const text = [
    `${BRAND_NAME} — رمز التحقق`,
    "",
    greeting,
    "",
    `رمز التحقق الخاص بك: ${code}`,
    "",
    "الرمز صالح لمدة 5 دقائق. إذا لم تطلب إنشاء حساب، يمكنك تجاهل هذه الرسالة.",
    "",
    "— فريق Adora Photo",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(BRAND_NAME)} — رمز التحقق</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Segoe UI,Tahoma,Arial,'Noto Sans Arabic',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(124,58,237,0.12);border:1px solid #ede9fe;">
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 50%,#c026d3 100%);padding:28px 24px;text-align:center;">
              <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.06em;text-shadow:0 2px 12px rgba(0,0,0,0.15);">${escapeHtml(
                BRAND_NAME
              )}</div>
              <div style="margin-top:8px;font-size:12px;color:rgba(255,255,255,0.92);font-weight:600;">تسجيل حساب جديد</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;text-align:right;color:#18181b;font-size:15px;line-height:1.7;">
              ${greeting.replace(/\n/g, "<br>")}
              <p style="margin:16px 0 8px;color:#52525b;font-size:14px;">استخدم الرمز التالي لإتمام إنشاء حسابك:</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 24px 24px;">
              <div style="display:inline-block;padding:16px 36px;border-radius:16px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:2px dashed #a78bfa;font-size:28px;font-weight:800;letter-spacing:0.35em;color:#5b21b6;font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(
                code
              )}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;text-align:right;color:#71717a;font-size:12px;line-height:1.65;">
              صالح لمدة <strong style="color:#7c3aed;">5 دقائق</strong> فقط. لا تشارك هذا الرمز مع أحد.<br>
              إذا لم تطلب إنشاء حساب في Adora، يمكنك تجاهل هذه الرسالة بأمان.
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#faf5ff;border-top:1px solid #ede9fe;text-align:center;font-size:11px;color:#a1a1aa;">
              رسالة تلقائية — لا ترد على هذا البريد<br>
              <span style="color:#7c3aed;font-weight:600;">Adora Photo</span> · أزياء وتسوق
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { text, html };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ to: string, code: string, name?: string }} opts
 */
async function sendSignupOtpEmail(opts) {
  const to = String(opts.to || "").trim();
  const code = String(opts.code || "").trim();
  if (!to || !code) throw new Error("Missing email or code");

  const transporter = createTransport();
  const from = fromAddress();
  const { text, html } = buildSignupOtpEmail({ to, code, name: opts.name });

  await transporter.sendMail({
    from,
    to,
    subject: `${BRAND_NAME} — رمز التحقق لتسجيل الحساب`,
    text,
    html,
    headers: {
      "X-Entity-Ref-ID": `adora-signup-${Date.now()}`,
    },
  });
}

module.exports = {
  BRAND_NAME,
  isEmailTransportConfigured,
  sendSignupOtpEmail,
};

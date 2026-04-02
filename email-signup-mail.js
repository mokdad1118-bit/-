/**
 * إرسال رموز التحقق (OTP) عبر Resend API — التسجيل وإعادة تعيين كلمة المرور
 *
 * المتغيرات:
 *   RESEND_API_KEY  (مطلوب)
 *   RESEND_FROM أو EMAIL_FROM — في الإنتاج يجب أن يكون عنواناً من نطاق موثّق في Resend
 *   OTP_PEPPER / JWT_SECRET — على الخادم فقط (لتخزين الهاش)، لا يُستخدم هنا
 */
const { Resend } = require("resend");

const BRAND_NAME = "Adora";

function getResendApiKey() {
  return String(process.env.RESEND_API_KEY || "").trim();
}

function isEmailTransportConfigured() {
  const key = getResendApiKey();
  if (!key) return false;
  if (process.env.NODE_ENV === "production") {
    const from = String(process.env.RESEND_FROM || process.env.EMAIL_FROM || "").trim();
    if (!from) return false;
  }
  return true;
}

function fromAddress() {
  const raw = String(process.env.RESEND_FROM || process.env.EMAIL_FROM || "").trim();
  if (raw) {
    if (raw.includes("<") && raw.includes(">")) return raw;
    if (/^[^\s<]+@[^\s<]+$/i.test(raw)) return `${BRAND_NAME} <${raw}>`;
    return raw;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Set RESEND_FROM or EMAIL_FROM to a verified domain address (production).");
  }
  return `${BRAND_NAME} <onboarding@resend.dev>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{ code: string, name?: string, purpose: 'signup' | 'password_reset' }} p
 */
function buildOtpEmail(p) {
  const code = String(p.code || "").trim();
  const name = String(p.name || "").trim();
  const purpose = p.purpose === "password_reset" ? "password_reset" : "signup";

  const titleAr = purpose === "password_reset" ? "إعادة تعيين كلمة المرور" : "تسجيل حساب جديد";
  const titleEn = purpose === "password_reset" ? "Password reset" : "New account verification";
  const subject =
    purpose === "password_reset"
      ? `${BRAND_NAME} — رمز إعادة تعيين كلمة المرور`
      : `${BRAND_NAME} — رمز التحقق لتسجيل الحساب`;

  const greetingAr = name ? `مرحباً ${name}،` : "مرحباً،";
  const leadAr =
    purpose === "password_reset"
      ? "استخدم الرمز التالي لإعادة تعيين كلمة مرور حسابك في Adora:"
      : "استخدم الرمز التالي لإتمام إنشاء حسابك في Adora:";
  const leadEn =
    purpose === "password_reset"
      ? "Use this code to reset your Adora account password:"
      : "Use this code to finish creating your Adora account:";

  const footerAr =
    purpose === "password_reset"
      ? "إذا لم تطلب إعادة تعيين كلمة المرور، تجاهل هذه الرسالة."
      : "إذا لم تطلب إنشاء حساب، تجاهل هذه الرسالة بأمان.";

  const text = [
    `${BRAND_NAME} — ${titleEn}`,
    "",
    greetingAr,
    "",
    leadAr.replace(":", ""),
    code,
    "",
    "الرمز صالح لمدة 5 دقائق فقط. / This code expires in 5 minutes.",
    "لا تشارك الرمز مع أي شخص. / Do not share this code with anyone.",
    "",
    footerAr,
    "",
    `— ${BRAND_NAME}`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(BRAND_NAME)} — ${escapeHtml(titleAr)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Segoe UI,Tahoma,Arial,'Noto Sans Arabic',sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(124,58,237,0.12);border:1px solid #ede9fe;">
          <tr>
            <td style="background:linear-gradient(135deg,#7c3aed 0%,#a855f7 50%,#c026d3 100%);padding:28px 24px;text-align:center;">
              <div style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.04em;text-shadow:0 2px 12px rgba(0,0,0,0.15);">${escapeHtml(
                BRAND_NAME
              )}</div>
              <div style="margin-top:10px;font-size:13px;color:rgba(255,255,255,0.95);font-weight:600;">${escapeHtml(titleAr)}</div>
              <div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.85);font-weight:500;direction:ltr;text-align:center;">${escapeHtml(
                titleEn
              )}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;text-align:right;color:#18181b;font-size:15px;line-height:1.75;">
              ${escapeHtml(greetingAr)}
              <p style="margin:14px 0 6px;color:#3f3f46;font-size:14px;">${escapeHtml(leadAr)}</p>
              <p dir="ltr" style="margin:8px 0 0;text-align:left;color:#52525b;font-size:12px;line-height:1.5;">${escapeHtml(leadEn)}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 24px 20px;">
              <div style="display:inline-block;padding:18px 40px;border-radius:16px;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:2px solid #a78bfa;font-size:32px;font-weight:800;letter-spacing:0.42em;color:#5b21b6;font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(
                code
              )}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px;text-align:center;">
              <div style="display:inline-block;background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;padding:12px 16px;max-width:440px;">
                <p style="margin:0;font-size:13px;font-weight:700;color:#92400e;line-height:1.5;">تنبيه: ينتهي صلاحية هذا الرمز خلال <strong>5 دقائق</strong> فقط.</p>
                <p dir="ltr" style="margin:6px 0 0;font-size:12px;color:#b45309;line-height:1.45;">This verification code expires in <strong>5 minutes</strong>.</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;text-align:right;color:#71717a;font-size:12px;line-height:1.65;">
              لا تشارك الرمز مع أي شخص.<br>
              <span dir="ltr" style="display:inline-block;margin-top:4px;color:#a1a1aa;">Never share this code. ${escapeHtml(footerAr)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#faf5ff;border-top:1px solid #ede9fe;text-align:center;font-size:11px;color:#a1a1aa;">
              رسالة تلقائية — لا ترد على هذا البريد<br>
              <span style="color:#7c3aed;font-weight:600;">${escapeHtml(BRAND_NAME)}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

async function sendOtpViaResend({ to, subject, html, text, idempotencyKey }) {
  const key = getResendApiKey();
  if (!key) throw new Error("RESEND_API_KEY is not set");

  const resend = new Resend(key);
  const from = fromAddress();
  const payload = {
    from,
    to: [to],
    subject,
    html,
    text,
  };
  if (idempotencyKey) payload.idempotencyKey = idempotencyKey;

  const { error } = await resend.emails.send(payload);
  if (error) {
    const msg = error.message || error.name || "Resend send failed";
    throw new Error(msg);
  }
}

/**
 * @param {{ to: string, code: string, name?: string }} opts
 */
async function sendSignupOtpEmail(opts) {
  const to = String(opts.to || "").trim();
  const code = String(opts.code || "").trim();
  if (!to || !code) throw new Error("Missing email or code");
  const { subject, text, html } = buildOtpEmail({ code, name: opts.name, purpose: "signup" });
  await sendOtpViaResend({
    to,
    subject,
    html,
    text,
    idempotencyKey: `adora-signup-otp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
}

/**
 * @param {{ to: string, code: string, name?: string }} opts
 */
async function sendPasswordResetOtpEmail(opts) {
  const to = String(opts.to || "").trim();
  const code = String(opts.code || "").trim();
  if (!to || !code) throw new Error("Missing email or code");
  const { subject, text, html } = buildOtpEmail({ code, name: opts.name, purpose: "password_reset" });
  await sendOtpViaResend({
    to,
    subject,
    html,
    text,
    idempotencyKey: `adora-pwreset-otp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
}

module.exports = {
  BRAND_NAME,
  isEmailTransportConfigured,
  sendSignupOtpEmail,
  sendPasswordResetOtpEmail,
};

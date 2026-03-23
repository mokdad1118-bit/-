# Adora — متجر + API (Node.js / Express)

مشروع واحد يشغّل **واجهة ثابتة** و**REST API** و**Socket.io** من `server.js`، مع **SQLite** عبر `db.js` (إنشاء الجداول تلقائياً عند التشغيل).

## هيكل مهم للخلفية

| ملف / مجلد | الوظيفة |
|-------------|---------|
| `server.js` | تطبيق Express، مسارات `/api/*`، Socket.io |
| `auth.js` | JWT، حماية المسارات |
| `db.js` | SQLite، الاتصال والتهيئة |
| `package.json` | التبعيات و`npm start` |
| `render.yaml` | تعريف اختياري لنشر [Render Blueprint](https://render.com/docs/blueprint-spec) |
| `.env.example` | نموذج المتغيرات (انسخه إلى `.env` محلياً) |

> **ملاحظة:** المسارات مدمجة في `server.js` (لا يوجد مجلد `routes/` منفصل).

## التشغيل محلياً

```bash
npm install
copy .env.example .env
# عدّل .env (JWT_SECRET، إلخ)
npm start
```

التحقق: `GET http://localhost:3000/api/health`

## النشر على Render

دليل خطوة بخطوة (GitHub + Render + Netlify + تسجيل الدخول): **`RENDER_SETUP.md`**.

باختصار: **Build** `npm ci` — **Start** `node server.js` — متغيرات **`JWT_SECRET`** و **`CORS_ORIGIN`** (انظر `.env.example` و `render.yaml`).

راجع أيضاً **`NETLIFY.md`** لربط الواجهة الثابتة بعنوان الـ API (`ADORA_API_BASE`).

## الأمان

- **لا ترفع** ملف `.env` إلى Git (مُدرَج في `.gitignore`).
- استخدم **`.env.example`** كمرجع فقط.

## رفع الكود إلى GitHub

المستودع جاهز محلياً (مع استبعاد `.env`). لربطه بحسابك ودفع الفرع إلى GitHub، اتبع **`GITHUB_PUSH.md`**.

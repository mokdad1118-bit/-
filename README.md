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

1. اربط هذا المستودع بـ **New Web Service** على [Render](https://render.com).
2. **Build:** `npm install` — **Start:** `node server.js`
3. **Environment** (من `.env.example`):
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = سلسلة عشوائية طويلة (لا تستخدم القيمة الافتراضية)
   - `CORS_ORIGIN` = رابط الواجهة على Netlify (مثل `https://xxxx.netlify.app`) بدون `/` في النهاية
4. اختياري: `PORT` يضبطه Render تلقائياً.

راجع أيضاً **`NETLIFY.md`** لربط الواجهة الثابتة بعنوان الـ API.

## الأمان

- **لا ترفع** ملف `.env` إلى Git (مُدرَج في `.gitignore`).
- استخدم **`.env.example`** كمرجع فقط.

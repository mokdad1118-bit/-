# نشر الواجهة على Netlify + API منفصل

## لماذا يظهر خطأ 404 عند تسجيل الدخول؟

**Netlify يعرض ملفات HTML/JS/CSS فقط.** لا يشغّل `server.js` (Node).  
عندما لا يُحدَّد عنوان الـ API، الطلبات تذهب إلى `https://موقعك.netlify.app/api/...` → Netlify **لا يملك** هذه المسارات → **404**.

## الحل (ملخص)

1. **انشر الخادم** على Render (أو غيره) — انظر قسم [Render](#نشر-الخادم-على-render) أدناه.
2. **اربط الواجهة بالـ API** بـ `window.ADORA_API_BASE` (ملف `adora-config.js`) أو بـ meta tag `adora-api-base`.
3. **اضبط CORS** على السيرفر: `CORS_ORIGIN=https://موقعك.netlify.app` (نفس الرابط بالضبط).

---

## ربط الواجهة بالـ API

### الطريقة أ — Netlify مربوط بـ Git (موصى بها)

1. في Netlify: **Site settings → Environment variables** أضف:
   - **`ADORA_API_BASE`** = `https://عنوان-الـAPI.onrender.com` (بدون `/` في النهاية)
2. عند كل بناء، يُشغَّل `node scripts/write-adora-config.cjs` ويُحدَّث `adora-config.js` تلقائياً (انظر `netlify.toml`).
3. أعد نشر الموقع.

### الطريقة ب — رفع يدوي (drag & drop)

قبل الرفع، إما:

- عدّل **`adora-config.js`** يدوياً:
  ```javascript
  window.ADORA_API_BASE = "https://عنوان-الـAPI.onrender.com";
  ```
- أو من جهازك شغّل (PowerShell):
  ```powershell
  $env:ADORA_API_BASE="https://عنوان-الـAPI.onrender.com"; npm run build:netlify
  ```
  ثم ارفع المجلد.

### الطريقة ج — meta tag في `index.html` (بديل)

```html
<meta name="adora-api-base" content="https://عنوان-الـAPI.onrender.com">
```

**الأولوية:** قيمة `adora-config.js` (`window.ADORA_API_BASE`) ثم الـ meta، ثم نفس أصل الصفحة إذا بقي فارغاً.

---

## نشر الخادم على Render

1. أنشئ حساباً على [Render](https://render.com) واربط المستودع (أو ارفع المشروع).
2. **New → Web Service** (أو استخدم **Blueprint** إذا كان `render.yaml` في الجذر).
3. الإعدادات:
   - **Build:** `npm install`
   - **Start:** `node server.js`
   - **Health check path:** `/api/health`
4. **Environment** (مهم جداً):
   - **`NODE_ENV`** = `production`
   - **`JWT_SECRET`** = سلسلة عشوائية طويلة (مثلاً من `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - **`CORS_ORIGIN`** = `https://موقعك.netlify.app` (رابط الواجهة بالضبط، يمكن فصل أصول متعددة بفاصلة)
5. بعد النشر انسخ **Public URL** الخاص بالخدمة (مثل `https://adora-backend-xxxx.onrender.com`) وضعه في **`ADORA_API_BASE`** على Netlify أو في `adora-config.js`.

### ملاحظة SQLite على الخطة المجانية

قرص Render المجاني **مؤقت**؛ قد تُفقد بيانات SQLite عند إعادة التشغيل أو النوم. للإنتاج استخدم **Persistent Disk** أو قاعدة بيانات خارجية.

---

## التحقق

- من المتصفح: `https://عنوان-الـAPI.com/api/health` يجب أن يعيد JSON فيه `"ok": true` (أو ما يعادله).
- من Netlify: افتح الموقع وجرب **تسجيل الدخول والتسجيل** — يجب ألا يظهر 404 على طلبات `/api/...`.

---

## إذا استُضيف الموقع والـ API على نفس النطاق

اترك `ADORA_API_BASE` و `adora-api-base` **فارغين** (مثل خلف Nginx على نطاق واحد).

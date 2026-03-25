# ربط GitHub + Render + تسجيل الدخول (Netlify)

لا يمكن لأي أداة خارجية رفع الكود إلى **حسابك** على GitHub أو إنشاء خدمة على **Render** بدون:
- **GitHub:** `GH_TOKEN` (Personal Access Token) أو `gh auth login`
- **Render:** تسجيل الدخول في [dashboard.render.com](https://dashboard.render.com) وربط المستودع

اتبع الخطوات بالترتيب.

---

## 1) رفع المشروع إلى GitHub

من PowerShell داخل مجلد المشروع:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\ادورا"
$env:GH_TOKEN = "ghp_xxxxxxxx"   # من https://github.com/settings/tokens — صلاحية repo
.\scripts\push-to-github.ps1
```

انسخ رابط المستودع الذي يظهر (مثل `https://github.com/اسمك/adora-ecommerce`).

---

## 2) إنشاء Web Service على Render

### خيار أ — من Blueprint (يستخدم `render.yaml`)

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
2. اربط نفس المستودع على GitHub واختر الفرع `main`.
3. عند المطالبة، عيّن **`CORS_ORIGIN`** إلى رابط واجهتك **بالضبط**، مثال:
   - `https://30bcc.netlify.app`
   - بدون `/` في النهاية.
4. **`JWT_SECRET`** يُولَّد تلقائياً من الـ Blueprint (حقل `generateValue`).

### خيار ب — Web Service يدوي

1. **New** → **Web Service** → اربط المستودع.
2. **Build Command:** `npm ci`  
3. **Start Command:** `node server.js`  
4. **Health Check Path:** `/api/health`
5. **Environment → Add Environment Variable:**
   | المفتاح | القيمة |
   |---------|--------|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | سلسلة عشوائية طويلة (مثلاً ناتج `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
   | `CORS_ORIGIN` | `https://30bcc.netlify.app` (أو نطاق Netlify الفعلي لديك) |

6. **Create Web Service** وانتظر حتى يصبح **Live**.

### الصور على Render (Cloudinary — مطلوب للرفع)

رفع الصور من لوحة التحكم يعتمد على **Cloudinary** فقط (لا يوجد مجلد `/uploads` على السيرفر). عيّن **`CLOUDINARY_URL`** أو **`CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`** في Environment، ثم أعد النشر.

---

## 3) رابط الـ API

بعد النجاح، رابط الخدمة يكون مثل:

`https://adora-backend.onrender.com`  
(الاسم الفعلي يظهر في أعلى صفحة الخدمة على Render.)

تحقق من المتصفح:

`https://<اسم-الخدمة>.onrender.com/api/health`  
يجب أن يعيد JSON يدل على أن الخادم يعمل.

---

## 4) ربط الواجهة (Netlify) — بدون هذا خطوة تسجيل الدخول تفشل بـ 404

الواجهة يجب أن تتصل بـ Render وليس بـ Netlify:

1. Netlify → **Site configuration → Environment variables**
2. أضف **`ADORA_API_BASE`** = `https://<اسم-الخدمة>.onrender.com` (بدون `/` في النهاية)
3. **Deploys → Trigger deploy** (إعادة بناء حتى يُشغَّل `scripts/write-adora-config.cjs` ويحدّث `adora-config.js`)

أو عدّل `adora-config.js` يدوياً قبل الرفع:

```javascript
window.ADORA_API_BASE = "https://<اسم-الخدمة>.onrender.com";
```

---

## 5) تحقق سريع

| الخطوة | المتوقع |
|--------|---------|
| `/api/health` على Render | JSON ناجح |
| من Netlify: تسجيل / تسجيل دخول | لا 404؛ طلبات إلى نطاق `onrender.com` |
| `CORS_ORIGIN` | يطابق رابط Netlify حرفياً (بما فيه `https://`) |

إذا بقي خطأ CORS في الـ Console، راجع أن `CORS_ORIGIN` يساوي **نفس** عنوان الموقع الذي يفتحه المستخدم (بدون مسار إضافي).

---

## PostgreSQL على Render (Adora)

- لوحة Render تعرض **Internal Database URL** و**External Database URL** لقاعدة PostgreSQL.
- **ربط قاعدة بـ Web Service:** من صفحة الـ Web Service → **Environment** → **Link Database** — Render يضيف **`DATABASE_URL`** (الاتصال **الداخلي** بين خدمات Render). هذا هو الأنسب لتشغيل `server.js` على Render.
- التطبيق يستخدم **`pg`** ويقرأ **`DATABASE_URL`** من البيئة. للاتصال من **جهازك** (TablePlus، سكربت نقل، إلخ) استخدم **External Database URL**؛ لا تضع الـ External URL في متغيرات الـ Web Service إن كان الـ Internal متاحاً (أسرع وأكثر أماناً داخل الشبكة الداخلية لـ Render).
- إذا ظهرت كلمة مرور قاعدة البيانات في لقطة شاشة أو محادثة: **غيّر كلمة المرور** من إعدادات قاعدة البيانات على Render (أو أعد إنشاء المستخدم).

---

## مرجع سريع

- `server.js` — نقطة الدخول؛ `package.json` → `"start": "node server.js"`
- `.env.example` — قائمة المتغيرات (لا ترفع `.env` إلى Git)
- `NETLIFY.md` — تفاصيل إضافية للواجهة الثابتة

# نشر Adora على الإنترنت

## 1) المتطلبات

- **Node.js** 18 أو أحدث  
- نطاق + **HTTPS** (مُستحسن لـ PWA والجلسات)  
- جدار ناري يفتح المنفذ **80/443** (أو **3000** إن كان الوصول مباشراً لـ Node)

## 2) على السيرفر (Linux مثلاً)

```bash
cd /var/www/adora
npm ci --omit=dev
cp .env.example .env
nano .env
```

### أهم متغيرات `.env` للإنتاج

| المتغير | معنى |
|---------|------|
| `NODE_ENV` | `production` |
| `PORT` | غالباً `3000` (داخلياً) |
| `PUBLIC_URL` | `https://نطاقك.com` |
| `JWT_SECRET` | سلسلة عشوائية طويلة — لا تستخدم القيمة الافتراضية |
| `CORS_ORIGIN` | `https://نطاقك.com` (أو عدة نطاقات مفصولة بفاصلة) |
| `ADORA_APP_DOWNLOAD_URL` | رابط متجر التطبيق إن وُجد |
| `DATABASE_URL` | **مطلوب** — رابط PostgreSQL (`postgres://…`). على Render: اربط قاعدة البيانات بالخدمة أو انسخ الرابط (Internal للتطبيق على Render، External للاتصال من جهازك فقط) |
| `DATABASE_SSL` | اختياري — `false` للاتصال المحلي بدون SSL |

توليد `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

تشغيل:

```bash
export NODE_ENV=production
node server.js
```

أو باستخدام **PM2**:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

## 3) Nginx + SSL

- راجع المثال في `deploy/nginx-example.conf`  
- استخدم **Certbot** (Let's Encrypt) لشهادات HTTPS  
- تأكد من تمرير الرؤوس: `X-Forwarded-Proto` و `Host` (السيرفر مفعّل `trust proxy` في وضع الإنتاج)

## 4) Netlify (واجهة فقط)

Netlify **لا يشغّل Node**. إن رفعت المشروع هناك فقط، ستحصل على **404 على `/api/*`**.  
اتبع **`NETLIFY.md`**: شغّل `server.js` على Render/Railway/VPS، ثم اربط الواجهة بـ **`adora-config.js`** (أو متغير **`ADORA_API_BASE`** في بناء Netlify) أو وسم **`adora-api-base`** في `index.html`، واضبط **`CORS_ORIGIN`** على رابط Netlify.

## 5) الواجهة الأمامية (نفس النطاق)

إذا كان **الموقع والـ API** على نفس الأصل (`https://نطاقك.com`) فلا حاجة لتعديل `adora-config.js` أو `adora-api-base`.

إذا كان الـ API على **نطاق فرعي** آخر، عيّن **`window.ADORA_API_BASE`** في `adora-config.js` أو:

```html
<meta name="adora-api-base" content="https://api.example.com">
```

## 6) صحة الخدمة

- `GET /api/health` — للتحقق من أن التطبيق يعمل

## 7) Docker (اختياري)

```bash
docker build -t adora .
docker run -d -p 3000:3000 --env-file .env adora
```

يجب أن يحتوي `.env` على **`DATABASE_URL`** لقاعدة PostgreSQL.

## 8) نسخ احتياطي

- **PostgreSQL:** استخدم `pg_dump` أو نسخ احتياطي من مزوّد الاستضافة (مثل Render)  
- **صور المنتجات والبانرات:** تُخزَّن في **Cloudinary** (روابط `https://` في قاعدة البيانات) — لا يوجد مجلد `uploads/` على السيرفر

### ترحيل بيانات قديمة من SQLite

إن كان لديك ملف `adora.sqlite` سابقاً:

```bash
npm install
# ثم عيّن DATABASE_URL في .env ثم:
npm run migrate:sqlite-to-pg -- path/to/adora.sqlite
```

يحتاج السكربت حزمة **`sqlite3`** ضمن `devDependencies` (مثبتة تلقائياً بـ `npm install` بدون `--omit=dev`).

## 9) أمان

- لا ترفع ملف `.env` إلى مستودع عام  
- غيّر كلمة مرور **المدير** الافتراضية بعد أول دخول  
- راقب السجلات وحدّث التبعيات عند الحاجة

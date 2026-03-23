# رفع المشروع إلى GitHub

تم إنشاء مستودع Git محلياً مع commit أولي. **ملف `.env` غير مُتتبَّع** (مُستبعد عبر `.gitignore`).

## الطريقة السريعة (GitHub CLI)

1. ثبّت [Git](https://git-scm.com/download/win) و [GitHub CLI](https://cli.github.com/) إن لم تكن مثبّتاً.
2. **بدون تفاعل (موصى به):** أنشئ [Personal Access Token](https://github.com/settings/tokens) بصلاحية `repo`، ثم:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\ادورا"
$env:GH_TOKEN = "ghp_xxxxxxxxxxxxxxxx"
.\scripts\push-to-github.ps1
```

يُنشئ المستودع `adora-ecommerce` ويُدفع الفرع `main` ويطبع رابط GitHub.

3. **تفاعلي:** `gh auth login` ثم:

```powershell
git branch -M main
gh repo create adora-ecommerce --public --source=. --remote=origin --push
```

بعدها يظهر الرابط مثل: `https://github.com/اسمك/adora-ecommerce`

## بدون CLI

1. أنشئ مستودعاً فارغاً على GitHub (بدون README إن كان المجلد محلياً جاهزاً).
2. ثم:

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\ادورا"
git branch -M main
git remote add origin https://github.com/اسمك/اسم-المستودع.git
git push -u origin main
```

## Render

بعد الرفع: في [Render](https://render.com) → **New Web Service** → اربط المستودع →  
Build: `npm install` — Start: `node server.js` — واضبط المتغيرات من `.env.example`.

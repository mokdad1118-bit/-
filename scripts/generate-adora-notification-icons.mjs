/**
 * يولّد من شعار العلامة (مربع تقريباً):
 *   icons/adora-icon.png           192×192 — إشعار + manifest + favicon
 *   icons/adora-icon-72…384.png    مقاسات إضافية لأندرويد / WebAPK
 *   icons/adora-icon-512.png       512×512 — manifest
 *   icons/adora-apple-touch.png    180×180 — Apple touch icon
 *   icons/adora-badge.png           72×72 — شارة إشعار (قص يركّز على حرف A)
 *   icons/adora-image.png          512×256 — صورة إشعار عريضة
 *
 * المصدر: icons/adora-brand-source.png (ضع ملف الشعار هنا ثم شغّل السكربت)
 * تشغيل: npm run icons:notifications
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "icons", "adora-brand-source.png");
const outIcon = path.join(root, "icons", "adora-icon.png");
const out512 = path.join(root, "icons", "adora-icon-512.png");
const outApple = path.join(root, "icons", "adora-apple-touch.png");
const outBadge = path.join(root, "icons", "adora-badge.png");
const outImage = path.join(root, "icons", "adora-image.png");

const LAVENDER = { r: 245, g: 240, b: 252, alpha: 1 };

if (!fs.existsSync(src)) {
  console.error("Missing source:", src);
  process.exit(1);
}

const meta = await sharp(src).metadata();
const W = meta.width || 830;
const H = meta.height || 851;

await sharp(src)
  .resize(192, 192, { fit: "cover", position: "centre" })
  .png()
  .toFile(outIcon);

const densityIcons = [
  [72, "adora-icon-72.png"],
  [96, "adora-icon-96.png"],
  [144, "adora-icon-144.png"],
  [256, "adora-icon-256.png"],
  [384, "adora-icon-384.png"],
];
for (const [size, name] of densityIcons) {
  await sharp(src)
    .resize(size, size, { fit: "cover", position: "centre" })
    .png()
    .toFile(path.join(root, "icons", name));
}

await sharp(src)
  .resize(512, 512, { fit: "contain", position: "centre", background: LAVENDER })
  .png()
  .toFile(out512);

await sharp(src)
  .resize(180, 180, { fit: "cover", position: "centre" })
  .png()
  .toFile(outApple);

const cropW = Math.round(W * 0.52);
const cropH = Math.round(H * 0.38);
const left = Math.max(0, Math.round((W - cropW) / 2));
const top = Math.max(0, Math.round(H * 0.12));
await sharp(src)
  .extract({ left, top, width: Math.min(cropW, W - left), height: Math.min(cropH, H - top) })
  .resize(72, 72, { fit: "cover", position: "centre" })
  .png()
  .toFile(outBadge);

await sharp(src)
  .resize(512, 256, { fit: "contain", position: "centre", background: LAVENDER })
  .png()
  .toFile(outImage);

const allOut = [
  outIcon,
  ...densityIcons.map(([, name]) => path.join(root, "icons", name)),
  out512,
  outApple,
  outBadge,
  outImage,
];
for (const f of allOut) {
  const m = await sharp(f).metadata();
  console.log(path.basename(f), m.width, "x", m.height);
}

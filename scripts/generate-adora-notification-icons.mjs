/**
 * يولّد من قالب التصميم (1024×682 تقريباً):
 *   icons/adora-icon.png   192×192
 *   icons/adora-badge.png   72×72
 *   icons/adora-image.png  512×256
 *
 * تشغيل: node scripts/generate-adora-notification-icons.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = path.join(root, "icons", "adora-notification-template.jpg");
const outIcon = path.join(root, "icons", "adora-icon.png");
const outBadge = path.join(root, "icons", "adora-badge.png");
const outImage = path.join(root, "icons", "adora-image.png");

if (!fs.existsSync(src)) {
  console.error("Missing source:", src);
  process.exit(1);
}

const meta = await sharp(src).metadata();
const W = meta.width || 1024;
const H = meta.height || 682;
const topH = Math.round(H * 0.5);
const halfW = Math.round(W / 2);

await sharp(src)
  .extract({ left: 0, top: 0, width: halfW, height: topH })
  .resize(192, 192, { fit: "cover", position: "centre" })
  .png()
  .toFile(outIcon);

await sharp(src)
  .extract({ left: halfW, top: 0, width: halfW, height: topH })
  .resize(72, 72, { fit: "cover", position: "centre" })
  .png()
  .toFile(outBadge);

await sharp(src)
  .extract({ left: 0, top: topH, width: W, height: H - topH })
  .resize(512, 256, { fit: "cover", position: "centre" })
  .png()
  .toFile(outImage);

for (const f of [outIcon, outBadge, outImage]) {
  const m = await sharp(f).metadata();
  console.log(path.basename(f), m.width, "x", m.height);
}

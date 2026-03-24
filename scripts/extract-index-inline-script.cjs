/**
 * يفصل السكربت الضخم من index.html إلى index-page.js (مرة واحدة / عند الحاجة).
 * يحل مشكلة آلاف الأخطاء الوهمية في محرر HTML داخل <script>.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
const normalized = html.replace(/\r\n/g, "\n");

const marker = "<script>\n        // ==================== SPLASH SCREEN LOGIC";
const start = normalized.indexOf(marker);
if (start < 0) {
  console.error("لم يُعثر على بداية السكربت المضمّن.");
  process.exit(1);
}

const scriptTagEnd = normalized.indexOf(">", start) + 1;
const closeNeedle = "\n    </script>";
const end = normalized.indexOf(closeNeedle, scriptTagEnd);
if (end < 0) {
  console.error("لم يُعثر على نهاية السكربت.");
  process.exit(1);
}

const inner = normalized.slice(scriptTagEnd, end).replace(/^\s+/, "");
fs.writeFileSync(path.join(root, "index-page.js"), inner, "utf8");

const replacement = '    <script src="/index-page.js"></script>';
const newNormalized =
  normalized.slice(0, start) + replacement + normalized.slice(end + closeNeedle.length);

const outHtml = html.includes("\r\n") ? newNormalized.replace(/\n/g, "\r\n") : newNormalized;
fs.writeFileSync(htmlPath, outHtml, "utf8");

console.log("OK: index-page.js + index.html محدّثان.");

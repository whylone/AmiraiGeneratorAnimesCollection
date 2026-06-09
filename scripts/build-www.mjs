/**
 * Собирает статический бандл в www/ для упаковки в APK (Capacitor).
 *
 * Берём те же файлы, что и Flask-версия, но index.html делаем статическим
 * (без Jinja url_for). Пути /static/... и /img/... абсолютные — в WebView
 * Capacitor они резолвятся от корня www/, как и у Flask.
 */
import { existsSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const www = resolve(root, "www");

// 1. чистим www/
if (existsSync(www)) rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

// 2. вся статика → www/static/ (css, fonts, js, vendor, img)
cpSync(resolve(root, "static"), resolve(www, "static"), { recursive: true });

// 3. логотипы дублируем в www/img/ — брендбар и favicon ссылаются на /img/...
cpSync(resolve(root, "static", "img"), resolve(www, "img"), { recursive: true });

// 4. index.html из шаблона: убираем Jinja, ставим абсолютные пути.
let html = readFileSync(resolve(root, "templates", "index.html"), "utf8");
html = html.replace(
    /\{\{\s*url_for\(\s*'static'\s*,\s*filename=['"]([^'"]+)['"]\s*\)\s*\}\}/g,
    "/static/$1"
);
// Нативный мост Capacitor (window.Capacitor) инжектится рантаймом до наших
// скриптов — отдельный тег не нужен.
writeFileSync(resolve(www, "index.html"), html, "utf8");

console.log("✓ www/ собран:", www);

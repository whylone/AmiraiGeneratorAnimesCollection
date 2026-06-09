/**
 * Собирает debug-APK через Gradle и кладёт готовый файл в dist/.
 * Требует установленный Android SDK + JDK 17 (см. README-mobile.md).
 *
 * После сборки: dist/amirai-podborka.apk — кидай в Telegram и ставь на телефон.
 */
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const android = resolve(root, "android");
const isWin = process.platform === "win32";

if (!existsSync(android)) {
    console.error("Папки android/ нет. Сначала: npx cap add android");
    process.exit(1);
}

const gradlew = resolve(android, isWin ? "gradlew.bat" : "gradlew");
console.log("→ Gradle assembleDebug…");
const r = spawnSync(gradlew, ["assembleDebug"], {
    cwd: android,
    stdio: "inherit",
    shell: isWin,
});
if (r.status !== 0) process.exit(r.status || 1);

const apk = resolve(android, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
if (!existsSync(apk)) {
    console.error("APK не найден:", apk);
    process.exit(1);
}
const dist = resolve(root, "dist");
mkdirSync(dist, { recursive: true });
const out = resolve(dist, "amirai-podborka.apk");
copyFileSync(apk, out);
console.log("\n✓ Готово:", out);
console.log("  Кидай этот файл в Telegram и ставь на телефон.");

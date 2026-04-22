import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const newVersion = Bun.argv[2];

if (!newVersion) {
  console.error("❌ Masukkan versi baru! Contoh: bun update-version.ts 0.1.3");
  process.exit(1);
}

const rootDir = import.meta.dir;
const rootPkgPath = join(rootDir, "package.json");
const tauriConfPath = join(rootDir, "src-tauri", "tauri.conf.json");
const cargoTomlPath = join(rootDir, "src-tauri", "Cargo.toml");

try {
  // 1. Update package.json
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));
  rootPkg.version = newVersion;
  writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));
  console.log(`✅ package.json updated to ${newVersion}`);

  // 2. Update tauri.conf.json
  const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf-8"));
  tauriConf.version = newVersion;
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2));
  console.log(`✅ tauri.conf.json updated to ${newVersion}`);

  // 3. Update Cargo.toml (Menggunakan Regex karena ini format TOML)
  let cargoContent = readFileSync(cargoTomlPath, "utf-8");
  // Mencari version = "x.x.x" tepat di bawah [package]
  cargoContent = cargoContent.replace(
    /(^\[package\][\s\S]*?version\s*=\s*")([^"]+)(")/m,
    `$1${newVersion}$3`,
  );
  writeFileSync(cargoTomlPath, cargoContent);
  console.log(`✅ Cargo.toml updated to ${newVersion}`);

  console.log("\n🚀 Sinkronisasi selesai. Siap untuk build!");
} catch (error: any) {
  console.error("❌ Error:", error.message);
}

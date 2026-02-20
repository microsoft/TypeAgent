// Replicate the old postinstall for better-sqlite3:
//   1. Remove the build dir (may have been rebuilt for Electron by electron-builder)
//   2. Run prebuild-install to download the correct Node.js-compatible prebuilt binary
//   3. Copy the binary to build/Release-Node/ for use outside Electron
//
// Works with pnpm's store layout on Windows, macOS, and Linux.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Find all better-sqlite3 installations in the pnpm store
const pnpmDir = path.resolve(__dirname, "..", "..", "node_modules", ".pnpm");
const entries = fs.readdirSync(pnpmDir).filter((e) => e.startsWith("better-sqlite3@"));

if (entries.length === 0) {
  console.error("No better-sqlite3 installations found in", pnpmDir);
  process.exit(1);
}

let hasError = false;

for (const entry of entries) {
  const pkgDir = path.join(pnpmDir, entry, "node_modules", "better-sqlite3");
  if (!fs.existsSync(path.join(pkgDir, "package.json"))) {
    continue;
  }

  console.log(`\n📦 Processing ${entry}:`);
  console.log("   ", pkgDir);

  // 1. Remove existing build directory (may contain Electron-rebuilt binary)
  const buildDir = path.join(pkgDir, "build");
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    console.log("🗑️  Removed existing build directory");
  }

  // 2. Run prebuild-install to get the correct Node.js prebuilt binary
  try {
    console.log("⬇️  Running prebuild-install...");
    execSync("npx prebuild-install", {
      cwd: pkgDir,
      stdio: "inherit",
      env: { ...process.env, npm_config_runtime: "node" },
    });
  } catch (e) {
    console.error(`❌ prebuild-install failed for ${entry}:`, e.message);
    hasError = true;
    continue;
  }

  // 3. Copy to Release-Node
  const src = path.join(pkgDir, "build", "Release", "better_sqlite3.node");
  const dstDir = path.join(pkgDir, "build", "Release-Node");
  const dst = path.join(dstDir, "better_sqlite3.node");

  if (!fs.existsSync(src)) {
    console.error("❌ Native binary not found after prebuild-install:", src);
    hasError = true;
    continue;
  }

  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, dst);

  console.log("✅ Node.js binary copied:");
  console.log("   ", src);
  console.log(" → ", dst);
}

if (hasError) {
  process.exit(1);
}
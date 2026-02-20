// Save the Node.js-compatible better-sqlite3 native binary to a safe location.
//
// Problem: electron-builder's install-app-deps (in packages/shell postinstall)
// rebuilds better-sqlite3 for Electron, wiping the entire build/ directory.
// This runs in the root postinstall BEFORE electron-builder, so we save the
// correct Node.js binary to prebuild-node/ (outside build/) where
// electron-builder won't touch it.
//
// Works with pnpm's store layout on Windows, macOS, and Linux.

const fs = require("fs");
const path = require("path");

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

  const src = path.join(pkgDir, "build", "Release", "better_sqlite3.node");

  // Save to prebuild-node/ at the package root (outside build/ so
  // electron-builder's rebuild won't wipe it)
  const dstDir = path.join(pkgDir, "prebuild-node");
  const dst = path.join(dstDir, "better_sqlite3.node");

  if (!fs.existsSync(src)) {
    console.error("❌ Native binary not found:", src);
    hasError = true;
    continue;
  }

  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, dst);

  console.log("✅ Node.js binary saved:");
  console.log("   ", src);
  console.log(" → ", dst);
}

if (hasError) {
  process.exit(1);
}
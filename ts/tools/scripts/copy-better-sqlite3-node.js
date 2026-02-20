const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

// Resolve the real package location (works with pnpm on all OSes)
// With pnpm strict hoisting, better-sqlite3 isn't available at the workspace
// root. Resolve it from a workspace package that depends on it.
const consumerDir = path.resolve(__dirname, "..", "..", "node_modules", ".pnpm");
const consumerRequire = createRequire(path.join(consumerDir, "package.json"));
let pkgJson;
try {
  pkgJson = consumerRequire.resolve("better-sqlite3/package.json");
} catch {
  // Fallback: try resolving from the workspace root (hoisted or non-pnpm)
  pkgJson = require.resolve("better-sqlite3/package.json");
}
const pkgDir = path.dirname(pkgJson);

console.log("📦 Resolving better-sqlite3 package:");
console.log("   ", pkgDir);

const src = path.join(pkgDir, "build", "Release", "better_sqlite3.node");
const dstDir = path.join(pkgDir, "build", "Release-Node");
const dst = path.join(dstDir, "better_sqlite3.node");

if (!fs.existsSync(src)) {
  console.error("better-sqlite3 native binary not found:", src);
  process.exit(1);
}

fs.mkdirSync(dstDir, { recursive: true });
fs.copyFileSync(src, dst);

console.log("✅ better-sqlite3 node binary copied:");
console.log("   ", src);
console.log(" → ", dst);
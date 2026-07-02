// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Save the Node.js-compatible better-sqlite3 native binary to a safe location.
//
// Problem: electron-builder's install-app-deps (in packages/shell postinstall)
// rebuilds better-sqlite3 for Electron, wiping the entire build/ directory.
// This runs in the root postinstall BEFORE electron-builder, so we save the
// correct Node.js binary to prebuild-node/ (outside build/) where
// electron-builder won't touch it.
//
// If the binary in build/Release/ is already for Electron (wrong ABI), we
// re-download the correct Node.js prebuilt via prebuild-install.
//
// It ALSO provisions an Electron-ABI binary into prebuild-electron/ so the
// standalone Electron shell (which runs the agent-server in-process) can load
// better-sqlite3 for in-process SQLite (e.g. `@copilot import`). The Electron
// binary is downloaded from the better-sqlite3 GitHub release that matches the
// installed Electron's ABI. This step is best-effort (non-fatal): Node-only
// environments skip it, and the packaged app falls back to build/Release,
// which electron-builder rebuilds for Electron directly.
//
// Works with pnpm's store layout on Windows, macOS, and Linux.

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const expectedABI = process.versions.modules; // e.g. "127" for Node 22

// Probe binary compatibility in a CHILD process. Loading a native addon built
// for a different ABI (e.g. Electron) can SIGSEGV the loader rather than throw,
// which an in-process try/catch cannot recover from. Isolating the dlopen in a
// child turns a crash into a non-zero exit we can detect safely.
function isNodeCompatible(binaryPath) {
    const res = spawnSync(
        process.execPath,
        ["-e", "process.dlopen({ exports: {} }, process.argv[1])", binaryPath],
        { stdio: "ignore" },
    );
    return res.status === 0;
}

// Find all better-sqlite3 installations in the pnpm store
const pnpmDir = path.resolve(__dirname, "..", "..", "node_modules", ".pnpm");
const entries = fs
    .readdirSync(pnpmDir)
    .filter((e) => e.startsWith("better-sqlite3@"));

if (entries.length === 0) {
    console.error("No better-sqlite3 installations found in", pnpmDir);
    process.exit(1);
}

// ── Electron-ABI binary provisioning (prebuild-electron/) ──────────────────
//
// The standalone Electron shell runs the agent-server in-process, so any
// native module it loads (better-sqlite3, for @copilot import) must match
// Electron's ABI, not Node's. We download the matching prebuilt from the
// better-sqlite3 GitHub release and stash it in prebuild-electron/. The reader
// (packages/agentServer/.../sessionStoreReader.ts) points better-sqlite3 at
// this binary when running under Electron.

// Compare two dotted version strings numerically by their first three parts.
function compareVersions(a, b) {
    const pa = String(a)
        .split(/[.\-+]/)
        .map(Number);
    const pb = String(b)
        .split(/[.\-+]/)
        .map(Number);
    for (let i = 0; i < 3; i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d;
    }
    return 0;
}

// Highest installed Electron version (from the pnpm store), or undefined.
function getElectronVersion() {
    try {
        const versions = fs
            .readdirSync(pnpmDir)
            .map((e) => /^electron@(\d+\.\d+\.\d+[^_+()]*)/.exec(e))
            .filter(Boolean)
            .map((m) => m[1])
            .sort(compareVersions);
        return versions.length ? versions[versions.length - 1] : undefined;
    } catch {
        return undefined;
    }
}

// Resolve the Electron ABI (NODE_MODULE_VERSION) for `version`, trying every
// node-abi in the store newest-first. The bundled prebuild-install pins an old
// node-abi that doesn't know recent Electron releases, but electron-builder
// pulls in a newer one — so we pick whichever can answer.
function getElectronAbi(version) {
    let abiDirs;
    try {
        abiDirs = fs
            .readdirSync(pnpmDir)
            .filter((e) => /^node-abi@\d/.test(e))
            .sort((a, b) => compareVersions(a.split("@")[1], b.split("@")[1]));
    } catch {
        return undefined;
    }
    for (let i = abiDirs.length - 1; i >= 0; i--) {
        const modPath = path.join(
            pnpmDir,
            abiDirs[i],
            "node_modules",
            "node-abi",
        );
        try {
            const { getAbi } = require(modPath);
            const abi = getAbi(version, "electron");
            if (abi) return String(abi);
        } catch {
            // Try an older node-abi.
        }
    }
    return undefined;
}

function requireBundled(name, fromDir) {
    return require(require.resolve(name, { paths: [fromDir] }));
}

// Byte-compare two files (size first, then contents). Used to detect an
// already-correct binary so we can skip overwriting a file the running
// Electron shell may have mapped (which would fail with EBUSY on Windows).
function filesEqual(a, b) {
    try {
        if (fs.statSync(a).size !== fs.statSync(b).size) return false;
        return fs.readFileSync(a).equals(fs.readFileSync(b));
    } catch {
        return false;
    }
}

// Download a .tar.gz prebuild and extract it into `tempDir` (which will then
// contain build/Release/better_sqlite3.node). Uses prebuild-install's bundled
// simple-get (redirect + proxy aware) and tar-fs so we add no new deps.
function downloadAndExtract(url, tempDir, fromDir) {
    const get = requireBundled("simple-get", fromDir);
    const tarFs = requireBundled("tar-fs", fromDir);
    const pump = requireBundled("pump", fromDir);
    const zlib = require("zlib");
    return new Promise((resolve, reject) => {
        const req = get(url, (err, res) => {
            if (err) return reject(err);
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            pump(res, zlib.createGunzip(), tarFs.extract(tempDir), (e) =>
                e ? reject(e) : resolve(),
            );
        });
        req.setTimeout(60 * 1000, () => req.abort());
    });
}

// Ensure prebuild-electron/better_sqlite3.node exists for the given ABI.
// Idempotent via an electron-abi.txt marker. Best-effort: warns on failure.
async function ensureElectronBinary(pkgDir, bsqVersion, abi) {
    const dstDir = path.join(pkgDir, "prebuild-electron");
    const dst = path.join(dstDir, "better_sqlite3.node");
    const marker = path.join(dstDir, "electron-abi.txt");
    const current = fs.existsSync(marker)
        ? fs.readFileSync(marker, "utf8").trim()
        : "";
    if (fs.existsSync(dst) && current === abi) {
        console.log(
            `✅ Electron binary (ABI ${abi}) already in prebuild-electron/`,
        );
        return;
    }

    const platform = process.platform; // win32 | darwin | linux
    const arch = process.arch; // x64 | arm64 | ...
    const asset = `better-sqlite3-v${bsqVersion}-electron-v${abi}-${platform}-${arch}.tar.gz`;
    const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${bsqVersion}/${asset}`;
    const tempDir = path.join(pkgDir, "build-electron-temp");

    console.log(`⬇️  Downloading Electron (ABI ${abi}) prebuilt: ${asset}`);
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        await downloadAndExtract(url, tempDir, pkgDir);
        const extracted = path.join(
            tempDir,
            "build",
            "Release",
            "better_sqlite3.node",
        );
        if (!fs.existsSync(extracted)) {
            throw new Error(
                "archive did not contain build/Release/better_sqlite3.node",
            );
        }
        fs.mkdirSync(dstDir, { recursive: true });
        // If the correct binary is already in place (prior run without a
        // marker, or a running shell holding it open), just refresh the
        // marker instead of overwriting — avoids EBUSY on a locked .node.
        if (fs.existsSync(dst) && filesEqual(dst, extracted)) {
            fs.writeFileSync(marker, `${abi}\n`);
            console.log(
                `✅ Electron binary already up to date; marker refreshed (ABI ${abi})`,
            );
            return;
        }
        fs.copyFileSync(extracted, dst);
        fs.writeFileSync(marker, `${abi}\n`);
        console.log(
            `✅ Electron binary saved to prebuild-electron/ (ABI ${abi})`,
        );
    } catch (e) {
        console.warn(
            `⚠️  Could not provision Electron binary (ABI ${abi}): ${e.message}`,
        );
        console.warn(
            "   The Electron shell will fall back to build/Release; in-process",
        );
        console.warn(
            "   SQLite (e.g. @copilot import) may fail until this succeeds.",
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

let hasError = false;

for (const entry of entries) {
    const pkgDir = path.join(pnpmDir, entry, "node_modules", "better-sqlite3");
    if (!fs.existsSync(path.join(pkgDir, "package.json"))) {
        continue;
    }

    console.log(`\n📦 Processing ${entry}:`);
    console.log("   ", pkgDir);

    const dstDir = path.join(pkgDir, "prebuild-node");
    const dst = path.join(dstDir, "better_sqlite3.node");

    // If prebuild-node/ already has a compatible binary, skip
    if (fs.existsSync(dst) && isNodeCompatible(dst)) {
        console.log(
            "✅ Already has compatible Node.js binary in prebuild-node/",
        );
        continue;
    }

    const releaseBinary = path.join(
        pkgDir,
        "build",
        "Release",
        "better_sqlite3.node",
    );

    // If build/Release/ has a compatible Node.js binary, just copy it
    if (fs.existsSync(releaseBinary) && isNodeCompatible(releaseBinary)) {
        fs.mkdirSync(dstDir, { recursive: true });
        fs.copyFileSync(releaseBinary, dst);
        console.log("✅ Copied compatible binary from build/Release/");
        console.log(" → ", dst);
        continue;
    }

    // Binary is missing or wrong ABI (e.g. Electron) — re-download for Node.js
    console.log(
        "⬇️  Downloading Node.js-compatible prebuilt via prebuild-install...",
    );
    const tempBuildDir = path.join(pkgDir, "build-node-temp");
    try {
        // prebuild-install writes to build/Release/, so use a temp dir
        // to avoid disturbing any existing Electron binary
        fs.rmSync(tempBuildDir, { recursive: true, force: true });
        const origBuild = path.join(pkgDir, "build");
        const hasBuild = fs.existsSync(origBuild);
        if (hasBuild) {
            fs.renameSync(origBuild, tempBuildDir);
        }
        try {
            execFileSync(
                process.execPath,
                [
                    require.resolve("prebuild-install/bin", {
                        paths: [pkgDir],
                    }),
                    "--runtime",
                    "node",
                    "--target",
                    process.version,
                ],
                {
                    cwd: pkgDir,
                    stdio: "inherit",
                },
            );

            const downloaded = path.join(
                pkgDir,
                "build",
                "Release",
                "better_sqlite3.node",
            );
            if (!fs.existsSync(downloaded)) {
                throw new Error("prebuild-install did not produce a binary");
            }

            fs.mkdirSync(dstDir, { recursive: true });
            fs.copyFileSync(downloaded, dst);
            console.log("✅ Node.js binary saved to prebuild-node/");

            // Remove the temp build dir created by prebuild-install
            fs.rmSync(path.join(pkgDir, "build"), {
                recursive: true,
                force: true,
            });
        } finally {
            // Restore original build dir (may contain Electron binary)
            if (hasBuild) {
                if (!fs.existsSync(origBuild)) {
                    fs.renameSync(tempBuildDir, origBuild);
                } else {
                    fs.rmSync(tempBuildDir, { recursive: true, force: true });
                }
            }
        }
    } catch (e) {
        console.error(`❌ Failed for ${entry}:`, e.message);
        fs.rmSync(tempBuildDir, { recursive: true, force: true });
        hasError = true;
        continue;
    }
}

// Second pass: provision Electron-ABI binaries (best-effort, async). Runs
// after the Node.js pass so it never disturbs prebuild-node/. Node-binary
// failures remain fatal; Electron provisioning failures only warn.
(async () => {
    const electronVersion = getElectronVersion();
    if (!electronVersion) {
        console.log(
            "ℹ️  No Electron install found; skipping prebuild-electron.",
        );
        return;
    }
    const abi = getElectronAbi(electronVersion);
    if (!abi) {
        console.warn(
            `⚠️  Could not determine Electron ABI for ${electronVersion}; skipping prebuild-electron. Updating "node-abi" may help.`,
        );
        return;
    }
    console.log(
        `\n🔌 Provisioning Electron ${electronVersion} (ABI ${abi}) binaries`,
    );
    for (const entry of entries) {
        const pkgDir = path.join(
            pnpmDir,
            entry,
            "node_modules",
            "better-sqlite3",
        );
        const pkgJsonPath = path.join(pkgDir, "package.json");
        if (!fs.existsSync(pkgJsonPath)) {
            continue;
        }
        const bsqVersion = JSON.parse(
            fs.readFileSync(pkgJsonPath, "utf8"),
        ).version;
        await ensureElectronBinary(pkgDir, bsqVersion, abi);
    }
})()
    .catch((e) => {
        console.warn("⚠️  Electron binary provisioning failed:", e.message);
    })
    .finally(() => {
        if (hasError) {
            process.exit(1);
        }
    });

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { build } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
    copyFileSync,
    mkdirSync,
    cpSync,
    readFileSync,
    writeFileSync,
    existsSync,
    statSync,
    readdirSync,
} from "fs";
import { createHash } from "crypto";
import chalk from "chalk";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper function to create Vite build options that avoid TypeScript plugin conflicts
function createBuildOptions(outDir, options = {}) {
    return {
        logLevel: "error",
        plugins: [
            // Explicitly disable TypeScript plugin to avoid outDir conflicts
            {
                name: "disable-typescript-plugin",
                configResolved(config) {
                    // Remove TypeScript plugin
                    config.plugins = config.plugins.filter(
                        (plugin) =>
                            !plugin.name || !plugin.name.includes("typescript"),
                    );
                },
            },
        ],
        esbuild: {
            // Use esbuild for TypeScript compilation
            target: "es2022",
        },
        build: {
            outDir,
            emptyOutDir: options.emptyOutDir ?? false,
            sourcemap: isDev,
            minify: !isDev,
            rollupOptions: options.rollupOptions || {},
        },
    };
}

// --- 🔧 Incremental build detection ---
function checkIncrementalBuild() {
    const buildHashFile = resolve(
        __dirname,
        "../.build.cache/.extension-build-hash",
    );

    try {
        // Get modification times of key directories
        const srcExtensionPath = resolve(__dirname, "../src/extension");
        const srcElectronPath = resolve(__dirname, "../src/electron");
        const scriptPath = resolve(__dirname, "buildExtension.mjs");

        const getLastModified = (dirPath) => {
            if (!existsSync(dirPath)) return 0;
            const stat = statSync(dirPath);
            if (stat.isFile()) return stat.mtimeMs;

            let maxTime = stat.mtimeMs;
            try {
                const items = readdirSync(dirPath);
                for (const item of items) {
                    const itemPath = resolve(dirPath, item);
                    const itemTime = getLastModified(itemPath);
                    maxTime = Math.max(maxTime, itemTime);
                }
            } catch (e) {
                // Skip directories we can't read
            }
            return maxTime;
        };

        const lastModified = Math.max(
            getLastModified(srcExtensionPath),
            getLastModified(srcElectronPath),
            getLastModified(scriptPath),
        );

        const currentHash = createHash("md5")
            .update(lastModified.toString())
            .digest("hex");

        // Check if build is up to date
        if (existsSync(buildHashFile)) {
            const lastHash = readFileSync(buildHashFile, "utf8").trim();
            if (lastHash === currentHash) {
                console.log(
                    chalk.green(
                        "✅ Extension build is up to date, skipping...",
                    ),
                );
                process.exit(0);
            }
        }

        // Store current hash for next time - ONLY update if we actually built
        return (actuallyBuilt) => {
            if (actuallyBuilt) {
                // Ensure cache directory exists
                const cacheDir = dirname(buildHashFile);
                if (!existsSync(cacheDir)) {
                    mkdirSync(cacheDir, { recursive: true });
                }
                writeFileSync(buildHashFile, currentHash);
            }
        };
    } catch (error) {
        // If hash checking fails, proceed with build
        console.warn(
            chalk.yellow(
                "⚠️  Could not check incremental build status, proceeding...",
            ),
        );
        return (actuallyBuilt) => {
            if (actuallyBuilt) {
                console.warn(chalk.yellow("⚠️  Could not update build hash"));
            }
        };
    }
}

// const updateBuildHash = checkIncrementalBuild();

// --- 🔧 Detect dev mode ---
const isDev =
    process.argv.includes("--dev") ||
    process.argv.includes("--mode=development");
const buildMode = isDev ? "development" : "production";
const verbose = process.argv.includes("--verbose");

const chromeOutDir = resolve(__dirname, "../dist/extension");
const electronOutDir = resolve(__dirname, "../dist/electron");
const srcDir = resolve(__dirname, "../src/extension");
const electronSrcDir = resolve(__dirname, "../src/electron");

const sharedScripts = {
    contentScript: "contentScript/index.ts",
    webTypeAgentMain: "webTypeAgentMain.ts",
    webTypeAgentContentScript: "webTypeAgentContentScript.ts",
    options: "options.ts",
    sidepanel: "sidepanel.ts",
    uiEventsDispatcher: "uiEventsDispatcher.ts",
    "sites/paleobiodb": "sites/paleobiodb.ts",
};

const electronOnlyScripts = {
    agentActivation: "../src/electron/agentActivation.ts",
};

const vendorAssets = [
    [
        "node_modules/bootstrap/dist/css/bootstrap.min.css",
        "vendor/bootstrap/bootstrap.min.css",
    ],
    [
        "node_modules/bootstrap/dist/js/bootstrap.bundle.min.js",
        "vendor/bootstrap/bootstrap.bundle.min.js",
    ],
    ["node_modules/prismjs/prism.js", "vendor/prism/prism.js"],
    ["node_modules/prismjs/themes/prism.css", "vendor/prism/prism.css"],
    [
        "node_modules/prismjs/components/prism-typescript.js",
        "vendor/prism/prism-typescript.js",
    ],
    [
        "node_modules/prismjs/components/prism-json.js",
        "vendor/prism/prism-json.js",
    ],
];

if (verbose)
    console.log(
        chalk.blueBright(
            `\n🔨 Building in ${buildMode.toUpperCase()} mode...\n`,
        ),
    );

//
// ------------------------
// 🔹 Browser Extension
// ------------------------
//
if (verbose) console.log(chalk.cyan("🚀 Building Browser extension..."));

// Service worker (ESM)
await build(
    createBuildOptions(chromeOutDir, {
        emptyOutDir: !isDev,
        rollupOptions: {
            input: { serviceWorker: resolve(srcDir, "serviceWorker/index.ts") },
            output: {
                format: "es",
                entryFileNames: "serviceWorker.js",
            },
        },
    }),
);
if (verbose) console.log(chalk.green("✅ Chrome service worker built"));

// Content scripts (IIFE)
for (const [name, relPath] of Object.entries(sharedScripts)) {
    const input = resolve(srcDir, relPath);
    if (verbose) console.log(chalk.yellow(`➡️  Chrome content: ${name}`));
    await build(
        createBuildOptions(chromeOutDir, {
            rollupOptions: {
                input,
                output: {
                    format: "iife",
                    entryFileNames: `${name}.js`,
                    inlineDynamicImports: true,
                },
            },
        }),
    );
    if (verbose) console.log(chalk.green(`✅ Chrome ${name}.js built`));
}

// Static file copy
if (verbose) console.log(chalk.cyan("\n📁 Copying Chrome static files..."));
copyFileSync(`${srcDir}/manifest.json`, `${chromeOutDir}/manifest.json`);
copyFileSync(`${srcDir}/sidepanel.html`, `${chromeOutDir}/sidepanel.html`);
copyFileSync(`${srcDir}/options.html`, `${chromeOutDir}/options.html`);
mkdirSync(`${chromeOutDir}/sites`, { recursive: true });
copyFileSync(
    `${srcDir}/sites/paleobiodbSchema.mts`,
    `${chromeOutDir}/sites/paleobiodbSchema.mts`,
);
cpSync(`${srcDir}/images`, `${chromeOutDir}/images`, { recursive: true });
for (const [src, destRel] of vendorAssets) {
    const dest = resolve(chromeOutDir, destRel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(resolve(__dirname, "../", src), dest);
}
if (verbose) console.log(chalk.green("✅ Chrome static assets copied"));

//
// ------------------------
// 🟣 Electron Extension
// ------------------------
//
if (verbose) console.log(chalk.cyan("\n🚀 Building Electron extension..."));

for (const [name, relPath] of Object.entries(sharedScripts)) {
    const input = resolve(srcDir, relPath);
    if (verbose) console.log(chalk.yellow(`➡️  Electron shared: ${name}`));
    await build(
        createBuildOptions(electronOutDir, {
            rollupOptions: {
                input,
                output: {
                    format: "iife",
                    entryFileNames: `${name}.js`,
                    inlineDynamicImports: true,
                },
            },
        }),
    );
    if (verbose) console.log(chalk.green(`✅ Electron ${name}.js built`));
}

for (const [name, relPath] of Object.entries(electronOnlyScripts)) {
    const input = resolve(__dirname, relPath);
    if (verbose) console.log(chalk.yellow(`➡️  Electron only: ${name}`));
    await build(
        createBuildOptions(electronOutDir, {
            rollupOptions: {
                input,
                output: {
                    format: "iife",
                    entryFileNames: `${name}.js`,
                    inlineDynamicImports: true,
                },
            },
        }),
    );
    if (verbose) console.log(chalk.green(`✅ Electron ${name}.js built`));
}

// Copy electron manifest
if (verbose) console.log(chalk.cyan("\n📁 Copying Electron static files..."));
copyFileSync(
    `${electronSrcDir}/manifest.json`,
    `${electronOutDir}/manifest.json`,
);
if (verbose) console.log(chalk.green("✅ Electron static assets copied\n"));

// Update build hash to mark successful completion
// updateBuildHash(true); // true = actually built something

if (verbose)
    console.log(
        chalk.bold.green(
            `\n🎉 Extension build complete [${buildMode.toUpperCase()} mode]`,
        ),
    );

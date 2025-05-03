// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { build } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { copyFileSync, mkdirSync, cpSync } from "fs";
import chalk from "chalk";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- 🔧 Detect dev mode ---
const isDev =
    process.argv.includes("--dev") ||
    process.argv.includes("--mode=development");
const buildMode = isDev ? "development" : "production";

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

// console.log(chalk.blueBright(`\n🔨 Building in ${buildMode.toUpperCase()} mode...\n`));

//
// ------------------------
// 🔹 Browser Extension
// ------------------------
//
// console.log(chalk.cyan('🚀 Building Browser extension...'));

// Service worker (ESM)
await build({
    logLevel: "error",
    build: {
        outDir: chromeOutDir,
        emptyOutDir: !isDev,
        sourcemap: isDev,
        minify: !isDev,
        rollupOptions: {
            input: { serviceWorker: resolve(srcDir, "serviceWorker/index.ts") },
            output: {
                format: "es",
                entryFileNames: "serviceWorker.js",
            },
        },
    },
});
// console.log(chalk.green('✅ Chrome service worker built'));

// Content scripts (IIFE)
for (const [name, relPath] of Object.entries(sharedScripts)) {
    const input = resolve(srcDir, relPath);
    // console.log(chalk.yellow(`➡️  Chrome content: ${name}`));
    await build({
        logLevel: "error",
        build: {
            outDir: chromeOutDir,
            emptyOutDir: false,
            sourcemap: isDev,
            minify: !isDev,
            rollupOptions: {
                input,
                output: {
                    format: "iife",
                    entryFileNames: `${name}.js`,
                    inlineDynamicImports: true,
                },
            },
        },
    });
    // console.log(chalk.green(`✅ Chrome ${name}.js built`));
}

// Static file copy
// console.log(chalk.cyan('\n📁 Copying Chrome static files...'));
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
// console.log(chalk.green('✅ Chrome static assets copied'));

//
// ------------------------
// 🟣 Electron Extension
// ------------------------
//
// console.log(chalk.cyan('\n🚀 Building Electron extension...'));

for (const [name, relPath] of Object.entries(sharedScripts)) {
    const input = resolve(srcDir, relPath);
    // console.log(chalk.yellow(`➡️  Electron shared: ${name}`));
    await build({
        logLevel: "error",
        build: {
            outDir: electronOutDir,
            emptyOutDir: false,
            sourcemap: isDev,
            minify: !isDev,
            rollupOptions: {
                input,
                output: {
                    format: "iife",
                    entryFileNames: `${name}.js`,
                    inlineDynamicImports: true,
                },
            },
        },
    });
    // console.log(chalk.green(`✅ Electron ${name}.js built`));
}

for (const [name, relPath] of Object.entries(electronOnlyScripts)) {
    const input = resolve(__dirname, relPath);
    // console.log(chalk.yellow(`➡️  Electron only: ${name}`));
    await build({
        logLevel: "error",
        build: {
            outDir: electronOutDir,
            emptyOutDir: false,
            sourcemap: isDev,
            minify: !isDev,
            rollupOptions: {
                input,
                output: {
                    format: "iife",
                    entryFileNames: `${name}.js`,
                    inlineDynamicImports: true,
                },
            },
        },
    });
    // console.log(chalk.green(`✅ Electron ${name}.js built`));
}

// Copy electron manifest
// console.log(chalk.cyan('\n📁 Copying Electron static files...'));
copyFileSync(
    `${electronSrcDir}/manifest.json`,
    `${electronOutDir}/manifest.json`,
);
// console.log(chalk.green('✅ Electron static assets copied\n'));

// console.log(chalk.bold.green(`\n🎉 Extension build complete [${buildMode.toUpperCase()} mode]`));

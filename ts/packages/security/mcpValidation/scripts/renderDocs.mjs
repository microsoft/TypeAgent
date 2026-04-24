// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Renders markdown (with ```mermaid fences) to self-contained HTML and/or PDF.
// HTML path: pandoc + mermaid-filter (diagrams embedded as base64 PNG).
// PDF path:  pandoc → HTML → Chrome/Edge headless --print-to-pdf.
//
// Requires on the host:
//   - pandoc (winget install JohnMacFarlane.Pandoc, or apt/brew)
//   - @mermaid-js/mermaid-cli + mermaid-filter (npm i -g, or via npx)
//   - Chrome or Edge (found automatically on Windows/macOS/Linux)
//
// Usage:
//   node scripts/renderDocs.mjs --input ARCHITECTURE.md --out dist-docs --format both
//   node scripts/renderDocs.mjs --input README.md --out dist-docs --format html
//   node scripts/renderDocs.mjs --input brief.md  --out dist-docs --format pdf

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { input: "", out: "dist-docs", format: "both", title: "" };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--input") opts.input = args[++i];
        else if (a === "--out") opts.out = args[++i];
        else if (a === "--format") opts.format = args[++i];
        else if (a === "--title") opts.title = args[++i];
    }
    if (!opts.input) {
        console.error("Usage: renderDocs.mjs --input <file.md> [--out <dir>] [--format html|pdf|both] [--title <title>]");
        process.exit(2);
    }
    if (!["html", "pdf", "both"].includes(opts.format)) {
        console.error(`Unknown --format "${opts.format}". Use html, pdf, or both.`);
        process.exit(2);
    }
    return opts;
}

function which(name) {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "where" : "which";
    const r = spawnSync(cmd, [name], { encoding: "utf-8" });
    if (r.status !== 0) return null;
    return r.stdout.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? null;
}

function findPandoc() {
    const hit = which("pandoc");
    if (hit) return hit;
    const candidates = [
        "C:/Program Files/Pandoc/pandoc.exe",
        `${process.env.LOCALAPPDATA ?? ""}/Pandoc/pandoc.exe`,
        "/usr/local/bin/pandoc",
        "/opt/homebrew/bin/pandoc",
        "/usr/bin/pandoc",
    ];
    return candidates.find((p) => p && existsSync(p)) ?? null;
}

function findMermaidFilter() {
    const isWin = process.platform === "win32";
    const name = isWin ? "mermaid-filter.cmd" : "mermaid-filter";
    const hit = which(name);
    if (hit) return hit;
    const npmGlobal = `${process.env.APPDATA ?? ""}/npm/${name}`;
    if (existsSync(npmGlobal)) return npmGlobal;
    return null;
}

function findBrowser() {
    const candidates = [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    ];
    return candidates.find((p) => existsSync(p)) ?? null;
}

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
    if (r.status !== 0) {
        throw new Error(`${cmd} ${args.join(" ")} exited with code ${r.status}`);
    }
}

function main() {
    const opts = parseArgs();
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = resolve(here, "..");
    const inputAbs = resolve(pkgRoot, opts.input);
    if (!existsSync(inputAbs)) {
        console.error(`Input not found: ${inputAbs}`);
        process.exit(1);
    }
    const outDir = resolve(pkgRoot, opts.out);
    mkdirSync(outDir, { recursive: true });

    const pandoc = findPandoc();
    if (!pandoc) {
        console.error("pandoc not found on PATH. Install: winget install JohnMacFarlane.Pandoc");
        process.exit(1);
    }
    const mermaidFilter = findMermaidFilter();
    if (!mermaidFilter) {
        console.error("mermaid-filter not found on PATH. Install: npm i -g @mermaid-js/mermaid-cli mermaid-filter");
        process.exit(1);
    }

    const stem = basename(opts.input, extname(opts.input));
    const title = opts.title || stem;
    const htmlOut = join(outDir, `${stem}.html`);
    const pdfOut = join(outDir, `${stem}.pdf`);

    const wantHtml = opts.format === "html" || opts.format === "both";
    const wantPdf = opts.format === "pdf" || opts.format === "both";

    if (wantHtml || wantPdf) {
        console.log(`pandoc: ${inputAbs} → ${htmlOut}`);
        run(pandoc, [
            inputAbs,
            "-o", htmlOut,
            "--standalone",
            "--embed-resources",
            "--filter", mermaidFilter,
            "--metadata", `title=${title}`,
        ]);
    }

    if (wantPdf) {
        const browser = findBrowser();
        if (!browser) {
            console.error("No Chrome or Edge found for PDF rendering.");
            process.exit(1);
        }
        console.log(`chrome: ${htmlOut} → ${pdfOut}`);
        const fileUrl = `file:///${htmlOut.replace(/\\/g, "/")}`;
        run(browser, [
            "--headless=new",
            "--disable-gpu",
            "--no-margins",
            `--print-to-pdf=${pdfOut}`,
            fileUrl,
        ]);
        if (opts.format === "pdf") {
            // clean up intermediate HTML unless user asked for both
            // (kept: writes are fast; lets the user inspect if pdf looks off)
        }
    }

    const produced = [
        wantHtml ? htmlOut : null,
        wantPdf ? pdfOut : null,
    ].filter(Boolean);
    console.log(`\nProduced:\n  ${produced.join("\n  ")}`);
}

main();

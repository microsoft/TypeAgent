// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const bundle = await build({
    entryPoints: ["src/previewApp.ts"],
    bundle: true,
    minify: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
});
const script = bundle.outputFiles[0].text.replaceAll("</script", "<\\/script");
const css = `body{font:14px/1.5 var(--font-sans,system-ui);color:var(--color-text-primary,#202124);background:var(--color-background-primary,#fff);margin:16px;overflow-wrap:anywhere}button{font:inherit;color:inherit;background:var(--color-background-secondary,#f4f4f4);border:1px solid var(--color-border-primary,#999);border-radius:8px;padding:6px 10px;margin:4px;cursor:pointer}button:focus-visible{outline:2px solid currentColor;outline-offset:2px}h2{font-size:1.2rem}section{border-top:1px solid var(--color-border-primary,#aaa);padding-top:8px;margin-top:12px}small{display:block}pre{white-space:pre-wrap}ol,ul{padding-left:22px}`;
const hash = (value) =>
    `'sha256-${createHash("sha256").update(value).digest("base64")}'`;
const policy = `default-src 'none'; script-src ${hash(script)}; style-src ${hash(css)}; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${css}</style><title>Memory preview</title></head><body><main id="preview" aria-label="Memory preview"></main><p id="status" role="status">Connecting to the host…</p><script>${script}</script></body></html>`;
if (Buffer.byteLength(html, "utf8") > 400 * 1024)
    throw new Error("Memory preview renderer exceeds 400 KiB");
await mkdir("dist", { recursive: true });
await writeFile("dist/preview.html", html, "utf8");
process.stdout.write(
    `Memory preview renderer: ${Buffer.byteLength(html, "utf8")} bytes\n`,
);

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const browser = fileURLToPath(new URL("../", import.meta.url));
const rpc = path.resolve(browser, "../browserControlRpc");
const extension = path.resolve(browser, "../browserExtension");
const pdfjs = path.join(browser, "node_modules/pdfjs-dist");
const converterPath = "converters/pdfToMarkdown";
const tools = path.resolve(
    rpc,
    "../../../tools/scripts/converters/pdfToMarkdown",
);

async function equalFile(actual, expected) {
    assert.deepEqual(await readFile(actual), await readFile(expected), actual);
}

async function equalTree(actual, expected) {
    const entries = await readdir(expected, { withFileTypes: true });
    assert.ok(entries.length > 0, expected);
    for (const entry of entries) {
        const target = path.join(actual, entry.name);
        const source = path.join(expected, entry.name);
        if (entry.isDirectory()) await equalTree(target, source);
        else await equalFile(target, source);
    }
}

test("parent distribution preserves converter sources, declarations, notices and compact provenance", async () => {
    for (const name of [
        "index.js",
        "index.d.ts",
        "engine.js",
        "export.js",
        "columns.js",
        "symbols.js",
        "texfonts.js",
        "mathtext.js",
        "pdfjs5.js",
        "lifecycle.js",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "source-manifest.json",
    ]) {
        const emitted = path.join(rpc, "dist", converterPath, name);
        const source = path.join(rpc, "src", converterPath, name);
        if (name.endsWith(".js")) {
            const expected = ts
                .transpileModule(await readFile(source, "utf8"), {
                    fileName: name,
                    compilerOptions: {
                        target: ts.ScriptTarget.ES2021,
                        module: ts.ModuleKind.ESNext,
                    },
                })
                .outputText.trim();
            assert.equal(
                (await readFile(emitted, "utf8"))
                    .replace(/\/\/# sourceMappingURL=.*$/m, "")
                    .trim(),
                expected,
                name,
            );
        } else await equalFile(emitted, source);
    }
    const emittedNames = await readdir(path.join(rpc, "dist", converterPath));
    for (const name of [
        "test",
        "patches",
        "README.md",
        "package.json",
        "pnpm-lock.yaml",
        "tsconfig.json",
        "vendor-source.mjs",
        "build-artifacts.mjs",
    ])
        assert.ok(
            !emittedNames.includes(name),
            `Runtime contains tooling: ${name}`,
        );
    await equalFile(
        path.join(rpc, "dist", converterPath, "PDFJS-LICENSE"),
        path.join(pdfjs, "LICENSE"),
    );
});

for (const [name, root] of [
    ["viewer", path.join(browser, "dist/views/public/pdf")],
    ["Chrome", path.join(extension, "dist/extension")],
    ["Electron", path.join(extension, "dist/electron")],
]) {
    test(`${name} distribution includes exact PDF.js support assets and vendor notices`, async () => {
        for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
            await equalTree(
                path.join(root, "vendor/pdfjs", directory),
                path.join(pdfjs, directory),
            );
        }
        await equalFile(
            path.join(root, "vendor/pdfjs/LICENSE"),
            path.join(pdfjs, "LICENSE"),
        );
        for (const notice of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
            await equalFile(
                path.join(root, "vendor", converterPath, notice),
                path.join(rpc, "src", converterPath, notice),
            );
        }
        if (name === "viewer") {
            const assets = path.join(browser, "dist/views/public/pdf/js");
            const workers = (await readdir(assets)).filter((file) =>
                /^pdf\.worker.*\.mjs$/.test(file),
            );
            assert.equal(workers.length, 1);
            await equalFile(
                path.join(assets, workers[0]),
                path.join(pdfjs, "build/pdf.worker.mjs"),
            );
        } else {
            await equalFile(
                path.join(root, "vendor/pdfjs/pdf.worker.min.mjs"),
                path.join(pdfjs, "build/pdf.worker.min.mjs"),
            );
        }
    });
}

test("production build and artifact scripts pass Node syntax checks", () => {
    for (const script of [
        path.join(browser, "vite.config.mjs"),
        path.join(extension, "scripts/buildExtension.mjs"),
        path.join(tools, "build-artifacts.mjs"),
        path.join(tools, "vendor-source.mjs"),
        path.join(tools, "compare-upstream.mjs"),
        path.join(tools, "qualify-book.mjs"),
    ])
        execFileSync(process.execPath, ["--check", script], { stdio: "pipe" });
});

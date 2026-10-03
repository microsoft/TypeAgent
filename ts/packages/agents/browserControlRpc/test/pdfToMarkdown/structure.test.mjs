// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const parent = new URL("../../", import.meta.url);
const repository = new URL("../../../../", parent);
const runtime = new URL("src/converters/pdfToMarkdown/", parent);
const tooling = new URL(
    "ts/tools/scripts/converters/pdfToMarkdown/",
    repository,
);
const require = createRequire(new URL("package.json", parent));

test("converter layout has no obsolete source or nested package artifacts", async () => {
    await assert.rejects(stat(new URL("src/papero/", parent)), {
        code: "ENOENT",
    });
    for (const directory of [
        runtime,
        tooling,
        new URL("test/pdfToMarkdown/", parent),
    ]) {
        const entries = await readdir(directory, { recursive: true });
        assert.ok(
            !entries.some((name) =>
                /(^|[\\/])(node_modules|dist|package\.json|(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)|.*\.tsbuildinfo)([\\/]|$)/.test(
                    name,
                ),
            ),
            fileURLToPath(directory),
        );
    }
    const pkg = JSON.parse(
        await readFile(new URL("package.json", parent), "utf8"),
    );
    assert.equal(pkg.dependencies["pdfjs-dist"], "5.3.31");
    assert.equal(
        pkg.devDependencies["pdfjs-baseline"],
        "npm:pdfjs-dist@4.10.38",
    );
    assert.equal(pkg.devDependencies["@napi-rs/canvas"], "0.1.100");
    const declarations = await readFile(new URL("index.d.ts", runtime), "utf8");
    assert.doesNotMatch(declarations, /\bPapero[A-Z]\w*/);
});

test("authored converter adapters, scripts and tests retain Microsoft MIT headers", async () => {
    const files = [
        new URL("src/pdfMarkdown.ts", parent),
        new URL("test/pdfMarkdown.spec.mjs", parent),
        ...["index.js", "index.d.ts", "lifecycle.js", "pdfjs5.js"].map(
            (name) => new URL(name, runtime),
        ),
    ];
    for (const directory of [tooling, new URL("test/pdfToMarkdown/", parent)]) {
        for (const name of await readdir(directory, { recursive: true })) {
            if (/\.(?:mjs|js|ts)$/.test(name))
                files.push(new URL(name.replaceAll("\\", "/"), directory));
        }
    }
    for (const file of files) {
        assert.ok(
            (await readFile(file, "utf8")).startsWith(
                "// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT License.\n",
            ),
            fileURLToPath(file),
        );
    }
});

test("workspace lockfile records consolidated converter dependencies", async () => {
    const toolsRequire = createRequire(
        new URL("ts/tools/package.json", repository),
    );
    const yaml = toolsRequire("js-yaml");
    const lock = yaml.load(
        await readFile(new URL("ts/pnpm-lock.yaml", repository), "utf8"),
    );
    const importer = lock.importers["packages/agents/browserControlRpc"];
    assert.equal(importer.dependencies["pdfjs-dist"].specifier, "5.3.31");
    assert.equal(importer.dependencies["pdfjs-dist"].version, "5.3.31");
    assert.equal(
        importer.devDependencies["pdfjs-baseline"].specifier,
        "npm:pdfjs-dist@4.10.38",
    );
    assert.equal(
        importer.devDependencies["pdfjs-baseline"].version,
        "pdfjs-dist@4.10.38",
    );
    assert.equal(
        importer.devDependencies["@napi-rs/canvas"].specifier,
        "0.1.100",
    );
    assert.equal(
        importer.devDependencies["@napi-rs/canvas"].version,
        "0.1.100",
    );
    assert.ok(
        !Object.keys(lock.importers).some((name) =>
            name.includes("browserControlRpc/src/"),
        ),
    );
});

test("root and workspace formatting ignores exclude vendor bodies but not authored tooling", async () => {
    const prettier = require("prettier");
    for (const ignorePath of [
        new URL(".prettierignore", repository),
        new URL("ts/.prettierignore", repository),
    ]) {
        const options = {
            ignorePath: fileURLToPath(ignorePath),
            withNodeModules: false,
        };
        assert.equal(
            (
                await prettier.getFileInfo(
                    fileURLToPath(new URL("engine.js", runtime)),
                    options,
                )
            ).ignored,
            true,
        );
        assert.equal(
            (
                await prettier.getFileInfo(
                    fileURLToPath(new URL("vendor-source.mjs", tooling)),
                    options,
                )
            ).ignored,
            false,
        );
    }
    const readme = await readFile(new URL("README.md", tooling), "utf8");
    assert.equal([...readme.matchAll(/^# /gm)].length, 1);
    assert.doesNotMatch(readme, /src\/papero|dist\/papero|# Papero Vendor/);
});

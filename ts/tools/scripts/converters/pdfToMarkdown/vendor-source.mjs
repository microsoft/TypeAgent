// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
    readFile,
    writeFile,
    mkdir,
    mkdtemp,
    copyFile,
    rm,
} from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const tooling = path.dirname(fileURLToPath(import.meta.url));
const parent = path.resolve(
    tooling,
    "../../../../packages/agents/browserControlRpc",
);
const directory = path.join(parent, "src/converters/pdfToMarkdown");
const tests = path.join(parent, "test/pdfToMarkdown");
const require = createRequire(path.join(parent, "package.json"));
const ts = require("typescript");
const revision = "f9e92cbc0224d1413c11dda15b284ee41b9fc48f";
const checkout = process.argv[2];
if (!checkout)
    throw new Error("Usage: node vendor-source.mjs <pinned-upstream-checkout>");
const git = (...args) =>
    execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== revision)
    throw new Error("Upstream checkout must match the pin");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const previous = JSON.parse(
    await readFile(path.join(directory, "source-manifest.json"), "utf8"),
);
const sourceHeader = (name) =>
    [
        "// Copyright (c) Microsoft Corporation.",
        "// Licensed under the MIT License.",
        "",
        "// Copyright (c) 2026 Beatriz Almeida.",
        "// Licensed under the MIT License; see LICENSE.",
        `// Upstream source: https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/${revision}/web/assets/${name}`,
        "// TypeAgent modifications: Copyright (c) Microsoft Corporation. Licensed under the MIT License.",
        "// Adapted source and provenance header; reversible patch recorded in ts/tools/scripts/converters/pdfToMarkdown/patches.",
        "",
    ].join("\n");
const filenames = [
    "engine.js",
    "columns.js",
    "symbols.js",
    "texfonts.js",
    "mathtext.js",
    "export.js",
    "LICENSE",
];
if (process.argv.includes("--restore")) {
    const staging = await mkdtemp(
        path.join(os.tmpdir(), "pdf-to-markdown-restore-"),
    );
    try {
        for (const file of previous.files) {
            const target = path.join(staging, file.localPath);
            await copyFile(path.join(checkout, file.upstreamPath), target);
            if (file.patch)
                execFileSync(
                    "git",
                    [
                        "-c",
                        "core.autocrlf=false",
                        "apply",
                        "--",
                        path.join(tooling, file.patch),
                    ],
                    { cwd: staging },
                );
            if (hash(await readFile(target)) !== file.vendoredSha256)
                throw new Error(`Restored hash mismatch: ${file.localPath}`);
        }
        for (const file of previous.files)
            await copyFile(
                path.join(staging, file.localPath),
                path.join(directory, file.localPath),
            );
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
}
const roots = [
    "contentBlocks",
    "mdTable",
    "figureWords",
    "blockMarkdown",
    "toMarkdown",
];
const exportPath = path.join(checkout, "web/assets/export.js");
const source = ts.createSourceFile(
    exportPath,
    await readFile(exportPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
);
const declarations = new Map();
for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name)
        declarations.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name))
                declarations.set(declaration.name.text, statement);
        }
    }
}
const selected = new Set();
const identifiers = new Set();
const visit = (node) => {
    if (ts.isIdentifier(node)) {
        identifiers.add(node.text);
        const declaration = declarations.get(node.text);
        if (declaration && !selected.has(declaration)) {
            selected.add(declaration);
            visit(declaration);
        }
    }
    ts.forEachChild(node, visit);
};
for (const name of roots) {
    const declaration = declarations.get(name);
    if (!declaration) throw new Error(`Missing upstream export: ${name}`);
    selected.add(declaration);
    visit(declaration);
}
const chunks = [];
for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings))
            throw new Error("Unsupported upstream import shape");
        const needed = bindings.elements.filter((binding) =>
            identifiers.has(binding.name.text),
        );
        if (needed.length)
            chunks.push(
                `import { ${needed.map((binding) => binding.getText(source)).join(", ")} } from ${statement.moduleSpecifier.getText(source)};`,
            );
    } else if (selected.has(statement))
        chunks.push(source.text.slice(statement.getFullStart(), statement.end));
}
await writeFile(
    path.join(directory, "export.js"),
    sourceHeader("export.js") + chunks.join("\n") + "\n",
);
for (const name of filenames.filter(
    (name) => name !== "export.js" && name !== "LICENSE",
)) {
    const localPath = path.join(directory, name);
    const text = await readFile(localPath, "utf8");
    const header = sourceHeader(name);
    if (!text.includes(header)) await writeFile(localPath, header + text);
}
const exporter = await import(pathToFileURL(exportPath).href);
const document = JSON.parse(
    await readFile(path.join(tests, "markdown-document.json"), "utf8"),
);
const markdownParity = [];
for (const images of ["none", "ref", "embed"]) {
    for (const math of ["unicode", "latex"]) {
        for (const pageBreaks of [false, true]) {
            const options = { images, math, pageBreaks };
            markdownParity.push({
                options,
                markdown: exporter.toMarkdown(document, options),
            });
        }
    }
}
await writeFile(
    path.join(tests, "markdown-parity.json"),
    JSON.stringify({ revision, cases: markdownParity }, null, 2) + "\n",
);
await mkdir(path.join(tooling, "patches"), { recursive: true });
const files = [];
for (const name of filenames) {
    const upstreamPath = name === "LICENSE" ? "LICENSE" : `web/assets/${name}`;
    const originalPath = path.join(checkout, upstreamPath);
    const localPath = path.join(directory, name);
    const original = await readFile(originalPath);
    const recorded = previous.files.find(
        (file) => file.upstreamPath === upstreamPath,
    );
    if (!recorded || recorded.originalSha256 !== hash(original))
        throw new Error(`Pinned original hash changed: ${upstreamPath}`);
    const local = await readFile(localPath);
    const changed = !original.equals(local);
    let patch = null;
    if (changed) {
        patch = `patches/${name}.patch`;
        const diff = spawnSync(
            "git",
            [
                "-c",
                "core.autocrlf=false",
                "diff",
                "--no-index",
                "--",
                originalPath,
                localPath,
            ],
            { encoding: "utf8" },
        );
        if (diff.status !== 1)
            throw new Error(`Unable to record ${name} patch: ${diff.stderr}`);
        const normalized = diff.stdout
            .split("\n")
            .map((line) => {
                if (line.startsWith("diff --git "))
                    return `diff --git a/${name} b/${name}`;
                if (line.startsWith("--- ")) return `--- a/${name}`;
                if (line.startsWith("+++ ")) return `+++ b/${name}`;
                if (line === " ") return "";
                return line;
            })
            .join("\n");
        await writeFile(path.join(tooling, patch), normalized);
    }
    files.push({
        upstreamPath,
        localPath: name,
        originalSha256: hash(original),
        vendoredSha256: hash(local),
        patch,
    });
}
const demo = process.argv.includes("--compare-demo")
    ? []
    : previous.demo.assets;
for (const name of process.argv.includes("--compare-demo")
    ? filenames.filter((name) => name !== "LICENSE")
    : []) {
    const url = `https://beatrizalmeidaf.github.io/papero-pdf-text-extractor/assets/${name}`;
    const response = await fetch(url);
    if (!response.ok) {
        demo.push({ path: `assets/${name}`, url, status: response.status });
        continue;
    }
    const sha256 = hash(Buffer.from(await response.arrayBuffer()));
    demo.push({
        path: `assets/${name}`,
        url,
        sha256,
        matchesPin:
            sha256 ===
            files.find((file) => file.localPath === name).originalSha256,
    });
}
const manifest = {
    repository: "https://github.com/beatrizalmeidaf/papero-pdf-text-extractor",
    revision,
    upstreamHeadAtFetch: previous.upstreamHeadAtFetch,
    fetchedAt: previous.fetchedAt,
    license: {
        spdx: "MIT",
        copyright: "Copyright (c) 2026 Beatriz Almeida",
        notice: "LICENSE",
    },
    hashAlgorithm: "SHA-256",
    files,
    markdownExports: roots,
    markdownClosure: [...declarations]
        .filter(([, statement]) => selected.has(statement))
        .map(([name]) => name),
    dependencies: [
        {
            name: "pdfjs-dist",
            upstreamVersion: "4.10.38",
            localVersion: "5.3.31",
            license: "Apache-2.0",
            use: "Local operator/font engine and caller-managed worker",
        },
    ],
    testOnlyDependencies: [
        {
            name: "pdfjs-baseline",
            version: "npm:pdfjs-dist@4.10.38",
            use: "Parent dev dependency for isolated upstream comparison; never imported by runtime",
        },
        {
            name: "@napi-rs/canvas",
            version: "0.1.100",
            use: "Parent dev dependency for Node qualification canvas globals",
        },
    ],
    patchDirectory: "ts/tools/scripts/converters/pdfToMarkdown/patches",
    sourceHeaderPolicy:
        "Upstream copyright, MIT license, pinned source URL and TypeAgent modification attribution on each vendored JavaScript file; original hashes unchanged",
    localAdapters: await Promise.all(
        ["index.js", "index.d.ts", "lifecycle.js", "pdfjs5.js"].map(
            async (name) => ({
                localPath: name,
                sha256: hash(await readFile(path.join(directory, name))),
            }),
        ),
    ),
    demo: {
        revision: null,
        evidence:
            "Public deployed asset bytes; no deployment commit identifier advertised by these assets",
        assets: demo,
    },
    localPatches: [
        {
            id: "P1",
            file: "engine.js",
            description: "Local PDF.js import; remove global worker mutation",
        },
        {
            id: "P2",
            file: "engine.js",
            helper: "lifecycle.js",
            description:
                "One document, bounded page concurrency 1-4 (default 1), injected loading/worker/password options, abort gates, guarded cleanup",
        },
        {
            id: "P3",
            file: "export.js",
            description:
                "AST-selected exact Markdown dependency closure; omit Word/Excel/HTML/text/CSV/JSON/archive exporters",
        },
        {
            id: "P4",
            file: "engine.js",
            description:
                "Canvas release on failure and render cancellation; page cleanup after extraction/cropping; preserve openPdf proxy result",
        },
        {
            id: "P5",
            file: "engine.js",
            helper: "pdfjs5.js",
            description:
                "Normalize combined compact PDF.js 5 constructPath/paint operations to upstream primitives; use public operator lists to avoid renderer-mutated Path2D caches",
        },
        {
            id: "P6",
            file: "engine.js",
            description:
                "Extract caller-owned viewer proxies without destroying or cleaning their pages; bound cumulative text and block work; yield and check cancellation at page boundaries",
        },
        {
            id: "P7",
            file: "*.js",
            description:
                "Pinned per-file upstream provenance headers; helper algorithm bodies unchanged",
        },
    ],
};
await writeFile(
    path.join(directory, "source-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
);
process.stdout.write(
    JSON.stringify(
        {
            revision,
            closure: manifest.markdownClosure,
            demo: manifest.demo.assets,
        },
        null,
        2,
    ) + "\n",
);

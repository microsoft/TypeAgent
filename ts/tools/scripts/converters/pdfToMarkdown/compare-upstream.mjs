// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { fixturePdf } from "../../../../packages/agents/browserControlRpc/test/pdfToMarkdown/fixture.mjs";

const parent = new URL(
    "../../../../packages/agents/browserControlRpc/",
    import.meta.url,
);
const require = createRequire(new URL("package.json", parent));
const ts = require("typescript");
const fixtures = new URL("test/pdfToMarkdown/", parent);
const runtime = new URL("src/converters/pdfToMarkdown/", parent);
Object.assign(globalThis, require("@napi-rs/canvas"));
const checkout = process.argv[2];
if (!checkout)
    throw new Error(
        "Usage: node compare-upstream.mjs <pinned-upstream-checkout>",
    );
assert.equal(
    execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
        encoding: "utf8",
    }).trim(),
    "f9e92cbc0224d1413c11dda15b284ee41b9fc48f",
);
if (process.argv[3] !== "--baseline") {
    execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), checkout, "--baseline"],
        { stdio: "inherit" },
    );
    const expected = JSON.parse(
        await readFile(new URL("extraction-parity.json", fixtures), "utf8"),
    );
    const local = {
        ...(await import(new URL("engine.js", runtime))),
        ...(await import(new URL("index.js", runtime))),
    };
    const adapted = await local.extractDocument(fixturePdf(), {
        getDocumentOptions: { useSystemFonts: true, disableFontFace: true },
    });
    try {
        const pages = adapted.doc.pages.map((page) => ({
            number: page.number,
            width: page.width,
            height: page.height,
            blocks: page.blocks,
        }));
        assert.deepEqual(pages, expected.pages);
        assert.equal(
            local.toMarkdown(adapted.doc, { math: "latex", images: "none" }),
            expected.markdown,
        );
        process.stdout.write(
            "Exact page/block and Markdown parity: upstream PDF.js 4.10.38 versus local 5.3.31 (synthetic glyph/rotation/table fixture)\n",
        );
        process.stdout.write(
            local.toMarkdown(adapted.doc, { images: "none" }) + "\n",
        );
    } finally {
        await adapted.destroy();
    }
} else {
    const text = await readFile(
        path.join(checkout, "web/assets/engine.js"),
        "utf8",
    );
    const source = ts.createSourceFile(
        "engine.js",
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
    );
    const chunks = [];
    for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement)) {
            const specifier = statement.moduleSpecifier.text;
            const url = specifier.startsWith("https:")
                ? pathToFileURL(
                      require.resolve("pdfjs-baseline/legacy/build/pdf.mjs"),
                  ).href
                : pathToFileURL(path.join(checkout, "web/assets", specifier))
                      .href;
            chunks.push(
                statement
                    .getText(source)
                    .replace(
                        statement.moduleSpecifier.getText(source),
                        JSON.stringify(url),
                    ),
            );
        } else if (
            ts.isExpressionStatement(statement) &&
            statement
                .getText(source)
                .startsWith("pdfjsLib.GlobalWorkerOptions.workerSrc")
        ) {
            continue;
        } else chunks.push(text.slice(statement.getFullStart(), statement.end));
    }
    const upstream = await import(
        `data:text/javascript;base64,${Buffer.from(chunks.join("\n")).toString("base64")}`
    );
    const baseline = await upstream.extractDocument(fixturePdf().buffer);
    try {
        const view = (doc) =>
            doc.pages.map((page) => ({
                number: page.number,
                width: page.width,
                height: page.height,
                blocks: page.blocks,
            }));
        const exporter = await import(
            pathToFileURL(path.join(checkout, "web/assets/export.js")).href
        );
        await writeFile(
            new URL("extraction-parity.json", fixtures),
            JSON.stringify(
                {
                    revision: "f9e92cbc0224d1413c11dda15b284ee41b9fc48f",
                    baselinePdfjs: "4.10.38",
                    localPdfjs: "5.3.31",
                    pages: view(baseline.doc),
                    markdown: exporter.toMarkdown(baseline.doc, {
                        math: "latex",
                        images: "none",
                    }),
                },
                null,
                2,
            ) + "\n",
        );
    } finally {
        await baseline.pdf.destroy();
    }
}

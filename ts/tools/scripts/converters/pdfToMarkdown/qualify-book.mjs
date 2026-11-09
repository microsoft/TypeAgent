// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const parent = new URL(
    "../../../../packages/agents/browserControlRpc/",
    import.meta.url,
);
const require = createRequire(new URL("package.json", parent));
const ts = require("typescript");
const runtime = new URL("src/converters/pdfToMarkdown/", parent);

const [book, checkout, output, mode = "compare"] = process.argv.slice(2);
if (!book || !checkout || !output)
    throw new Error(
        "Usage: node qualify-book.mjs <local-pdf> <pinned-checkout> <private-output-directory>",
    );
Object.assign(globalThis, require("@napi-rs/canvas"));
assert.equal(
    execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
        encoding: "utf8",
    }).trim(),
    "f9e92cbc0224d1413c11dda15b284ee41b9fc48f",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
await mkdir(output, { recursive: true });

if (mode === "compare") {
    for (const variant of ["baseline", "adapted", "production"])
        execFileSync(
            process.execPath,
            [fileURLToPath(import.meta.url), book, checkout, output, variant],
            { stdio: "inherit" },
        );
    const baseline = JSON.parse(
        await readFile(path.join(output, "baseline.json"), "utf8"),
    );
    const adapted = JSON.parse(
        await readFile(path.join(output, "adapted.json"), "utf8"),
    );
    const production = JSON.parse(
        await readFile(path.join(output, "production.json"), "utf8"),
    );
    const differingPages = adapted.pages
        .filter(
            (page, index) =>
                page.markdownHash !== baseline.pages[index]?.markdownHash,
        )
        .map((page) => page.number);
    const report = {
        revision: "f9e92cbc0224d1413c11dda15b284ee41b9fc48f",
        byteHash: baseline.byteHash,
        baseline: { ...baseline, pages: undefined },
        adapted: { ...adapted, pages: undefined },
        production: { ...production, pages: undefined },
        exactMarkdownParity: baseline.markdownHash === adapted.markdownHash,
        productionMarkdownParity:
            baseline.markdownHash === production.markdownHash,
        differingPages,
    };
    await writeFile(
        path.join(output, "comparison.json"),
        JSON.stringify(report, null, 2) + "\n",
    );
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    assert.equal(adapted.pageCount, baseline.pageCount);
    for (const result of [baseline, adapted, production]) {
        assert.equal(result.pageCount, 118);
        assert.equal(result.markdownChars, 273552);
        assert.equal(
            result.markdownHash,
            "a8befc8ef1023be20226910a05ee4ed78ebaef5256364e3f98357951c156d0e0",
        );
    }
    assert.equal(
        adapted.markdownHash,
        baseline.markdownHash,
        "Book Markdown differs from pinned upstream; inspect private comparison artifacts",
    );
    assert.equal(
        production.markdownHash,
        baseline.markdownHash,
        "Production adapter differs from pinned upstream",
    );
} else {
    let engine;
    let exporter;
    if (mode === "baseline") {
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
                          require.resolve(
                              "pdfjs-baseline/legacy/build/pdf.mjs",
                          ),
                      ).href
                    : pathToFileURL(
                          path.join(checkout, "web/assets", specifier),
                      ).href;
                chunks.push(
                    statement
                        .getText(source)
                        .replace(
                            statement.moduleSpecifier.getText(source),
                            JSON.stringify(url),
                        ),
                );
            } else if (
                !(
                    ts.isExpressionStatement(statement) &&
                    statement
                        .getText(source)
                        .startsWith("pdfjsLib.GlobalWorkerOptions.workerSrc")
                )
            ) {
                chunks.push(
                    text.slice(statement.getFullStart(), statement.end),
                );
            }
        }
        engine = await import(
            `data:text/javascript;base64,${Buffer.from(chunks.join("\n")).toString("base64")}`
        );
        exporter = await import(
            pathToFileURL(path.join(checkout, "web/assets/export.js")).href
        );
    } else {
        engine = await import(new URL("engine.js", runtime));
        exporter = await import(new URL("index.js", runtime));
    }
    const bytes = new Uint8Array(await readFile(book));
    const byteHash = hash(bytes);
    const start = performance.now();
    if (mode === "production") {
        const { openPdf } = await import(
            new URL("dist/converters/pdfToMarkdown/engine.js", parent)
        );
        const { extractPdfMarkdown, preparePdfCapture, serializePdfArtifact } =
            await import(new URL("dist/pdfMarkdown.js", parent));
        const pdf = await openPdf(bytes);
        try {
            const extracted = await extractPdfMarkdown(pdf, {
                byteHash,
                pdfjsVersion: "5.3.31",
            });
            const captured = await preparePdfCapture(
                JSON.parse(serializePdfArtifact(extracted.artifact)),
            );
            assert.equal(captured.markdown, extracted.markdown);
            assert.doesNotMatch(captured.markdown, /^---\n|^## Page \d+$/m);
            const report = {
                byteHash,
                pageCount: extracted.pageCount,
                markdownChars: captured.markdown.length,
                markdownHash: hash(captured.markdown),
                artifactDigest: captured.artifactDigest,
                elapsedMs: Math.round(performance.now() - start),
                peakRssBytes: process.resourceUsage().maxRSS * 1024,
                warnings: extracted.artifact.warnings,
            };
            await writeFile(
                path.join(output, "production.md"),
                captured.markdown,
            );
            await writeFile(
                path.join(output, "production.json"),
                JSON.stringify(report, null, 2) + "\n",
            );
            process.stdout.write(
                `production: ${report.pageCount} pages, ${report.markdownChars} characters, ${report.elapsedMs} ms\n`,
            );
        } finally {
            await pdf.destroy();
        }
        process.exit(0);
    }
    const result = await engine.extractDocument(bytes.buffer, {
        images: false,
        concurrency: 1,
    });
    try {
        const options = { math: "latex", images: "none", pageBreaks: false };
        const markdown = exporter.toMarkdown(result.doc, options);
        const counts = {};
        for (const page of result.doc.pages)
            for (const block of page.blocks)
                counts[block.type] = (counts[block.type] ?? 0) + 1;
        const report = {
            byteHash,
            pdfjs: mode === "baseline" ? "4.10.38" : "5.3.31",
            pageCount: result.doc.page_count,
            markdownChars: markdown.length,
            markdownHash: hash(markdown),
            blockCounts: counts,
            elapsedMs: Math.round(performance.now() - start),
            peakRssBytes: process.resourceUsage().maxRSS * 1024,
            warnings: result.doc.warnings,
            pages: result.doc.pages.map((page) => ({
                number: page.number,
                markdownHash: hash(
                    exporter.toMarkdown({ pages: [page] }, options),
                ),
            })),
        };
        await writeFile(path.join(output, `${mode}.md`), markdown);
        await writeFile(
            path.join(output, `${mode}.json`),
            JSON.stringify(report, null, 2) + "\n",
        );
        process.stdout.write(
            `${mode}: ${report.pageCount} pages, ${report.markdownChars} characters, ${report.elapsedMs} ms\n`,
        );
    } finally {
        if (result.destroy) await result.destroy();
        else await result.pdf.destroy();
    }
}

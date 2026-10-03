// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fixturePdf } from "./fixture.mjs";

const require = createRequire(new URL("../../package.json", import.meta.url));
const {
    DOMMatrix,
    ImageData,
    Path2D,
    createCanvas,
} = require("@napi-rs/canvas");
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const engine = await import("../../src/converters/pdfToMarkdown/engine.js");
const converter = await import("../../src/converters/pdfToMarkdown/index.js");
const papero = { ...engine, ...converter };
const { pdfjsLib } = engine;
const runtime = new URL("../../src/converters/pdfToMarkdown/", import.meta.url);
const tooling = new URL(
    "../../../../../tools/scripts/converters/pdfToMarkdown/",
    import.meta.url,
);

test("production converter exports only the caller-owned document and Markdown API", () => {
    assert.deepEqual(Object.keys(converter).sort(), [
        "extractExistingDocument",
        "figureWords",
        "toMarkdown",
    ]);
});

test("public declarations match the three runtime function exports", async () => {
    const ts = require("typescript");
    const text = await readFile(new URL("index.d.ts", runtime), "utf8");
    const source = ts.createSourceFile(
        "index.d.ts",
        text,
        ts.ScriptTarget.Latest,
        true,
    );
    const exports = source.statements
        .filter((statement) => ts.isFunctionDeclaration(statement))
        .map((statement) => statement.name.text)
        .sort();
    assert.deepEqual(exports, Object.keys(converter).sort());
});

test("engine imports local PDF.js and serializes Markdown math", () => {
    assert.equal(papero.SCHEMA, "pdf-text-api/document@1");
    assert.equal(
        papero.toMarkdown(
            {
                pages: [
                    {
                        number: 1,
                        blocks: [
                            { type: "heading", level: 1, text: "Papero smoke" },
                            { type: "formula", latex: "x^{2}", number: "(1)" },
                        ],
                    },
                ],
            },
            { math: "latex", images: "none" },
        ),
        "# Papero smoke\n\n$$\nx^{2} \\tag{1}\n$$\n",
    );
});

test("PDF.js 5.3.31 extracts local glyphs, transforms, and rules", async () => {
    const workerSrc = pdfjsLib.GlobalWorkerOptions.workerSrc;
    const data = fixturePdf().buffer;
    const expectedBytes = new Uint8Array(data).slice();
    const result = await papero.extractDocument(data, {
        retainPdf: false,
        getDocumentOptions: { useSystemFonts: true, disableFontFace: true },
    });
    assert.equal(pdfjsLib.version, "5.3.31");
    assert.equal(pdfjsLib.GlobalWorkerOptions.workerSrc, workerSrc);
    assert.deepEqual(new Uint8Array(data), expectedBytes);
    assert.equal(result.pdf, null);
    assert.equal(result.doc.page_count, 1);
    assert.equal(result.doc.pages_extracted, 1);
    assert.match(
        papero.toMarkdown(result.doc),
        /Operator glyph text with local PDF\.js\./,
    );
    assert.match(
        papero.toMarkdown(result.doc),
        /Ro<sub>tat<\/sub>ed<sup>text<\/sup>/,
    );
    assert.ok(
        result.doc.pages[0].blocks.some((block) => block.type === "table"),
    );
    const expected = JSON.parse(
        await readFile(
            new URL("./extraction-parity.json", import.meta.url),
            "utf8",
        ),
    );
    assert.deepEqual(
        result.doc.pages.map((page) => ({
            number: page.number,
            width: page.width,
            height: page.height,
            blocks: page.blocks,
        })),
        expected.pages,
    );
    assert.equal(
        papero.toMarkdown(result.doc, { math: "latex", images: "none" }),
        expected.markdown,
    );
    await result.destroy();
});

test("rendered crops use public operator lists and release all canvases", async () => {
    const previousDocument = globalThis.document;
    const canvases = [];
    globalThis.document = {
        createElement(name) {
            assert.equal(name, "canvas");
            const canvas = createCanvas(1, 1);
            const requested = { width: 1, height: 1 };
            for (const dimension of ["width", "height"]) {
                const descriptor = Object.getOwnPropertyDescriptor(
                    Object.getPrototypeOf(canvas),
                    dimension,
                );
                Object.defineProperty(canvas, dimension, {
                    get() {
                        return descriptor.get.call(this);
                    },
                    set(value) {
                        requested[dimension] = value;
                        descriptor.set.call(this, value);
                    },
                });
            }
            canvases.push(requested);
            return canvas;
        },
    };
    try {
        const result = await papero.extractDocument(fixturePdf(), {
            images: true,
            retainPdf: false,
            getDocumentOptions: { useSystemFonts: true, disableFontFace: true },
        });
        const table = result.doc.pages[0].blocks.find(
            (block) => block.type === "table",
        );
        assert.equal(table.image.mime, "image/png");
        assert.ok(table.image.data.length > 0);
        assert.ok(table.image.width > 0 && table.image.height > 0);
        assert.ok(canvases.length >= 2);
        assert.ok(
            canvases.every(
                (canvas) => canvas.width === 0 && canvas.height === 0,
            ),
        );
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test("destroying an extraction leaves an injected PDFWorker caller-owned", async () => {
    const worker = new pdfjsLib.PDFWorker();
    await worker.promise;
    try {
        const result = await papero.extractDocument(fixturePdf(), {
            worker,
            retainPdf: false,
            getDocumentOptions: { useSystemFonts: true, disableFontFace: true },
        });
        assert.equal(result.pdf, null);
        assert.equal(worker.destroyed, false);
    } finally {
        worker.destroy();
    }
});

function fakeLoading({
    count = 8,
    failPage,
    pending = false,
    password = false,
} = {}) {
    let active = 0;
    let maximum = 0;
    let destroys = 0;
    let opens = 0;
    let parameters;
    let task;
    const pdf = {
        numPages: count,
        async getMetadata() {
            return { info: {} };
        },
        async getPage(number) {
            active++;
            maximum = Math.max(maximum, active);
            return {
                getViewport() {
                    return {
                        width: 600,
                        height: 800,
                        transform: [1, 0, 0, -1, 0, 800],
                    };
                },
                async getOperatorList() {
                    await new Promise(setImmediate);
                    if (number === failPage)
                        throw new Error("fixture page failure");
                    return { fnArray: [], argsArray: [] };
                },
                async getTextContent() {
                    return { items: [], styles: {} };
                },
                cleanup() {
                    active--;
                },
            };
        },
    };
    const getDocument = (input) => {
        opens++;
        parameters = input;
        task = {
            promise: pending
                ? new Promise(() => {})
                : password
                  ? new Promise((resolve) =>
                        setImmediate(() =>
                            task.onPassword((value) => {
                                assert.equal(value, "transient password");
                                resolve(pdf);
                            }, 1),
                        ),
                    )
                  : Promise.resolve(pdf),
            async destroy() {
                destroys++;
            },
        };
        return task;
    };
    return {
        getDocument,
        stats: () => ({ maximum, destroys, opens, parameters }),
        pdf,
    };
}

for (const concurrency of [undefined, 1, 2, 4]) {
    test(`one PDF with bounded concurrency ${concurrency ?? "default"}`, async () => {
        const fake = fakeLoading();
        const progress = [];
        const result = await papero.extractDocument(new Uint8Array([1]), {
            ...(concurrency === undefined ? {} : { concurrency }),
            getDocument: fake.getDocument,
            onProgress: (done, total) => progress.push([done, total]),
        });
        assert.equal(fake.stats().opens, 1);
        assert.equal(fake.stats().maximum, concurrency ?? 1);
        assert.deepEqual(
            result.doc.pages.map((page) => page.number),
            [1, 2, 3, 4, 5, 6, 7, 8],
        );
        assert.deepEqual(
            progress,
            Array.from({ length: 8 }, (_, index) => [index + 1, 8]),
        );
        assert.equal(result.pdf, fake.pdf);
        await Promise.all([result.destroy(), result.destroy()]);
        assert.equal(fake.stats().destroys, 1);
    });
}

test("invalid concurrency and already-aborted input never open a PDF", async () => {
    const fake = fakeLoading();
    for (const concurrency of [0, 5, 1.5, NaN]) {
        await assert.rejects(
            papero.extractDocument(new Uint8Array(), {
                concurrency,
                getDocument: fake.getDocument,
            }),
            RangeError,
        );
    }
    await assert.rejects(
        papero.extractDocument(new Uint8Array(), {
            signal: AbortSignal.abort(),
            getDocument: fake.getDocument,
        }),
        { name: "AbortError" },
    );
    assert.equal(fake.stats().opens, 0);
});

test("abort during loading rejects even when an injected loading promise remains pending", async () => {
    const fake = fakeLoading({ pending: true });
    const controller = new AbortController();
    const extraction = papero.extractDocument(new Uint8Array(), {
        signal: controller.signal,
        getDocument: fake.getDocument,
    });
    await new Promise(setImmediate);
    controller.abort();
    await assert.rejects(extraction, { name: "AbortError" });
    assert.equal(fake.stats().destroys, 1);
});

test("abort between pages prevents stale progress and destroys the task", async () => {
    const fake = fakeLoading();
    const controller = new AbortController();
    let progress = 0;
    await assert.rejects(
        papero.extractDocument(new Uint8Array(), {
            signal: controller.signal,
            getDocument: fake.getDocument,
            onProgress() {
                progress++;
                controller.abort();
            },
        }),
        { name: "AbortError" },
    );
    assert.equal(progress, 1);
    assert.equal(fake.stats().destroys, 1);
});

test("page failure and invalid page selection destroy the task", async () => {
    for (const options of [{ failPage: 2 }, {}]) {
        const fake = fakeLoading(options);
        await assert.rejects(
            papero.extractDocument(new Uint8Array(), {
                getDocument: fake.getDocument,
                ...(options.failPage ? {} : { pages: "99" }),
            }),
        );
        assert.equal(fake.stats().destroys, 1);
    }
});

test("injected worker, font options, and passwords stay at the loading boundary", async () => {
    const fake = fakeLoading({ password: true, count: 1 });
    const worker = {};
    const result = await papero.extractDocument(new Uint8Array(), {
        getDocument: fake.getDocument,
        getDocumentOptions: {
            url: "https://invalid.example/no-fetch.pdf",
            fontExtraProperties: false,
            isEvalSupported: true,
            disableFontFace: true,
        },
        worker,
        password: "transient password",
        onPassword(updatePassword, reason) {
            assert.equal(reason, 1);
            updatePassword("transient password");
        },
        retainPdf: false,
    });
    assert.equal(fake.stats().parameters.worker, worker);
    assert.equal(fake.stats().parameters.password, "transient password");
    assert.equal(fake.stats().parameters.fontExtraProperties, true);
    assert.equal(fake.stats().parameters.isEvalSupported, false);
    assert.equal(fake.stats().parameters.disableFontFace, true);
    assert.equal(fake.stats().parameters.url, undefined);
    assert.ok(!JSON.stringify(result.doc).includes("transient password"));
    assert.equal(fake.stats().destroys, 1);
});

test("openPdf retains the upstream PDF proxy return contract", async () => {
    const fake = fakeLoading({ count: 1 });
    const pdf = await papero.openPdf(new Uint8Array(), {
        getDocument: fake.getDocument,
    });
    assert.equal(pdf, fake.pdf);
    assert.equal(fake.stats().destroys, 0);
});

test("caller-owned extraction aborts pending page work without destroying the viewer proxy", async () => {
    const fake = fakeLoading({ count: 1 });
    let release;
    let reached;
    const started = new Promise((resolve) => {
        reached = resolve;
    });
    const original = fake.pdf.getPage;
    fake.pdf.getPage = async (number) => {
        reached();
        await new Promise((resolve) => {
            release = resolve;
        });
        return original(number);
    };
    const controller = new AbortController();
    const progress = [];
    const pending = papero.extractExistingDocument(fake.pdf, {
        signal: controller.signal,
        onProgress: (done) => progress.push(done),
    });
    await started;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(fake.stats().destroys, 0);
    release();
    await new Promise(setImmediate);
    assert.deepEqual(progress, []);
    assert.ok(await original(1));
});

test("loading errors are classified and cleaned up", async () => {
    for (const [name, code] of [
        ["PasswordException", "encrypted_pdf"],
        ["InvalidPDFException", "invalid_pdf"],
    ]) {
        let destroys = 0;
        await assert.rejects(
            papero.extractDocument(new Uint8Array(), {
                getDocument: () => ({
                    promise: Promise.reject(
                        Object.assign(new Error("fixture"), { name }),
                    ),
                    async destroy() {
                        destroys++;
                    },
                }),
            }),
            { code },
        );
        assert.equal(destroys, 1);
    }
});

test("copied source hashes, helper preservation, and patch records are current", async () => {
    const manifest = JSON.parse(
        await readFile(new URL("source-manifest.json", runtime), "utf8"),
    );
    assert.equal(manifest.revision, "f9e92cbc0224d1413c11dda15b284ee41b9fc48f");
    for (const file of manifest.files) {
        const bytes = await readFile(new URL(file.localPath, runtime));
        assert.equal(
            createHash("sha256").update(bytes).digest("hex"),
            file.vendoredSha256,
            file.localPath,
        );
        if (!file.patch) assert.equal(file.vendoredSha256, file.originalSha256);
        else
            assert.match(
                await readFile(new URL(file.patch, tooling), "utf8"),
                /^diff --git /,
            );
        if (file.localPath.endsWith(".js")) {
            const text = bytes.toString("utf8");
            assert.ok(
                text.startsWith(
                    "// Copyright (c) 2026 Beatriz Almeida.\n// Licensed under the MIT License; see LICENSE.\n",
                ),
            );
            assert.ok(
                text.includes(
                    `/blob/${manifest.revision}/${file.upstreamPath}`,
                ),
            );
            assert.ok(
                text.includes(
                    "TypeAgent modifications: Copyright (c) Microsoft Corporation.",
                ),
            );
            if (
                [
                    "columns.js",
                    "symbols.js",
                    "texfonts.js",
                    "mathtext.js",
                ].includes(file.localPath)
            ) {
                const originalBody = text.split("\n").slice(5).join("\n");
                assert.equal(
                    createHash("sha256").update(originalBody).digest("hex"),
                    file.originalSha256,
                );
            }
        }
    }
    for (const file of manifest.localAdapters) {
        const bytes = await readFile(new URL(file.localPath, runtime));
        assert.equal(
            createHash("sha256").update(bytes).digest("hex"),
            file.sha256,
            file.localPath,
        );
    }
});

test("recorded patches reconstruct the exact pinned upstream bytes", async (context) => {
    const temporary = await mkdtemp(
        path.join(os.tmpdir(), "pdf-to-markdown-patch-validation-"),
    );
    context.after(() => rm(temporary, { recursive: true, force: true }));
    const manifest = JSON.parse(
        await readFile(new URL("source-manifest.json", runtime), "utf8"),
    );
    for (const file of manifest.files.filter((file) => file.patch)) {
        const target = path.join(temporary, file.localPath);
        await copyFile(new URL(file.localPath, runtime), target);
        execFileSync(
            "git",
            [
                "-c",
                "core.autocrlf=false",
                "-c",
                "core.eol=lf",
                "apply",
                "--reverse",
                "--",
                fileURLToPath(new URL(file.patch, tooling)),
            ],
            { cwd: temporary, stdio: "pipe" },
        );
        assert.equal(
            createHash("sha256")
                .update(await readFile(target))
                .digest("hex"),
            file.originalSha256,
            file.localPath,
        );
    }
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { getDocument, version } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
    extractPdfMarkdown,
    PDF_EXTRACTOR_VERSION,
    preparePdfCapture,
} from "@typeagent/browser-control-rpc/pdfMarkdown";
import {
    FIXTURE_VERSION,
    largeDocumentHtml,
    imageHeavyAssets,
    sha256,
    withPdfGenerator,
} from "./fixtures.mjs";

export const thresholds = {
    totalMsPerPage: 180,
    loadMs: 5000,
    heapGrowthMiB: 192,
    rssGrowthMiB: 384,
    maxTimerGapMs: 500,
    cancelMs: 250,
    regressionRatio: 1.5,
};
const mib = (value) => value / (1024 * 1024);
const measurement =
    "Fresh Node process per size and fixture family; installed PDF.js legacy Node entrypoint. Memory peaks sampled every 10ms during load/extract/prepare only; includes public operator inspection and any image-resource decoding it performs, excludes Chromium generation, viewer canvas rendering, checkpoints and cancellation reruns. Cancellation probes run on warm pages at page 3 and immediately after the final-page progress callback. Image-heavy family embeds eight distinct deterministic 800x600 noise rasters, reused across pages alongside digital text.";

async function cancellation(doc, page, deferAbort = false) {
    const controller = new AbortController();
    let requested;
    let completed = 0;
    const start = performance.now();
    await assert.rejects(
        extractPdfMarkdown(
            doc,
            (done) => {
                completed = done;
                if (done === page) {
                    const abort = () => {
                        requested = performance.now();
                        controller.abort();
                    };
                    if (deferAbort) setTimeout(abort, 0);
                    else abort();
                }
            },
            { signal: controller.signal },
        ),
        { name: "AbortError" },
    );
    assert.equal(
        completed,
        page,
        "no pages completed after cancellation boundary",
    );
    assert.ok(requested !== undefined);
    return {
        latencyMs: performance.now() - requested,
        completedPages: completed,
        elapsedMs: performance.now() - start,
    };
}

async function measure(path) {
    globalThis.gc?.();
    const initial = process.memoryUsage();
    let peakHeap = initial.heapUsed;
    let peakRss = initial.rss;
    let maxTimerGap = 0;
    let ticks = 0;
    let lastTick = performance.now();
    const sample = () => {
        const now = performance.now();
        maxTimerGap = Math.max(maxTimerGap, now - lastTick);
        lastTick = now;
        const memory = process.memoryUsage();
        peakHeap = Math.max(peakHeap, memory.heapUsed);
        peakRss = Math.max(peakRss, memory.rss);
        ticks++;
    };
    const timer = setInterval(sample, 10);
    let doc;
    try {
        const bytes = await readFile(path);
        const options = { byteHash: sha256(bytes), pdfjsVersion: version };
        const start = performance.now();
        doc = await getDocument({
            data: new Uint8Array(bytes),
            fontExtraProperties: true,
            isEvalSupported: false,
        }).promise;
        const loaded = performance.now();
        const progress = [];
        let pageBoundaryYields = 0;
        const result = await extractPdfMarkdown(
            doc,
            (done) => {
                assert.equal(
                    pageBoundaryYields,
                    done - 1,
                    "each preceding page yielded",
                );
                progress.push(done);
                setTimeout(() => pageBoundaryYields++, 0);
            },
            options,
        );
        const extracted = performance.now();
        const capture = await preparePdfCapture(result.artifact);
        const finished = performance.now();
        sample();
        clearInterval(timer);
        assert.deepEqual(
            progress,
            Array.from({ length: doc.numPages }, (_, index) => index + 1),
        );
        assert.equal(result.emptyPages.length, 0);
        assert.ok(result.artifact.coverage.every((coverage) => coverage === 1));
        assert.equal(
            result.artifact.semanticDocument.pages.length,
            doc.numPages,
        );
        assert.equal(capture.markdown, result.markdown);
        assert.deepEqual(capture.locationMap.entries, []);
        for (let page = 1; page <= doc.numPages; page++) {
            const semanticPage =
                result.artifact.semanticDocument.pages[page - 1];
            const text = semanticPage.blocks
                .map((block) => block.text)
                .join("\n");
            assert.ok(text.includes(`Document section ${page}`));
            let previous = -1;
            for (let row = 1; row <= 12; row++) {
                const position = text.indexOf(
                    `P${page}C1R${row}`,
                    previous + 1,
                );
                assert.ok(
                    position > previous,
                    `semantic order on page ${page}, row ${row}`,
                );
                previous = position;
            }
        }
        const cancel = await cancellation(doc, 3);
        const postLastPageCancel = await cancellation(doc, doc.numPages, true);
        return {
            pages: doc.numPages,
            bytes: bytes.length,
            byteHash: options.byteHash,
            artifactDigest: capture.artifactDigest,
            blocks: result.artifact.blocks.length,
            semanticPages: result.artifact.semanticDocument.pages.length,
            loadMs: loaded - start,
            extractionMs: extracted - loaded,
            preparationMs: finished - extracted,
            totalMs: finished - start,
            initialHeapMiB: mib(initial.heapUsed),
            peakHeapMiB: mib(peakHeap),
            heapGrowthMiB: mib(peakHeap - initial.heapUsed),
            initialRssMiB: mib(initial.rss),
            peakRssMiB: mib(peakRss),
            rssGrowthMiB: mib(peakRss - initial.rss),
            maxTimerGapMs: maxTimerGap,
            timerTicks: ticks,
            pageBoundaryYields,
            cancel,
            postLastPageCancel,
        };
    } finally {
        clearInterval(timer);
        await doc?.destroy();
    }
}

export function checkMetrics(metric, baseline) {
    for (const name of [
        "loadMs",
        "extractionMs",
        "preparationMs",
        "totalMs",
        "heapGrowthMiB",
        "rssGrowthMiB",
        "maxTimerGapMs",
        "timerTicks",
        "pageBoundaryYields",
    ]) {
        assert.ok(
            Number.isFinite(metric[name]) && metric[name] >= 0,
            `valid ${name}`,
        );
    }
    assert.ok(
        Number.isFinite(metric.cancel?.latencyMs),
        "valid cancellation latency",
    );
    assert.ok(
        Number.isFinite(metric.postLastPageCancel?.latencyMs),
        "valid final cancellation latency",
    );
    assert.ok(metric.loadMs <= thresholds.loadMs, "load deadline");
    assert.ok(
        metric.totalMs <=
            thresholds.loadMs + thresholds.totalMsPerPage * metric.pages,
        "per-page completion budget",
    );
    assert.ok(
        metric.heapGrowthMiB <= thresholds.heapGrowthMiB,
        "heap growth budget",
    );
    assert.ok(
        metric.rssGrowthMiB <= thresholds.rssGrowthMiB,
        "RSS growth budget",
    );
    assert.ok(
        metric.maxTimerGapMs <= thresholds.maxTimerGapMs,
        "event-loop stall budget",
    );
    assert.ok(
        Number.isSafeInteger(metric.timerTicks) && metric.timerTicks > 0,
        "event loop sampling runs during extraction",
    );
    assert.equal(
        metric.pageBoundaryYields,
        metric.pages,
        "event loop yields at every page boundary",
    );
    assert.ok(
        metric.cancel.latencyMs <= thresholds.cancelMs,
        "page boundary cancellation deadline",
    );
    assert.ok(
        metric.postLastPageCancel.latencyMs <= thresholds.cancelMs,
        "post-last-page cancellation deadline",
    );
    if (baseline) {
        assert.equal(
            metric.byteHash,
            baseline.byteHash,
            "baseline fixture must be identical",
        );
        assert.equal(
            metric.artifactDigest,
            baseline.artifactDigest,
            "content changed: review quality before accepting baseline",
        );
        for (const name of ["totalMs", "heapGrowthMiB", "rssGrowthMiB"]) {
            assert.ok(
                metric[name] <= baseline[name] * thresholds.regressionRatio,
                `${name} regression exceeds 50%`,
            );
        }
    }
}

function childMeasure(path) {
    return new Promise((resolveResult, reject) => {
        const child = fork(fileURLToPath(import.meta.url), ["--worker", path], {
            execArgv: ["--expose-gc"],
            stdio: ["ignore", "inherit", "inherit", "ipc"],
        });
        let result;
        child.on("message", (message) => {
            result = message;
        });
        child.on("error", reject);
        child.on("exit", (code) =>
            code === 0 && result
                ? resolveResult(result)
                : reject(new Error(`Benchmark worker exited ${code}`)),
        );
    });
}

async function main() {
    const output = resolve(process.argv[2] ?? "tmp/pdf-extraction-benchmark");
    const resume = process.argv.includes("--resume")
        ? JSON.parse(await readFile(resolve(output, "report.json"), "utf8"))
        : undefined;
    const baseline =
        process.argv[3] && process.argv[3] !== "--resume"
            ? JSON.parse(await readFile(process.argv[3], "utf8"))
            : undefined;
    const report = {
        fixtureVersion: FIXTURE_VERSION,
        pdfjsVersion: version,
        extractorVersion: PDF_EXTRACTOR_VERSION,
        nodeVersion: process.version,
        platform: process.platform,
        measurement,
        thresholds,
        metrics: [],
        unsupported: [
            "OCR",
            "browser-process peak memory",
            "browser image-rendering performance",
        ],
    };
    await mkdir(output, { recursive: true });
    await withPdfGenerator(async (generator) => {
        report.chromiumVersion = generator.browserVersion;
        for (const previous of [baseline, resume].filter(Boolean)) {
            for (const field of [
                "fixtureVersion",
                "pdfjsVersion",
                "extractorVersion",
                "nodeVersion",
                "platform",
                "chromiumVersion",
            ])
                assert.equal(
                    report[field],
                    previous[field],
                    `incompatible baseline ${field}`,
                );
        }
        const images = await imageHeavyAssets(generator);
        for (const fixture of ["text", "image-heavy"]) {
            for (const pages of [100, 300, 500]) {
                const html = largeDocumentHtml(
                    pages,
                    fixture === "image-heavy" ? images : [],
                );
                const bytes = await generator.generate(html);
                assert.equal(
                    sha256(await generator.generate(html)),
                    sha256(bytes),
                    "large PDF bytes must be deterministic",
                );
                const path = resolve(output, `${fixture}-${pages}-pages.pdf`);
                const retained = resume?.metrics.find(
                    (entry) =>
                        entry.fixture === fixture && entry.pages === pages,
                );
                if (retained) {
                    assert.equal(
                        retained.byteHash,
                        sha256(bytes),
                        "resumed fixture bytes must match",
                    );
                    assert.equal(
                        sha256(await readFile(path)),
                        retained.byteHash,
                        "persisted fixture bytes must match",
                    );
                    checkMetrics(retained);
                }
                await writeFile(path, bytes);
                const metric = retained ?? {
                    fixture,
                    ...(await childMeasure(path)),
                };
                report.metrics.push(metric);
                await writeFile(
                    resolve(output, "report.json"),
                    JSON.stringify(report, null, 2),
                );
                process.stdout.write(`${JSON.stringify(metric)}\n`);
                checkMetrics(
                    metric,
                    baseline?.metrics.find(
                        (entry) =>
                            entry.pages === pages && entry.fixture === fixture,
                    ),
                );
            }
        }
    });
    for (let index = 1; index < report.metrics.length; index++) {
        const previous = report.metrics[index - 1];
        const current = report.metrics[index];
        if (current.fixture !== previous.fixture) continue;
        assert.ok(
            current.extractionMs / current.pages <=
                (1.5 * previous.extractionMs) / previous.pages,
            "superlinear extraction regression",
        );
    }
    report.status = "passed";
    await writeFile(
        resolve(output, "report.json"),
        JSON.stringify(report, null, 2),
    );
    process.stdout.write(
        `Passed benchmark gates; report: ${resolve(output, "report.json")}\n`,
    );
}

async function checkReport(path, baselinePath) {
    const report = JSON.parse(await readFile(path, "utf8"));
    const baseline = baselinePath
        ? JSON.parse(await readFile(baselinePath, "utf8"))
        : undefined;
    assert.deepEqual(
        report.metrics.map((metric) => [metric.fixture, metric.pages]),
        ["text", "image-heavy"].flatMap((fixture) =>
            [100, 300, 500].map((pages) => [fixture, pages]),
        ),
    );
    if (baseline) {
        for (const field of [
            "fixtureVersion",
            "pdfjsVersion",
            "extractorVersion",
            "nodeVersion",
            "platform",
            "chromiumVersion",
        ])
            assert.equal(
                report[field],
                baseline[field],
                `incompatible baseline ${field}`,
            );
    }
    for (const metric of report.metrics)
        checkMetrics(
            metric,
            baseline?.metrics.find(
                (entry) =>
                    entry.pages === metric.pages &&
                    entry.fixture === metric.fixture,
            ),
        );
    for (let index = 1; index < report.metrics.length; index++) {
        const previous = report.metrics[index - 1];
        const current = report.metrics[index];
        if (current.fixture !== previous.fixture) continue;
        assert.ok(
            current.extractionMs / current.pages <=
                (thresholds.regressionRatio * previous.extractionMs) /
                    previous.pages,
            "superlinear extraction regression",
        );
    }
    report.status = "passed";
    report.regressionBaseline = baselinePath;
    report.measurement = measurement;
    report.unsupported = report.unsupported.map((entry) =>
        entry === "table structure"
            ? "untagged table structure"
            : entry === "image decoding/rendering performance"
              ? "browser image-rendering performance"
              : entry,
    );
    await writeFile(path, JSON.stringify(report, null, 2));
    process.stdout.write(
        "All persisted benchmark metrics and regression gates passed.\n",
    );
}

if (process.argv[2] === "--check") {
    checkReport(process.argv[3], process.argv[4]).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
} else if (process.argv[2] === "--worker") {
    measure(process.argv[3])
        .then((metric) => process.send(metric))
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        });
} else if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

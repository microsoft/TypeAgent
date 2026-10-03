// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.argv[2]);
const report = JSON.parse(
    await readFile(resolve(root, "viewer-acceptance.json"), "utf8"),
);
const retained = JSON.parse(
    await readFile(resolve(root, "benchmark/report.json"), "utf8"),
);
assert.deepEqual(
    report.browserMetrics.map(({ fixture, pages }) => [fixture, pages]),
    ["text", "image-heavy"].flatMap((fixture) =>
        [100, 300, 500].map((pages) => [fixture, pages]),
    ),
);
for (const metric of report.browserMetrics) {
    for (const field of [
        "loadMs",
        "totalMs",
        "extractionAndPreparationMs",
        "maxTimerGapMs",
        "timerTicks",
    ])
        assert.ok(Number.isFinite(metric[field]) && metric[field] >= 0, field);
    assert.ok(metric.loadMs <= report.thresholds.loadMs);
    assert.ok(
        metric.totalMs <=
            report.thresholds.totalMsBase +
                report.thresholds.totalMsPerPage * metric.pages,
    );
    assert.ok(metric.maxTimerGapMs <= report.thresholds.maxTimerGapMs);
    assert.ok(metric.timerTicks >= metric.pages);
    assert.equal(metric.blocks, metric.pages * 15);
    assert.equal(metric.locationEntries, metric.pages * 13);
    const previous = retained.metrics.find(
        (entry) =>
            entry.fixture === metric.fixture && entry.pages === metric.pages,
    );
    assert.ok(previous);
    const bytes = await readFile(
        resolve(
            root,
            "benchmark",
            `${metric.fixture}-${metric.pages}-pages.pdf`,
        ),
    );
    assert.equal(bytes.length, metric.bytes);
    assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        previous.byteHash,
    );
}
const resume = report.reloadResume;
assert.deepEqual(
    resume.initialTextReads,
    Array.from({ length: 10 }, (_, index) => index + 1),
);
assert.equal(resume.exactOrderedPages11Through300, true);
assert.equal(resume.resumeTextReadCount, 290);
assert.equal(resume.firstResumeTextRead, 11);
assert.equal(resume.lastResumeTextRead, 300);
assert.equal(resume.checkpointsBeforeReload, 10);
assert.equal(resume.checkpointsAfterReload, 10);
assert.equal(resume.completedCheckpointCount, 300);
assert.ok(report.smoke.textCanvas.nonwhitePixels > 0);
assert.ok(report.smoke.cropCanvas.nonwhitePixels > 0);
assert.ok(report.smoke.imageHeavyCanvas.coloredPixels > 0);
assert.equal(report.smoke.allOverlayBoxesWithinPage, true);
assert.equal(report.smoke.mobileInspectionControlsWithinViewport, true);
assert.equal(report.smoke.mobileAnnotationControlsWithinViewport, true);
for (const screenshot of report.smoke.screenshots)
    assert.ok((await stat(resolve(root, screenshot))).size > 1000);
process.stdout.write(
    "Six browser timing gates, six fixture hashes, reload evidence and two screenshot artifacts verified.\n",
);

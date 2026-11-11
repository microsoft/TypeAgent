// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { ViewHistory } from "../../packages/memory/service/dist/viewHistory.js";
import {
    ViewBuildRunner,
    ViewBuildStaleError,
} from "../../packages/memory/service/dist/viewBuilds.js";
import { wikiPageContext } from "../../packages/memory/service/dist/wikiAdmission.js";
import { createLatencyWikiJob } from "../../packages/memory/service/dist/latencyQualificationFixture.js";
import { hashValue } from "./replay-artifacts.mjs";
import { recordWikiDiagnostics } from "./wiki-consolidation-qualification.mjs";

function contexts(input, versions) {
    return versions
        .filter((page) => page.viewId !== input.definition.viewId)
        .map((page) => wikiPageContext(input, page, undefined, false));
}

function boundInput(snapshot, pages) {
    const input = structuredClone(snapshot);
    input.influenceSources = [
        ...new Map(
            [
                ...(input.influenceSources ?? []),
                ...pages.flatMap((page) => page.contributingSources),
            ].map((source) => [
                JSON.stringify([source.sourceId, source.revisionId]),
                source,
            ]),
        ).values(),
    ];
    return input;
}

export async function replayRealWikiInventory(
    frozen,
    records,
    concurrency,
    mutation,
) {
    assert.ok([1, 2, 4].includes(concurrency));
    const selected = frozen.snapshots.filter((snapshot) =>
        frozen.inventories.every((versions) => {
            const pages = contexts(snapshot, versions);
            const saved = records.find(
                (row) =>
                    row.key ===
                    hashValue({ input: boundInput(snapshot, pages), pages }),
            );
            return (
                saved &&
                ["defer", "covered", "ambiguous"].includes(
                    saved.assessment.disposition,
                )
            );
        }),
    );
    assert.ok(
        selected.length >= 4,
        "Too few recorded non-generative targets; no fixture substitution",
    );
    const job = createLatencyWikiJob();
    job.jobId = "real-inventory-replay";
    job.corpusId = selected[0].corpusId;
    job.results = selected.map((snapshot) => ({
        viewId: snapshot.definition.viewId,
        state: "pending",
        reason: "Frozen real target",
        snapshot: structuredClone(snapshot),
    }));
    let inventory = mutation ? 0 : 1,
        active = 0,
        peak = 0,
        attempts = 0,
        discarded = 0;
    const receipts = [];
    const runner = new ViewBuildRunner(
        {
            identity: "captured-real-wiki-inventory",
            async assessWikiSubject(input, pages, signal) {
                const saved = records.find(
                    (row) => row.key === hashValue({ input, pages }),
                );
                assert.ok(
                    saved,
                    "Uncaptured real Wiki request; no provider fallback",
                );
                attempts++;
                active++;
                peak = Math.max(peak, active);
                try {
                    await delay(
                        Math.max(1, saved.elapsedMs * 0.005),
                        undefined,
                        { signal },
                    );
                    return structuredClone(saved.assessment);
                } finally {
                    active--;
                }
            },
            generate: async () => {
                throw new Error("Uncaptured generative target");
            },
            validate: async () => {
                throw new Error("Uncaptured support target");
            },
        },
        {
            current: async () => undefined,
            wikiPages: async (input) =>
                contexts(input, frozen.inventories[inventory]),
            async recordWikiAssessment(_job, result, assessment, pages) {
                const current = contexts(
                    result.snapshot,
                    frozen.inventories[inventory],
                );
                if (hashValue(current) !== hashValue(pages)) {
                    discarded++;
                    throw new ViewBuildStaleError(
                        "Captured real page inventory advanced",
                    );
                }
                result.state = "skipped";
                result.wikiAssessment = assessment;
                result.reason = assessment.reason;
                receipts.push({
                    viewId: result.viewId,
                    assessment: hashValue(assessment),
                });
                if (mutation && receipts.length === 1) inventory = 1;
            },
            update: async (_corpus, _id, update) => {
                update(job);
                return job;
            },
            materialize: async () => {
                throw new Error("Replay cannot publish");
            },
        },
        undefined,
        undefined,
        undefined,
        1,
        false,
        concurrency,
    );
    const start = performance.now();
    runner.start(job);
    try {
        await runner.wait(job.jobId, AbortSignal.timeout(120_000));
    } finally {
        await runner.close();
    }
    assert.equal(active, 0);
    assert.equal(job.state, "complete");
    assert.equal(receipts.length, selected.length);
    assert.ok(
        discarded <= concurrency - 1,
        "Wasted work exceeded the first stale window",
    );
    return {
        concurrency,
        mutation,
        receipts,
        attempts,
        discarded,
        peak,
        scaledReplayWallMs: performance.now() - start,
        publication: job.publication,
    };
}

async function main() {
    const { values } = parseArgs({
        options: {
            product: { type: "string" },
            history: { type: "string" },
            output: { type: "string" },
            authorization: { type: "string" },
        },
    });
    assert.ok(
        values.product &&
            values.history &&
            values.output &&
            values.authorization,
    );
    await mkdir(values.output);
    const { head, state } = await new ViewHistory(
        values.history,
        () => ({}),
    ).read();
    const versions = Object.values(state.views)
        .map((pages) => pages.at(-1))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    assert.ok(versions.length >= 2);
    const snapshots = Object.values(state.builds)
        .flatMap((job) => job.results)
        .filter((result) => result.wikiAssessment?.disposition === "defer")
        .slice(0, 6)
        .map((result) => result.snapshot);
    assert.equal(snapshots.length, 6);
    const frozen = {
        head,
        snapshots,
        inventories: [versions.slice(0, -1), versions],
    };
    await writeFile(
        path.join(values.output, "frozen.json"),
        JSON.stringify(frozen),
        { flag: "wx" },
    );
    const authorization = JSON.parse(
        await readFile(values.authorization, "utf8"),
    );
    const records = [];
    await recordWikiDiagnostics(
        values.product,
        hashValue(frozen),
        values.output,
        authorization,
        snapshots.length * 4,
        async (adapter, tape) => {
            for (const snapshot of snapshots)
                for (const inventory of frozen.inventories) {
                    const pages = contexts(snapshot, inventory);
                    const input = boundInput(snapshot, pages);
                    const start = performance.now();
                    const assessment = await adapter.assessWikiSubject(
                        input,
                        pages,
                        tape.signal,
                    );
                    records.push({
                        key: hashValue({ input, pages }),
                        assessment,
                        elapsedMs: performance.now() - start,
                    });
                    await writeFile(
                        path.join(values.output, "assessments.json"),
                        JSON.stringify(records),
                    );
                }
        },
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("Offline inventory replay attempted network access");
    };
    const samples = [];
    try {
        for (const mutation of [false, true])
            for (let sample = 0; sample < 10; sample++) {
                const order = sample % 2 ? [4, 2, 1] : [1, 2, 4];
                const arms = [];
                for (const concurrency of order)
                    arms.push(
                        await replayRealWikiInventory(
                            frozen,
                            records,
                            concurrency,
                            mutation,
                        ),
                    );
                const serial = arms.find((arm) => arm.concurrency === 1);
                for (const arm of arms)
                    assert.deepEqual(arm.receipts, serial.receipts);
                samples.push({ mutation, sample, arms });
            }
    } finally {
        globalThis.fetch = originalFetch;
    }
    await writeFile(
        path.join(values.output, "results.json"),
        JSON.stringify({
            frozenHash: hashValue(frozen),
            pageCounts: frozen.inventories.map((pages) => pages.length),
            observedModelAssessments: records.length,
            timeScale: 0.005,
            scope: "Real stored page inventories and fresh recorded model assessments. One scripted transition between retained inventories; native runner and guarded receipt replay, not live maintenance throughput or publication.",
            samples,
        }),
        { flag: "wx" },
    );
}

if (
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
    await main();

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
    qualifyWikiPairs,
    recordWikiDiagnostics,
    validateLiveAuthorization,
} from "./wiki-consolidation-qualification.mjs";
import { replayRealWikiInventory } from "./wiki-inventory-qualification.mjs";
import { createLatencyWikiJob } from "../../packages/memory/service/dist/latencyQualificationFixture.js";
import { wikiPageContext } from "../../packages/memory/service/dist/wikiAdmission.js";
import { hashValue } from "./replay-artifacts.mjs";

test("live authorization cannot be reset, extended, inferred or used after its absolute deadline", () => {
    const authorization = {
        authorizedByUser: true,
        automaticFailedArmReruns: false,
        totalWindowHours: 6,
        startedEpochMs: 1000,
        deadlineEpochMs: 1000 + 6 * 60 * 60_000,
    };
    assert.equal(
        validateLiveAuthorization(authorization, 1000),
        6 * 60 * 60_000,
    );
    for (const changes of [
        { authorizedByUser: false },
        { automaticFailedArmReruns: true },
        { totalWindowHours: 7 },
        { deadlineEpochMs: authorization.deadlineEpochMs + 1 },
    ])
        assert.throws(() =>
            validateLiveAuthorization({ ...authorization, ...changes }, 1000),
        );
    assert.throws(() => validateLiveAuthorization(authorization, 999));
    assert.throws(() =>
        validateLiveAuthorization(authorization, authorization.deadlineEpochMs),
    );
});

async function diagnosticProduct(t) {
    const root = await mkdtemp(path.join(tmpdir(), "wiki-deadline-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    const modules = [
        [["config"], "export function loadConfigSync() {}"],
        [
            ["aiclient"],
            `export function initRuntimeConfigFromProcessEnv() {}
             export const openai = { createChatModel: () => ({
                 complete: async () => "authored-fixture-response"
             }) };`,
        ],
        [
            ["memory", "service"],
            "export function createConfiguredViewSynthesisAdapter(_endpoint, _maximum, model) { return model; }",
        ],
    ];
    for (const [name, source] of modules) {
        const directory = path.join(root, "packages", ...name, "dist");
        await mkdir(directory, { recursive: true });
        await writeFile(
            path.join(
                directory,
                name.at(-1) === "service" ? "viewSynthesis.js" : "index.js",
            ),
            source,
        );
    }
    return root;
}

test("Wiki initialization consumes authorization time and each model call rechecks the deadline", async (t) => {
    const product = await diagnosticProduct(t);
    const startedEpochMs = Date.now() - 6 * 60 * 60_000 + 10_000;
    const deadlineEpochMs = startedEpochMs + 6 * 60 * 60_000;
    let reads = 0;
    let clock = deadlineEpochMs - 7000;
    t.mock.method(Date, "now", () =>
        reads++ === 0 ? deadlineEpochMs - 10_000 : clock,
    );
    await recordWikiDiagnostics(
        product,
        "authored-input",
        product,
        {
            authorizedByUser: true,
            automaticFailedArmReruns: false,
            totalWindowHours: 6,
            startedEpochMs,
            deadlineEpochMs,
        },
        2,
        async (adapter, tape) => {
            assert.equal(tape.budget.timeoutMs, 7000);
            assert.equal(
                await adapter.complete([{ role: "user", content: "fixture" }]),
                "authored-fixture-response",
            );
            clock = deadlineEpochMs;
            await assert.rejects(
                async () => adapter.complete([]),
                /Live authorization expired/,
            );
            assert.equal(tape.providerCalls, 1);
        },
    );
});

test("modified frozen Wiki pairs fail before model/configuration initialization", async () => {
    await assert.rejects(
        qualifyWikiPairs("", { pairs: [], inputHash: "modified" }, "", {}),
        /Frozen Wiki inputs changed/,
    );
});

test("real-inventory runner drains stale windows, preserves receipts and rejects replay misses", async () => {
    const snapshots = createLatencyWikiJob()
        .results.slice(0, 6)
        .map((result) => result.snapshot);
    const page = {
        viewId: "retained-page",
        revisionId: "page-revision",
        definition: { wiki: { query: "open review", aliases: [] } },
        content: {
            title: "Open review",
            sections: [{ body: "The review remains open." }],
            citations: snapshots[0].inputs[0].passages,
        },
    };
    const frozen = { snapshots, inventories: [[], [page]] };
    const records = [];
    for (const snapshot of snapshots)
        for (const inventory of frozen.inventories) {
            const pages = inventory.map((version) =>
                wikiPageContext(snapshot, version, undefined, false),
            );
            const input = structuredClone(snapshot);
            input.influenceSources = [
                ...new Map(
                    pages
                        .flatMap((context) => context.contributingSources)
                        .map((source) => [
                            JSON.stringify([
                                source.sourceId,
                                source.revisionId,
                            ]),
                            source,
                        ]),
                ).values(),
            ];
            records.push({
                key: hashValue({ input, pages }),
                elapsedMs: 4,
                assessment: {
                    disposition: "defer",
                    purpose: "Incidental mention",
                    reason: "Too sparse",
                    canonicalViewId: "",
                    sharedFragmentIds: [],
                    essentialDistinctions: [],
                    ambiguousViewIds: [],
                },
            });
        }
    const serial = await replayRealWikiInventory(frozen, records, 1, true);
    for (const concurrency of [2, 4]) {
        const candidate = await replayRealWikiInventory(
            frozen,
            records,
            concurrency,
            true,
        );
        assert.deepEqual(candidate.receipts, serial.receipts);
        assert.equal(candidate.discarded, concurrency - 1);
        assert.equal(candidate.attempts, snapshots.length + concurrency - 1);
        assert.equal(candidate.publication, false);
    }
    await assert.rejects(
        replayRealWikiInventory(frozen, [], 2, false),
        /Too few recorded/,
    );
});

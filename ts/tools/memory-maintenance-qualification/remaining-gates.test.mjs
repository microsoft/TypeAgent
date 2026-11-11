// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    qualifyWikiPairs,
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

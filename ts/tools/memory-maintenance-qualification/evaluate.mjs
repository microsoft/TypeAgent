// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export function measureProgress(family, jobs, publications, subjects) {
    const descriptors = family.descriptors;
    const discovered = descriptors.map((entry) => entry.viewId);
    const scope = new Set(discovered);
    const results = jobs
        .flatMap((job) => job.results ?? [])
        .filter((result) => scope.has(result.viewId));
    const applied = [
        ...new Set(
            results
                .filter((result) =>
                    ["draft", "merged", "published", "searchable"].includes(
                        result.state,
                    ),
                )
                .map((result) => result.viewId),
        ),
    ];
    const parked = results
        .filter((result) =>
            ["blocked", "conflicted", "failed"].includes(result.state),
        )
        .map((result) => ({
            viewId: result.viewId,
            state: result.state,
            reason: result.reason,
            conflictId: result.conflictId,
        }));
    const discoveredTerms = new Set(
        descriptors.map((entry) => entry.query.toLowerCase()),
    );
    const undiscovered = subjects
        .filter((entry) => !discoveredTerms.has(entry.term.toLowerCase()))
        .map((entry) => entry.term);
    return {
        discovered,
        applied,
        ready: publications
            .filter(
                (entry) =>
                    scope.has(entry.viewId) &&
                    entry.indexState === "ready" &&
                    entry.publishedRevisionId === entry.indexedRevisionId,
            )
            .map((entry) => entry.viewId),
        parked,
        undiscovered,
        cursor: family.cursor,
        dirty: family.dirty,
        error: family.error,
        scope: "Original extracted subjects; not a semantic completeness claim",
    };
}

export async function reviewPacket(fixtureRoot, receipt) {
    const gold = JSON.parse(
        await readFile(
            path.join(
                fixtureRoot,
                "fixtures",
                "second-brain-maintenance",
                "expectations.json",
            ),
            "utf8",
        ),
    );
    const actions = JSON.parse(
        await readFile(
            path.join(
                fixtureRoot,
                "fixtures",
                "second-brain-maintenance",
                "external-actions.json",
            ),
            "utf8",
        ),
    );
    assert.equal(gold.evaluatorOnly, true);
    assert.equal(actions.evaluatorOnly, true);
    return {
        scope: "Evaluator only. Never supply this packet to synthesis/extraction.",
        productReceipt: receipt.receiptId,
        productOutcome: receipt.outcome,
        familyScopedProgress: Object.fromEntries(
            Object.entries(receipt.stages ?? {})
                .filter(([_phase, stage]) => stage.wikiProgress)
                .map(([phase, stage]) => {
                    const progress = stage.wikiProgress;
                    const scope = new Set(progress.discovered);
                    return [
                        phase,
                        {
                            ...progress,
                            applied: progress.applied.filter((id) =>
                                scope.has(id),
                            ),
                            ready: progress.ready.filter((id) => scope.has(id)),
                            parked: progress.parked.filter((entry) =>
                                scope.has(entry.viewId),
                            ),
                            scope: "Recorded Wiki descriptor IDs only; excludes unrelated topic/project result IDs. Original stage receipts retained.",
                        },
                    ];
                }),
        ),
        cases: gold.cases.map((entry) => ({
            ...entry,
            semanticVerdict:
                "PENDING independent human review and later authorized model run",
            offlineObservations: receipt.checks.filter((check) =>
                check.cases?.includes(entry.id),
            ),
        })),
        externalActions: actions.actions,
        pending: receipt.pending,
    };
}

export function assertExactCounts(stages) {
    assert.equal(stages.baseline.activeSources, 16);
    assert.equal(stages["meeting-orders"].activeSources, 18);
    assert.equal(stages.correction.activeSources, 19);
    assert.equal(stages.initial.activeSources, 23);
    assert.equal(stages.t1.activeSources, 24);
    assert.equal(stages.t2.activeSources, 25);
    assert.equal(stages["t2-forgotten"].activeSources, 24);
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    const { values } = parseArgs({
        options: {
            receipt: { type: "string" },
            fixtures: { type: "string" },
            output: { type: "string" },
        },
    });
    assert.ok(
        values.receipt && values.fixtures && values.output,
        "Required: --receipt --fixtures --output",
    );
    const receipt = JSON.parse(await readFile(values.receipt, "utf8"));
    await writeFile(
        values.output,
        JSON.stringify(await reviewPacket(values.fixtures, receipt), null, 2),
    );
}

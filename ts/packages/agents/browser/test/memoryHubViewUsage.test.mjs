// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceViewUsage } from "../dist/agent/memoryHubViewUsage.mjs";
import { validateViewRequest } from "../dist/views/server/features/views/viewValidation.mjs";

test("all four kinds retain exact historical membership, section impact, pending builds and conflict usage without skill authority", async () => {
    const kinds = ["wiki", "projectBrief", "troubleshootingGuide", "timeline"];
    const versions = kinds.map((kind, index) => ({
        corpusId: "c",
        viewId: kind,
        revisionId: `revision-${index}`,
        version: 2,
        state: "draft",
        provenance: "merged",
        definition: {
            selector: {
                kind: "sources",
                sources: [{ sourceId: "s", revisionId: "r" }],
            },
        },
        content: { kind, title: kind, citations: [] },
        relationships: [
            {
                from: { kind: "section", sectionId: `section-${index}` },
                to: { kind: "source", sourceId: "s", revisionId: "r" },
            },
        ],
    }));
    const service = {
        getCapabilities: async () => ({ derivedViews: { history: true } }),
        listViews: async () => ({ head: "a".repeat(40), views: versions }),
        getViewHistory: async ({ viewId }) => {
            const version = versions.find(
                (version) => version.viewId === viewId,
            );
            return [
                { version },
                {
                    version: {
                        ...version,
                        revisionId: `old-${viewId}`,
                        version: 1,
                    },
                },
            ];
        },
        listViewBuilds: async () => [
            {
                jobId: "job",
                results: kinds.map((kind) => ({
                    viewId: kind,
                    state: "conflicted",
                    reason: "Explicit overlap",
                    conflictId: `conflict-${kind}`,
                    snapshot: {
                        definition: {
                            kind,
                            selector: {
                                sources: [{ sourceId: "s", revisionId: "r" }],
                            },
                        },
                    },
                })),
            },
        ],
    };
    const usage = await sourceViewUsage(service, "c", "s");
    assert.equal(usage.length, 12);
    for (const kind of kinds) {
        assert.deepEqual(
            usage
                .filter((item) => item.kind === kind)
                .map((item) => item.state),
            ["current", "historical", "conflict"],
        );
        assert.equal(
            usage.find(
                (item) => item.viewId === kind && item.state === "historical",
            ).revisionId,
            `old-${kind}`,
        );
    }
    assert.equal(JSON.stringify(usage).includes("activate"), false);
    assert.deepEqual(await sourceViewUsage(service, "c", "other"), []);
    assert.equal(
        await sourceViewUsage({ getCapabilities: async () => ({}) }, "c", "s"),
        undefined,
    );
    assert.deepEqual(
        validateViewRequest({
            method: "memoryHubRunbookUsedBy",
            params: {
                corpusId: "c",
                sourceId: "s",
                pageSize: 1,
                viewContinuationToken: "token",
            },
        }),
        {
            method: "memoryHubRunbookUsedBy",
            params: {
                corpusId: "c",
                sourceId: "s",
                pageSize: 1,
                viewContinuationToken: "token",
            },
        },
    );
});

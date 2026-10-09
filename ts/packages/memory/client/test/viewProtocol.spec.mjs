// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { McpMemoryServiceClient } from "../dist/memoryClient.js";
import {
    viewConflictSchema,
    viewHistoryEntrySchema,
    viewResolutionSchema,
    viewSaveRequestSchema,
    viewSnapshotSchema,
    viewSynthesisSchema,
    viewToolNames,
    viewVersionSchema,
} from "../dist/viewProtocol.js";

const source = { sourceId: "source", revisionId: "source-revision" };
const definition = {
    viewId: "guide",
    kind: "troubleshootingGuide",
    selector: { kind: "sources", sources: [source] },
};
const section = {
    id: "section",
    role: "diagnostic",
    heading: "Inspect",
    body: "Inspect the evidence.",
};
const citation = {
    ...source,
    locator: "chars:0-1",
    excerpt: "x",
};
const edge = {
    id: "support",
    predicate: "supportedBy",
    from: { kind: "section", viewId: "guide", sectionId: "section" },
    to: { kind: "source", ...source },
    citations: [citation],
};
const synthesis = {
    content: {
        kind: "troubleshootingGuide",
        title: "Guide",
        sections: [section],
        citations: [citation],
    },
    relationships: [edge],
    outcome: "diagnosticOnly",
    missingEvidence: [],
};
const hash = "a".repeat(64);
const head = "a".repeat(40);
const conflictId = "00000000-0000-4000-8000-000000000001";
const snapshot = {
    corpusId: "corpus",
    actor: "actor",
    definition,
    expectedVersion: 0,
    bounds: {},
    inputs: [{ ...source, title: "Source", content: "x", contentHash: hash }],
    pipeline: "troubleshooting-v1",
    model: "model",
    fingerprint: hash,
};

function persisted(output) {
    const sources = [
        ...new Map(
            output.relationships.map(({ to }) => [
                `${to.sourceId}:${to.revisionId}`,
                { sourceId: to.sourceId, revisionId: to.revisionId },
            ]),
        ).values(),
    ];
    const outputDefinition = {
        ...definition,
        selector: { kind: "sources", sources },
    };
    const version = {
        corpusId: "corpus",
        viewId: "guide",
        revisionId: "view-revision",
        version: 1,
        state: "draft",
        createdAt: "2026-10-08T00:00:00Z",
        actor: "actor",
        provenance: "generated",
        definition: { ...outputDefinition, revisionId: "definition-revision" },
        content: output.content,
        generation: {
            candidateId: "candidate",
            content: output.content,
            fingerprint: hash,
            relationships: output.relationships,
        },
        relationships: output.relationships.map((relationship) => ({
            ...relationship,
            schemaVersion: 1,
            family: "evidence",
            origin: "generator",
            reviewState: "unreviewed",
        })),
    };
    const conflict = {
        event: { kind: "viewMergeConflict", editIds: [], evidence: [source] },
        conflictId,
        identity: hash,
        corpusId: "corpus",
        viewId: "guide",
        jobId: conflictId,
        createdAt: version.createdAt,
        actor: "actor",
        state: "pending",
        expectedRevisionId: version.revisionId,
        input: {
            ...snapshot,
            definition: outputDefinition,
            inputs: sources.map((selected) => ({
                ...selected,
                title: "Source",
                content: "x\n\n".repeat(4000),
                contentHash: hash,
            })),
        },
        base: version.generation,
        human: version,
        candidate: output,
        targets: ["section"],
        reason: "Concurrent edit",
    };
    return { version, conflict };
}

const largeOutputs = [
    [
        "one item's 2000 edge citations",
        () => {
            const citations = Array.from({ length: 2000 }, (_, index) => ({
                ...citation,
                locator: `chars:${index * 3}-${index * 3 + 1}`,
            }));
            return {
                ...synthesis,
                content: { ...synthesis.content, citations },
                relationships: [{ ...edge, citations }],
            };
        },
    ],
    [
        "per-source aggregation of two items' 4000 edge citations",
        () => {
            const citations = Array.from({ length: 4000 }, (_, index) => ({
                ...citation,
                locator: `chars:${index * 3}-${index * 3 + 1}`,
            }));
            return {
                ...synthesis,
                content: { ...synthesis.content, citations },
                relationships: [{ ...edge, citations }],
            };
        },
    ],
    [
        "aggregate content citations and 1001 relationships",
        () => {
            const sections = Array.from({ length: 501 }, (_, index) => ({
                ...section,
                id: `section-${index}`,
            }));
            const relationships = Array.from({ length: 1001 }, (_, index) => {
                const endpoint = { ...source, sourceId: `source-${index % 2}` };
                return {
                    ...edge,
                    id: `support-${index}`,
                    from: {
                        ...edge.from,
                        sectionId: sections[Math.floor(index / 2)].id,
                    },
                    to: { kind: "source", ...endpoint },
                    citations: [{ ...citation, ...endpoint }],
                };
            });
            return {
                ...synthesis,
                content: {
                    ...synthesis.content,
                    sections,
                    citations: relationships.flatMap(
                        (relationship) => relationship.citations,
                    ),
                },
                relationships,
            };
        },
    ],
];

for (const [label, makeOutput] of largeOutputs) {
    test(`response schemas preserve ${label}`, () => {
        const { version, conflict } = persisted(makeOutput());
        assert.deepEqual(viewVersionSchema.parse(version), version);
        assert.deepEqual(viewConflictSchema.parse(conflict), conflict);
        assert.deepEqual(viewSnapshotSchema.parse({ head, views: [version] }), {
            head,
            views: [version],
        });
        assert.deepEqual(
            viewHistoryEntrySchema.parse({ commitId: head, version }),
            { commitId: head, version },
        );
    });

    test(`MCP response parser preserves ${label}`, async () => {
        const { version, conflict } = persisted(makeOutput());
        const history = { commitId: head, version };
        const responses = {
            [viewToolNames.getView]: version,
            [viewToolNames.listViews]: { head, views: [version] },
            [viewToolNames.getViewHistory]: [history],
            [viewToolNames.saveViewDraft]: history,
            [viewToolNames.resolveViewConflict]: history,
            [viewToolNames.getViewConflict]: conflict,
        };
        const client = new McpMemoryServiceClient({
            callTool: async ({ name }) => ({
                content: [],
                structuredContent: { result: responses[name] },
            }),
        });
        const request = { corpusId: "corpus", viewId: "guide" };
        assert.deepEqual(await client.getView(request), version);
        assert.deepEqual(await client.listViews("corpus"), {
            head,
            views: [version],
        });
        assert.deepEqual(await client.getViewHistory(request), [history]);
        assert.deepEqual(
            await client.saveViewDraft(saveRequest(synthesis)),
            history,
        );
        assert.deepEqual(
            await client.resolveViewConflict(resolutionRequest(synthesis)),
            history,
        );
        assert.deepEqual(
            await client.getViewConflict({ corpusId: "corpus", conflictId }),
            conflict,
        );
    });
}

function saveRequest(output) {
    return {
        corpusId: "corpus",
        viewId: "guide",
        expectedHead: head,
        expectedVersion: 1,
        definition,
        content: output.content,
        relationships: output.relationships,
    };
}

function resolutionRequest(output) {
    return {
        corpusId: "corpus",
        conflictId,
        expectedHead: head,
        expectedVersion: 1,
        expectedRevisionId: "view-revision",
        inputFingerprint: hash,
        choice: "combined",
        combined: output,
    };
}

for (const field of ["edge citations", "content citations", "relationships"]) {
    test(`inbound ${field} remain bounded at 1000`, () => {
        for (const length of [1000, 1001]) {
            const output = {
                ...synthesis,
                content: {
                    ...synthesis.content,
                    citations:
                        field === "content citations"
                            ? Array(length).fill(citation)
                            : [citation],
                },
                relationships:
                    field === "relationships"
                        ? Array(length).fill(edge)
                        : [
                              {
                                  ...edge,
                                  citations:
                                      field === "edge citations"
                                          ? Array(length).fill(citation)
                                          : [citation],
                              },
                          ],
            };
            const accepted = length === 1000;
            assert.equal(
                viewSynthesisSchema.safeParse(output).success,
                accepted,
            );
            assert.equal(
                viewSaveRequestSchema.safeParse(saveRequest(output)).success,
                accepted,
            );
            assert.equal(
                viewResolutionSchema.safeParse(resolutionRequest(output))
                    .success,
                accepted,
            );
        }
    });
}

test("response schemas still reject malformed evidence", () => {
    for (const invalidEdge of [
        { ...edge, citations: [] },
        { ...edge, citations: [{ ...citation, locator: "invalid" }] },
        { ...edge, predicate: "invalid" },
        { ...edge, to: { ...edge.to, kind: "section" } },
    ]) {
        const { version, conflict } = persisted({
            ...synthesis,
            relationships: [invalidEdge],
        });
        assert.equal(viewVersionSchema.safeParse(version).success, false);
        assert.equal(viewConflictSchema.safeParse(conflict).success, false);
    }
});

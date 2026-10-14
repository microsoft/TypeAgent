// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    viewVersionSchema,
    viewBuildJobSchema,
    viewSynthesisSchema,
    viewSaveRequestSchema,
    viewSnapshotSchema,
    viewHistoryEntrySchema,
    viewConflictSchema,
    viewResolutionSchema,
} from "../dist/viewProtocol.js";

const recorded = JSON.parse(
    await readFile(
        new URL(
            "../../mcp-server/test/fixtures/p6Canonical.json",
            import.meta.url,
        ),
        "utf8",
    ),
);
const canonical = recorded.canonical;
const alias = { ...canonical, ...recorded.alias, state: "archived" };
const result = recorded.job.results.find((entry) => entry.wikiConsolidation);
const output = result.wikiConsolidation.output;
const save = {
    corpusId: canonical.corpusId,
    viewId: canonical.viewId,
    expectedHead: recorded.origin.head,
    expectedVersion: canonical.version,
    definition: {
        viewId: canonical.viewId,
        kind: "wiki",
        selector: canonical.definition.selector,
        wiki: canonical.definition.wiki,
    },
    content: canonical.content,
    relationships: output.relationships,
    unlockProtection: ["title"],
};

test("actual original-indexed P0 registered canonical survives every shared read/receipt/edit schema", () => {
    assert.equal(canonical.content.sections.length, 2);
    assert.equal(canonical.content.index.length, 2);
    assert.ok(
        canonical.content.citations.every((citation) =>
            citation.locator.startsWith("indexed:"),
        ),
    );
    for (const version of [canonical, alias]) {
        assert.deepEqual(
            viewVersionSchema.parse(version).content,
            canonical.content,
        );
        assert.deepEqual(
            viewHistoryEntrySchema.parse({
                commitId: recorded.origin.head,
                version,
            }).version.content,
            canonical.content,
        );
    }
    assert.deepEqual(
        viewSnapshotSchema.parse({
            head: recorded.origin.head,
            views: [canonical, alias],
        }).views[1].redirect,
        alias.redirect,
    );
    assert.deepEqual(
        viewBuildJobSchema
            .parse(recorded.job)
            .results.find((entry) => entry.wikiConsolidation).wikiConsolidation
            .output.content,
        canonical.content,
    );
    assert.deepEqual(
        viewSynthesisSchema.parse(output).content,
        canonical.content,
    );
    assert.deepEqual(viewSaveRequestSchema.parse(save), save);
});

test("registered protected editor, generated base and explicit unlock/conflict shapes retain multi-page content", () => {
    const protectedVersion = {
        ...canonical,
        provenance: "human",
        actor: "authenticated-owner",
        protectedTargets: ["title"],
        content: { ...canonical.content, title: "Deliberate human title" },
    };
    assert.deepEqual(
        viewVersionSchema.parse(protectedVersion).protectedTargets,
        ["title"],
    );
    assert.deepEqual(
        viewSaveRequestSchema.parse({
            ...save,
            content: protectedVersion.content,
        }).content,
        protectedVersion.content,
    );
    const conflictId = "00000000-0000-4000-8000-000000000001";
    const conflict = {
        event: {
            kind: "viewMergeConflict",
            editIds: [],
            evidence: canonical.content.citations.map(
                ({ sourceId, revisionId }) => ({ sourceId, revisionId }),
            ),
        },
        identity: result.wikiConsolidation.input.fingerprint,
        corpusId: canonical.corpusId,
        viewId: canonical.viewId,
        jobId: recorded.job.jobId,
        conflictId,
        createdAt: canonical.createdAt,
        actor: "authenticated-owner",
        state: "pending",
        expectedRevisionId: canonical.revisionId,
        input: result.wikiConsolidation.input,
        human: protectedVersion,
        candidate: output,
        targets: ["title"],
        reason: "Protected title",
    };
    assert.deepEqual(
        viewConflictSchema.parse(conflict).candidate.content,
        canonical.content,
    );
    assert.deepEqual(
        viewResolutionSchema.parse({
            corpusId: canonical.corpusId,
            conflictId,
            expectedHead: recorded.origin.head,
            expectedVersion: canonical.version,
            expectedRevisionId: canonical.revisionId,
            inputFingerprint: result.wikiConsolidation.input.fingerprint,
            choice: "combined",
            combined: output,
        }).combined.content,
        canonical.content,
    );
    assert.equal(
        viewSaveRequestSchema.safeParse({
            ...save,
            actor: "memory-view-generator",
        }).success,
        false,
    );
    assert.equal(
        viewSaveRequestSchema.safeParse({ ...save, unlockProtection: [] })
            .success,
        false,
    );
});

const corruptions = [
    [
        "unregistered second page",
        (value) => {
            value.sections[0].details.mergedPageIds = [];
        },
    ],
    [
        "foreign registration",
        (value) => {
            value.sections[0].details.mergedPageIds = ["foreign"];
        },
    ],
    [
        "duplicate registration",
        (value) => {
            value.sections[0].details.mergedPageIds.push(value.sections[1].id);
        },
    ],
    [
        "nested registration",
        (value) => {
            value.sections[1].details.mergedPageIds = [value.sections[0].id];
        },
    ],
    [
        "duplicate page",
        (value) => {
            value.sections[1].id = value.sections[0].id;
        },
    ],
    [
        "missing index",
        (value) => {
            value.index.pop();
        },
    ],
    [
        "wrong index ID",
        (value) => {
            value.index[1].pageId = "foreign";
        },
    ],
    [
        "wrong index title",
        (value) => {
            value.index[1].title = "Invented heading";
        },
    ],
    [
        "wrong index taxonomy",
        (value) => {
            value.index[1].taxonomy =
                value.sections[1].details.taxonomy === "concept"
                    ? "system"
                    : "concept";
        },
    ],
    [
        "unknown detail authority",
        (value) => {
            value.sections[0].details.approve = true;
        },
    ],
    [
        "invalid citation identity",
        (value) => {
            value.citations[0].revisionId = "";
        },
    ],
];
for (const [name, corrupt] of corruptions)
    test(`reject ${name} in read, synthesis, receipt and authenticated edit shapes`, () => {
        const content = structuredClone(canonical.content);
        corrupt(content);
        assert.equal(
            viewVersionSchema.safeParse({ ...canonical, content }).success,
            false,
        );
        assert.equal(
            viewSynthesisSchema.safeParse({ ...output, content }).success,
            false,
        );
        assert.equal(
            viewSaveRequestSchema.safeParse({ ...save, content }).success,
            false,
        );
        const job = structuredClone(recorded.job);
        job.results.find(
            (entry) => entry.wikiConsolidation,
        ).wikiConsolidation.output.content = content;
        assert.equal(viewBuildJobSchema.safeParse(job).success, false);
    });

function withPages(count) {
    const content = structuredClone(canonical.content);
    content.sections = [
        content.sections[0],
        ...Array.from({ length: count - 1 }, (_, index) => ({
            ...structuredClone(content.sections[1]),
            id: `registered-${index}`,
        })),
    ];
    content.sections[0].details.mergedPageIds = content.sections
        .slice(1)
        .map((page) => page.id);
    content.index = content.sections.map((page) => ({
        pageId: page.id,
        title: page.heading,
        taxonomy: page.details.taxonomy,
    }));
    return content;
}
test("exact registered capacity 32 succeeds; 33 fails; ordinary one-page limits remain intact", () => {
    for (const count of [1, 32])
        assert.equal(
            viewVersionSchema.safeParse({
                ...canonical,
                content: withPages(count),
            }).success,
            true,
        );
    assert.equal(
        viewVersionSchema.safeParse({ ...canonical, content: withPages(33) })
            .success,
        false,
    );
    const ordinary = withPages(1);
    ordinary.sections[0].details.mergedPageIds = [
        canonical.content.sections[1].id,
    ];
    assert.equal(
        viewSaveRequestSchema.safeParse({ ...save, content: ordinary }).success,
        false,
    );
    assert.equal(
        viewVersionSchema.safeParse({ ...canonical, provenance: "model" })
            .success,
        false,
    );
});

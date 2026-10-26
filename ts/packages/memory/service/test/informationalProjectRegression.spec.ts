// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import { docPartsFromMarkdown } from "@typeagent/conversation-memory";
import {
    indexedLocator,
    parseIndexedLocator,
    selectIndexedFragments,
    type IndexedBlock,
} from "../src/indexedFragments.js";
import {
    hydrateProjectSummary,
    validateInformationalProjectOutput,
} from "../src/informationalProject.js";
import { mergeView, viewHash } from "../src/viewMerge.js";
import { viewContentToText } from "../src/viewText.js";
import { versionRelationships } from "../src/viewRelationships.js";
import type {
    ViewBuildSnapshot,
    ViewSynthesisOutput,
    ViewVersion,
} from "../src/viewTypes.js";

function snapshot(text: string): ViewBuildSnapshot {
    const block = {
        sourceId: "selected",
        revisionId: "current",
        blockOrdinal: 0,
        score: 1,
        text,
    };
    return {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        definition: {
            viewId: "project",
            kind: "projectBrief",
            selector: {
                kind: "sources",
                sources: [
                    {
                        sourceId: block.sourceId,
                        revisionId: block.revisionId,
                    },
                ],
            },
            projectSummary: {
                construction: "informational-project-summary-v1",
                query: "Atlas rollout",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        bounds: {},
        inputs: [
            {
                sourceId: block.sourceId,
                revisionId: block.revisionId,
                title: "Synthetic mixed-initiative review",
                content: text,
                contentHash: viewHash(text),
                passages: [
                    {
                        sourceId: block.sourceId,
                        revisionId: block.revisionId,
                        locator: indexedLocator(block, 0, text.length),
                        excerpt: text,
                    },
                ],
            },
        ],
        pipeline: "informational-project-summary-v1",
        model: "deterministic-no-model",
        fingerprint: "project-regression",
    };
}

function candidate() {
    return {
        title: "Atlas rollout",
        summary:
            "Atlas rollout remains active with capacity validation pending peak-load evidence.",
        completeness: "partial",
        assignments: [],
        milestoneItems: [],
        decisionItems: [],
        openQuestions: [],
        riskItems: [],
        goalsScope:
            "Atlas rollout remains active; completed rehearsal is not rollout approval.",
        owners: "Mira is the capacity reviewer, not the accountable service owner. Accountable role: service owner; assigned person unknown. Leo owns Boreal, not Atlas.",
        status: "Atlas project active; incident closed; capacity validation blocked pending peak-memory evidence.",
        milestones: "Atlas acceptance review proposed; due date unknown.",
        decisions:
            "Atlas rehearsal acceptance completed; rollout approval unknown.",
        risks: "A larger Atlas pool may increase memory and concurrency; peak-load evidence remains required.",
        context:
            "Atlas and Boreal are separate initiatives; Boreal's dependency does not establish an Atlas blocker.",
        limits: "Synthetic selected review only; not a historical model response.",
        citationIds: ["f0"],
        projectState: "active",
        incidentState: "closed",
        capacityState: "pendingOwnerReview",
    };
}

test("grounded project structured details and item identities survive refresh without root duplicates", () => {
    const input = snapshot(
        "Mira is the Atlas capacity reviewer. Atlas acceptance review is proposed. Peak-load evidence is pending.",
    );
    const raw = {
        ...candidate(),
        assignments: [
            {
                id: "capacity-review",
                responsibility: "Capacity review",
                state: "known",
                owner: "Mira",
            },
        ],
        milestoneItems: [{ id: "acceptance", status: "proposed", date: null }],
        decisionItems: [{ id: "acceptance-decision", status: "proposed" }],
        openQuestions: [
            "What peak-load memory evidence supports Atlas rollout?",
        ],
        riskItems: [{ id: "capacity-evidence", status: "open" }],
    };
    const first = hydrateProjectSummary(input, raw);
    const second = hydrateProjectSummary(input, structuredClone(raw));
    expect(second.content).toEqual(first.content);
    expect(second.content).not.toHaveProperty("openQuestions");
    expect(
        second.content.sections.find((section) => section.role === "risks")!
            .details,
    ).toMatchObject({ openQuestions: raw.openQuestions, items: raw.riskItems });
    expect(
        second.content.sections.find((section) => section.role === "owners")!
            .details,
    ).toMatchObject({ assignments: raw.assignments });
    expect(() =>
        hydrateProjectSummary(input, {
            ...raw,
            assignments: [raw.assignments[0], raw.assignments[0]],
        }),
    ).toThrow("Duplicate");
    expect(() =>
        hydrateProjectSummary(input, {
            ...raw,
            assignments: [{ ...raw.assignments[0], id: "invalid id" }],
        }),
    ).toThrow("Invalid project item");
});

function version(
    input: ViewBuildSnapshot,
    output: ViewSynthesisOutput,
): ViewVersion {
    const value: ViewVersion = {
        corpusId: input.corpusId,
        viewId: input.definition.viewId,
        revisionId: "project-r1",
        version: 1,
        state: "draft",
        createdAt: "2026-10-20T00:00:00Z",
        actor: "memory-view-generator",
        provenance: "generated",
        definition: { ...input.definition, revisionId: "definition-r1" },
        content: structuredClone(output.content),
        relationships: [],
        generation: {
            candidateId: "base",
            content: structuredClone(output.content),
            relationships: output.relationships,
            fingerprint: viewHash(output.content),
        },
        edits: [],
    };
    value.relationships = versionRelationships(
        value,
        output.relationships,
        true,
    );
    return value;
}

test("recovered Payments Markdown retains qualifications through structural extraction and bounded two-document selection", async () => {
    const qualifications = [
        "Project status: active",
        "Incident status: closed",
        "Capacity validation: blocked",
        "Assigned person: unknown.",
        "Accountable role: <service-owner>.",
        "state: proposed; due date: unknown.",
        "A pool value learned in one workload is not a deployment default.",
        "Restoring a larger pool can increase memory and server concurrency",
        "PAY-28 asks for peak-load memory measurements before pool reuse",
    ];
    const blocks: IndexedBlock[] = [];
    for (const id of ["document-008", "document-009"]) {
        const source = await readFile(
            new URL(
                `../../test/fixtures/memoryDemo/memory-import-second-brain/content-only/baseline/${id}.md`,
                import.meta.url,
            ),
            "utf8",
        );
        const parts = docPartsFromMarkdown(source, 8000, undefined, {
            collectLinkKnowledge: false,
            collectStructuralKnowledge: false,
            maxTokensPerPart: 7500,
        });
        const text = parts.map((part) => part.textChunks.join("\n")).join("\n");
        for (const qualification of qualifications) {
            expect(source).toContain(qualification);
            expect(text).toContain(qualification);
        }
        // Reconstructed blocks isolate window selection, not historical posting ranks.
        blocks.push({
            sourceId: id,
            revisionId: "recovered-baseline",
            blockOrdinal: 0,
            text,
            score: 1,
        });
    }
    const selection = selectIndexedFragments(blocks, {
        terms: ["Payments API reliability"],
        sourceIds: blocks.map((block) => block.sourceId),
    });
    for (const block of blocks) {
        const fragments = selection.fragments.filter(
            (fragment) => fragment.sourceId === block.sourceId,
        );
        for (const qualification of qualifications)
            expect(
                fragments.some((fragment) =>
                    fragment.snippet.includes(qualification),
                ),
            ).toBe(true);
        for (const fragment of fragments) {
            const { start, end } = parseIndexedLocator(fragment.locator);
            expect(fragment.snippet).toBe(block.text.slice(start, end));
        }
    }
});

test("controlled project qualifications survive hydration, unedited refresh merge and text rendering", () => {
    const raw = candidate();
    const input = snapshot(
        [
            raw.goalsScope,
            raw.owners,
            raw.status,
            raw.milestones,
            raw.decisions,
            raw.risks,
            raw.context,
        ].join("\n"),
    );
    const hydrated = hydrateProjectSummary(input, raw);
    expect(() =>
        validateInformationalProjectOutput(input, hydrated),
    ).not.toThrow();
    const previous = hydrateProjectSummary(input, {
        ...raw,
        status: "Atlas rehearsal passed; capacity qualification unknown.",
        capacityState: "unknown",
    });
    const merged = mergeView(version(input, previous), hydrated);
    expect(merged.conflicts).toEqual([]);
    expect(merged.output).toEqual(hydrated);
    const rendered = viewContentToText(merged.output.content);
    for (const role of [
        "goalsScope",
        "owners",
        "status",
        "milestones",
        "decisions",
        "risks",
        "context",
    ] as const) {
        expect(
            merged.output.content.sections.find(
                (section) => section.role === role,
            )!.body,
        ).toBe(raw[role]);
        expect(rendered).toContain(raw[role]);
    }
    expect(merged.output.content.citations).toEqual(input.inputs[0].passages);
    expect(
        merged.output.content.sections.find(
            (section) => section.role === "status",
        )!.details,
    ).toEqual({
        kind: "status",
        project: "active",
        incident: "closed",
        capacity: "pendingOwnerReview",
    });
});

test.each(["revision", "excerpt", "locator"] as const)(
    "project output rejects a citation with changed %s",
    (field) => {
        const raw = candidate();
        const input = snapshot(raw.status);
        const output = structuredClone(hydrateProjectSummary(input, raw));
        const citation = output.content.citations[0];
        if (field === "revision") citation.revisionId = "superseded";
        else if (field === "excerpt") citation.excerpt = "Invented qualifier";
        else
            citation.locator = citation.locator.replace(
                /:0-\d+$/,
                `:1-${raw.status.length}`,
            );
        expect(() => validateInformationalProjectOutput(input, output)).toThrow(
            "Project summary citation is not an exact supplied indexed fragment",
        );
    },
);

test("pending review without supported blockage must not render a fabricated blocked state", () => {
    const raw = {
        ...candidate(),
        status: "Atlas project active; incident closed; capacity review pending; no capacity conclusion recorded.",
        risks: "Capacity qualification unknown; pending review does not establish a blocker.",
    };
    const input = snapshot(raw.status);
    const output = hydrateProjectSummary(input, raw);
    expect(() =>
        validateInformationalProjectOutput(input, output),
    ).not.toThrow();
    const rendered = viewContentToText(output.content);
    expect(rendered).toContain(raw.status);
    expect(rendered).toContain("Capacity: pending owner review");
    expect(rendered).not.toContain("BLOCKED pending owner review");
});

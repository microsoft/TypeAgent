// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    assertEditorialAssessment,
    captureEditorialContext,
    editorialProtection,
    isEditorialUnlockSuccessor,
    mergeEditorialView,
    parseEditorialAssessment,
    recordEditorialProtection,
    relatedEditorialArticles,
    requiresEditorialCheck,
    readEditorialAssessment,
    unlockEditorialProtection,
} from "../src/viewEditorial.js";
import { recordViewEdits, viewHash } from "../src/viewMerge.js";
import {
    authoredRelationships,
    versionRelationships,
} from "../src/viewRelationships.js";
import type {
    ViewBuildSnapshot,
    ViewSynthesisOutput,
    ViewVersion,
} from "../src/viewTypes.js";

function output(
    body: string,
    title = "Command and lease",
): ViewSynthesisOutput {
    return {
        content: {
            kind: "wiki",
            construction: "informational-wiki-v1",
            title,
            summary:
                "Limited summary: selected indexed fragments only; offline",
            index: [{ pageId: "article", title, taxonomy: "concept" }],
            sections: [
                {
                    id: "article",
                    role: "page",
                    heading: title,
                    body,
                    details: {
                        kind: "page",
                        construction: "informational-wiki-v1",
                        taxonomy: "concept",
                        note: "",
                        mergedPageIds: [],
                    },
                },
            ],
            citations: [
                {
                    sourceId: "worksheet",
                    revisionId: "r1",
                    locator: `indexed:0:${"a".repeat(64)}:0-10`,
                    excerpt: "38 ms median",
                },
            ],
        },
        relationships: [],
        outcome: "knowledgePages",
        missingEvidence: [],
    };
}

function version(): ViewVersion {
    const generated = output(
        "Initial command median 38 ms; acquisition p95 1850 ms is a different cohort.",
    );
    return {
        corpusId: "corpus",
        viewId: "article",
        revisionId: "article-r1",
        version: 1,
        state: "draft",
        actor: "memory-view-generator",
        provenance: "generated",
        createdAt: new Date().toISOString(),
        definition: {
            viewId: "article",
            revisionId: "definition",
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "worksheet", revisionId: "r1" }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: "command and lease",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        content: generated.content,
        relationships: [],
        generation: {
            candidateId: "base",
            content: structuredClone(generated.content),
            relationships: [],
            fingerprint: viewHash(generated.content),
        },
        edits: [],
    };
}

function unlockLineage() {
    const previous = version();
    humanEdit(previous, (content) => {
        content.title = "My human title";
        const details = content.sections[0].details!;
        if (details.kind === "page") details.note = "Retained annotation";
    });
    previous.actor = "authenticated-local-owner";
    previous.provenance = "human";
    const current: ViewVersion = {
        ...structuredClone(previous),
        revisionId: "article-r2",
        baseRevisionId: previous.revisionId,
        version: previous.version + 1,
        edits: unlockEditorialProtection(previous, ["title"]),
    };
    current.relationships = versionRelationships(
        current,
        authoredRelationships(previous),
        true,
    );
    return { previous, current };
}

test("only the exact human unlock successor retains the resolved editorial choice", () => {
    const { previous, current } = unlockLineage();
    expect(isEditorialUnlockSuccessor(previous, current, ["title"])).toBe(true);
    expect(editorialProtection(current)).toEqual(["section:article:note"]);
    expect(current.content).toEqual(previous.content);
    expect(current.edits!.map((edit) => edit.id)).toEqual(
        previous.edits!.map((edit) => edit.id),
    );
});

const invalidUnlockSuccessors: Array<
    [string, (current: ViewVersion) => unknown]
> = [
    ["actor", (current: ViewVersion) => (current.actor = "unknown")],
    ["parent", (current: ViewVersion) => (current.baseRevisionId = "other")],
    ["gap", (current: ViewVersion) => current.version++],
    ["generated", (current: ViewVersion) => (current.provenance = "generated")],
    ["corpus", (current: ViewVersion) => (current.corpusId = "other")],
    ["view", (current: ViewVersion) => (current.viewId = "other")],
    ["state", (current: ViewVersion) => (current.state = "archived")],
    ["content", (current: ViewVersion) => (current.content.title += " edited")],
    [
        "definition",
        (current: ViewVersion) => (current.definition.revisionId = "other"),
    ],
    [
        "generation",
        (current: ViewVersion) => (current.generation!.candidateId = "other"),
    ],
    ["missing edit", (current: ViewVersion) => current.edits!.pop()],
    ["edit id", (current: ViewVersion) => (current.edits![0].id = "other")],
    [
        "edit actor",
        (current: ViewVersion) => (current.edits![0].actor = "unknown"),
    ],
    [
        "edit payload",
        (current: ViewVersion) => (current.edits![0].newValue = "other"),
    ],
    [
        "annotation protection",
        (current: ViewVersion) =>
            (current.edits!.find(
                (edit) => edit.target !== "title",
            )!.protection = []),
    ],
    ["relationship", (current: ViewVersion) => current.relationships.pop()],
];

test.each(invalidUnlockSuccessors)(
    "rejects an unproven unlock successor: %s",
    (_name, change) => {
        const { previous, current } = unlockLineage();
        change(current);
        expect(isEditorialUnlockSuccessor(previous, current, ["title"])).toBe(
            false,
        );
    },
);

test("an unlock outside the recorded conflict targets cannot inherit its acceptance", () => {
    const { previous, current } = unlockLineage();
    expect(isEditorialUnlockSuccessor(previous, current, ["summary"])).toBe(
        false,
    );
});

function humanEdit(
    current: ViewVersion,
    change: (content: ViewVersion["content"]) => void,
): void {
    const edited = structuredClone(current.content);
    change(edited);
    current.edits = recordEditorialProtection(
        current,
        recordViewEdits(current, edited, [], "authenticated-local-owner"),
    );
    current.content = edited;
    current.provenance = "human";
}

test("genuine human summary edits retain authorship and conflict on substantive generated change", () => {
    const current = version();
    const summary =
        "Limited summary: selected indexed fragments only; Owner explicitly withheld approval. Updated human note: 2026-10-12.";
    humanEdit(current, (content) => {
        content.summary = summary;
    });
    expect(editorialProtection(current)).toEqual(["summary"]);
    const edit = current.edits![0];
    expect(edit.actor).toBe("authenticated-local-owner");
    expect(edit.newValue).toBe(summary);
    const candidate = output("Revised evidence");
    candidate.content.summary =
        "Limited summary: selected indexed fragments only; Approval now granted.";
    const result = mergeEditorialView(
        current,
        candidate,
        current.content.citations,
    );
    expect(result.conflicts).toContain("summary");
    expect(current.edits![0].id).toBe(edit.id);
    expect(current.content.summary).toBe(summary);
});

test("legacy explicitly protected clock-bearing summaries are never silently unlocked", () => {
    const current = version();
    current.generation!.content.summary += ". Updated 2026-10-13T00:00:00Z.";
    current.generation!.fingerprint = viewHash(current.generation!.content);
    humanEdit(current, (content) => {
        content.summary = `${content.summary}. Updated 2026-10-12T00:00:00Z.`;
    });
    const candidate = output("Same retained evidence");
    expect(
        mergeEditorialView(current, candidate, current.content.citations)
            .conflicts,
    ).toContain("summary");
    expect(editorialProtection(current)).toEqual(["summary"]);
    expect(current.content.summary).toContain("Updated 2026-10-12T00:00:00Z");
});

test("malformed assessment JSON cannot expose content in technical rejection diagnostics", async () => {
    await expect(
        readEditorialAssessment(
            Promise.reject(
                new SyntaxError(
                    'Unexpected token in "raw unsupported command median 1850"',
                ),
            ),
        ),
    ).rejects.toThrow("Editorial rejection: invalid-assessment");
});

test("editorial context uses the generated base, never protected prose as factual input", () => {
    const current = version();
    humanEdit(current, (content) => {
        content.title = "My capacity note";
        if (content.kind === "wiki")
            content.sections[0].details.note =
                "Personal synthetic review annotation";
    });

    const captured = captureEditorialContext(current)!;
    expect(captured.generatedBase.content.title).toBe("Command and lease");
    expect(JSON.stringify(captured.generatedBase)).not.toContain(
        "Personal synthetic",
    );
    expect(captured.protectedTargets).toEqual([
        "section:article:note",
        "title",
    ]);
    expect(captured.targetRevisionId).toBe(current.revisionId);
    expect(captured.generatedBaseId).toBe("base");
});

test("routine unprotected correction advances while deliberate title and annotation remain exact", () => {
    const current = version();
    humanEdit(current, (content) => {
        content.title = "My capacity note";
        if (content.kind === "wiki")
            content.sections[0].details.note =
                "Personal synthetic review annotation";
    });
    const candidate = output(
        "Corrected command median is 41 ms; acquisition p95 remains separately scoped.",
    );
    const merged = mergeEditorialView(
        current,
        candidate,
        candidate.content.citations,
    );
    expect(merged.conflicts).toEqual([]);
    expect(merged.output.content.title).toBe("My capacity note");
    expect(merged.output.content.sections[0].body).toContain("41 ms");
    expect(merged.output.content.sections[0].details).toMatchObject({
        note: "Personal synthetic review annotation",
    });
    expect(candidate.content.title).toBe("Command and lease");
});

test("genuine protected overlap is an existing recoverable conflict, not a silent overwrite", () => {
    const current = version();
    humanEdit(current, (content) => {
        content.sections[0].body += "\nMy deliberate human qualification.";
    });
    const candidate = output(
        "Changed command and lease account with the human qualification removed.",
    );
    const merged = mergeEditorialView(
        current,
        candidate,
        candidate.content.citations,
    );
    expect(merged.conflicts).toContain("section:article");
    expect(merged.output.content.sections[0].body).toBe(
        current.content.sections[0].body,
    );
});

test("explicit unit unlock permits later agent revision without pretending the old text was generated", () => {
    const current = version();
    humanEdit(current, (content) => {
        content.title = "My protected title";
    });
    const original = structuredClone(current.content);
    current.edits = unlockEditorialProtection(current, ["title"]);
    expect(current.content).toEqual(original);
    expect(editorialProtection(current)).toEqual([]);
    const candidate = output(
        "Current command sample is withdrawn.",
        "Current command evidence",
    );
    const merged = mergeEditorialView(
        current,
        candidate,
        candidate.content.citations,
    );
    expect(merged.conflicts).toEqual([]);
    expect(merged.output.content.title).toBe("Current command evidence");
    expect(current.generation?.content.title).toBe("Command and lease");
    expect(() => unlockEditorialProtection(current, ["invented-unit"])).toThrow(
        "Invalid or unknown",
    );
});

test("unlocking body alone keeps the deliberate note protected and preserves edit-base guards", () => {
    const current = version();
    humanEdit(current, (content) => {
        content.sections[0].body = "Deliberate old wording";
        if (content.kind === "wiki")
            content.sections[0].details.note = "My retained note";
    });
    current.edits = unlockEditorialProtection(current, [
        "section:article:body",
    ]);
    const candidate = output("Current corrected command evidence");
    const merged = mergeEditorialView(
        current,
        candidate,
        candidate.content.citations,
    );
    expect(merged.conflicts).toEqual([]);
    expect(merged.output.content.sections[0].body).toBe(
        candidate.content.sections[0].body,
    );
    expect(merged.output.content.sections[0].details).toMatchObject({
        note: "My retained note",
    });
    const edit = current.edits.find((entry) => entry.status !== "cleared")!;
    edit.generatedBaseId = "forged-base";
    expect(
        mergeEditorialView(current, candidate, candidate.content.citations)
            .conflicts,
    ).toContain("section:article");
});

test("consequential updates require focused actual-output checks; no per-fragment witness is invented", () => {
    const current = version();
    const input: ViewBuildSnapshot = {
        corpusId: "corpus",
        actor: "local-owner",
        expectedVersion: 1,
        definition: {
            viewId: "article",
            kind: "wiki",
            selector: current.definition.selector,
        },
        inputs: [
            {
                sourceId: "worksheet",
                revisionId: "r2",
                title: "Worksheet",
                content:
                    "The command sample is withdrawn, not a replacement median.",
                contentHash: "hash",
            },
        ],
        bounds: {},
        pipeline: "informational-wiki-v1",
        model: "offline",
        fingerprint: "input",
    };
    const editorial = captureEditorialContext(current);
    expect(
        requiresEditorialCheck(
            { ...input, ...(editorial ? { editorial } : {}) },
            output("The command sample is withdrawn."),
        ),
    ).toBe(true);
    expect(() =>
        assertEditorialAssessment({
            safe: false,
            failures: ["correction-withdrawal"],
        }),
    ).toThrow("critical-distinction");
    expect(() =>
        parseEditorialAssessment({
            safe: false,
            failures: ["raw secret model output"],
        }),
    ).toThrow("invalid-assessment");
    expect(() =>
        parseEditorialAssessment({ safe: true, failures: ["quantity"] }),
    ).toThrow("invalid-assessment");
    expect(
        assertEditorialAssessment({ safe: true, failures: [] }),
    ).toBeUndefined();
});

test("related navigation follows current original source revisions without establishing equivalence", () => {
    const current = version();
    const other = version();
    other.viewId = "independent-lease";
    other.revisionId = "lease-current";
    other.content.title = "Independent lease lifetime";
    const obsolete = structuredClone(other);
    obsolete.viewId = "obsolete";
    obsolete.content.citations[0].revisionId = "r0";
    expect(
        relatedEditorialArticles(current, [current, other, obsolete]),
    ).toEqual([
        {
            viewId: "independent-lease",
            revisionId: "lease-current",
            title: "Independent lease lifetime",
        },
    ]);
    expect(current.viewId).toBe("article");
    expect(other.viewId).toBe("independent-lease");
});

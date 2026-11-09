// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, type ChatModel } from "@typeagent/aiclient";
import {
    createConfiguredViewSynthesisAdapter,
    validateConstructedGuide,
} from "../src/viewSynthesis.js";
import { hydrateSchemaAnswers } from "../src/schemaViewSynthesis.js";
import { independentSupport, resolveQuestion } from "../src/schemaView.js";
import { compactSchemaAudit } from "../src/viewSynthesisEvidence.js";
import { ViewBuildRunner } from "../src/viewBuilds.js";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewSupportReport,
    ViewSynthesisOutput,
} from "../src/viewTypes.js";

const inspectRequest = openai.createChatModel(
    {
        provider: "azure",
        modelType: openai.ModelType.Chat,
        apiKey: "synthetic-key",
        endpoint: "https://synthetic.invalid/schema-answer-repair",
        supportsResponseFormat: true,
        requestConstraints: {
            inputTokens: 2000000,
            contextTokens: 2200000,
            outputTokens: 16000,
        },
    },
    { response_format: { type: "json_object" } },
).inspectRequest;
if (!inspectRequest) throw new Error("Offline model must inspect requests");

function snapshot(): ViewBuildSnapshot {
    const inputs = ["08:10", "13:45"].map((time, index) => ({
        sourceId: `log-${index}`,
        revisionId: "revision",
        title: "Workshop log, common local clock",
        content: `Workshop log, common local clock. 2031-04-09 ${time}: active branch is ${index ? "beta" : "alpha"}.`,
        contentHash: `hash-${index}`,
    }));
    return {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        inputs,
        definition: {
            viewId: "branch",
            kind: "schemaView",
            selector: {
                kind: "sources",
                sources: inputs.map(({ sourceId, revisionId }) => ({
                    sourceId,
                    revisionId,
                })),
            },
            schemaView: {
                construction: "schema-defined-v1",
                title: "Active branch",
                template: "questions-v1",
                discovery: { enabled: false, maxProposals: 0 },
                slots: [
                    {
                        id: "branch",
                        question: "Which branch is active?",
                        cardinality: "singleton",
                        schema: { type: "string" },
                        rubric: {
                            version: 1,
                            selection: "mostRecent",
                            requireConfirmation: false,
                            authoritySourceIds: [],
                        },
                        approval: "approved",
                        discoveryCitations: [],
                    },
                ],
            },
        },
        pipeline: "schema-defined-v1",
        model: "offline",
        fingerprint: "frozen",
    };
}

function answers(local = true) {
    return {
        answers: [
            {
                slotId: "branch",
                candidates: ["alpha", "beta"].map((value, index) => ({
                    valueJson: JSON.stringify(value),
                    effectiveAt: "",
                    localTimestamp: local
                        ? `2031-04-09T${index ? "13:45" : "08:10"}`
                        : "",
                    localTimeScope: local
                        ? "Workshop log common local clock"
                        : "",
                    passageIds: [`p${index}-0`],
                    chronologyPassageIds: [`p${index}-0`],
                    opposingPassageIds: [] as string[],
                })),
            },
        ],
    };
}

function support(
    output: ViewSynthesisOutput,
    supported: boolean,
): ViewSupportReport {
    return {
        supported,
        sections: output.content.sections.map((section) => ({
            sectionId: section.id,
            supported,
            reason: supported
                ? "Exact retained report and chronology"
                : "Missing common local chronology binding",
        })),
        relationships: output.relationships.map((edge) => ({
            edgeId: edge.id,
            supported: true,
            reason: "Exact retained citation",
        })),
        missingContext: [],
        reasons: supported ? [] : ["Repair the source chronology binding"],
    };
}

function evidenceBindingFixture() {
    const input = snapshot();
    input.inputs[0].content =
        "Workshop log, common local clock. 2031-04-09 08:10.\n\nThe active branch is alpha.\n\nThe review owner is Morgan.";
    input.inputs[0].assertionLineage = {
        owner: "workshop",
        independenceKey: "entry-alpha",
        derivedFrom: [],
    };
    const slot = input.definition.schemaView!.slots[0];
    slot.cardinality = "record";
    slot.schema = {
        type: "object",
        properties: { branch: { type: "string" }, owner: { type: "string" } },
        required: ["branch", "owner"],
    };
    const raw = {
        answers: [
            {
                slotId: slot.id,
                candidates: [
                    {
                        ...answers(false).answers[0].candidates[0],
                        valueJson: JSON.stringify({
                            branch: "alpha",
                            owner: "Morgan",
                        }),
                        sourceRecordedDate: "2031-04-09",
                        passageIds: ["p0-1", "p0-2"],
                        chronologyPassageIds: ["p0-0"],
                    },
                ],
            },
        ],
    };
    return { input, raw };
}

function firstCandidate(output: ViewSynthesisOutput) {
    const details = output.content.sections[0].details;
    if (details?.kind !== "question") throw new Error("Expected question");
    return details.candidates[0];
}

test("explicit bindings retain joint factual support and a distinct recording-date header", () => {
    const { input, raw } = evidenceBindingFixture();
    const output = hydrateSchemaAnswers(input, raw, true);
    validateConstructedGuide(input, output);
    const candidate = firstCandidate(output);
    expect(candidate.support.map((entry) => entry.role)).toEqual([
        "value",
        "value",
        "chronology",
    ]);
    expect(
        candidate.support
            .slice(0, 2)
            .every((entry) => entry.sourceRecordedDate === undefined),
    ).toBe(true);
    expect(candidate.support[2].sourceRecordedDate).toBe("2031-04-09");
    expect(candidate.citations).toHaveLength(3);
    expect(output.relationships[0].citations).toHaveLength(3);
    expect(output.content.citations).toHaveLength(3);
    expect(independentSupport(candidate)).toBe(1);
    candidate.support[2].independenceKey = "header-is-not-an-extra-witness";
    expect(independentSupport(candidate)).toBe(1);
});

test("a chronology header without factual passages cannot produce an observed value", () => {
    const { input, raw } = evidenceBindingFixture();
    raw.answers[0].candidates[0].passageIds = [];
    expect(() => hydrateSchemaAnswers(input, raw, true)).toThrow(
        "requires retained support",
    );
});

test("explicit chronology metadata cannot omit its passage binding", () => {
    const { input, raw } = evidenceBindingFixture();
    raw.answers[0].candidates[0].chronologyPassageIds = [];
    expect(() => hydrateSchemaAnswers(input, raw, true)).toThrow(
        "requires an explicit passage binding",
    );
});

test.each(["source", "revision"])(
    "chronology cannot borrow a header from a different %s",
    (mode) => {
        const { input, raw } = evidenceBindingFixture();
        if (mode === "revision") {
            input.inputs[1].sourceId = input.inputs[0].sourceId;
            input.inputs[1].revisionId = "previous";
        }
        raw.answers[0].candidates[0].chronologyPassageIds = ["p1-0"];
        const output = hydrateSchemaAnswers(input, raw, true);
        expect(() => validateConstructedGuide(input, output)).toThrow(
            "same source revision",
        );
        const candidate = firstCandidate(output);
        const slot = input.definition.schemaView!.slots[0];
        slot.rubric.authoritySourceIds = [input.inputs[1].sourceId];
        if (mode === "source")
            expect(
                resolveQuestion(slot, [candidate], []).selectedCandidateIds,
            ).toEqual([]);
    },
);

test("legacy joint evidence stays unclassified but new configured answers require roles", () => {
    const { input, raw } = evidenceBindingFixture();
    const { chronologyPassageIds: _context, ...legacy } =
        raw.answers[0].candidates[0];
    legacy.passageIds = ["p0-0", ...legacy.passageIds];
    const legacyRaw = { answers: [{ slotId: "branch", candidates: [legacy] }] };
    const output = hydrateSchemaAnswers(input, legacyRaw);
    validateConstructedGuide(input, output);
    expect(firstCandidate(output).support).toHaveLength(3);
    expect(
        firstCandidate(output).support.every(
            (entry) => entry.role === undefined,
        ),
    ).toBe(true);
    expect(() => hydrateSchemaAnswers(input, legacyRaw, true)).toThrow(
        "Explicit chronology passage bindings are required",
    );
});

test.each([
    "mixed",
    "no-value",
    "value-time",
    "unbound-time",
    "unbound-citation",
])("explicit support rejects %s ambiguity", (mode) => {
    const { input, raw } = evidenceBindingFixture();
    const output = hydrateSchemaAnswers(input, raw, true);
    const candidate = firstCandidate(output);
    if (mode === "mixed") delete candidate.support[0].role;
    if (mode === "no-value")
        candidate.support.forEach((entry) => {
            entry.role = "chronology";
        });
    if (mode === "value-time")
        candidate.support[0].sourceRecordedDate = "2031-04-09";
    if (mode === "unbound-time") candidate.effectiveAt = "2031-04-09T08:10:00Z";
    if (mode === "unbound-citation") candidate.support.pop();
    expect(() => validateConstructedGuide(input, output)).toThrow();
});

test("coalesced equal values preserve each source's context and most-recent chronology", () => {
    const { input, raw } = evidenceBindingFixture();
    input.inputs[1].content =
        "Workshop log, common local clock. 2031-04-10 14:30.\n\nThe active branch is alpha.\n\nThe review owner is Morgan.";
    const first = raw.answers[0].candidates[0];
    first.localTimestamp = "2031-04-09T08:10";
    first.localTimeScope = "Workshop log common local clock";
    raw.answers[0].candidates.push({
        ...first,
        sourceRecordedDate: "2031-04-10",
        localTimestamp: "2031-04-10T14:30",
        passageIds: ["p1-1", "p1-2"],
        chronologyPassageIds: ["p1-0"],
    });
    const output = hydrateSchemaAnswers(input, raw, true);
    validateConstructedGuide(input, output);
    const candidate = firstCandidate(output);
    expect(candidate.support).toHaveLength(6);
    expect(candidate.localChronology?.timestamp).toBe("2031-04-10T14:30");
    expect(
        candidate.support
            .filter((entry) => entry.role === "chronology")
            .map((entry) => [
                entry.citation.sourceId,
                entry.sourceRecordedDate,
            ]),
    ).toEqual([
        ["log-0", "2031-04-09"],
        ["log-1", "2031-04-10"],
    ]);
});

test("audit compaction preserves factual/header roles, exact references and date bindings", () => {
    const { input, raw } = evidenceBindingFixture();
    const output = hydrateSchemaAnswers(input, raw, true);
    const packed = compactSchemaAudit(input, output);
    const candidate = packed.output.content.sections[0].details.candidates[0];
    expect(candidate.support.map((entry) => entry.role)).toEqual([
        "value",
        "value",
        "chronology",
    ]);
    expect(candidate.support[2].sourceRecordedDate).toBe("2031-04-09");
    expect(
        candidate.support.map((entry) => {
            const evidence = packed.evidence.find(
                (item) => item.id === entry.citation.evidenceId,
            );
            return evidence && "passageId" in evidence
                ? evidence.passageId
                : undefined;
        }),
    ).toEqual(["p0-1", "p0-2", "p0-0"]);
    expect(packed.output.relationships[0].citations).toHaveLength(3);
});

test.each([
    [
        "faithful",
        "They've been building wooden birdhouses lately, especially ones with bright blue roofs.",
        true,
    ],
    [
        "true-verbatim",
        'The user said exactly: "I\'ve been building wooden birdhouses lately, especially ones with bright blue roofs."',
        true,
    ],
    [
        "false-verbatim",
        'The user said exactly: "They\'ve been building wooden birdhouses lately, especially ones with bright blue roofs."',
        false,
    ],
    [
        "changed-fact",
        "They've been building stone towers lately, especially ones with bright red roofs.",
        false,
    ],
    [
        "wrong-attribution",
        "The user's sibling has been building wooden birdhouses lately, especially ones with bright blue roofs.",
        false,
    ],
] as const)(
    "typed JSON quotation contract preserves %s values and strict audit handoff",
    async (_mode, value, supported) => {
        const input = snapshot();
        input.inputs[0].content =
            "User workshop journal.\n\nUser: I've been building wooden birdhouses lately, especially ones with bright blue roofs.";
        input.definition.schemaView!.slots[0].question =
            "What craft preference did the user report?";
        const raw = answers(false);
        raw.answers[0].candidates = [
            {
                ...raw.answers[0].candidates[0],
                valueJson: JSON.stringify(value),
                passageIds: ["p0-1"],
                chronologyPassageIds: [],
            },
        ];
        const output = hydrateSchemaAnswers(input, raw, true);
        validateConstructedGuide(input, output);
        const original = structuredClone(output);
        expect(
            output.content.sections[0].body.endsWith(
                JSON.stringify(value, null, 2),
            ),
        ).toBe(true);
        let audits = 0;
        const model: ChatModel = {
            completionSettings: {},
            inspectRequest,
            complete: async (messages) => {
                if (typeof messages === "string")
                    throw new Error("Expected labeled messages");
                audits++;
                const rules = String(messages[0].content);
                expect(rules).toContain(
                    "JSON delimiters around a scalar string or record field are serialization syntax",
                );
                expect(rules).toContain(
                    "speaker, referent, attribution, meaning and qualifications remain unchanged and unambiguous",
                );
                expect(rules).toContain("must match the cited wording");
                const payload = JSON.parse(String(messages[1].content));
                expect(payload.output.content.sections[0].body).toBe(
                    output.content.sections[0].body,
                );
                expect(
                    payload.output.content.sections[0].details.candidates[0]
                        .value,
                ).toBe(value);
                const report = support(output, supported);
                if (!supported)
                    report.reasons = [
                        "The asserted wording, facts or attribution lack cited support",
                    ];
                return { success: true, data: JSON.stringify(report) };
            },
        };
        const adapter = createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            model,
        );
        const report = await adapter.validate(
            input,
            output,
            new AbortController().signal,
        );
        expect(audits).toBe(1);
        expect(report.supported).toBe(supported);
        expect(output).toEqual(original);
    },
);

test("mostRecent orders a common local chronology without inventing a timezone", () => {
    const input = snapshot();
    const output = hydrateSchemaAnswers(input, answers());
    validateConstructedGuide(input, output);
    const details = output.content.sections[0].details;
    if (details?.kind !== "question") throw new Error("Expected question");
    expect(details.answerState).toBe("answered");
    expect(
        details.candidates.find((c) =>
            details.selectedCandidateIds.includes(c.id),
        )?.value,
    ).toBe("beta");
    expect(details.candidates).toHaveLength(2);
    expect(output.content.sections[0].body).toContain(
        "report what the cited sources state, not independent verification of events or present-day status",
    );
    expect(output.content.sections[0].body).toContain("2031-04-09T13:45");
    expect(output.content.sections[0].body).toContain("timezone unspecified");
    expect(output.content.sections[0].body).toContain(
        "maintenance freshness: current",
    );
    for (const candidate of details.candidates) {
        expect(candidate.effectiveAt).toBeUndefined();
        expect(candidate.localChronology?.timestamp).not.toMatch(/Z|[+-]\d\d:/);
        expect(candidate.opposingCitations).toEqual([]);
        expect(candidate.support[0].localChronology).toEqual(
            candidate.localChronology,
        );
    }
});

test("a dated source report does not supply an unknown occurrence time or timezone", () => {
    const input = snapshot();
    input.inputs[0].content =
        "Session date: 2031/04/09\n\nEarlier I worked on branch alpha.";
    const raw = answers(false);
    raw.answers[0].candidates = [
        {
            ...raw.answers[0].candidates[0],
            passageIds: ["p0-1"],
        },
    ];
    const response = {
        answers: raw.answers.map((answer) => ({
            ...answer,
            candidates: answer.candidates.map((candidate) => ({
                ...candidate,
                sourceRecordedDate: "2031-04-09",
            })),
        })),
    };
    const output = hydrateSchemaAnswers(input, response);
    validateConstructedGuide(input, output);
    const details = output.content.sections[0].details;
    if (details?.kind !== "question") throw new Error("Expected question");
    const candidate = details.candidates[0];
    expect(candidate.effectiveAt).toBeUndefined();
    expect(candidate.localChronology).toBeUndefined();
    expect(
        candidate.support
            .filter((support) => support.role !== "value")
            .every((support) => support.sourceRecordedDate === "2031-04-09"),
    ).toBe(true);
    expect(output.content.sections[0].body).toContain(
        "unknown occurrence/effective time",
    );
    expect(output.content.sections[0].body).toContain(
        "Source recording dates (not occurrence dates; no timezone inferred): 2031-04-09",
    );
    expect(output.content.sections[0].body).not.toContain(
        "Source observation times: unknown",
    );
});

test("a session chronology anchor does not become an occurrence or turn-level timestamp", () => {
    const input = snapshot();
    input.inputs[0].content =
        "Peer review conversation, common local clock. Session date: 2031/04/09 (08:10)\n\nI might request a peer review next week.";
    input.definition.schemaView!.slots[0].question =
        "What is the peer review plan?";
    const raw = answers();
    const output = hydrateSchemaAnswers(input, {
        answers: [
            {
                ...raw.answers[0],
                candidates: [
                    {
                        ...raw.answers[0].candidates[0],
                        valueJson: JSON.stringify(
                            "Might request a peer review next week.",
                        ),
                        sourceRecordedDate: "2031-04-09",
                        localTimeScope:
                            "Peer review conversation, common local clock",
                        passageIds: ["p0-1"],
                    },
                ],
            },
        ],
    });
    validateConstructedGuide(input, output);
    const details = output.content.sections[0].details;
    if (details?.kind !== "question") throw new Error("Expected question");
    const candidate = details.candidates[0];
    expect(candidate.effectiveAt).toBeUndefined();
    expect(candidate.localChronology).toEqual({
        timestamp: "2031-04-09T08:10",
        scope: "Peer review conversation, common local clock",
    });
    expect(output.content.sections[0].body).toContain(
        "Source-local chronology anchor (report ordering only, not occurrence/effective or turn-level time): 2031-04-09T08:10",
    );
    expect(output.content.sections[0].body).not.toContain(
        "Occurrence/effective chronology: 2031-04-09T08:10",
    );
    expect(output.content.sections[0].body).toContain(
        "Source recording dates (not occurrence dates; no timezone inferred): 2031-04-09",
    );
    expect(candidate.value).toBe("Might request a peer review next week.");
});

test.each(["2031-02-29", "2031-04", "2031-04-09T00:00:00Z", 20310409, null])(
    "source recording dates reject invalid or overprecise value %s",
    (sourceRecordedDate) => {
        const raw = answers(false);
        const response = {
            answers: raw.answers.map((answer) => ({
                ...answer,
                candidates: answer.candidates.map((candidate) => ({
                    ...candidate,
                    sourceRecordedDate,
                })),
            })),
        };
        expect(() => hydrateSchemaAnswers(snapshot(), response)).toThrow();
    },
);

test("date-only source recording metadata cannot select a mostRecent winner", () => {
    const raw = answers(false);
    const response = {
        answers: raw.answers.map((answer) => ({
            ...answer,
            candidates: answer.candidates.map((candidate, index) => ({
                ...candidate,
                sourceRecordedDate: index ? "2031-04-10" : "2031-04-09",
            })),
        })),
    };
    const output = hydrateSchemaAnswers(snapshot(), response);
    validateConstructedGuide(snapshot(), output);
    const details = output.content.sections[0].details;
    if (details?.kind !== "question") throw new Error("Expected question");
    expect(details.answerState).toBe("conflicted");
    expect(details.selectedCandidateIds).toEqual([]);
});

test("coalesced reports retain separate recording dates without using them as temporal winners", () => {
    const raw = answers(false);
    const response = {
        answers: raw.answers.map((answer) => ({
            ...answer,
            candidates: answer.candidates.map((candidate, index) => ({
                ...candidate,
                valueJson: JSON.stringify("alpha"),
                sourceRecordedDate: index ? "2031-04-10" : "2031-04-09",
            })),
        })),
    };
    const output = hydrateSchemaAnswers(snapshot(), response);
    validateConstructedGuide(snapshot(), output);
    const details = output.content.sections[0].details;
    if (details?.kind !== "question") throw new Error("Expected question");
    expect(details.candidates).toHaveLength(1);
    const candidate = details.candidates[0];
    expect(
        candidate.support.map((support) => support.sourceRecordedDate).sort(),
    ).toEqual(["2031-04-09", "2031-04-10"]);
    expect(candidate.effectiveAt).toBeUndefined();
    expect(candidate.localChronology).toBeUndefined();
});

test.each(["different-clock", "absolute", "unknown"] as const)(
    "mostRecent leaves %s chronology incomparable",
    (mode) => {
        const raw = answers();
        const second = raw.answers[0].candidates[1];
        if (mode === "different-clock") second.localTimeScope = "Remote clock";
        else {
            second.localTimestamp = "";
            second.localTimeScope = "";
            if (mode === "absolute")
                second.effectiveAt = "2031-04-09T13:45:00Z";
        }
        const output = hydrateSchemaAnswers(snapshot(), raw);
        const details = output.content.sections[0].details;
        expect(details?.kind === "question" && details.answerState).toBe(
            "conflicted",
        );
    },
);

test.each(["local", "mixed", "different-clock"] as const)(
    "coalesced equal values preserve %s support chronology without inventing a common clock",
    (mode) => {
        const input = snapshot();
        const raw = answers();
        const first = raw.answers[0].candidates[0];
        const second = raw.answers[0].candidates[1];
        second.valueJson = first.valueJson;
        if (mode === "mixed") {
            second.localTimestamp = "";
            second.localTimeScope = "";
            second.effectiveAt = "2031-04-09T13:45:00Z";
        }
        if (mode === "different-clock") second.localTimeScope = "Remote clock";
        const output = hydrateSchemaAnswers(input, raw);
        validateConstructedGuide(input, output);
        const details = output.content.sections[0].details;
        if (details?.kind !== "question") throw new Error("Expected question");
        expect(details.candidates).toHaveLength(1);
        const candidate = details.candidates[0];
        expect(candidate.support).toHaveLength(2);
        expect(candidate.effectiveAt).toBeUndefined();
        expect(candidate.localChronology).toEqual(
            mode === "local"
                ? {
                      timestamp: "2031-04-09T13:45",
                      scope: "Workshop log common local clock",
                  }
                : undefined,
        );
        expect(output.content.sections[0].body).toContain(
            "Source-local chronology anchor (report ordering only, not occurrence/effective or turn-level time)",
        );
        expect(output.content.sections[0].body).not.toContain(
            "Occurrence/effective chronology: 2031-04-09T08:10",
        );
        if (mode === "mixed") {
            expect(candidate.support[1].effectiveAt).toBe(
                "2031-04-09T13:45:00Z",
            );
            expect(output.content.sections[0].body).toContain(
                "Occurrence/effective chronology: 2031-04-09T13:45:00Z",
            );
        }
    },
);

test.each(["2031-02-30T08:10", "2031-04-09T28:10", "2031-04-09T08:10Z"])(
    "invalid local chronology %s is rejected",
    (timestamp) => {
        const raw = answers();
        raw.answers[0].candidates[0].localTimestamp = timestamp;
        expect(() =>
            validateConstructedGuide(
                snapshot(),
                hydrateSchemaAnswers(snapshot(), raw),
            ),
        ).toThrow(/local chronology/);
    },
);

test.each(["confirmation", "opposition", "independentSupport"] as const)(
    "local chronology does not bypass %s requirements",
    (mode) => {
        const input = snapshot();
        const slot = input.definition.schemaView!.slots[0];
        const raw = answers();
        if (mode === "confirmation") slot.rubric.requireConfirmation = true;
        if (mode === "opposition")
            raw.answers[0].candidates[1].opposingPassageIds = ["p0-0"];
        if (mode === "independentSupport")
            slot.rubric.selection = "independentSupport";
        const output = hydrateSchemaAnswers(input, raw);
        const details = output.content.sections[0].details;
        expect(details?.kind === "question" && details.answerState).toBe(
            mode === "confirmation" ? "pending" : "conflicted",
        );
    },
);

test("an answered question still repairs an unsupported clause in an unselected candidate", async () => {
    const input = snapshot();
    let generations = 0;
    const model: ChatModel = {
        completionSettings: {},
        inspectRequest,
        complete: async (messages, _options, schema) => {
            if (typeof messages === "string")
                throw new Error("Expected labeled messages");
            const payload = JSON.parse(String(messages[1].content));
            if (
                schema &&
                !Array.isArray(schema) &&
                "name" in schema &&
                schema.name === "schema_view_answers"
            ) {
                generations++;
                const raw = answers();
                if (generations === 1)
                    raw.answers[0].candidates[0].valueJson = JSON.stringify(
                        "alpha; no prize decision was made",
                    );
                else {
                    expect(
                        payload.previousArtifact.sections[0].details.candidates,
                    ).toHaveLength(2);
                    expect(payload.supportReport.reasons).toContain(
                        "An unselected candidate's prize assertion is unsupported by its own citations",
                    );
                    expect(String(messages[0].content)).toContain(
                        "narrow/remove only unsupported clauses",
                    );
                }
                return { success: true, data: JSON.stringify(raw) };
            }
            const output: ViewSynthesisOutput = {
                content: payload.output.content,
                relationships: payload.output.relationships,
                outcome: "schemaAnswers",
                missingEvidence: [],
            };
            const supported = !output.content.sections.some(
                (section) =>
                    section.details?.kind === "question" &&
                    section.details.candidates.some((candidate) =>
                        String(candidate.value).includes("prize"),
                    ),
            );
            const report = support(output, supported);
            if (!supported)
                report.reasons.push(
                    "An unselected candidate's prize assertion is unsupported by its own citations",
                );
            return { success: true, data: JSON.stringify(report) };
        },
    };
    const adapter = createConfiguredViewSynthesisAdapter(
        undefined,
        4000,
        model,
    );
    const signal = new AbortController().signal;
    const output = await adapter.generate(input, signal);
    expect(output.content.sections[0].details).toMatchObject({
        answerState: "answered",
    });
    const rejected = await adapter.validate(input, output, signal);
    expect(rejected.supported).toBe(false);
    const repaired = await adapter.repairSchemaAnswers!(
        input,
        output,
        rejected,
        signal,
    );
    validateConstructedGuide(input, repaired);
    expect((await adapter.validate(input, repaired, signal)).supported).toBe(
        true,
    );
    expect(repaired.content.sections[0].details).toMatchObject({
        answerState: "answered",
        candidates: [{ value: "alpha" }, { value: "beta" }],
    });
    expect(generations).toBe(2);
});

test.each([
    "They might request a peer review.",
    "They are considering requesting a peer review.",
    "They will request a peer review only if approval is granted.",
    "They have not requested a peer review.",
])(
    "support repair preserves the exact qualified observation: %s",
    async (source) => {
        const input = snapshot();
        input.inputs[0].content = source;
        input.definition.schemaView!.slots[0].question =
            "What is the peer review status?";
        const frozen = JSON.stringify(input);
        let generations = 0;
        let audits = 0;
        const model: ChatModel = {
            completionSettings: {},
            inspectRequest,
            complete: async (messages, _options, schema) => {
                if (typeof messages === "string")
                    throw new Error("Expected labeled messages");
                const payload = JSON.parse(String(messages[1].content));
                if (
                    schema &&
                    !Array.isArray(schema) &&
                    "name" in schema &&
                    schema.name === "schema_view_answers"
                ) {
                    generations++;
                    expect(String(messages[0].content)).toContain(
                        "Preserve modality, negation, conditions and action status INSIDE the candidate value",
                    );
                    if (generations === 2) {
                        expect(payload.supportReport.reasons).toContain(
                            "Unsupported modality",
                        );
                        expect(String(messages[0].content)).toContain(
                            "rewrite the offending value field itself",
                        );
                    }
                    const raw = answers(false);
                    raw.answers[0].candidates = [
                        {
                            ...raw.answers[0].candidates[0],
                            valueJson: JSON.stringify(
                                generations === 1
                                    ? "Request a peer review."
                                    : source,
                            ),
                        },
                    ];
                    return { success: true, data: JSON.stringify(raw) };
                }
                audits++;
                const output: ViewSynthesisOutput = {
                    content: payload.output.content,
                    relationships: payload.output.relationships,
                    outcome: "schemaAnswers",
                    missingEvidence: [],
                };
                const details = output.content.sections[0].details;
                if (details?.kind !== "question")
                    throw new Error("Expected question");
                const report = support(
                    output,
                    details.candidates[0].value === source,
                );
                if (!report.supported)
                    report.reasons.push("Unsupported modality");
                return { success: true, data: JSON.stringify(report) };
            },
        };
        const adapter = createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            model,
        );
        const signal = new AbortController().signal;
        const output = await adapter.generate(input, signal);
        const rejected = await adapter.validate(input, output, signal);
        expect(rejected.supported).toBe(false);
        const repaired = await adapter.repairSchemaAnswers!(
            input,
            output,
            rejected,
            signal,
        );
        validateConstructedGuide(input, repaired);
        expect(
            (await adapter.validate(input, repaired, signal)).supported,
        ).toBe(true);
        const details = repaired.content.sections[0].details;
        if (details?.kind !== "question") throw new Error("Expected question");
        expect(details.candidates.map((candidate) => candidate.value)).toEqual([
            source,
        ]);
        expect(generations).toBe(2);
        expect(audits).toBe(2);
        expect(JSON.stringify(input)).toBe(frozen);
    },
);

test.each(["actual", "illustrative", "actual-with-measurement"] as const)(
    "question construction respects %s scope alongside hypothetical measurements",
    async (scope) => {
        const input = snapshot();
        input.inputs[0].content =
            "Tutorial: the following readings are hypothetical examples only.\n\nSample A: 17 degrees. Sample B: 19 degrees.";
        input.inputs[1].content =
            scope === "actual-with-measurement"
                ? "Actual measurement log: Sample C: 23 degrees."
                : "No actual measurements have been taken.";
        const slot = input.definition.schemaView!.slots[0];
        slot.question =
            scope === "illustrative"
                ? "Which illustrative readings does the tutorial provide?"
                : "Which temperatures were actually measured?";
        slot.cardinality = "collection";
        slot.schema = {
            type: "object",
            properties: {
                sampleId: { type: "string" },
                temperature: { type: "number" },
            },
            required: ["sampleId", "temperature"],
        };
        slot.itemKey = "sampleId";
        slot.rubric.selection = "independentSupport";
        const frozen = JSON.stringify(input);
        const values =
            scope === "actual"
                ? []
                : scope === "illustrative"
                  ? [
                        { sampleId: "A", temperature: 17 },
                        { sampleId: "B", temperature: 19 },
                    ]
                  : [{ sampleId: "C", temperature: 23 }];
        let generations = 0;
        const model: ChatModel = {
            completionSettings: {},
            inspectRequest,
            complete: async (messages, _options, schema) => {
                if (typeof messages === "string")
                    throw new Error("Expected labeled messages");
                if (
                    schema &&
                    !Array.isArray(schema) &&
                    "name" in schema &&
                    schema.name === "schema_view_answers"
                ) {
                    generations++;
                    expect(String(messages[0].content)).toContain(
                        "Hypothetical or illustrative figures do not establish actual observations",
                    );
                    expect(String(messages[1].content)).toContain(
                        "hypothetical examples only",
                    );
                    return {
                        success: true,
                        data: JSON.stringify({
                            answers: [
                                {
                                    slotId: slot.id,
                                    candidates: values.map((value) => ({
                                        valueJson: JSON.stringify(value),
                                        itemKey: value.sampleId,
                                        effectiveAt: "",
                                        sourceRecordedDate: "",
                                        localTimestamp: "",
                                        localTimeScope: "",
                                        chronologyPassageIds: [],
                                        passageIds:
                                            scope === "illustrative"
                                                ? ["p0-0", "p0-1"]
                                                : ["p1-0"],
                                        opposingPassageIds: [],
                                    })),
                                },
                            ],
                        }),
                    };
                }
                const payload = JSON.parse(String(messages[1].content));
                const output: ViewSynthesisOutput = {
                    content: payload.output.content,
                    relationships: payload.output.relationships,
                    outcome: "schemaAnswers",
                    missingEvidence: [],
                };
                expect(output.content.sections[0].body).not.toContain(
                    "historical observations",
                );
                return {
                    success: true,
                    data: JSON.stringify(support(output, true)),
                };
            },
        };
        const adapter = createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            model,
        );
        const signal = new AbortController().signal;
        const output = await adapter.generate(input, signal);
        validateConstructedGuide(input, output);
        expect((await adapter.validate(input, output, signal)).supported).toBe(
            true,
        );
        const details = output.content.sections[0].details;
        if (details?.kind !== "question") throw new Error("Expected question");
        expect(details.answerState).toBe(values.length ? "partial" : "pending");
        expect(details.candidates.map((candidate) => candidate.value)).toEqual(
            values,
        );
        expect(output.content.sections[0].body).not.toContain(
            "historical observations",
        );
        if (scope === "actual")
            expect(output.missingEvidence).toContain(slot.question);
        else
            expect(output.content.sections[0].body).toContain(
                "report what the cited sources state, not independent verification of events",
            );
        expect(generations).toBe(1);
        expect(JSON.stringify(input)).toBe(frozen);
    },
);

test.each(["repaired", "unsupported", "incompleteAudit", "transportFailure"])(
    "configured question repair is bounded and revalidated (%s)",
    async (mode) => {
        const repairSupported = mode === "repaired";
        const input = snapshot();
        let generationCalls = 0;
        let validationCalls = 0;
        const model: ChatModel = {
            completionSettings: {},
            inspectRequest,
            complete: async (messages, _options, schema) => {
                if (typeof messages === "string")
                    throw new Error("Expected labeled messages");
                const payload = JSON.parse(String(messages[1].content));
                if (
                    schema &&
                    !Array.isArray(schema) &&
                    "name" in schema &&
                    schema.name === "schema_view_answers"
                ) {
                    generationCalls++;
                    if (mode === "transportFailure")
                        throw new Error("Synthetic transport failure");
                    if (generationCalls === 2) {
                        expect(payload.input.inputs).toHaveLength(2);
                        expect(payload.previousArtifact.kind).toBe(
                            "schemaView",
                        );
                        expect(payload.supportReport.supported).toBe(false);
                        expect(String(messages[0].content)).toContain(
                            "not evidence",
                        );
                        expect(String(messages[0].content)).toContain(
                            "including unselected and rejected candidates",
                        );
                        expect(String(messages[0].content)).toContain(
                            "candidate's own passageIds",
                        );
                    }
                    return {
                        success: true,
                        data: JSON.stringify(answers(generationCalls > 1)),
                    };
                }
                validationCalls++;
                const report = support(
                    {
                        content: payload.output.content,
                        relationships: payload.output.relationships,
                        outcome: "schemaAnswers",
                        missingEvidence: [],
                    },
                    validationCalls > 1 && repairSupported,
                );
                if (mode === "incompleteAudit") report.sections = [];
                return {
                    success: true,
                    data: JSON.stringify(report),
                };
            },
        };
        const adapter = createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            model,
        );
        const job: ViewBuildJob = {
            jobId: "job",
            corpusId: input.corpusId,
            fingerprint: input.fingerprint,
            request: {
                corpusId: input.corpusId,
                expectedHead: null,
                targets: [{ definition: input.definition, expectedVersion: 0 }],
                publication: false,
            },
            actor: "test",
            createdAt: "2031-04-09T00:00:00Z",
            updatedAt: "2031-04-09T00:00:00Z",
            state: "running",
            results: [
                {
                    viewId: input.definition.viewId,
                    snapshot: input,
                    state: "pending",
                    reason: "",
                },
            ],
            publication: false,
        };
        let materializations = 0;
        let finish!: () => void;
        const finished = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const runner = new ViewBuildRunner(adapter, {
            update: async (_corpusId, _jobId, update) => {
                update(job);
                if (job.state !== "running") finish();
                return job;
            },
            current: async () => undefined,
            materialize: async (_job, result, candidate) => {
                materializations++;
                expect(candidate.content.sections[0].details).toMatchObject({
                    answerState: "answered",
                });
                result.state = "draft";
            },
        });
        try {
            runner.start(job);
            await finished;
            await runner.close();
            expect(generationCalls).toBe(
                mode === "incompleteAudit" || mode === "transportFailure"
                    ? 1
                    : 2,
            );
            expect(validationCalls).toBe(
                mode === "transportFailure"
                    ? 0
                    : mode === "incompleteAudit"
                      ? 1
                      : repairSupported
                        ? 3
                        : 2,
            );
            expect(materializations).toBe(repairSupported ? 1 : 0);
            expect(job.results[0].state).toBe(
                mode === "transportFailure"
                    ? "failed"
                    : repairSupported
                      ? "draft"
                      : "blocked",
            );
        } finally {
            await runner.close();
        }
    },
);

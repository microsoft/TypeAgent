// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ChatModel,
    StructuredOutputJsonSchema,
} from "@typeagent/aiclient";
import { openai } from "@typeagent/aiclient";
import {
    hydrateSchemaAnswers,
    schemaAnswerResponse,
} from "../src/schemaViewSynthesis.js";
import {
    compactSchemaAudit,
    labelViewInput,
    retainedPassages,
} from "../src/viewSynthesisEvidence.js";
import { createConfiguredViewSynthesisAdapter } from "../src/viewSynthesis.js";
import {
    consolidationScopeSchema,
    parseConsolidationScope,
} from "../src/wikiConsolidation.js";
import type { ViewBuildSnapshot, ViewVersion } from "../src/viewTypes.js";

function snapshot(): ViewBuildSnapshot {
    const text = `Shared clock 2031-04-09: branch alpha at 08:10, beta at 13:45. ${"Exact retained context. ".repeat(100)}`;
    return {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        pipeline: "schema-defined-v1",
        model: "offline",
        fingerprint: "frozen",
        definition: {
            viewId: "branches",
            kind: "schemaView",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "revision" }],
            },
            schemaView: {
                construction: "schema-defined-v1",
                title: "Branches",
                template: "questions-v1",
                discovery: { enabled: false, maxProposals: 0 },
                slots: ["branch", "proposed", "rejected"].map((id, index) => ({
                    id,
                    question: "Which branch is active?",
                    cardinality: "singleton",
                    schema: { type: "string" },
                    rubric: {
                        version: 1,
                        selection: "mostRecent",
                        requireConfirmation: false,
                        authoritySourceIds: [],
                    },
                    approval:
                        index === 0
                            ? "approved"
                            : index === 1
                              ? "proposed"
                              : "rejected",
                    discoveryCitations: [],
                })),
            },
        },
        inputs: [
            {
                sourceId: "source",
                revisionId: "revision",
                title: "Shared clock",
                content: text,
                contentHash: "hash",
                assertionLineage: {
                    owner: "owner",
                    independenceKey: "independent",
                    derivedFrom: ["original"],
                },
            },
        ],
    };
}

function answer(value = "alpha") {
    return {
        valueJson: JSON.stringify(value),
        effectiveAt: "",
        localTimestamp: `2031-04-09T${value === "beta" ? "13:45" : "08:10"}`,
        localTimeScope: "Shared clock",
        passageIds: ["p0-0"],
        chronologyPassageIds: ["p0-0"],
        opposingPassageIds: [] as string[],
    };
}
function validAnswers() {
    return {
        answers: [{ slotId: "branch", candidates: [answer(), answer("beta")] }],
    };
}

function controlledModel(
    responses: unknown[],
    afterCall?: (call: number) => void,
) {
    const calls: Array<{
        input: Record<string, unknown>;
        schema: StructuredOutputJsonSchema;
        instructions: string;
    }> = [];
    const model: ChatModel = {
        completionSettings: {},
        inspectRequest: openai.createChatModel(
            {
                provider: "azure",
                modelType: openai.ModelType.Chat,
                apiKey: "synthetic-key",
                endpoint: "https://synthetic.invalid/structural-inspection",
                supportsResponseFormat: true,
                requestConstraints: {
                    inputTokens: 2000000,
                    contextTokens: 2200000,
                    outputTokens: 16000,
                },
            },
            { response_format: { type: "json_object" } },
        ).inspectRequest!,
        complete: async (messages, _options, schema) => {
            if (
                typeof messages === "string" ||
                !schema ||
                Array.isArray(schema)
            )
                throw new Error("Expected structured messages");
            calls.push({
                input: JSON.parse(String(messages[1].content)),
                schema,
                instructions: String(messages[0].content),
            });
            afterCall?.(calls.length);
            return {
                success: true,
                data: JSON.stringify(
                    responses[Math.min(calls.length - 1, responses.length - 1)],
                ),
            };
        },
    };
    return {
        adapter: createConfiguredViewSynthesisAdapter(undefined, 4000, model),
        calls,
        model,
    };
}

test("answer wire schema binds approved IDs and their exact count", () => {
    const response = schemaAnswerResponse(snapshot());
    const schema = response.schema as {
        properties: {
            answers: {
                minItems: number;
                maxItems: number;
                items: { properties: { slotId: { enum: string[] } } };
            };
        };
    };
    expect(schema.properties.answers.minItems).toBe(1);
    expect(schema.properties.answers.maxItems).toBe(1);
    expect(schema.properties.answers.items.properties.slotId.enum).toEqual([
        "branch",
    ]);
});

test.each([
    [
        "duplicate",
        { answers: [validAnswers().answers[0], validAnswers().answers[0]] },
        "Duplicate slot answer",
    ],
    [
        "unknown",
        { answers: [{ slotId: "invented", candidates: [] }] },
        "non-approved or unknown",
    ],
    [
        "proposed",
        { answers: [{ slotId: "proposed", candidates: [] }] },
        "non-approved or unknown",
    ],
    [
        "rejected",
        { answers: [{ slotId: "rejected", candidates: [] }] },
        "non-approved or unknown",
    ],
    ["missing", { answers: [] }, "One answer is required"],
    [
        "missing evidence roles",
        {
            answers: [
                {
                    slotId: "branch",
                    candidates: [
                        { ...answer(), chronologyPassageIds: undefined },
                    ],
                },
            ],
        },
        "Explicit chronology passage bindings are required",
    ],
    [
        "reference",
        {
            answers: [
                {
                    slotId: "branch",
                    candidates: [{ ...answer(), passageIds: ["p9-0"] }],
                },
            ],
        },
        "Unknown retained passage",
    ],
] as const)(
    "one structural correction repairs %s against identical frozen evidence",
    async (_name, malformed, reason) => {
        const input = snapshot();
        const original = structuredClone(input);
        expect(() => hydrateSchemaAnswers(input, malformed, true)).toThrow(
            reason,
        );
        const { adapter, calls } = controlledModel([malformed, validAnswers()]);
        const output = await adapter.generate(
            input,
            new AbortController().signal,
        );
        expect(calls).toHaveLength(2);
        expect(calls[0].input).toEqual(
            labelViewInput(input, retainedPassages(input)),
        );
        expect(calls[1].input.originalInput).toEqual(calls[0].input);
        expect(calls[1].input.rejectedResponse).toEqual(malformed);
        expect(calls[1].schema).toEqual(calls[0].schema);
        expect(input).toEqual(original);
        expect(
            output.content.sections[0].details?.kind === "question" &&
                output.content.sections[0].details.candidates,
        ).toHaveLength(2);
    },
);

test("structural exhaustion never silently merges duplicate outer answers", async () => {
    const duplicate = {
        answers: [validAnswers().answers[0], validAnswers().answers[0]],
    };
    const { adapter, calls } = controlledModel([duplicate]);
    await expect(
        adapter.generate(snapshot(), new AbortController().signal),
    ).rejects.toThrow("Duplicate slot answer");
    expect(calls).toHaveLength(2);
});

test("a repaired candidate still runs all chronology guards", async () => {
    const badTime = validAnswers();
    badTime.answers[0].candidates[0].localTimestamp = "2031-02-30T08:10";
    const { adapter, calls } = controlledModel([{ answers: [] }, badTime]);
    await expect(
        adapter.generate(snapshot(), new AbortController().signal),
    ).rejects.toThrow(/local chronology/);
    expect(calls).toHaveLength(2);
});

test.each([1, 2])(
    "cancellation on structural call %s prevents further calls and output",
    async (at) => {
        const controller = new AbortController();
        const { adapter, calls } = controlledModel(
            [{ answers: [] }, validAnswers()],
            (call) => {
                if (call === at)
                    controller.abort(
                        new Error("cancelled structural correction"),
                    );
            },
        );
        await expect(
            adapter.generate(snapshot(), controller.signal),
        ).rejects.toThrow("cancelled structural correction");
        expect(calls).toHaveLength(at);
    },
);

const validScope = {
    relation: "samePurpose",
    reason: "same-scoped-purpose",
    scope: { system: "Payments", initiative: "", purpose: "Branch chronology" },
    criticalDistinctions: [
        {
            fragmentId: "f0",
            statement: "Earlier and later observations are distinct.",
        },
    ],
};
function scopeInput() {
    const input = snapshot();
    input.inputs[0].passages = [
        {
            sourceId: "source",
            revisionId: "revision",
            locator: `chars:0-${input.inputs[0].content.length}`,
            excerpt: input.inputs[0].content,
        },
    ];
    return input;
}
function articles() {
    return {
        viewId: "article",
        content: {
            kind: "wiki",
            title: "Branches",
            sections: [],
            citations: [],
        },
    } as unknown as ViewVersion;
}

test.each([
    [{ ...validScope, reason: "distinct-scope" }, "relation-reason"],
    [
        { ...validScope, scope: { ...validScope.scope, system: " " } },
        "empty-identity",
    ],
    [
        {
            ...validScope,
            scope: { ...validScope.scope, initiative: "x".repeat(201) },
        },
        "text-bounds",
    ],
    [
        {
            ...validScope,
            criticalDistinctions: [
                { fragmentId: "f9", statement: "Unretained" },
            ],
        },
        "fragment-reference",
    ],
    [
        {
            ...validScope,
            criticalDistinctions: [
                ...validScope.criticalDistinctions,
                ...validScope.criticalDistinctions,
            ],
        },
        "duplicate-distinction",
    ],
    [{ ...validScope, executionAuthority: true }, "shape"],
])("wiki scope rejection has safe subcode %s", async (malformed, code) => {
    const input = scopeInput();
    expect(() => parseConsolidationScope(malformed, input)).toThrow(
        `invalid-scoped-purpose:${code}`,
    );
    const original = structuredClone(input);
    const { adapter, calls } = controlledModel([malformed, validScope]);
    expect(
        await adapter.assessWikiConsolidation!(
            input,
            articles(),
            articles(),
            new AbortController().signal,
        ),
    ).toEqual(validScope);
    expect(calls).toHaveLength(2);
    const { rejectedResponse, rejectionCode, ...unchanged } = calls[1].input;
    expect(unchanged).toEqual(calls[0].input);
    expect(rejectedResponse).toEqual(malformed);
    expect(rejectionCode).toBe(
        `Wiki consolidation rejected: invalid-scoped-purpose:${code}`,
    );
    expect(calls[1].schema).toEqual(consolidationScopeSchema(input));
    expect(input).toEqual(original);
});

test("non-schema wiki synthesis retains legacy model support without request inspection", async () => {
    const { adapter, calls, model } = controlledModel([validScope]);
    delete model.inspectRequest;
    expect(
        await adapter.assessWikiConsolidation!(
            scopeInput(),
            articles(),
            articles(),
            new AbortController().signal,
        ),
    ).toEqual(validScope);
    expect(calls).toHaveLength(1);
});

test("wiki scope correction exhaustion never converts malformed scope to a merge", async () => {
    const { adapter, calls } = controlledModel([
        { ...validScope, reason: "distinct-scope" },
    ]);
    await expect(
        adapter.assessWikiConsolidation!(
            scopeInput(),
            articles(),
            articles(),
            new AbortController().signal,
        ),
    ).rejects.toThrow("invalid-scoped-purpose:relation-reason");
    expect(calls).toHaveLength(2);
});

test.each([1, 2])(
    "wiki scope cancellation on call %s prevents further processing",
    async (at) => {
        const controller = new AbortController();
        const { adapter, calls } = controlledModel(
            [{ ...validScope, reason: "distinct-scope" }, validScope],
            (call) => {
                if (call === at)
                    controller.abort(new Error("cancelled scope correction"));
            },
        );
        await expect(
            adapter.assessWikiConsolidation!(
                scopeInput(),
                articles(),
                articles(),
                controller.signal,
            ),
        ).rejects.toThrow("cancelled scope correction");
        expect(calls).toHaveLength(at);
    },
);

function auditFixture(count: number) {
    const input = snapshot();
    const raw = validAnswers();
    raw.answers[0].candidates = Array.from({ length: count }, (_, index) => ({
        ...answer(`branch-${index}`),
        localTimestamp: `2031-04-09T08:${String(10 + index).padStart(2, "0")}`,
        opposingPassageIds: index === 0 ? ["p0-0"] : [],
    }));
    const output = hydrateSchemaAnswers(input, raw);
    if (output.content.kind !== "schemaView") throw new Error("Wrong fixture");
    for (const [
        index,
        candidate,
    ] of output.content.sections[0].details.candidates.entries())
        candidate.review = index === 1 ? "rejected" : "unreviewed";
    return { input, output };
}

function expandAudit(
    value: unknown,
    audit: ReturnType<typeof compactSchemaAudit>,
): unknown {
    if (Array.isArray(value))
        return value.map((entry) => expandAudit(entry, audit));
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (
        Object.keys(object).length === 1 &&
        typeof object.evidenceId === "string"
    ) {
        const evidence = audit.evidence.find(
            (entry) => entry.id === object.evidenceId,
        );
        if (!evidence) throw new Error("Missing audit evidence reference");
        if ("citation" in evidence) return evidence.citation;
        const passage = retainedPassages(
            audit.input as unknown as ViewBuildSnapshot,
        ).find((entry) => entry.passageId === evidence.passageId);
        if (!passage) throw new Error("Missing audit passage reference");
        const { passageId: _id, ...citation } = passage;
        return citation;
    }
    return Object.fromEntries(
        Object.entries(object).map(([key, entry]) => [
            key,
            expandAudit(entry, audit),
        ]),
    );
}

test("schema audit preserves every selected, unselected and rejected candidate, chronology, lineage and relationship losslessly", () => {
    const { input, output } = auditFixture(12);
    const original = structuredClone(output);
    const audit = compactSchemaAudit(input, output);
    expect(
        audit.output.content.sections[0].details.selectedCandidateIds,
    ).toHaveLength(1);
    expect(audit.output.content.sections[0].details.candidates[1].review).toBe(
        "rejected",
    );
    expect(expandAudit(audit.output, audit)).toEqual({
        content: output.content,
        relationships: output.relationships,
        outcome: output.outcome,
        missingEvidence: output.missingEvidence,
    });
    expect(audit.evidence).toEqual([{ id: "e0", passageId: "p0-0" }]);
    expect(JSON.stringify(audit).split(input.inputs[0].content)).toHaveLength(
        2,
    );
    expect(output).toEqual(original);
});

test("repeated candidate evidence grows by references, not multiplied full passages", () => {
    const small = auditFixture(1);
    const large = auditFixture(20);
    const smallAudit = JSON.stringify(
        compactSchemaAudit(small.input, small.output),
    );
    const largeAudit = JSON.stringify(
        compactSchemaAudit(large.input, large.output),
    );
    expect(largeAudit.length - smallAudit.length).toBeLessThan(19 * 1600);
    expect(largeAudit.length).toBeLessThan(JSON.stringify(large).length / 2);
    expect(largeAudit.split(large.input.inputs[0].content)).toHaveLength(2);
});

test.each(["sourceId", "revisionId", "excerpt", "locator"] as const)(
    "audit fails closed on missing/corrupt %s references",
    (field) => {
        const { input, output } = auditFixture(2);
        if (output.content.kind !== "schemaView")
            throw new Error("Wrong fixture");
        output.content.sections[0].details.candidates[1].support[0].citation = {
            ...output.content.sections[0].details.candidates[1].support[0]
                .citation,
            [field]: "missing-reference",
        };
        expect(() => compactSchemaAudit(input, output)).toThrow(
            "Audit citation does not match frozen retained evidence",
        );
    },
);

test("configured schema audit sends reference payload and still exposes every alternative to the independent checker", async () => {
    const { input, output } = auditFixture(4);
    const { adapter, calls } = controlledModel([
        {
            supported: false,
            sections: output.content.sections.map((section) => ({
                sectionId: section.id,
                supported: false,
                reason: "Unsupported rejected alternative",
            })),
            relationships: output.relationships.map((edge) => ({
                edgeId: edge.id,
                supported: true,
                reason: "Exact citation",
            })),
            missingContext: [],
            reasons: ["Unsupported rejected alternative"],
        },
    ]);
    const report = await adapter.validate(
        input,
        output,
        new AbortController().signal,
    );
    expect(report.supported).toBe(false);
    const expected = compactSchemaAudit(input, output);
    expect(calls[0].input.output).toEqual(expected.output);
    expect(calls[0].input.evidence).toEqual(expected.evidence);
    expect(calls[0].instructions).toContain("including unselected/rejected");
});

test("exact subpassage citations and event provenance survive reference compaction", () => {
    const input = snapshot();
    input.inputs[0].evidence = { kind: "event", eventId: "event-identity" };
    const output = hydrateSchemaAnswers(input, validAnswers());
    if (output.content.kind !== "schemaView") throw new Error("Wrong fixture");
    const citation =
        output.content.sections[0].details.candidates[0].citations[0];
    output.content.citations.push({
        ...citation,
        locator: "chars:0-12",
        excerpt: input.inputs[0].content.slice(0, 12),
    });

    const audit = compactSchemaAudit(input, output);
    expect(audit.evidence).toHaveLength(2);
    expect(expandAudit(audit.output, audit)).toEqual({
        content: output.content,
        relationships: output.relationships,
        outcome: output.outcome,
        missingEvidence: output.missingEvidence,
    });
    const invalid = structuredClone(output);
    invalid.content.citations[0].evidence = {
        kind: "event",
        eventId: "other-event",
    };
    expect(() => compactSchemaAudit(input, invalid)).toThrow(
        "Audit citation does not match frozen retained evidence",
    );
});

test("candidate values that resemble citation references remain literal values", () => {
    const input = snapshot();
    input.definition.schemaView!.slots[0].schema = {
        type: "object",
        properties: {
            evidenceId: { type: "string" },
            excerpt: { type: "string" },
        },
        required: ["evidenceId", "excerpt"],
    };
    const raw = validAnswers();
    const value = {
        evidenceId: "literal-value-not-reference",
        excerpt: "Literal candidate data",
    };
    raw.answers[0].candidates = [
        { ...answer(), valueJson: JSON.stringify(value) },
    ];
    const output = hydrateSchemaAnswers(input, raw);
    const audit = compactSchemaAudit(input, output);
    expect(
        audit.output.content.sections[0].details.candidates[0].value,
    ).toEqual(value);
});

test("synthesis timing records only safe call kinds and sizes, not retained text", async () => {
    const previous = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
    const logs: string[] = [];
    const spy = import.meta.jest
        .spyOn(console, "warn")
        .mockImplementation((message) => logs.push(String(message)));
    try {
        const { adapter } = controlledModel([{ answers: [] }, validAnswers()]);
        await adapter.generate(snapshot(), new AbortController().signal);
        const timings = logs
            .filter((line) => line.startsWith("[memory-search-timing] "))
            .map((line) =>
                JSON.parse(line.slice("[memory-search-timing] ".length)),
            );
        expect(timings.map((timing) => timing.metadata.callKind)).toEqual([
            "normal",
            "contract-repair",
        ]);
        expect(
            timings.every(
                (timing) =>
                    timing.scope === "memory.view.model" &&
                    timing.metadata.messageCharacters > 0,
            ),
        ).toBe(true);
        expect(logs.join("\n")).not.toContain("Exact retained context");
        expect(logs.join("\n")).not.toContain("Which branch is active?");
    } finally {
        spy.mockRestore();
        if (previous === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = previous;
    }
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ChatModel,
    StructuredOutputJsonSchema,
} from "@typeagent/aiclient";
import {
    parseWikiChoices,
    wikiChoiceMessages,
    wikiChoiceSchema,
} from "../src/wikiDecision.js";
import { consequenceKinds } from "../src/viewEditorial.js";
import type {
    ViewBuildSnapshot,
    ViewSynthesisOutput,
    ViewVersion,
} from "../src/viewTypes.js";

const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
const factories: Array<{ endpoint: unknown; settings: unknown }> = [];
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    openai: {
        ...actual.openai,
        hasChatModelEndpoint: () => false,
        getChatModelSettings: () => ({ provider: "azure" }),
        createChatModel(endpoint: unknown, settings: unknown) {
            factories.push({ endpoint, settings });
            return {
                completionSettings: settings,
                async complete(
                    _messages: unknown,
                    _usage: unknown,
                    schema: StructuredOutputJsonSchema,
                ) {
                    return {
                        success: true,
                        data: JSON.stringify(
                            schema.name === "wiki_choice_answers"
                                ? answer({ completeness: "partial" })
                                : draft,
                        ),
                    };
                },
            };
        },
    },
}));
const { createConfiguredViewSynthesisAdapter } = await import(
    "../src/viewSynthesis.js"
);

const questions = {
    q: {
        instructions: "Judge actual explanatory coverage.",
        criteria: { yes: "Supported.", no: "Unsupported." },
    },
};
const answer = (choices: Record<string, string>) => ({
    answers: Object.fromEntries(
        Object.entries(choices).map(([id, choice]) => [
            id,
            { type: "choice", choice },
        ]),
    ),
});

test("strict Wiki answer schema contains only offered typed choices, never scores", () => {
    const schema = wikiChoiceSchema(questions);
    expect(schema.strict).toBe(true);
    expect(JSON.stringify(schema)).not.toMatch(/probabilities|confidence/);
    expect(JSON.stringify(schema)).toContain('"additionalProperties":false');
    const messages = wikiChoiceMessages(
        { completeEvidence: "Original source; FINAL QUALIFICATION." },
        questions,
    );
    expect(JSON.parse(messages[1].content)).toEqual({
        state: { completeEvidence: "Original source; FINAL QUALIFICATION." },
        questions: { q: { type: "choice", ...questions.q } },
    });
    expect(
        parseWikiChoices(JSON.stringify(answer({ q: "yes" })), questions),
    ).toEqual({ q: "yes" });
});

test.each([
    { answers: {} },
    { ...answer({ q: "yes" }), explanation: "Extra prose" },
    answer({ q: "unknown" }),
    answer({ q: "yes", extra: "yes" }),
    { answers: { q: { type: "choice", choice: "yes", confidence: 1 } } },
    {
        answers: {
            q: {
                type: "choice",
                choice: "yes",
                probabilities: { yes: 1, no: 0 },
            },
        },
    },
    { answers: { q: { type: "score", choice: "yes" } } },
])(
    "choice-only responses reject contract drift without fabricating scores: %j",
    (raw) => {
        expect(() =>
            parseWikiChoices(JSON.stringify(raw), questions),
        ).toThrow();
    },
);

test("choice-only response parsing preserves special question IDs and rejects invalid JSON", () => {
    const special = Object.fromEntries([["__proto__", questions.q]]);
    expect(
        parseWikiChoices(
            JSON.stringify(answer({ ["__proto__"]: "yes" })),
            special,
        ),
    ).toEqual({ ["__proto__"]: "yes" });
    expect(() => parseWikiChoices("not JSON", questions)).toThrow();
    expect(() => wikiChoiceMessages({}, {})).toThrow("at least one");
    expect(() =>
        wikiChoiceMessages({}, { q: { instructions: "Empty", criteria: {} } }),
    ).toThrow("offered choices");
});

function snapshot(): ViewBuildSnapshot {
    return {
        corpusId: "corpus",
        actor: "offline-test",
        expectedVersion: 0,
        bounds: {},
        pipeline: "informational-wiki-v1",
        model: "test",
        fingerprint: "frozen",
        definition: {
            viewId: "article",
            kind: "wiki",
            selector: { kind: "sources", sources: [] },
            wiki: {
                construction: "informational-wiki-v1",
                query: "Clock",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        inputs: [
            {
                sourceId: "source",
                revisionId: "revision",
                title: "Clock",
                content: "Clock owns its lease; approval remains unknown.",
                contentHash: "a".repeat(64),
                passages: [
                    {
                        sourceId: "source",
                        revisionId: "revision",
                        locator: "complete",
                        excerpt:
                            "Clock owns its lease; approval remains unknown.",
                    },
                ],
            },
        ],
    };
}
const draft = {
    title: "Clock",
    summary: "Clock owns its lease.",
    status: "sufficient",
    prose: "Clock owns its lease; approval remains unknown.",
    limits: "Selected sources only.",
    citationIds: ["f0"],
};
const assessment = {
    disposition: "distinct",
    deferBasis: "",
    purpose: "Explain Clock leases",
    reason: "A substantive standalone reference.",
    canonicalViewId: "",
    sharedFragmentIds: [],
    ambiguousViewIds: [],
    essentialDistinctions: [],
};
function controlled(
    choose: (request: {
        state: Record<string, unknown>;
        questions: Record<string, unknown>;
    }) => unknown,
    afterChoice?: () => void,
    editorial: unknown = {
        safe: false,
        failures: ["scope-state"],
        diagnostics: [
            {
                kind: "scope-state",
                location: "/content/title",
                reason: "Approval is not established by the original evidence.",
                evidenceIds: ["f0"],
                correction: "Preserve the unknown approval state.",
            },
        ],
    },
) {
    const calls: Array<{
        name: string;
        input: Record<string, unknown>;
        instructions: string;
        schema: StructuredOutputJsonSchema;
    }> = [];
    const model: ChatModel = {
        completionSettings: {},
        async complete(messages, _usage, schema) {
            if (
                typeof messages === "string" ||
                !schema ||
                Array.isArray(schema)
            )
                throw new Error("Expected structured call");
            const input = JSON.parse(String(messages[1].content));
            calls.push({
                name: schema.name,
                input,
                instructions: String(messages[0].content),
                schema,
            });
            let raw: unknown;
            if (schema.name === "wiki_choice_answers") {
                raw = choose(input);
                afterChoice?.();
            } else if (schema.name === "wiki_subject_purpose") raw = assessment;
            else if (schema.name === "wiki_consolidation_scope")
                raw = {
                    relation: "samePurpose",
                    reason: "same-scoped-purpose",
                    scope: {
                        system: "Clock",
                        initiative: "",
                        purpose: "Explain Clock leases",
                    },
                    criticalDistinctions: [
                        {
                            fragmentId: "f0",
                            statement: "Approval remains unknown.",
                        },
                    ],
                };
            else if (schema.name === "editorial_consequences") raw = editorial;
            else raw = draft;
            return { success: true, data: JSON.stringify(raw) };
        },
    };
    return {
        calls,
        adapter: createConfiguredViewSynthesisAdapter(undefined, 4000, model),
    };
}

test("admission preserves evidence preparation but final bounded authority uses choice-only answers", async () => {
    const { adapter, calls } = controlled((request) =>
        answer(
            "utility" in request.questions
                ? { utility: "useful" }
                : { disposition: "distinct", canonical: "none" },
        ),
    );
    expect(
        await adapter.assessWikiSubject!(
            snapshot(),
            [],
            new AbortController().signal,
        ),
    ).toEqual({
        ...assessment,
        deferBasis: undefined,
    });
    expect(calls.map((c) => c.name)).toEqual([
        "wiki_subject_purpose",
        "wiki_choice_answers",
        "wiki_choice_answers",
    ]);
    expect(Object.keys(calls[1].input.state as object).sort()).toEqual([
        "aliases",
        "fragments",
        "query",
    ]);
    expect(calls[1].input.state).not.toHaveProperty("pages");
    expect(calls[1].input.state).not.toHaveProperty("preparedAssessment");
});

test("a conflicting or uncertain bounded verdict fails closed without repairing or accepting prepared metadata", async () => {
    const { adapter, calls } = controlled(() =>
        answer({ utility: "uncertain" }),
    );
    await expect(
        adapter.assessWikiSubject!(
            snapshot(),
            [],
            new AbortController().signal,
        ),
    ).rejects.toThrow("utility rejected");
    expect(calls).toHaveLength(2);
});

test("Wiki completeness can change only status, not authored prose or source evidence", async () => {
    const { adapter, calls } = controlled(() =>
        answer({ completeness: "partial" }),
    );
    const output = await adapter.generate(
        snapshot(),
        new AbortController().signal,
    );
    if (output.content.kind !== "wiki")
        throw new Error("Expected Wiki content");
    expect(output.content.status).toBe("partial");
    expect(output.content.summary).toBe(draft.summary);
    expect(output.content.sections[0].body).toBe(draft.prose);
    expect(calls).toHaveLength(2);
    expect(calls[1].input.state).toMatchObject({
        fragments: snapshot().inputs[0].passages,
        content: { summary: draft.summary },
    });
});

test("repaired informational Wiki prose also receives an independent completeness verdict", async () => {
    const { adapter, calls } = controlled(() =>
        answer({ completeness: "partial" }),
    );
    const output = await adapter.repairInformational!(
        snapshot(),
        {
            outcome: "knowledgePages",
            content: {
                kind: "wiki",
                construction: "informational-wiki-v1",
                index: [],
                title: "Clock",
                sections: [],
                citations: [],
            },
            relationships: [],
            missingEvidence: [],
        },
        { safe: false, failures: ["scope-state"] },
        new AbortController().signal,
    );
    expect(output.content).toMatchObject({
        status: "partial",
        summary: draft.summary,
        sections: [{ body: draft.prose }],
    });
    expect(calls.map(({ name }) => name)).toEqual([
        "informational_wiki",
        "wiki_choice_answers",
    ]);
    expect(calls[1].input.state).toMatchObject({
        fragments: snapshot().inputs[0].passages,
        content: { summary: draft.summary },
    });
});

test("Wiki editorial choices independently confirm output-bound factual diagnostics", async () => {
    const { adapter, calls } = controlled(() =>
        answer({
            safety: "unsafe",
            ...Object.fromEntries(
                consequenceKinds.map((kind) => [
                    kind,
                    kind === "scope-state" ? "fail" : "pass",
                ]),
            ),
        }),
    );
    const output: ViewSynthesisOutput = {
        outcome: "knowledgePages",
        content: {
            kind: "wiki",
            construction: "informational-wiki-v1",
            index: [],
            title: "Clock",
            summary: "Approved",
            sections: [],
            citations: [],
        },
        relationships: [],
        missingEvidence: [],
    };
    expect(
        await adapter.checkEditorial!(
            snapshot(),
            output,
            new AbortController().signal,
        ),
    ).toEqual({
        safe: false,
        failures: ["scope-state"],
        diagnostics: [
            {
                kind: "scope-state",
                location: "/content/title",
                quote: "Clock",
                reason: "Approval is not established by the original evidence.",
                evidence: [
                    {
                        fragmentId: "f0",
                        quote: snapshot().inputs[0].passages![0].excerpt,
                    },
                ],
                correction: "Preserve the unknown approval state.",
            },
        ],
    });
    expect(calls.map((c) => c.name)).toEqual([
        "editorial_consequences",
        "wiki_choice_answers",
    ]);
    expect(calls[1].input.state).toMatchObject({ content: output.content });
    expect(calls[1].input.state).not.toHaveProperty("preparedAssessment");
});

test("choice-only Wiki editorial categories retain unsupported-claim diagnostics without invented witnesses", async () => {
    const { adapter } = controlled(
        () =>
            answer({
                safety: "unsafe",
                ...Object.fromEntries(
                    consequenceKinds.map((kind) => [
                        kind,
                        kind === "unsupported-claim" ? "fail" : "pass",
                    ]),
                ),
            }),
        undefined,
        {
            safe: false,
            failures: ["unsupported-claim"],
            diagnostics: [
                {
                    kind: "unsupported-claim",
                    location: "/content/summary",
                    reason: "No supplied fragment establishes automatic deployment.",
                    evidenceIds: [],
                    correction: "Remove the unsupported deployment assertion.",
                },
            ],
        },
    );
    await expect(
        adapter.checkEditorial!(
            snapshot(),
            {
                outcome: "knowledgePages",
                content: {
                    kind: "wiki",
                    construction: "informational-wiki-v1",
                    index: [],
                    title: "Clock",
                    summary: "Clock deploys automatically.",
                    sections: [],
                    citations: [],
                },
                relationships: [],
                missingEvidence: [],
            },
            new AbortController().signal,
        ),
    ).resolves.toMatchObject({
        safe: false,
        failures: ["unsupported-claim"],
        diagnostics: [
            {
                quote: "Clock deploys automatically.",
                evidence: [],
            },
        ],
    });
});

test("Wiki editorial disagreement cannot accept or repair unconfirmed diagnostics", async () => {
    const { adapter } = controlled(() =>
        answer({
            safety: "safe",
            ...Object.fromEntries(
                consequenceKinds.map((kind) => [kind, "pass"]),
            ),
        }),
    );
    await expect(
        adapter.checkEditorial!(
            snapshot(),
            {
                outcome: "knowledgePages",
                content: {
                    kind: "wiki",
                    construction: "informational-wiki-v1",
                    index: [],
                    title: "Clock",
                    sections: [],
                    citations: [],
                },
                relationships: [],
                missingEvidence: [],
            },
            new AbortController().signal,
        ),
    ).rejects.toThrow("editorial rejected");
});

test("unsafe-without-categories is rejected rather than silently converted to safe", async () => {
    const { adapter } = controlled(() =>
        answer({
            safety: "unsafe",
            ...Object.fromEntries(
                consequenceKinds.map((kind) => [kind, "pass"]),
            ),
        }),
    );
    await expect(
        adapter.checkEditorial!(
            snapshot(),
            {
                outcome: "knowledgePages",
                content: {
                    kind: "wiki",
                    construction: "informational-wiki-v1",
                    index: [],
                    title: "Clock",
                    sections: [],
                    citations: [],
                },
                relationships: [],
                missingEvidence: [],
            },
            new AbortController().signal,
        ),
    ).rejects.toThrow("invalid-assessment");
});

test("post-completion cancellation is honored before accepting restricted answers", async () => {
    const controller = new AbortController();
    const { adapter, calls } = controlled(
        () => answer({ completeness: "partial" }),
        () => controller.abort(new Error("Cancelled offline decision")),
    );
    await expect(
        adapter.generate(snapshot(), controller.signal),
    ).rejects.toThrow("Cancelled offline decision");
    expect(calls).toHaveLength(2);
});

test("default Wiki decisions use Luna strict JSON while the prose endpoint and settings stay unchanged", async () => {
    factories.length = 0;
    await createConfiguredViewSynthesisAdapter("prose-endpoint").generate(
        snapshot(),
        new AbortController().signal,
    );
    expect(factories).toEqual([
        {
            endpoint: "prose-endpoint",
            settings: {
                temperature: 0,
                response_format: { type: "json_object" },
            },
        },
        {
            endpoint: actual.openai.GPT_6_LUNA,
            settings: {
                temperature: 1,
                response_format: { type: "json_object" },
            },
        },
    ]);
});

test("the actual SDK serializes Wiki choices as strict JSON schema rather than JSON mode alone", () => {
    const model = actual.openai.createChatModel(
        {
            provider: "azure",
            modelType: actual.openai.ModelType.Chat,
            apiKey: "synthetic-key",
            endpoint: "https://synthetic.invalid/wiki-decisions",
            supportsResponseFormat: true,
            requestConstraints: {
                inputTokens: 2000000,
                contextTokens: 2200000,
                outputTokens: 16000,
            },
        },
        { response_format: { type: "json_object" }, temperature: 1 },
    );
    const inspected = model.inspectRequest!(
        wikiChoiceMessages({ evidence: "Complete source." }, questions),
        wikiChoiceSchema(questions),
    );
    const wire = JSON.parse(inspected.serializedRequest);
    expect(wire.response_format).toEqual({
        type: "json_schema",
        json_schema: wikiChoiceSchema(questions),
    });
    expect(wire.messages).toEqual(
        wikiChoiceMessages({ evidence: "Complete source." }, questions),
    );
});

test("a conflicting final admission verdict cannot reuse the prepared evidence for a different disposition", async () => {
    const { adapter, calls } = controlled((request) =>
        answer(
            "utility" in request.questions
                ? { utility: "useful" }
                : { disposition: "covered", canonical: "none" },
        ),
    );
    await expect(
        adapter.assessWikiSubject!(
            snapshot(),
            [],
            new AbortController().signal,
        ),
    ).rejects.toThrow("admission rejected");
    expect(calls.map((call) => call.name)).toEqual([
        "wiki_subject_purpose",
        "wiki_choice_answers",
        "wiki_choice_answers",
    ]);
});

test("consolidation disagreement fails without changing scope metadata or attempting a repair", async () => {
    const input = snapshot();
    const article = (viewId: string): ViewVersion => ({
        corpusId: input.corpusId,
        viewId,
        revisionId: `${viewId}-revision`,
        version: 1,
        state: "draft",
        createdAt: "2031-04-09T14:00:00.000Z",
        actor: input.actor,
        definition: {
            ...input.definition,
            viewId,
            revisionId: `${viewId}-definition`,
        },
        content: {
            kind: "wiki",
            construction: "informational-wiki-v1",
            title: "Clock",
            index: [],
            sections: [],
            citations: [],
        },
        relationships: [],
        provenance: "generated",
    });
    const { adapter, calls } = controlled(() =>
        answer({ relation: "distinct" }),
    );
    await expect(
        adapter.assessWikiConsolidation!(
            input,
            article("one"),
            article("two"),
            new AbortController().signal,
        ),
    ).rejects.toThrow("consolidation rejected");
    expect(calls).toHaveLength(2);
});

test("restricted transport errors never become safe editorial outcomes", async () => {
    const { adapter } = controlled(() => {
        throw new Error("Restricted provider failure");
    });
    await expect(
        adapter.checkEditorial!(
            snapshot(),
            {
                outcome: "knowledgePages",
                missingEvidence: [],
                relationships: [],
                content: {
                    kind: "wiki",
                    construction: "informational-wiki-v1",
                    title: "Clock",
                    index: [],
                    sections: [],
                    citations: [],
                },
            },
            new AbortController().signal,
        ),
    ).rejects.toThrow("Restricted provider failure");
});

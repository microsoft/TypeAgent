// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel, DecisionModel } from "@typeagent/aiclient";
import type { ViewBuildSnapshot } from "../src/viewTypes.js";
import type { WikiAdmissionExperimentModelCall } from "../src/wikiAdmissionExperiment.js";

const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    openai: {
        ...actual.openai,
        getChatModelSettings: () => ({ provider: "azure" }),
    },
}));
const { createConfiguredViewSynthesisAdapter } = await import(
    "../src/viewSynthesis.js"
);
const { retainEditorialPassages, requiresEditorialCheck } = await import(
    "../src/viewEditorial.js"
);

function snapshot(): ViewBuildSnapshot {
    const text =
        "Academic support includes peer discussion and reading tutoring.";
    return {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        pipeline: "informational-wiki-v1",
        model: "test",
        fingerprint: "test",
        bounds: {},
        definition: {
            viewId: "academic",
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "revision" }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: "academic support",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        inputs: [
            {
                sourceId: "source",
                revisionId: "revision",
                title: "Original",
                content: text,
                contentHash: "hash",
                passages: [
                    {
                        sourceId: "source",
                        revisionId: "revision",
                        locator: "indexed:0",
                        excerpt: text,
                    },
                ],
            },
        ],
    };
}

function fixture(arm: "G0" | "D1") {
    const calls: WikiAdmissionExperimentModelCall[] = [];
    let decisions = 0;
    const model: ChatModel = {
        completionSettings: {},
        async complete(_messages, _options, schema) {
            if (!schema || Array.isArray(schema))
                throw new Error("Missing schema");
            return {
                success: true,
                data: JSON.stringify(
                    schema.name === "wiki_completeness"
                        ? { status: "sufficient" }
                        : {
                              title: "Academic support",
                              summary: "Academic support helps learners.",
                              prose: snapshot().inputs[0].content,
                              limits: "Examples, not an exhaustive inventory.",
                              citationIds: ["f0"],
                              ...(JSON.stringify(schema.schema).includes(
                                  '"status"',
                              )
                                  ? { status: "sufficient" }
                                  : {}),
                          },
                ),
            };
        },
    };
    const decision: DecisionModel = {
        provider: "azure",
        model: "decision-1",
        configGeneration: 1,
        providerSource: "factory",
        async decide(request) {
            decisions++;
            return {
                success: true,
                data: {
                    provider: "azure",
                    requestedModel: "decision-1",
                    answers: Object.fromEntries(
                        Object.keys(request.questions).map((id) => [
                            id,
                            {
                                type: "choice",
                                choice: "sufficient",
                                probabilities: { sufficient: 1 },
                            },
                        ]),
                    ),
                },
            };
        },
    };
    return {
        adapter: createConfiguredViewSynthesisAdapter(
            "test",
            4000,
            model,
            undefined,
            {
                arm,
                writerContract: "shared-prose-v1",
                ...(arm === "D1"
                    ? {
                          treatmentRevision: "decision-first-v2" as const,
                          decisionModel: decision,
                      }
                    : {}),
                onModelCall: (call) => {
                    calls.push(call);
                },
            },
        ),
        calls,
        decisions: () => decisions,
    };
}

test("shared G0/D1 writers have identical complete messages/schema and separate completeness backends", async () => {
    const g0 = fixture("G0"),
        d1 = fixture("D1");
    const input = snapshot(),
        signal = new AbortController().signal;
    const left = await g0.adapter.generate(input, signal);
    const right = await d1.adapter.generate(input, signal);
    expect(g0.calls[0].messages).toEqual(d1.calls[0].messages);
    expect(g0.calls[0].schema).toEqual(d1.calls[0].schema);
    expect(g0.calls[0].schema.schema).not.toHaveProperty("properties.status");
    expect(g0.calls).toHaveLength(2);
    expect(d1.calls).toHaveLength(1);
    expect(g0.decisions()).toBe(0);
    expect(d1.decisions()).toBe(1);
    expect(left.content).toEqual(right.content);
    expect(left.content.kind === "wiki" && left.content.status).toBe(
        "sufficient",
    );
});

test("six -> two -> six retrieval cannot erase retained original passages or churn effective evidence", () => {
    const first = Array.from({ length: 6 }, (_, index) => ({
        sourceId: "source",
        revisionId: "revision",
        locator: `indexed:${index}`,
        excerpt: [
            "Reading tutoring",
            "Mentoring",
            "Homework support",
            "College preparation",
            "Discussion",
            "Debate",
        ][index],
    }));
    const middle = retainEditorialPassages(first, first.slice(4));
    const last = retainEditorialPassages(middle, first);
    expect(middle).toEqual(first);
    expect(last).toEqual(first);
    expect(middle[0]).not.toBe(first[0]);
    const added = {
        ...first[0],
        locator: "indexed:new",
        excerpt: "New supported evidence",
    };
    expect(retainEditorialPassages(last, [added])).toEqual([...first, added]);
});

test.each(["G0", "D1"] as const)(
    "shared %s canonical contribution repair keeps prose-only authoring and separate completeness",
    async (arm) => {
        const f = fixture(arm),
            input = snapshot(),
            signal = new AbortController().signal;
        const previous = await f.adapter.generate(input, signal);
        input.wikiContribution = {
            candidateViewId: "incoming",
            query: "academic support",
            purpose: "Preserve supported academic support",
            essentialDistinctions: [
                {
                    fragmentId: "f0",
                    statement: input.inputs[0].content,
                    canonicalExcerpt: "",
                },
            ],
            priorProse: previous.content.sections[0].body,
        };
        const repaired = await f.adapter.repairWikiContribution!(
            input,
            previous,
            {
                disposition: "contribute",
                purpose: input.wikiContribution.purpose,
                reason: "Missing supported distinction",
                canonicalViewId: input.definition.viewId,
                sharedFragmentIds: ["f0"],
                ambiguousViewIds: [],
                essentialDistinctions:
                    input.wikiContribution.essentialDistinctions,
            },
            signal,
        );
        const repair = f.calls.find(
            (call) => call.callKind === "contract-repair",
        )!;
        expect(repair.schema.schema).not.toHaveProperty("properties.status");
        expect(
            repaired.content.kind === "wiki" && repaired.content.status,
        ).toBe("sufficient");
        expect(f.calls).toHaveLength(arm === "G0" ? 4 : 2);
        expect(f.decisions()).toBe(arm === "G0" ? 0 : 2);
    },
);

test("bounded editorial repair supplies rejected prose as diagnostics while retaining original support and prior claims", async () => {
    const f = fixture("G0"),
        input = snapshot();
    const signal = new AbortController().signal;
    const previous = await f.adapter.generate(input, signal);
    input.editorial = {
        generatedBaseId: "old",
        targetRevisionId: "old-r1",
        generatedBase: previous,
        protectedTargets: [],
        unlockedTargets: [],
    };
    const repaired = await f.adapter.repairWikiEditorial!(
        input,
        previous,
        { safe: false, failures: ["coverage"] },
        signal,
    );
    const writer = f.calls.find((call) => call.callKind === "contract-repair")!;
    if (typeof writer.messages === "string")
        throw new Error("Expected structured writer messages");
    const payload = JSON.parse(String(writer.messages[1].content));
    expect(payload.editorial.rejectedUpdate.failures).toEqual(["coverage"]);
    expect(payload.editorial.generatedBase).toEqual(previous);
    expect(payload.fragments[0].text).toBe(input.inputs[0].content);
    expect(repaired.content).toEqual(previous.content);
});

test("ordinary Wiki changes require preservation checks even without consequential keywords", async () => {
    const f = fixture("G0"),
        input = snapshot();
    const output = await f.adapter.generate(
        input,
        new AbortController().signal,
    );
    input.editorial = {
        generatedBaseId: "old",
        targetRevisionId: "old-revision",
        generatedBase: structuredClone(output),
        protectedTargets: [],
        unlockedTargets: [],
    };
    output.content.sections[0].body = "Peer discussion.";
    expect(requiresEditorialCheck(input, output)).toBe(true);
});

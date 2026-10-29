// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    configFromEnvRecord,
    getRuntimeConfig,
    setRuntimeConfig,
    type ChatModel,
} from "@typeagent/aiclient";
import { answerIntegratedEvidence } from "../src/integratedAnswer.js";
import { readIntegratedEvidence } from "../src/integratedAnswerReader.js";
import { runWithSearchCancellation } from "@typeagent/knowpro";
import {
    MemoryUnderstanding,
    assertUnderstandingBytes,
} from "../src/understanding.js";
import {
    parseUnderstanding,
    readUnderstanding,
    UnderstandingReaderUnavailable,
} from "../src/understandingReader.js";
import { UnderstandingStore } from "../src/understandingStore.js";
import type { AnswerEvidence, MemoryEvidence } from "../src/types.js";
import type {
    UnderstandingCandidates,
    UnderstandingHost,
    UnderstandingReaderResult,
} from "../src/understandingTypes.js";
import type { MemoryGraphQueryResult } from "../src/graphTypes.js";

const request = { corpusId: "corpus", question: "How did the gallery change?" };
const empty: UnderstandingCandidates = {
    dates: [],
    entities: [],
    warnings: [],
};
function source(id = "original", date = "2024-03-15"): MemoryEvidence {
    return {
        evidenceId: `${id}-fragment`,
        corpusId: "corpus",
        sourceId: id,
        revisionId: "r1",
        title: id,
        locator: "lines:1-2",
        snippet: `Session date: ${date}\nUser reported six gallery projects.`,
        sourceType: "text",
        score: 1,
        indexedAt: "2026-10-27T00:00:00Z",
    };
}
function response(ids = ["s0"]): UnderstandingReaderResult {
    return {
        schemaVersion: 1,
        status: "answered",
        title: "Gallery changes",
        summary: {
            text: "The user reported six projects.",
            evidenceIds: ids,
            role: "memory",
        },
        sections: [],
        unknowns: ["Intermediate changes are not established."],
        followUps: ["Was the change verified?"],
        moduleSignals: [],
        retrievalQueries: [],
    };
}
function graph(): MemoryGraphQueryResult {
    return {
        corpusId: "corpus",
        generation: "g1",
        state: "ready",
        nodes: ["Bootstrap", "user"].map((id) => ({
            id,
            label: id,
            kind: "entity",
            mentionCount: 1,
            supportCount: 1,
            types: [],
        })),
        edges: [
            {
                id: "edge",
                source: "user",
                target: "Bootstrap",
                type: "upgrade",
                count: 1,
                supportCount: 1,
            },
        ],
        counts: { nodes: 2, edges: 1, omittedNodes: 0, omittedEdges: 0 },
        limits: { maxNodes: 12, maxEdges: 16 },
        coverage: {
            documents: { state: "ready", total: 1, eligible: 1, indexed: 1 },
            events: { state: "unsupported", total: 0, eligible: 0, indexed: 0 },
            reasons: [],
        },
    };
}
describe("Understanding operation cancellation", () => {
    test("opt-in transient refinement recovery retains only revalidated initial content", async () => {
        const { engine: original, host, model } = fixture();
        original.close();
        const answer = host.answer;
        const id = "00000000-0000-4000-8000-000000000002";
        const engine = new MemoryUnderstanding(host, {
            model,
            refinementFallback: true,
        });
        host.answer = async (...args) => ({
            ...(await answer(...args)),
            evidenceSnapshotId: id,
            refinementPending: true,
        });
        const initial = await engine.understand({
            ...request,
            phase: "initial",
        });
        host.answer = async () => {
            throw new UnderstandingReaderUnavailable(
                new Error("offline transient"),
            );
        };
        const retained = await engine.understand({
            ...request,
            phase: "refine",
            evidenceSnapshotId: id,
        });
        expect(retained.snapshotId).toBe(initial.snapshotId);
        expect(retained.answer?.summary).toEqual(initial.answer?.summary);
        expect(retained.answer?.status).toBe("partial");
        expect(retained.refinementPending).toBe(false);
        expect(retained.refinementFailed).toBe(true);
        expect(retained.warnings.join(" ")).toContain(
            "refinement is incomplete",
        );
        host.validate = async () => false;
        await expect(
            engine.understand({
                ...request,
                phase: "refine",
                evidenceSnapshotId: id,
            }),
        ).rejects.toThrow("changed or was forgotten");
        engine.close();
    });

    test("generic errors and malformed model output never become successful refinement fallbacks", async () => {
        const { engine: original, host, model } = fixture();
        original.close();
        const engine = new MemoryUnderstanding(host, {
            model,
            refinementFallback: true,
        });
        host.answer = async () => {
            throw new Error("scope mismatch");
        };
        await expect(
            engine.understand({
                ...request,
                phase: "refine",
                evidenceSnapshotId: "00000000-0000-4000-8000-000000000002",
            }),
        ).rejects.toThrow("scope mismatch");
        engine.close();
        model.complete = async () => ({ success: true, data: "invalid JSON" });
        await expect(
            readUnderstanding({
                question: request.question,
                evidence: [{ id: "s0", kind: "source", source: source() }],
                candidates: empty,
                allowRefinement: false,
                model,
            }),
        ).rejects.not.toBeInstanceOf(UnderstandingReaderUnavailable);
    });

    test("cancel reaches the active reader and does not cross collection scope", async () => {
        const { engine, model } = fixture();
        const original = model.complete;
        const requestId = "00000000-0000-4000-8000-000000000001";
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        model.complete = async (
            _prompt,
            _settings,
            _schema,
            _callback,
            signal,
        ) => {
            if (!signal) throw new Error("Reader cancellation signal missing");
            entered();
            return new Promise<Awaited<ReturnType<ChatModel["complete"]>>>(
                (_resolve, reject) => {
                    signal.addEventListener(
                        "abort",
                        () => reject(signal.reason),
                        { once: true },
                    );
                },
            );
        };
        const pending = engine.understand({ ...request, requestId });
        const rejected = expect(pending).rejects.toThrow("cancelled");
        await started;
        await expect(
            engine.understand({ ...request, requestId }),
        ).rejects.toThrow("already active");
        expect(() =>
            engine.cancel({ corpusId: request.corpusId, requestId: "invalid" }),
        ).toThrow("UUID");
        expect(engine.cancel({ corpusId: "other", requestId })).toBe(false);
        expect(engine.cancel({ corpusId: request.corpusId, requestId })).toBe(
            true,
        );
        await rejected;
        expect(engine.cancel({ corpusId: request.corpusId, requestId })).toBe(
            false,
        );
        model.complete = original;
        expect(
            (await engine.understand({ ...request, requestId })).answer?.status,
        ).toBe("answered");
        engine.close();
    });

    test("batched validation receives all influencing evidence and source-set identity", async () => {
        const { engine, host } = fixture();
        let validations = 0;
        host.validateSnapshot = async (input, evidence, indexVersion) => {
            validations++;
            expect(input.corpusId).toBe(request.corpusId);
            expect(evidence.length).toBeGreaterThan(0);
            expect(indexVersion).toBe("index1");
            return true;
        };
        await engine.understand(request);
        expect(validations).toBeGreaterThan(0);
        engine.close();
    });
});

function fixture(originals = [source()]) {
    const calls: {
        evidence: AnswerEvidence[];
        candidates: UnderstandingCandidates;
        parentContext?: { question: string; answer?: string };
    }[] = [];
    const model: ChatModel = {
        completionSettings: {},
        complete: async (prompt) => {
            if (typeof prompt === "string")
                throw new Error("Expected messages");
            const content = prompt[prompt.length - 1].content;
            if (typeof content !== "string") throw new Error("Expected JSON");
            const input = JSON.parse(content) as (typeof calls)[number];
            calls.push(input);
            return {
                success: true,
                data: JSON.stringify(
                    response(input.evidence.slice(0, 1).map((item) => item.id)),
                ),
            };
        },
    };
    const host: UnderstandingHost = {
        validate: async () => true,
        answer: (request, reader) =>
            answerIntegratedEvidence(
                request,
                {
                    searchOriginal: async () => ({
                        query: request.question,
                        matches: originals,
                        warnings: [],
                        capabilitiesUsed: [],
                        indexVersion: "index1",
                    }),
                    getEligibleViewMatches: async () => ({ matches: [] }),
                    expandSource: async (ref) =>
                        originals.find(
                            (item) => item.sourceId === ref.sourceId,
                        ),
                    validateEvidence: async ({ request, evidence }) =>
                        host.validate(request, evidence),
                },
                { reader },
            ),
    };
    const engine = new MemoryUnderstanding(host, { model });
    return { engine, host, model, calls };
}

describe("strict understanding reader", () => {
    const evidence: AnswerEvidence[] = [
        { id: "s0", kind: "source", source: source() },
    ];
    test.each(["integrated", "understanding"])(
        "%s regenerates one inconsistent abstention with unchanged evidence",
        async (kind) => {
            const prompts: string[] = [];
            const model: ChatModel = {
                completionSettings: {},
                complete: async (prompt) => {
                    prompts.push(JSON.stringify(prompt));
                    const ids = prompts.length === 1 ? ["s0"] : [];
                    const data =
                        kind === "integrated"
                            ? {
                                  status: "noAnswer",
                                  answer: "The requested measurement is not recorded.",
                                  evidenceIds: ids,
                                  retrievalQueries: [],
                              }
                            : {
                                  ...response(ids),
                                  status: "noAnswer",
                              };
                    return { success: true, data: JSON.stringify(data) };
                },
            };
            const result =
                kind === "integrated"
                    ? await readIntegratedEvidence(request, evidence, {
                          model,
                      })
                    : await readUnderstanding({
                          question: request.question,
                          evidence,
                          candidates: empty,
                          allowRefinement: true,
                          model,
                      });
            expect(result.status).toBe("noAnswer");
            expect(prompts).toHaveLength(2);
            expect(prompts[1]).toContain("Regenerate from the same");
            expect(prompts[1]).toContain("User reported six gallery projects");
            expect(prompts[0]).toContain("Match every requested event");
        },
    );
    test.each(["status", "unknown citation", "malformed JSON", "cancelled"])(
        "integrated repair is bounded and does not recover %s by weakening validation",
        async (failure) => {
            let calls = 0;
            const controller = new AbortController();
            const model: ChatModel = {
                completionSettings: {},
                complete: async () => {
                    calls++;
                    if (failure === "cancelled")
                        controller.abort(new Error("reader cancelled"));
                    return {
                        success: true,
                        data:
                            failure === "malformed JSON"
                                ? "{"
                                : JSON.stringify({
                                      status: "noAnswer",
                                      answer: "Not established.",
                                      evidenceIds: [
                                          failure === "unknown citation"
                                              ? "unknown"
                                              : "s0",
                                      ],
                                      retrievalQueries: [],
                                  }),
                    };
                },
            };
            await expect(
                runWithSearchCancellation(controller.signal, () =>
                    readIntegratedEvidence(request, evidence, { model }),
                ),
            ).rejects.toThrow();
            expect(calls).toBe(failure === "status" ? 2 : 1);
        },
    );
    test("repair feedback cannot exceed the serialized reader request budget", async () => {
        let initialChars = 0;
        const valid: ChatModel = {
            completionSettings: {},
            complete: async (messages, _options, jsonSchema) => {
                initialChars = JSON.stringify({ messages, jsonSchema }).length;
                return {
                    success: true,
                    data: JSON.stringify({
                        status: "answered",
                        answer: "Six projects.",
                        evidenceIds: ["s0"],
                        retrievalQueries: [],
                    }),
                };
            },
        };
        await readIntegratedEvidence(request, evidence, { model: valid });
        let calls = 0;
        await expect(
            readIntegratedEvidence(request, evidence, {
                maxRequestChars: initialChars,
                model: {
                    completionSettings: {},
                    complete: async () => {
                        calls++;
                        return {
                            success: true,
                            data: JSON.stringify({
                                status: "noAnswer",
                                answer: "Not established.",
                                evidenceIds: ["s0"],
                                retrievalQueries: [],
                            }),
                        };
                    },
                },
            }),
        ).rejects.toThrow("serialized request budget");
        expect(calls).toBe(1);
    });
    test("brief initial reading preserves strict output and injected-model precedence", async () => {
        let instructions = "";
        const model: ChatModel = {
            completionSettings: {},
            complete: async (prompt) => {
                instructions = JSON.stringify(prompt);
                return { success: true, data: JSON.stringify(response()) };
            },
        };
        expect(
            (
                await readUnderstanding({
                    question: request.question,
                    evidence,
                    candidates: empty,
                    allowRefinement: true,
                    brief: true,
                    model,
                    endpoint: "unconfigured-must-not-be-used",
                })
            ).summary.evidenceIds,
        ).toEqual(["s0"]);
        expect(instructions).toContain("at most 700 output tokens");
        expect(instructions).toContain("Preserve uncertainty");
        expect(instructions).toContain("retrievalQueries");
    });
    test("uses the production factory and structured schema without rejected completion limits", async () => {
        const runtimeConfig = getRuntimeConfig();
        const fetch = globalThis.fetch;
        let body: Record<string, unknown> | undefined;
        setRuntimeConfig(
            configFromEnvRecord({
                TYPEAGENT_MODEL_PROVIDER: "azure",
                AZURE_OPENAI_API_KEY: "offline-fixture",
                AZURE_OPENAI_RESPONSE_FORMAT: "1",
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS:
                    "https://example.test/openai/deployments/gpt-6-luna/chat/completions",
            }),
        );
        globalThis.fetch = async (_url, init) => {
            body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return new Response(
                JSON.stringify({
                    choices: [
                        { message: { content: JSON.stringify(response()) } },
                    ],
                }),
                { status: 200 },
            );
        };
        try {
            const result = await readUnderstanding({
                question: request.question,
                evidence,
                candidates: empty,
                allowRefinement: true,
            });
            expect(result.status).toBe("answered");
            expect(body?.response_format).toMatchObject({
                type: "json_schema",
                json_schema: {
                    name: "memory_understanding_v1",
                    strict: true,
                },
            });
            expect(body).not.toHaveProperty("max_completion_tokens");
            expect(body).not.toHaveProperty("max_tokens");
            expect(body).not.toHaveProperty("max_output_tokens");
            expect(JSON.stringify(body?.messages)).toContain("1,600");
            expect(JSON.stringify(body?.messages)).toContain(
                "Do not assume the metric",
            );
        } finally {
            globalThis.fetch = fetch;
            setRuntimeConfig(runtimeConfig);
        }
    });
    test("parses a short answer without compulsory sections or visuals", () => {
        expect(
            parseUnderstanding(
                JSON.stringify(response()),
                evidence,
                empty,
                true,
            ).sections,
        ).toEqual([]);
    });
    test.each([
        [
            "unknown citation",
            {
                summary: {
                    text: "claim",
                    evidenceIds: ["invented"],
                    role: "memory",
                },
            },
        ],
        [
            "unsupported observation",
            {
                summary: {
                    text: "claim",
                    evidenceIds: [],
                    role: "attachmentObservation",
                },
            },
        ],
        [
            "uncited factual summary",
            { summary: { text: "claim", evidenceIds: [], role: "memory" } },
        ],
        ["unknown field", { html: "<script>alert(1)</script>" }],
        [
            "invented module",
            {
                moduleSignals: [
                    {
                        kind: "timeline",
                        reason: "evolution",
                        evidenceIds: ["s0"],
                        candidateIds: ["invented"],
                    },
                ],
            },
        ],
        ["inconsistent noAnswer", { status: "noAnswer" }],
        ["unknown schema", { schemaVersion: 2 }],
    ])("rejects %s", (_name, update) => {
        expect(() =>
            parseUnderstanding(
                JSON.stringify({ ...response(), ...update }),
                evidence,
                empty,
                true,
            ),
        ).toThrow();
    });
    test("forbids another refinement in the final pass", () => {
        expect(() =>
            parseUnderstanding(
                JSON.stringify({
                    ...response(),
                    retrievalQueries: ["confirmation"],
                }),
                evidence,
                empty,
                false,
            ),
        ).toThrow();
    });
    test("requires original support and opposition in each claim, not just another section", () => {
        const derived: AnswerEvidence = {
            id: "d0",
            kind: "derived",
            reference: { viewId: "v", revisionId: "v1", state: "selected" },
            text: "May",
            influencingSourceIds: ["original"],
            supportingSources: [],
            opposingSources: [],
            supportingEvidenceIds: ["s0"],
            opposingEvidenceIds: ["s1"],
            review: "unreviewed",
            freshness: "current",
            coverage: "current",
            authorship: "informational",
        };
        const all: AnswerEvidence[] = [
            ...evidence,
            { id: "s1", kind: "source", source: source("opposition") },
            derived,
        ];
        const invalid = response(["d0", "s0"]);
        invalid.sections = [
            {
                title: "Opposition",
                claims: [
                    {
                        text: "Different report.",
                        evidenceIds: ["s1"],
                        role: "memory",
                    },
                ],
            },
        ];
        expect(() =>
            parseUnderstanding(JSON.stringify(invalid), all, empty, true),
        ).toThrow("opposition");
        expect(
            parseUnderstanding(
                JSON.stringify(response(["d0", "s0", "s1"])),
                all,
                empty,
                true,
            ),
        ).toBeDefined();
    });
});

describe("understanding lifecycle and orchestration", () => {
    test("returns ready exact sources and scoped one-parent context without another model for source reads", async () => {
        const { engine, host, calls } = fixture();
        const questions: string[] = [];
        const answer = host.answer.bind(host);
        host.answer = (request, reader) => {
            questions.push(request.question);
            return answer(request, reader);
        };
        const first = await engine.understand(request);
        expect(first.citations[0]).toMatchObject({
            id: "s0",
            kind: "source",
            source: source(),
        });
        await engine.module({
            corpusId: "corpus",
            snapshotId: first.snapshotId,
            kind: "sources",
        });
        expect(calls).toHaveLength(1);
        await engine.understand({
            ...request,
            question: "Was it fixed?",
            parentSnapshotId: first.snapshotId,
            parentTurnId: first.turnId,
        });
        expect(calls[1].parentContext).toMatchObject({
            question: request.question,
            answer: first.answer?.summary.text,
        });
        expect(questions[1]).toContain(first.answer?.summary.text);
        engine.close();
    });
    test("preserves a maximum-length follow-on instead of exceeding the retrieval question limit", async () => {
        const { engine, host } = fixture();
        const first = await engine.understand(request);
        const question = "q".repeat(2000);
        const answer = host.answer.bind(host);
        host.answer = (request, reader) => {
            expect(request.question).toBe(question);
            return answer(request, reader);
        };
        await engine.understand({
            ...request,
            question,
            parentSnapshotId: first.snapshotId,
            parentTurnId: first.turnId,
        });
        engine.close();
    });
    test("rejects mismatched scope, checkpoint, turn and expired parents explicitly", async () => {
        const { engine } = fixture();
        const first = await engine.understand(request);
        const parent = {
            ...request,
            parentSnapshotId: first.snapshotId,
            parentTurnId: first.turnId,
        };
        await expect(
            engine.understand({ ...parent, corpusId: "another" }),
        ).rejects.toThrow("scope");
        await expect(
            engine.understand({ ...parent, parentTurnId: "different" }),
        ).rejects.toThrow("turn");
        await expect(
            engine.understand({
                ...parent,
                knowledgeCheckpointId: "checkpoint",
            }),
        ).rejects.toThrow("scope");
        engine.invalidate("corpus");
        await expect(engine.understand(parent)).rejects.toThrow("expired");
        engine.close();
    });
    test("module-only sources and timelines do not synthesize hidden answers", async () => {
        const { engine, calls } = fixture([
            source(),
            source("later", "2024-04-10"),
        ]);
        const first = await engine.understand({
            ...request,
            selection: { mode: "only", modules: ["timeline", "sources"] },
        });
        expect(first.answer).toBeUndefined();
        const timeline = await engine.module({
            corpusId: "corpus",
            snapshotId: first.snapshotId,
            kind: "timeline",
        });
        expect(timeline.timeline).toHaveLength(2);
        expect(
            timeline.timeline?.every((item) => item.kind === "sourceSession"),
        ).toBe(true);
        expect(calls).toHaveLength(0);
        engine.close();
    });
    test("does not turn capture/import timestamps into a timeline", async () => {
        const original = source();
        original.snippet = "An undated statement.";
        original.capturedAt = "2024-01-01T00:00:00Z";
        const { engine } = fixture([original]);
        const first = await engine.understand({
            ...request,
            selection: { mode: "only", modules: ["timeline"] },
        });
        expect(first.modules).toMatchObject([
            { kind: "timeline", status: "unavailable" },
        ]);
        engine.close();
    });
    test("deduplicates repeated turn dates before applying the timeline candidate bound", async () => {
        const earlier = source();
        earlier.snippet = Array.from(
            { length: 20 },
            (_, index) =>
                `[Session 0; date March-15-2024; turn ${index}; speaker user]\nEarlier request.`,
        ).join("\n");
        const later = source("later");
        later.snippet =
            "[Session 1; date April-10-2024; turn 1; speaker assistant]\nLater advice.";
        const { engine } = fixture([earlier, later]);
        const first = await engine.understand({
            ...request,
            selection: { mode: "only", modules: ["timeline"] },
        });
        const timeline = await engine.module({
            corpusId: "corpus",
            snapshotId: first.snapshotId,
            kind: "timeline",
        });
        expect(timeline.timeline?.map((item) => item.date)).toEqual([
            "2024-03-15",
            "2024-04-10",
        ]);
        engine.close();
    });
    test("retains explicit session provenance from a source title when an indexed window omits its header", async () => {
        const earlier = source();
        earlier.title = "Conversation 3; session 0; date March-15-2024";
        earlier.snippet = "An indexed window without the original turn header.";
        const later = source("later");
        later.title = "Conversation 3; session 1; date April-10-2024";
        later.snippet = "A later indexed window, also without a header.";
        const { engine } = fixture([earlier, later]);
        const result = await engine.understand({
            ...request,
            selection: { mode: "only", modules: ["timeline"] },
        });
        const timeline = await engine.module({
            corpusId: "corpus",
            snapshotId: result.snapshotId,
            kind: "timeline",
        });
        expect(
            timeline.timeline?.map((item) => ({
                date: item.date,
                kind: item.kind,
            })),
        ).toEqual([
            { date: "2024-03-15", kind: "sourceSession" },
            { date: "2024-04-10", kind: "sourceSession" },
        ]);
        engine.close();
    });
    test("checks uncited influence on every read and purges invalid snapshots", async () => {
        const { engine, host } = fixture([source(), source("uncited")]);
        const first = await engine.understand(request);
        host.validate = async (_request, items) =>
            !items.some(
                (item) =>
                    item.kind === "source" &&
                    item.source.sourceId === "uncited",
            );
        await expect(
            engine.module({
                corpusId: "corpus",
                snapshotId: first.snapshotId,
                kind: "sources",
            }),
        ).rejects.toThrow("forgotten");
        await expect(
            engine.module({
                corpusId: "corpus",
                snapshotId: first.snapshotId,
                kind: "sources",
            }),
        ).rejects.toThrow("expired");
        engine.close();
    });
    test("does not persist results prepared across a forget barrier", async () => {
        const { engine, model } = fixture();
        const complete = model.complete.bind(model);
        model.complete = async (...args) => {
            engine.invalidate("corpus");
            return complete(...args);
        };
        await expect(engine.understand(request)).rejects.toThrow("invalidated");
        engine.close();
    });
    test("requires same-generation supported graph edges, not just a node match", async () => {
        const { engine, host, calls } = fixture();
        host.queryKnowledgeGraph = async () => graph();
        host.queryGraphSupport = async () => ({
            generation: "g1",
            total: 1,
            items: [
                {
                    kind: "document",
                    corpusId: "corpus",
                    sourceId: "original",
                    revisionId: "r1",
                },
            ],
        });
        host.validateSupport = async () => true;
        const first = await engine.understand({
            ...request,
            question: "What relates to Bootstrap?",
            selection: { mode: "only", modules: ["relationships"] },
        });
        const moduleRequest = {
            corpusId: "corpus",
            snapshotId: first.snapshotId,
            kind: "relationships" as const,
        };
        const module = await engine.module(moduleRequest);
        expect(module.graph?.edges).toHaveLength(1);
        expect(module.support?.[0].items[0]).not.toHaveProperty("locator");
        host.queryGraphSupport = async () => ({
            generation: "other",
            total: 0,
            items: [],
        });
        expect((await engine.module(moduleRequest)).status).toBe("unavailable");
        expect(calls).toHaveLength(0);
        engine.close();
    });
    test("reports unsupported scopes instead of silently substituting an old answer", async () => {
        const { engine, host } = fixture();
        host.answer = async () => ({
            question: request.question,
            answer: "old answer",
            citations: [],
            mode: "extractive",
            grounded: true,
            indexVersion: "1",
            warnings: [],
        });
        await expect(engine.understand(request)).rejects.toThrow("unsupported");
        engine.close();
    });
});

describe("snapshot and wire budgets", () => {
    test("empty retrieval is explicitly noAnswer and never spends a prose completion", async () => {
        const { engine, calls } = fixture([]);
        const result = await engine.understand(request);
        expect(result.answer?.status).toBe("noAnswer");
        expect(result.answer?.summary.evidenceIds).toEqual([]);
        expect(result.answer?.summary.text).toContain(
            "indexed document evidence",
        );
        expect(calls).toHaveLength(0);
        engine.close();
    });
    test("enforces entry/total UTF-8 byte caps and accounts for replaced entries", () => {
        const store = new UnderstandingStore<{
            corpusId: string;
            text: string;
        }>();
        expect(() =>
            store.put(
                "oversize",
                {
                    corpusId: "corpus",
                    text: "\u00e9".repeat(262144),
                },
                0,
            ),
        ).toThrow("byte budget");
        const value = { corpusId: "corpus", text: "\u00e9".repeat(250000) };
        store.put("other", value, 0);
        for (let i = 0; i < 20; i++) store.put("same", value, 0);
        expect(store.get("other")).toBe(value);
        for (let i = 0; i < 17; i++) store.put(String(i), value, 0);
        expect(() => store.get("0")).toThrow("expired");
        expect(store.get("16")).toBe(value);
        store.close();
    });
    test("pins index versions even when original citations remain accessible", async () => {
        const { engine, host } = fixture();
        host.indexVersion = async () => "index1";
        const first = await engine.understand(request);
        host.indexVersion = async () => "index2";
        await expect(
            engine.module({
                corpusId: "corpus",
                snapshotId: first.snapshotId,
                kind: "sources",
            }),
        ).rejects.toThrow("changed");
        engine.close();
    });
    test("keeps unvalidated source synopsis out of rich model context", async () => {
        const original = source();
        original.synopsis = {
            status: "ready",
            freshness: "stale",
            preview: "An uncited generated synopsis.",
            generatedVersion: 1,
            recipe: "fixture",
            inputHash: "fixture",
        };
        const { engine, calls } = fixture([original]);
        await engine.understand(request);
        expect(calls[0].evidence[0]).not.toHaveProperty("source.synopsis");
        expect(calls[0].evidence[0]).toHaveProperty(
            "source.snippet",
            original.snippet,
        );
        engine.close();
    });
    test("admits concept cards only with same-generation accessible original support", async () => {
        const { engine, host, calls } = fixture();
        host.queryKnowledgeGraph = async () => graph();
        host.queryGraphSupport = async () => ({
            generation: "g1",
            total: 1,
            items: [
                {
                    kind: "document",
                    corpusId: "corpus",
                    sourceId: "original",
                    revisionId: "r1",
                },
            ],
        });
        host.validateSupport = async () => true;
        const first = await engine.understand({
            ...request,
            question: "Explain Bootstrap",
            selection: { mode: "only", modules: ["concepts"] },
        });
        const moduleRequest = {
            corpusId: "corpus",
            snapshotId: first.snapshotId,
            kind: "concepts" as const,
        };
        expect((await engine.module(moduleRequest)).concepts?.[0].label).toBe(
            "Bootstrap",
        );
        host.validateSupport = async () => false;
        expect((await engine.module(moduleRequest)).status).toBe("unavailable");
        expect(calls).toHaveLength(0);
        engine.close();
    });
    test("counts exact UTF-8 bytes of the whole wrapper, including non-ASCII text", () => {
        const value = { result: { text: "\u00e9".repeat(100) } };
        const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
        expect(() => assertUnderstandingBytes(value, bytes)).not.toThrow();
        expect(() => assertUnderstandingBytes(value, bytes - 1)).toThrow(
            "byte budget",
        );
    });
    test("expires without extending TTL on access, evicts LRU and rejects closed writes", () => {
        let now = 0;
        const store = new UnderstandingStore<{
            corpusId: string;
            text: string;
        }>(() => now);
        for (let i = 0; i < 64; i++)
            store.put(String(i), { corpusId: "corpus", text: "private" }, 0);
        store.get("0");
        store.put("64", { corpusId: "corpus", text: "private" }, 0);
        expect(() => store.get("1")).toThrow("expired");
        now = 15 * 60_000;
        expect(() => store.get("0")).toThrow("expired");
        store.close();
        expect(() =>
            store.put(
                "new",
                { corpusId: "corpus", text: "new" },
                store.version,
            ),
        ).toThrow("invalidated");
    });
});

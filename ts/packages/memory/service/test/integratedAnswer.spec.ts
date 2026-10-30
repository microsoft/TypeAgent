// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import { runWithSearchTiming } from "@typeagent/knowpro";
import {
    answerIntegratedEvidence,
    type IntegratedAnswerHost,
    type IntegratedAnswerSeed,
} from "../src/integratedAnswer.js";
import type {
    AnswerDerivedEvidence,
    AnswerEvidence,
    AnswerSourceReference,
    AnswerViewEvidence,
    MemoryAnswerRequest,
    MemoryEvidence,
} from "../src/types.js";

const request: MemoryAnswerRequest = {
    corpusId: "corpus",
    question: "What is the launch window?",
    includeDiagnostics: true,
};

function source(
    sourceId = "original",
    snippet = "Launch is in May.",
): MemoryEvidence {
    return {
        evidenceId: `${sourceId}-passage`,
        corpusId: "corpus",
        sourceId,
        revisionId: "r1",
        locator: "lines:1-2",
        title: sourceId,
        snippet,
        score: 1,
        sourceType: "text",
        indexedAt: "2026-10-23T00:00:00Z",
    };
}

function reference(item: MemoryEvidence): AnswerSourceReference {
    return {
        sourceId: item.sourceId,
        revisionId: item.revisionId,
        ...(item.locator !== undefined ? { locator: item.locator } : {}),
    };
}

function view(
    overrides: Partial<AnswerDerivedEvidence> = {},
): AnswerDerivedEvidence {
    return {
        kind: "derived",
        reference: {
            viewId: "launch",
            revisionId: "v1",
            sectionId: "window",
            itemId: "candidate",
            state: "selected",
        },
        text: "Launch is in May.",
        influencingSourceIds: ["original"],
        supportingSources: [reference(source())],
        opposingSources: [],
        authorship: "informational",
        review: "unreviewed",
        freshness: "current",
        coverage: "evaluated current retained sources",
        ...overrides,
    };
}

function fixture(
    originals: MemoryEvidence[] = [source()],
    views: AnswerViewEvidence[] = [view()],
    expanded = originals,
) {
    const calls: AnswerEvidence[][] = [];
    const host: IntegratedAnswerHost = {
        searchOriginal: async () => ({
            query: request.question,
            matches: originals,
            warnings: [],
            capabilitiesUsed: ["originals"],
            indexVersion: "index1",
        }),
        getEligibleViewMatches: async () => ({ matches: views }),
        expandSource: async (ref) =>
            expanded.find(
                (item) =>
                    item.sourceId === ref.sourceId &&
                    item.revisionId === ref.revisionId,
            ),
        validateEvidence: async () => true,
    };
    const model: ChatModel = {
        completionSettings: {},
        complete: async (prompt) => {
            if (typeof prompt === "string")
                throw new Error("Expected structured prompt");
            const content = prompt[prompt.length - 1].content;
            if (typeof content !== "string")
                throw new Error("Expected serialized evidence");
            const envelope = JSON.parse(content) as {
                evidence: AnswerEvidence[];
            };
            calls.push(envelope.evidence);
            return {
                success: true,
                data: JSON.stringify({
                    status: "answered",
                    answer: "Launch is in May.",
                    evidenceIds: envelope.evidence.map((item) => item.id),
                }),
            };
        },
    };
    return { host, model, calls };
}

describe("parallel answer retrieval", () => {
    test("views start before originals finish and preserve the prepared evidence", async () => {
        const { host, model } = fixture();
        const original = host.searchOriginal;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        host.searchOriginal = async (input) => {
            await gate;
            return original(input);
        };
        let viewStarted = false;
        const views = host.getEligibleViewMatches!;
        host.getEligibleViewMatches = async (input) => {
            viewStarted = true;
            return views(input);
        };
        const pending = answerIntegratedEvidence(request, host, {
            model,
            prepareOnly: true,
        });
        await Promise.resolve();
        expect(viewStarted).toBe(true);
        release();
        const result = await pending;
        const expected = fixture();
        const baseline = await answerIntegratedEvidence(
            request,
            expected.host,
            { model: expected.model, prepareOnly: true },
        );
        expect(result).toEqual(baseline);
    });

    test("strict view failure waits for the other branch to settle", async () => {
        const { host, model } = fixture();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const original = host.searchOriginal;
        host.searchOriginal = async (input) => {
            await gate;
            return original(input);
        };
        host.getEligibleViewMatches = async () => {
            throw new Error("view failed");
        };
        let settled = false;
        const pending = answerIntegratedEvidence(
            { ...request, retrievalPolicy: "sourcesAndViews" },
            host,
            { model, prepareOnly: true },
        );
        const rejected = expect(pending).rejects.toThrow("view failed");
        void pending.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(settled).toBe(false);
        release();
        await rejected;
    });
});

describe("bounded source-plus-view answering", () => {
    test("prepared retrieval skips synthesis and is reused without repeating retrieval", async () => {
        const { host, model, calls } = fixture();
        const searchOriginal = host.searchOriginal.bind(host);
        const getViews = host.getEligibleViewMatches!.bind(host);
        let searches = 0;
        let viewReads = 0;
        host.searchOriginal = (input) => {
            searches++;
            return searchOriginal(input);
        };
        host.getEligibleViewMatches = (input) => {
            viewReads++;
            return getViews(input);
        };
        let seed: IntegratedAnswerSeed | undefined;
        const prepared = await answerIntegratedEvidence(request, host, {
            model,
            prepareOnly: true,
            onPrepared: (value) => {
                seed = value;
            },
        });
        expect(prepared.mode).toBe("extractive");
        expect(calls).toHaveLength(0);
        if (!seed) throw new Error("Prepared evidence was not retained");
        const answer = await answerIntegratedEvidence(request, host, {
            model,
            seed,
        });
        expect(answer.answer).toBe("Launch is in May.");
        expect(calls).toHaveLength(1);
        expect(searches).toBe(1);
        expect(viewReads).toBe(1);
    });

    test("defers refinement and resumes with overlapping searches, stable ordering, and one final reader", async () => {
        const { host } = fixture();
        let seed: IntegratedAnswerSeed | undefined;
        let readerCalls = 0;
        const reader = async (
            _request: MemoryAnswerRequest,
            evidence: AnswerEvidence[],
            _options: unknown,
            allowRefinement: boolean,
        ) => {
            readerCalls++;
            return {
                status: "answered" as const,
                answer: "Launch is in May.",
                evidenceIds: evidence.map((item) => item.id),
                ...(allowRefinement
                    ? { retrievalQueries: ["first", "second"] }
                    : {}),
            };
        };
        await answerIntegratedEvidence(request, host, {
            reader,
            deferRefinement: true,
            onPrepared: (value) => {
                seed = value;
            },
        });
        expect(readerCalls).toBe(1);
        if (!seed) throw new Error("Deferred evidence was not retained");
        let release!: () => void;
        let bothStarted!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            bothStarted = resolve;
        });
        const queries: string[] = [];
        host.searchOriginal = async (input) => {
            queries.push(input.question);
            if (queries.length === 2) bothStarted();
            await gate;
            return {
                query: input.question,
                matches: [source(input.question)],
                warnings: [],
                capabilitiesUsed: [],
                indexVersion: "index1",
            };
        };
        const finishing = answerIntegratedEvidence(request, host, {
            reader,
            seed,
            resumeRefinement: true,
        });
        await started;
        expect(queries).toEqual(["first", "second"]);
        expect(readerCalls).toBe(1);
        release();
        const answer = await finishing;
        expect(readerCalls).toBe(2);
        expect(
            answer.readerContext?.integratedAnswer?.refinement?.queries,
        ).toEqual(["first", "second"]);
    }, 10000);

    test("settles sibling refinement searches before surfacing the first query's original error", async () => {
        const { host } = fixture();
        const failure = new Error("first failed");
        let seed: IntegratedAnswerSeed | undefined;
        const reader = async (
            _request: MemoryAnswerRequest,
            evidence: AnswerEvidence[],
        ) => ({
            status: "answered" as const,
            answer: "Launch is in May.",
            evidenceIds: evidence.map((item) => item.id),
            retrievalQueries: ["first", "second"],
        });
        await answerIntegratedEvidence(request, host, {
            reader,
            deferRefinement: true,
            onPrepared: (value) => {
                seed = value;
            },
        });
        if (!seed) throw new Error("Deferred evidence was not retained");
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let siblingSettled = false;
        host.searchOriginal = async (input) => {
            if (input.question === "first") throw failure;
            await gate;
            siblingSettled = true;
            return {
                query: input.question,
                matches: [],
                warnings: [],
                capabilitiesUsed: [],
                indexVersion: "index1",
            };
        };
        let rejected = false;
        const finishing = answerIntegratedEvidence(request, host, {
            reader,
            seed,
            resumeRefinement: true,
        });
        const checked = expect(finishing)
            .rejects.toBe(failure)
            .then(() => {
                rejected = true;
            });
        await Promise.resolve();
        expect(rejected).toBe(false);
        release();
        await checked;
        expect(siblingSettled).toBe(true);
    });

    test("times both reader passes and validation without logging private inputs or changing failures", async () => {
        const flag = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const warn = console.warn;
        const logs: string[] = [];
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        console.warn = (line: unknown) => logs.push(String(line));
        const { host } = fixture();
        const reader = async (
            _request: MemoryAnswerRequest,
            evidence: AnswerEvidence[],
            _options: unknown,
            allowRefinement: boolean,
        ) => ({
            status: "answered" as const,
            answer: "Launch is in May.",
            evidenceIds: evidence.map((item) => item.id),
            ...(allowRefinement
                ? { retrievalQueries: ["Exact launch month"] }
                : {}),
        });
        try {
            const result = await runWithSearchTiming(
                "latency-test",
                "test",
                () => answerIntegratedEvidence(request, host, { reader }),
            );
            expect(result.answer).toBe("Launch is in May.");
            const stages = logs.map(
                (line): { stage: string; traceId: string; status: string } =>
                    JSON.parse(line.replace("[memory-search-timing] ", "")),
            );
            expect(stages.map((item) => item.stage)).toEqual(
                expect.arrayContaining([
                    "answer.originalSearch",
                    "answer.maintainedViews",
                    "answer.retrieve",
                    "answer.expandSource",
                    "answer.assemble.initial",
                    "answer.reader.initial",
                    "answer.refinementSearch",
                    "answer.assemble.refined",
                    "answer.reader.refined",
                    "answer.validate",
                ]),
            );
            expect(
                stages.every((item) => item.traceId === "latency-test"),
            ).toBe(true);
            const failure = new Error("private validation failure");
            host.validateEvidence = async () => {
                throw failure;
            };
            await expect(
                runWithSearchTiming("latency-test", "test", () =>
                    answerIntegratedEvidence(request, host, { reader }),
                ),
            ).rejects.toBe(failure);
            expect(logs.at(-1)).toContain('"status":"error"');
            expect(logs.join("\n")).not.toContain(request.question);
            expect(logs.join("\n")).not.toContain("Launch is in May.");
            expect(logs.join("\n")).not.toContain(failure.message);
        } finally {
            console.warn = warn;
            if (flag === undefined)
                delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
            else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = flag;
        }
    });

    test("prioritizes focused refinement passages before applying the shared source limit", async () => {
        const initial = source("initial", "The gallery is being discussed.");
        const generic = source("generic", "General JS background.");
        const fact = source(
            "quantity",
            "The JS script was reduced from 140 lines to 95 lines.",
        );
        const { host } = fixture([initial], []);
        const refinement = "JS reduced lines";
        host.searchOriginal = async (input) => ({
            query: input.question,
            matches:
                input.question === refinement ? [generic, fact] : [initial],
            warnings: [],
            capabilitiesUsed: ["originals"],
            indexVersion: "index1",
        });
        let reads = 0;
        const result = await answerIntegratedEvidence(request, host, {
            maxSourceFragments: 1,
            reader: async (_request, evidence, _options, allowRefinement) => {
                reads++;
                if (allowRefinement)
                    return {
                        status: "noAnswer",
                        answer: "The quantity is missing.",
                        evidenceIds: [],
                        retrievalQueries: [refinement],
                    };
                const selected = evidence.find(
                    (item) =>
                        item.kind === "source" &&
                        item.source.sourceId === fact.sourceId,
                );
                if (!selected)
                    throw new Error("Focused refinement evidence was lost");
                return {
                    status: "answered",
                    answer: fact.snippet,
                    evidenceIds: [selected.id],
                };
            },
        });
        expect(reads).toBe(2);
        expect(result.answer).toBe(fact.snippet);
        expect(result.citations.map((item) => item.sourceId)).toEqual([
            fact.sourceId,
        ]);
    });
    test("revalidates evidence that prompted refinement even after replacement", async () => {
        const initial = source(
            "initial",
            "The launch date needs confirmation.",
        );
        const followup = source("confirmation", "Launch is in June.");
        const { host, model, calls } = fixture([initial], []);
        host.searchOriginal = async (input) => ({
            query: input.question,
            matches:
                input.question === "launch confirmation"
                    ? [followup]
                    : [initial],
            warnings: [],
            capabilitiesUsed: ["originals"],
            indexVersion: "index1",
        });
        const complete = model.complete.bind(model);
        let completions = 0;
        model.complete = async (...args) => {
            const result = await complete(...args);
            completions++;
            return completions % 2 === 1
                ? {
                      success: true,
                      data: JSON.stringify({
                          status: "noAnswer",
                          answer: "Confirmation is missing.",
                          evidenceIds: [],
                          retrievalQueries: ["launch confirmation"],
                      }),
                  }
                : result;
        };
        const validations: AnswerEvidence[][] = [];
        host.validateEvidence = async ({ evidence }) => {
            validations.push(evidence);
            return false;
        };
        await expect(
            answerIntegratedEvidence(request, host, {
                model,
                maxSourceFragments: 1,
            }),
        ).rejects.toThrow();
        expect(completions).toBe(4);
        expect(calls[1]).toMatchObject([
            { kind: "source", source: { sourceId: "confirmation" } },
        ]);
        expect(validations).toHaveLength(2);
        for (const evidence of validations)
            expect(evidence).toMatchObject([
                { kind: "source", source: { sourceId: "initial" } },
                { kind: "source", source: { sourceId: "confirmation" } },
            ]);
    });

    test.each([[""], ["one", "two", "three"], ["x".repeat(241)]])(
        "rejects invalid integrated refinement queries %j",
        async (...retrievalQueries) => {
            const { host, model } = fixture();
            model.complete = async () => ({
                success: true,
                data: JSON.stringify({
                    status: "noAnswer",
                    answer: "Evidence is missing.",
                    evidenceIds: [],
                    retrievalQueries,
                }),
            });
            await expect(
                answerIntegratedEvidence(request, host, { model }),
            ).rejects.toThrow("Invalid indexed answer retrieval queries");
        },
    );

    test("actually supplies typed originals and exact view references to the reader", async () => {
        const { host, model, calls } = fixture();
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls).toHaveLength(1);
        expect(calls[0].map((item) => item.kind)).toEqual([
            "source",
            "derived",
        ]);
        expect(result.citations).toEqual([source()]);
        expect(result.derivedReferences).toEqual([view().reference]);
        expect(
            result.readerContext?.integratedAnswer?.suppliedEvidence,
        ).toEqual(calls[0]);
        expect(
            result.readerContext?.integratedAnswer?.selectedEvidenceIds,
        ).toEqual(["s0", "d0"]);
    });

    test("expands opposing passages and preserves conflicted view state", async () => {
        const correction = source(
            "correction",
            "Correction: launch is June, not May.",
        );
        const conflicted = view({
            reference: { ...view().reference, state: "conflicted" },
            text: "May and June conflict; no selected answer.",
            opposingSources: [reference(correction)],
            influencingSourceIds: ["original", "correction"],
        });
        const { host, model, calls } = fixture(
            [source()],
            [conflicted],
            [source(), correction],
        );
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(result.citations.map((item) => item.sourceId)).toEqual([
            "original",
            "correction",
        ]);
        const block = calls[0].find((item) => item.kind === "derived");
        expect(block?.kind === "derived" && block.opposingEvidenceIds).toEqual([
            "s1",
        ]);
        expect(result.derivedReferences?.[0].state).toBe("conflicted");
    });

    test("does not leak a view depending on restricted originals", async () => {
        const privateView = view({
            text: "PRIVATE VALUE",
            influencingSourceIds: ["original", "private"],
        });
        const { host, model, calls } = fixture(
            [source(), source("private")],
            [privateView],
        );
        host.expandSource = async () => {
            throw new Error("Restricted view must not expand");
        };
        const result = await answerIntegratedEvidence(
            { ...request, sourceIds: ["original"] },
            host,
            { model },
        );
        expect(JSON.stringify(calls)).not.toContain("PRIVATE");
        expect(JSON.stringify(calls)).not.toContain("private");
        expect(result.derivedReferences).toEqual([]);
        expect(JSON.stringify(result)).not.toContain("private");
    });

    test("uses exact expanded text rather than a shorter search preview", async () => {
        const exact = source(
            "original",
            "Launch is in May, conditional on approval.",
        );
        const { host, model, calls } = fixture([source()], [view()], [exact]);
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls[0][0]).toEqual({
            kind: "source",
            id: "s0",
            source: exact,
        });
        expect(result.citations[0].snippet).toContain(
            "conditional on approval",
        );
    });

    test("deduplicates originals and repeated interpretations instead of adding votes", async () => {
        const repeated = view({
            reference: { ...view().reference, viewId: "second" },
        });
        const { host, model, calls } = fixture(
            [source(), source()],
            [view(), repeated],
        );
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls[0].filter((item) => item.kind === "source")).toHaveLength(
            1,
        );
        expect(calls[0].filter((item) => item.kind === "derived")).toHaveLength(
            1,
        );
        expect(result.readerContext?.integratedAnswer?.omittedViewBlocks).toBe(
            1,
        );
    });

    test("omits an entire claim when opposition cannot fit or cannot be read", async () => {
        const correction = source("correction", "A".repeat(24000));
        const qualified = view({ opposingSources: [reference(correction)] });
        const { host, model, calls } = fixture(
            [source()],
            [qualified],
            [source(), correction],
        );
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls[0].map((item) => item.kind)).toEqual(["source"]);
        expect(result.warnings.join(" ")).toContain(
            "coverage is not exhaustive",
        );
        host.expandSource = async () => undefined;
        const unavailable = await answerIntegratedEvidence(request, host, {
            model,
        });
        expect(unavailable.derivedReferences).toEqual([]);
        expect(unavailable.warnings.join(" ")).toContain("unavailable");
    });

    test("attributes durable user assertions without fabricated original citations", async () => {
        const assertion: AnswerViewEvidence = {
            ...view({ supportingSources: [], influencingSourceIds: [] }),
            kind: "userAssertion",
            reference: {
                ...view().reference,
                candidateId: "user-value",
                assertionOrigin: "user-correction",
            },
            text: "You stated that the launch window is July.",
        };
        const { host, model, calls } = fixture([], [assertion]);
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls[0][0].kind).toBe("userAssertion");
        expect(result.citations).toEqual([]);
        expect(result.assertionReferences).toEqual([assertion.reference]);
    });

    test("unknown state is usable without inventing a selected answer or source", async () => {
        const unknown = view({
            reference: { ...view().reference, state: "unknown" },
            text: "No launch window is supported in the evaluated scope.",
            supportingSources: [],
        });
        const { host, model } = fixture([], [unknown]);
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(result.citations).toEqual([]);
        expect(result.derivedReferences?.[0].state).toBe("unknown");
    });

    test("sourcesOnly never invokes view retrieval or expansion", async () => {
        const { host, model } = fixture();
        host.getEligibleViewMatches = async () => {
            throw new Error("Must not search views");
        };
        host.expandSource = async () => {
            throw new Error("Must not expand views");
        };
        const result = await answerIntegratedEvidence(
            { ...request, retrievalPolicy: "sourcesOnly" },
            host,
            { model },
        );
        expect(result.readerContext?.integratedAnswer?.retrievalMode).toBe(
            "sourcesOnly",
        );
        expect(result.warnings).toEqual([]);
    });

    test("view-index failure is strict or visibly degraded, unlike a normal cold start", async () => {
        const { host, model } = fixture();
        host.getEligibleViewMatches = async () => {
            throw new Error("Index failed");
        };
        await expect(
            answerIntegratedEvidence(
                { ...request, retrievalPolicy: "sourcesAndViews" },
                host,
                { model },
            ),
        ).rejects.toThrow("Index failed");
        const degraded = await answerIntegratedEvidence(request, host, {
            model,
        });
        expect(degraded.warnings.join(" ")).toContain("degraded source-only");
        expect(degraded.readerContext?.integratedAnswer?.retrievalMode).toBe(
            "degraded",
        );
        host.getEligibleViewMatches = async () => ({ matches: [] });
        const cold = await answerIntegratedEvidence(request, host, { model });
        expect(cold.warnings).toEqual([]);
        expect(cold.readerContext?.integratedAnswer?.retrievalMode).toBe(
            "sourcesAndViews",
        );
    });

    test("rejects unsupplied citation IDs and unsupported derived-only factual responses", async () => {
        const { host, model } = fixture();
        model.complete = async () => ({
            success: true,
            data: JSON.stringify({
                status: "answered",
                answer: "Fabricated citation",
                evidenceIds: ["not-supplied"],
            }),
        });
        await expect(
            answerIntegratedEvidence(request, host, { model }),
        ).rejects.toThrow("unsupported evidence reference");
        model.complete = async () => ({
            success: true,
            data: JSON.stringify({
                status: "answered",
                answer: "Launch is in May.",
                evidenceIds: ["d0"],
            }),
        });
        await expect(
            answerIntegratedEvidence(request, host, { model }),
        ).rejects.toThrow("omitted its original support");
    });

    test("rejects source revision mismatch without supplying a fabricated view citation", async () => {
        const { host, model, calls } = fixture(
            [source()],
            [view()],
            [{ ...source(), revisionId: "r2" }],
        );
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls[0].map((item) => item.kind)).toEqual(["source"]);
        expect(result.derivedReferences).toEqual([]);
    });

    test("rechecks all supplied evidence and reconstructs only once on delivery races", async () => {
        const { host, model, calls } = fixture();
        const validations: AnswerEvidence[][] = [];
        host.validateEvidence = async ({ evidence }) => {
            validations.push(evidence);
            return validations.length > 1;
        };
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls).toHaveLength(2);
        expect(validations).toEqual(calls);
        expect(
            result.readerContext?.integratedAnswer?.reconstructionCount,
        ).toBe(1);
        host.validateEvidence = async () => false;
        await expect(
            answerIntegratedEvidence(request, host, { model }),
        ).rejects.toThrow(
            "changed before delivery after one bounded reconstruction",
        );
        expect(calls).toHaveLength(4);
    });

    test("bounds source fragments, derived blocks and serialized reader evidence", async () => {
        const originals = Array.from({ length: 20 }, (_, i) =>
            source(`source${i}`, `Evidence ${i}`),
        );
        const views = originals.slice(0, 8).map((item, i) =>
            view({
                reference: { ...view().reference, viewId: `view${i}` },
                text: `Claim ${i}`,
                supportingSources: [reference(item)],
                influencingSourceIds: [item.sourceId],
            }),
        );
        const { host, model, calls } = fixture(originals, views);
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls[0].filter((item) => item.kind === "source")).toHaveLength(
            12,
        );
        expect(calls[0].filter((item) => item.kind === "derived")).toHaveLength(
            4,
        );
        expect(
            result.readerContext?.serializedContextChars,
        ).toBeLessThanOrEqual(24000);
        expect(
            result.readerContext?.integratedAnswer?.omittedSourceFragments,
        ).toBe(8);
        expect(result.readerContext?.integratedAnswer?.omittedViewBlocks).toBe(
            4,
        );
    });

    test("source retrieval and reader failures propagate without success-shaped fallback", async () => {
        const { host, model } = fixture();
        model.complete = async () => ({
            success: false,
            message: "Reader failed",
        });
        await expect(
            answerIntegratedEvidence(request, host, { model }),
        ).rejects.toThrow("Reader failed");
        host.searchOriginal = async () => {
            throw new Error("Original index failed");
        };
        await expect(
            answerIntegratedEvidence(request, host, { model }),
        ).rejects.toThrow("Original index failed");
    });

    test("records the reader's exact selected references separately from supplied context", async () => {
        const { host, model, calls } = fixture([source(), source("other")]);
        model.complete = async () => ({
            success: true,
            data: JSON.stringify({
                status: "answered",
                answer: "Original source answer.",
                evidenceIds: ["s0"],
            }),
        });
        let supplied: AnswerEvidence[] = [];
        host.validateEvidence = async ({ evidence }) => {
            supplied = evidence;
            return true;
        };
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls).toHaveLength(0);
        expect(result.citations).toEqual([source()]);
        expect(result.derivedReferences).toEqual([]);
        expect(
            result.readerContext?.integratedAnswer?.suppliedEvidence,
        ).toEqual(supplied);
        expect(supplied).toHaveLength(3);
        expect(
            result.readerContext?.integratedAnswer?.selectedEvidenceIds,
        ).toEqual(["s0"]);
    });

    test("does not conflate unknown state evaluations from different exact scopes", async () => {
        const unknown = view({
            reference: { ...view().reference, state: "unknown" },
            text: "No supported launch window in this scope.",
            supportingSources: [],
        });
        const otherScope = {
            ...unknown,
            reference: { ...unknown.reference, viewId: "other-scope" },
        };
        const { host, model, calls } = fixture([], [unknown, otherScope]);
        await answerIntegratedEvidence(request, host, { model });
        expect(calls[0].filter((item) => item.kind === "derived")).toHaveLength(
            2,
        );
    });

    test("never treats a selected derived value with no original support as a sourced fact", async () => {
        const { host, model, calls } = fixture(
            [],
            [view({ supportingSources: [] })],
        );
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(calls).toHaveLength(0);
        expect(result.citations).toEqual([]);
        expect(result.derivedReferences).toEqual([]);
        expect(result.answer).toContain("No supporting");
    });

    test("budgets the complete serialized reader request before invoking the model", async () => {
        const { host, model, calls } = fixture();
        await expect(
            answerIntegratedEvidence(request, host, {
                model,
                maxRequestChars: 100,
            }),
        ).rejects.toThrow("Complete integrated reader request exceeds");
        expect(calls).toHaveLength(0);
    });

    test("expansion errors fail strict mode and remain visible in default mode", async () => {
        const { host, model } = fixture();
        host.expandSource = async () => {
            throw new Error("Exact source read failed");
        };
        await expect(
            answerIntegratedEvidence(
                { ...request, retrievalPolicy: "sourcesAndViews" },
                host,
                { model },
            ),
        ).rejects.toThrow("Exact source read failed");
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(result.derivedReferences).toEqual([]);
        expect(result.readerContext?.integratedAnswer?.retrievalMode).toBe(
            "degraded",
        );
        expect(result.warnings.join(" ")).toContain("expansion failed");
    });

    test("unavailable integrated capability cannot silently satisfy strict retrieval", async () => {
        const { host, model } = fixture();
        delete host.getEligibleViewMatches;
        await expect(
            answerIntegratedEvidence(
                { ...request, retrievalPolicy: "sourcesAndViews" },
                host,
                { model },
            ),
        ).rejects.toThrow("does not support maintained-view retrieval");
        const result = await answerIntegratedEvidence(request, host, { model });
        expect(result.warnings.join(" ")).toContain("degraded source-only");
    });
});

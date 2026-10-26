// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import {
    answerIntegratedEvidence,
    type IntegratedAnswerHost,
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

describe("bounded source-plus-view answering", () => {
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

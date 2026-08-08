// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import {
    generateActionActionFunctionJsonSchemas,
    parseToolsJsonSchema,
    toJSONParsedActionSchema,
} from "@typeagent/action-schema";

import type { TranslationBenchBenchmarkSchema } from "../src/translationBench/synthesizer/benchmark.js";
import {
    runTranslationBenchFormatChecker,
    runTranslationBenchSemanticChecker,
} from "../src/translationBench/synthesizer/dataQualityVerifier.js";
import type { TranslationBenchGenerationQualityLoopOptions } from "../src/translationBench/synthesizer/datasetGenerator.js";
import {
    applyTranslationBenchNegativeFairnessIssues,
    checkTranslationBenchCandidateNegativeFairness,
    checkTranslationBenchNegativeFairnessAssessment,
    parseTranslationBenchNegativeFairnessAssessments,
} from "../src/translationBench/synthesizer/negativeFairness.js";
import { loadTranslationBenchQualityVerifierPromptPack } from "../src/translationBench/synthesizer/synthesizerPrompts.js";

const HASH = "c".repeat(64);

function browserCatalog(): TranslationBenchBenchmarkSchema[] {
    const actionNames = [
        "closeAllWebPages",
        "closeWebPage",
        "changeSearchProvider",
        "openWebPage",
        "followLinkByText",
        "captureScreenshot",
    ];
    const parsed = parseToolsJsonSchema(
        actionNames.map((actionName) => ({
            name: actionName,
            description: `Run ${actionName}`,
            inputSchema: {
                type: "object",
                properties: {
                    ...(actionName === "changeSearchProvider"
                        ? { name: { type: "string" } }
                        : {}),
                    ...(actionName === "openWebPage"
                        ? {
                              site: { type: "string" },
                              tab: { type: "string" },
                          }
                        : {}),
                    ...(actionName === "followLinkByText"
                        ? { keywords: { type: "string" } }
                        : {}),
                },
                additionalProperties: false,
            },
        })),
    );
    const tools = generateActionActionFunctionJsonSchemas({
        entry: parsed.entry.action!,
        actionSchemas: parsed.actionSchemas,
    }).map((tool) => ({
        type: "function" as const,
        function: {
            name: tool.function.name,
            ...(tool.function.description !== undefined
                ? { description: tool.function.description }
                : {}),
            parameters: tool.function.parameters as Record<string, unknown>,
        },
    }));
    return [
        {
            schemaName: "browser",
            description: "browser actions",
            tools,
            typeAgent: {
                sourceHash: `browser-${HASH}`,
                schemaType: "BrowserAction",
                parsedActionSchema: toJSONParsedActionSchema(parsed),
            },
        },
    ];
}

const targetOpenWebPage = {
    schemaName: "browser",
    actionName: "openWebPage",
};

function fairCandidate(negativeUtterance: string) {
    return {
        seed: {
            utterance: "Go to the Apple stock quote website",
            expectedActions: [
                {
                    schemaName: "browser",
                    actionName: "openWebPage",
                    parameters: { site: "apple.com" },
                },
            ],
            order: "strict" as const,
        },
        genCases: [
            {
                id: "pos-1",
                role: "positive" as const,
                utterance: "Navigate to apple.com/investor in the browser",
                expectedActions: [
                    {
                        schemaName: "browser",
                        actionName: "openWebPage",
                        parameters: { site: "apple.com/investor" },
                    },
                ],
                order: "strict" as const,
                dimensions: { variation: "paraphrase" },
            },
            {
                id: "neg-1",
                role: "negative" as const,
                utterance: negativeUtterance,
                expectedActions: [],
                order: "strict" as const,
                dimensions: { negativeKind: "pure_refusal" },
            },
        ],
    };
}

function makeLoop(
    catalog: TranslationBenchBenchmarkSchema[],
): TranslationBenchGenerationQualityLoopOptions {
    return {
        targetAction: targetOpenWebPage,
        schema: catalog[0]!,
        catalogSchemas: catalog,
        activeSchemas: ["browser"],
        genCaseCount: 2,
        maxAttempts: 5,
        generator: { model: "g", complete: async () => "" },
        reviewer: { model: "r", complete: async () => "" },
        anchor: {
            candidateId: "anchor-1",
            utterance: "open a site",
            sourceCalls: [],
        },
    } as unknown as TranslationBenchGenerationQualityLoopOptions;
}

describe("translation bench negative fairness LLM assessment parsing", () => {
    it("parses structured assessments", () => {
        const assessments = parseTranslationBenchNegativeFairnessAssessments([
            {
                path: "$.genCases[1].utterance",
                kind: "pure_refusal",
                fairEmptyGold: true,
                reason: "explicit don't of the target",
            },
        ]);
        expect(assessments).toHaveLength(1);
        expect(assessments[0]!.kind).toBe("pure_refusal");
    });

    it("accepts consistent fair assessments", () => {
        const r = checkTranslationBenchNegativeFairnessAssessment(
            {
                path: "$.genCases[0].utterance",
                kind: "pure_refusal",
                fairEmptyGold: true,
                reason: "don't screenshot banking",
            },
            "Don't take a screenshot of my online banking page.",
            { schemaName: "browser", actionName: "captureScreenshot" },
        );
        expect(r.ok).toBe(true);
        expect(r.kind).toBe("pure_refusal");
    });

    it("rejects unfair assessments and inconsistent fairEmptyGold flags", () => {
        const unfair = checkTranslationBenchNegativeFairnessAssessment(
            {
                path: "$.n",
                kind: "unfair_imperative",
                fairEmptyGold: false,
                reason: "still requests close this tab",
            },
            "Close only the current web page.",
            targetOpenWebPage,
        );
        expect(unfair.ok).toBe(false);

        const inconsistent = checkTranslationBenchNegativeFairnessAssessment(
            {
                path: "$.n",
                kind: "unfair_contrastive",
                fairEmptyGold: true,
                reason: "model lied",
            },
            "Search Bing for MSFT",
            targetOpenWebPage,
        );
        expect(inconsistent.ok).toBe(false);
    });
});

describe("translation bench candidate negative fairness from LLM assessments", () => {
    it("flags unfair negatives from assessments", () => {
        const candidate = fairCandidate(
            'Click the link titled "Museum Opening Hours."',
        );
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                {
                    path: "$.genCases[1].utterance",
                    kind: "unfair_imperative",
                    fairEmptyGold: false,
                    reason: "Requests followLinkByText; empty gold would FP a correct translator",
                },
            ],
        );
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.path).toContain("genCases[1]");
    });

    it("accepts pure-refusal assessments", () => {
        const candidate = fairCandidate(
            "Don't open any websites right now — leave my browser alone.",
        );
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                {
                    path: "$.genCases[1].utterance",
                    kind: "pure_refusal",
                    fairEmptyGold: true,
                    reason: "leave-alone refusal of opening sites",
                },
            ],
        );
        expect(issues).toEqual([]);
    });

    it("requires one assessment per negative", () => {
        const candidate = fairCandidate("Leave my tabs alone.");
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [],
        );
        expect(issues.some((i) => i.path === "$.negativeAssessments")).toBe(
            true,
        );
    });

    it("pairs assessments to negatives by order when counts match", () => {
        const candidate = fairCandidate(
            "Don't close all tabs; just close this one.",
        );
        const issues = checkTranslationBenchCandidateNegativeFairness(
            candidate,
            targetOpenWebPage,
            [
                {
                    path: "$.wrong.path",
                    kind: "unfair_contrastive",
                    fairEmptyGold: false,
                    reason: "refuse-then-alternate still requests an action",
                },
            ],
        );
        expect(issues).toHaveLength(1);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.path).toBe("$.genCases[1].utterance");
    });

    it("forces reject when applying unfair issues to an approve decision", () => {
        const decision = applyTranslationBenchNegativeFairnessIssues(
            {
                candidateHash: "e".repeat(64),
                decision: "approve",
                issues: [],
                summary: "ok",
                scores: {
                    anchorFidelity: 0.9,
                    groundTruthCorrectness: 0.9,
                    naturalness: 0.9,
                    generalizationDiversity: 0.9,
                    negativeQuality: 0.95,
                    historyCoherence: 0.9,
                },
            },
            [
                {
                    code: "BAD_NEGATIVE",
                    path: "$.genCases[1].utterance",
                    message: "unfair",
                    suggestedFix: "rewrite",
                },
            ],
        );
        expect(decision.decision).toBe("reject");
        expect(decision.issues).toHaveLength(1);
        expect(decision.scores.negativeQuality).toBeLessThanOrEqual(0.4);
    });
});

describe("format checker no longer regex-gates negatives", () => {
    it("passes structural format even when negative is contrastive", () => {
        const catalog = browserCatalog();
        const loop = makeLoop(catalog);
        const candidate = fairCandidate(
            'Click the link titled "Museum Opening Hours."',
        );
        const result = runTranslationBenchFormatChecker(candidate, loop);
        expect(result.passed).toBe(true);
        expect(result.issues.some((i) => i.code === "BAD_NEGATIVE")).toBe(
            false,
        );
    });

    it("still accepts pure-refusal negatives structurally", () => {
        const catalog = browserCatalog();
        const loop = makeLoop(catalog);
        const candidate = fairCandidate(
            "Don't open any websites right now — leave my browser alone.",
        );
        const result = runTranslationBenchFormatChecker(candidate, loop);
        expect(result.passed).toBe(true);
    });
});

describe("semantic checker enforces LLM negativeAssessments", () => {
    const pack = loadTranslationBenchQualityVerifierPromptPack();

    it("rejects when mock LLM marks negative unfair", async () => {
        const catalog = browserCatalog();
        const loop = makeLoop(catalog);
        const candidate = fairCandidate(
            "Don't close all tabs; just close this one.",
        );
        const candidateHash = "a".repeat(64);
        const llm = {
            model: "mock",
            complete: async () =>
                JSON.stringify({
                    candidateHash,
                    decision: "approve",
                    scores: {
                        anchorFidelity: 0.9,
                        groundTruthCorrectness: 0.9,
                        naturalness: 0.9,
                        generalizationDiversity: 0.9,
                        negativeQuality: 0.9,
                        historyCoherence: 0.9,
                    },
                    issues: [],
                    summary: "looks fine",
                    negativeAssessments: [
                        {
                            path: "$.genCases[1].utterance",
                            kind: "unfair_contrastive",
                            fairEmptyGold: false,
                            reason: "refuse-then-alternate still requests closeWebPage",
                        },
                    ],
                }),
        };

        const result = await runTranslationBenchSemanticChecker({
            pack,
            loop,
            candidate,
            candidateHash,
            llm,
        });
        expect(result.passed).toBe(false);
        expect(result.decision.decision).toBe("reject");
        expect(
            result.decision.issues.some((i) => i.code === "BAD_NEGATIVE"),
        ).toBe(true);
    });

    it("approves when mock LLM marks negative fair", async () => {
        const catalog = browserCatalog();
        const loop = makeLoop(catalog);
        const candidate = fairCandidate("Leave my browser tabs alone.");
        const candidateHash = "b".repeat(64);
        const llm = {
            model: "mock",
            complete: async () =>
                JSON.stringify({
                    candidateHash,
                    decision: "approve",
                    scores: {
                        anchorFidelity: 0.9,
                        groundTruthCorrectness: 0.9,
                        naturalness: 0.9,
                        generalizationDiversity: 0.9,
                        negativeQuality: 0.95,
                        historyCoherence: 0.9,
                    },
                    issues: [],
                    summary: "fair refusal negative",
                    negativeAssessments: [
                        {
                            path: "$.genCases[1].utterance",
                            kind: "pure_refusal",
                            fairEmptyGold: true,
                            reason: "leave-alone pure refusal",
                        },
                    ],
                }),
        };

        const result = await runTranslationBenchSemanticChecker({
            pack,
            loop,
            candidate,
            candidateHash,
            llm,
        });
        expect(result.passed).toBe(true);
        expect(result.decision.decision).toBe("approve");
    });

    it("rejects approve when negativeAssessments are missing", async () => {
        const catalog = browserCatalog();
        const loop = makeLoop(catalog);
        const candidate = fairCandidate("Is Bluetooth currently enabled?");
        const candidateHash = "d".repeat(64);
        const llm = {
            model: "mock",
            complete: async () =>
                JSON.stringify({
                    candidateHash,
                    decision: "approve",
                    scores: {
                        anchorFidelity: 0.9,
                        groundTruthCorrectness: 0.9,
                        naturalness: 0.9,
                        generalizationDiversity: 0.9,
                        negativeQuality: 0.9,
                        historyCoherence: 0.9,
                    },
                    issues: [],
                    summary: "forgot assessments",
                }),
        };

        const result = await runTranslationBenchSemanticChecker({
            pack,
            loop,
            candidate,
            candidateHash,
            llm,
        });
        expect(result.passed).toBe(false);
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";

import {
    classifyTranslationBenchAmbiguityAgreement,
    deterministicAmbiguityIssues,
    listTranslationBenchAmbiguityProbeTargets,
    parseTranslationBenchAmbiguityJudgeDecision,
    runTranslationBenchAmbiguityProbe,
    translationBenchAmbiguityCasesClear,
    type TranslationBenchAmbiguityProbeTranslator,
} from "../src/translationBench/synthesizer/ambiguityProbe.js";
import { loadTranslationBenchQualityVerifierPromptPack } from "../src/translationBench/synthesizer/synthesizerPrompts.js";
import type { TranslationBenchGeneratedCandidate } from "../src/translationBench/synthesizer/generationCandidate.js";
import type { TranslationBenchBenchmarkSchema } from "../src/translationBench/synthesizer/benchmark.js";

const candidate: TranslationBenchGeneratedCandidate = {
    seed: {
        utterance:
            "Inspect github.com to discover which browser actions are supported for that domain.",
        expectedActions: [
            {
                schemaName: "browser.actionDiscovery",
                actionName: "getWebFlowsForDomain",
                parameters: { domain: "github.com" },
            },
        ],
        order: "any",
    },
    genCases: [
        {
            id: "pos-1",
            role: "positive",
            utterance: "List the saved web flows for the domain github.com",
            expectedActions: [
                {
                    schemaName: "browser.actionDiscovery",
                    actionName: "getWebFlowsForDomain",
                    parameters: { domain: "github.com" },
                },
            ],
            order: "any",
            dimensions: { k: 1 },
        },
        {
            id: "neg-1",
            role: "negative",
            utterance: "Do not inspect any domains.",
            expectedActions: [],
            order: "any",
            dimensions: { k: 2 },
        },
    ],
};

const catalog = [
    {
        schemaName: "browser.actionDiscovery",
        description: "discovery",
        tools: [
            {
                type: "function" as const,
                function: {
                    name: "getWebFlowsForDomain",
                    parameters: {
                        type: "object",
                        properties: {},
                        additionalProperties: false,
                    },
                },
            },
            {
                type: "function" as const,
                function: {
                    name: "detectPageActions",
                    parameters: {
                        type: "object",
                        properties: {},
                        additionalProperties: false,
                    },
                },
            },
        ],
        typeAgent: {
            sourceHash: "x",
            schemaType: "X",
            parsedActionSchema: undefined,
        },
    },
] as unknown as TranslationBenchBenchmarkSchema[];

describe("translation bench ambiguity probe classification", () => {
    it("classifies unanimous gold / other / split / all_errors", () => {
        const gold = candidate.seed.expectedActions;
        expect(
            classifyTranslationBenchAmbiguityAgreement(gold, [
                {
                    model: "sol",
                    actions: [
                        {
                            schemaName: "browser.actionDiscovery",
                            actionName: "getWebFlowsForDomain",
                        },
                    ],
                },
                {
                    model: "terra",
                    actions: [
                        {
                            schemaName: "browser.actionDiscovery",
                            actionName: "getWebFlowsForDomain",
                        },
                    ],
                },
            ]).agreement,
        ).toBe("unanimous_gold");

        expect(
            classifyTranslationBenchAmbiguityAgreement(gold, [
                {
                    model: "sol",
                    actions: [
                        {
                            schemaName: "browser.actionDiscovery",
                            actionName: "detectPageActions",
                        },
                    ],
                },
                {
                    model: "terra",
                    actions: [
                        {
                            schemaName: "browser.actionDiscovery",
                            actionName: "detectPageActions",
                        },
                    ],
                },
            ]).agreement,
        ).toBe("unanimous_other");

        expect(
            classifyTranslationBenchAmbiguityAgreement(gold, [
                {
                    model: "sol",
                    actions: [
                        {
                            schemaName: "browser.actionDiscovery",
                            actionName: "getWebFlowsForDomain",
                        },
                    ],
                },
                {
                    model: "terra",
                    actions: [
                        {
                            schemaName: "browser.actionDiscovery",
                            actionName: "detectPageActions",
                        },
                    ],
                },
            ]).agreement,
        ).toBe("split");

        expect(
            classifyTranslationBenchAmbiguityAgreement(gold, [
                { model: "sol", actions: [], error: "boom" },
                { model: "terra", actions: [], error: "boom" },
            ]).agreement,
        ).toBe("all_errors");
    });

    it("lists seed + positives only", () => {
        const targets = listTranslationBenchAmbiguityProbeTargets(candidate);
        expect(targets.map((t) => t.path)).toEqual([
            "$.seed.utterance",
            "$.genCases[0].utterance",
        ]);
    });

    it("builds deterministic AMBIGUOUS_INTENT issues for splits", () => {
        const issues = deterministicAmbiguityIssues([
            {
                path: "$.seed.utterance",
                utterance: candidate.seed.utterance,
                expectedActions: candidate.seed.expectedActions,
                observations: [],
                agreement: "split",
                routes: [
                    "browser.actionDiscovery.detectPageActions",
                    "browser.actionDiscovery.getWebFlowsForDomain",
                ],
            },
        ]);
        expect(issues).toHaveLength(1);
        expect(issues[0]!.code).toBe("AMBIGUOUS_INTENT");
    });
});

describe("translation bench ambiguity probe end-to-end", () => {
    const pack = loadTranslationBenchQualityVerifierPromptPack();
    const hash = "a".repeat(64);

    it("passes without judge when all models match gold", async () => {
        const translator: TranslationBenchAmbiguityProbeTranslator = {
            models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
            async translate({ model, utterance }) {
                const isClear = utterance.includes("saved web flows");
                const actionName = isClear
                    ? "getWebFlowsForDomain"
                    : "getWebFlowsForDomain";
                return {
                    model,
                    actions: [
                        {
                            schemaName: "browser.actionDiscovery",
                            actionName,
                            parameters: { domain: "github.com" },
                        },
                    ],
                };
            },
        };
        let judgeCalled = false;
        const result = await runTranslationBenchAmbiguityProbe({
            pack,
            candidate: {
                ...candidate,
                // Use only the clear positive as seed so unanimous gold holds.
                seed: {
                    utterance:
                        "List the saved web flows for the domain github.com",
                    expectedActions: candidate.seed.expectedActions,
                    order: "any",
                },
                genCases: [],
            },
            candidateHash: hash,
            targetAction: {
                schemaName: "browser.actionDiscovery",
                actionName: "getWebFlowsForDomain",
            },
            activeSchemas: ["browser.actionDiscovery"],
            catalog,
            translator,
            judgeLlm: {
                model: "judge",
                async complete() {
                    judgeCalled = true;
                    return "{}";
                },
            },
        });
        expect(result.passed).toBe(true);
        expect(judgeCalled).toBe(false);
        expect(translationBenchAmbiguityCasesClear(result.cases)).toBe(true);
    });

    it("rejects split routes fail-closed (github.com style)", async () => {
        const translator: TranslationBenchAmbiguityProbeTranslator = {
            models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
            async translate({ model }) {
                // sol agrees with gold; terra/luna pick detect — classic split
                if (model === "gpt-5.6-sol") {
                    return {
                        model,
                        actions: [
                            {
                                schemaName: "browser.actionDiscovery",
                                actionName: "getWebFlowsForDomain",
                                parameters: { domain: "github.com" },
                            },
                        ],
                    };
                }
                return {
                    model,
                    actions: [
                        {
                            schemaName: "browser.actionDiscovery",
                            actionName: "detectPageActions",
                        },
                    ],
                };
            },
        };
        const result = await runTranslationBenchAmbiguityProbe({
            pack,
            candidate: {
                seed: candidate.seed,
                genCases: [],
            },
            candidateHash: hash,
            targetAction: {
                schemaName: "browser.actionDiscovery",
                actionName: "getWebFlowsForDomain",
            },
            activeSchemas: ["browser.actionDiscovery"],
            catalog,
            translator,
            judgeLlm: {
                model: "judge",
                async complete() {
                    // Judge tries to approve — deterministic split must still reject.
                    return JSON.stringify({
                        candidateHash: hash,
                        decision: "approve",
                        ambiguous: false,
                        issues: [],
                        summary: "looks fine",
                    });
                },
            },
        });
        expect(result.passed).toBe(false);
        expect(result.issues.some((i) => i.code === "AMBIGUOUS_INTENT")).toBe(
            true,
        );
        expect(result.cases[0]?.agreement).toBe("split");
    });

    it("parses judge reject and rejects approve+ambiguous", () => {
        const parsed = parseTranslationBenchAmbiguityJudgeDecision(
            {
                candidateHash: hash,
                decision: "approve",
                ambiguous: true,
                issues: [],
                summary: "double meaning",
            },
            hash,
        );
        expect(parsed.decision).toBe("reject");
        expect(parsed.ambiguous).toBe(true);
    });
});

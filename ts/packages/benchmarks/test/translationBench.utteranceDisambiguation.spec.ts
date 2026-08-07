// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import {
    generateActionActionFunctionJsonSchemas,
    parseToolsJsonSchema,
    toJSONParsedActionSchema,
} from "@typeagent/action-schema";

import type { TranslationBenchBenchmarkSchema } from "../src/translationBench/synthesizer/benchmark.js";
import { runTranslationBenchFormatChecker } from "../src/translationBench/synthesizer/dataQualityVerifier.js";
import type { TranslationBenchGenerationQualityLoopOptions } from "../src/translationBench/synthesizer/datasetGenerator.js";
import {
    checkTranslationBenchCandidateDisambiguation,
    checkTranslationBenchUtteranceDisambiguation,
    findTranslationBenchConfusableSiblings,
} from "../src/translationBench/synthesizer/utteranceDisambiguation.js";

const HASH = "b".repeat(64);

function browserCatalog(): TranslationBenchBenchmarkSchema[] {
    const actionNames = [
        "followLinkByText",
        "followLinkByPosition",
        "openWebPage",
        "openSearchResult",
        "closeWebPage",
    ];
    const parsed = parseToolsJsonSchema(
        actionNames.map((actionName) => ({
            name: actionName,
            description: `Run ${actionName}`,
            inputSchema: {
                type: "object",
                properties: {
                    ...(actionName === "followLinkByText"
                        ? { keywords: { type: "string" } }
                        : {}),
                    ...(actionName === "openWebPage"
                        ? { site: { type: "string" } }
                        : {}),
                    ...(actionName === "openSearchResult" ||
                    actionName === "followLinkByPosition"
                        ? { position: { type: "number" } }
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

describe("translation bench confusable siblings", () => {
    it("finds curated openWebPage ↔ followLinkByText pair", () => {
        const catalog = browserCatalog();
        const siblings = findTranslationBenchConfusableSiblings(
            { schemaName: "browser", actionName: "openWebPage" },
            catalog,
        );
        expect(siblings.map((s) => s.actionName)).toEqual(
            expect.arrayContaining(["followLinkByText"]),
        );
    });

    it("finds same-schema name-overlap siblings", () => {
        const catalog = browserCatalog();
        const siblings = findTranslationBenchConfusableSiblings(
            { schemaName: "browser", actionName: "followLinkByText" },
            catalog,
        );
        expect(siblings.map((s) => s.actionName)).toEqual(
            expect.arrayContaining([
                "openWebPage",
                "followLinkByPosition",
                "openSearchResult",
            ]),
        );
    });
});

describe("translation bench utterance disambiguation", () => {
    const catalog = browserCatalog();
    const openWebPage = {
        schemaName: "browser",
        actionName: "openWebPage",
    } as const;
    const followLink = {
        schemaName: "browser",
        actionName: "followLinkByText",
    } as const;
    const openSiblings = findTranslationBenchConfusableSiblings(
        openWebPage,
        catalog,
    );
    const followSiblings = findTranslationBenchConfusableSiblings(
        followLink,
        catalog,
    );

    it("rejects double-meaning open phrase for openWebPage", () => {
        const result = checkTranslationBenchUtteranceDisambiguation(
            "Open the Apple stock quote in a new tab",
            openWebPage,
            openSiblings,
            "$.seed.utterance",
        );
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/disambiguat|confusable/i);
    });

    it("rejects the same phrase for followLinkByText", () => {
        const result = checkTranslationBenchUtteranceDisambiguation(
            "Open the Apple stock quote in a new tab",
            followLink,
            followSiblings,
            "$.seed.utterance",
        );
        expect(result.ok).toBe(false);
    });

    it("accepts openWebPage with navigate cue", () => {
        const result = checkTranslationBenchUtteranceDisambiguation(
            "Go to the Apple stock quote website",
            openWebPage,
            openSiblings,
            "$.seed.utterance",
        );
        expect(result.ok).toBe(true);
        expect(result.targetCuesMatched.length).toBeGreaterThan(0);
    });

    it("accepts followLinkByText with link cue", () => {
        const result = checkTranslationBenchUtteranceDisambiguation(
            "Click the link titled Apple stock quote",
            followLink,
            followSiblings,
            "$.seed.utterance",
        );
        expect(result.ok).toBe(true);
        expect(result.targetCuesMatched.length).toBeGreaterThan(0);
    });

    it("skips negatives in candidate check", () => {
        const issues = checkTranslationBenchCandidateDisambiguation(
            {
                seed: {
                    utterance: "Go to apple.com",
                    expectedActions: [
                        {
                            schemaName: "browser",
                            actionName: "openWebPage",
                            parameters: { site: "apple.com" },
                        },
                    ],
                    order: "any",
                },
                genCases: [
                    {
                        id: "pos-0",
                        role: "positive",
                        utterance: "Visit the Apple homepage",
                        expectedActions: [
                            {
                                schemaName: "browser",
                                actionName: "openWebPage",
                                parameters: { site: "apple.com" },
                            },
                        ],
                        order: "any",
                        dimensions: {},
                    },
                    {
                        id: "neg-0",
                        role: "negative",
                        // Intentionally sibling-like; negatives are not checked.
                        utterance: "Open the Apple stock quote in a new tab",
                        expectedActions: [],
                        order: "any",
                        dimensions: {},
                    },
                ],
            },
            openWebPage,
            catalog,
        );
        expect(issues).toEqual([]);
    });
});

describe("format checker utterance disambiguation gate", () => {
    it("hard-rejects ambiguous positives before semantic review", () => {
        const catalog = browserCatalog();
        const schema = catalog[0]!;
        const target = {
            schemaName: "browser",
            actionName: "openWebPage",
        } as const;
        const loop = {
            targetAction: target,
            schema,
            catalogSchemas: catalog,
            anchor: {
                candidateId: "a",
                utterance: "open something",
                sourceCalls: [],
            },
            activeSchemas: ["browser"],
            genCaseCount: 2,
            maxAttempts: 5,
            generator: { model: "g", complete: async () => "" },
            reviewer: { model: "r", complete: async () => "" },
        } as unknown as TranslationBenchGenerationQualityLoopOptions;

        const ambiguous = {
            seed: {
                utterance: "Open the Apple stock quote in a new tab",
                expectedActions: [
                    {
                        schemaName: "browser",
                        actionName: "openWebPage",
                        parameters: { site: "apple.com" },
                    },
                ],
                order: "any",
            },
            genCases: [
                {
                    id: "pos-0",
                    role: "positive",
                    utterance: "Go to the Apple investor relations site",
                    expectedActions: [
                        {
                            schemaName: "browser",
                            actionName: "openWebPage",
                            parameters: { site: "apple.com" },
                        },
                    ],
                    order: "any",
                    dimensions: { variation: 0 },
                },
                {
                    id: "neg-0",
                    role: "negative",
                    utterance: "What is Apple's market cap?",
                    expectedActions: [],
                    order: "any",
                    dimensions: { boundary: "question" },
                },
            ],
        };

        const result = runTranslationBenchFormatChecker(ambiguous, loop);
        expect(result.passed).toBe(false);
        expect(result.issues.some((i) => i.code === "AMBIGUOUS_INTENT")).toBe(
            true,
        );
    });

    it("accepts disambiguated openWebPage positives", () => {
        const catalog = browserCatalog();
        const schema = catalog[0]!;
        const target = {
            schemaName: "browser",
            actionName: "openWebPage",
        } as const;
        const loop = {
            targetAction: target,
            schema,
            catalogSchemas: catalog,
            anchor: {
                candidateId: "a",
                utterance: "open something",
                sourceCalls: [],
            },
            activeSchemas: ["browser"],
            genCaseCount: 2,
            maxAttempts: 5,
            generator: { model: "g", complete: async () => "" },
            reviewer: { model: "r", complete: async () => "" },
        } as unknown as TranslationBenchGenerationQualityLoopOptions;

        const clear = {
            seed: {
                utterance: "Go to the Apple stock quote website",
                expectedActions: [
                    {
                        schemaName: "browser",
                        actionName: "openWebPage",
                        parameters: { site: "apple.com" },
                    },
                ],
                order: "any",
            },
            genCases: [
                {
                    id: "pos-0",
                    role: "positive",
                    utterance: "Navigate to apple.com/investor",
                    expectedActions: [
                        {
                            schemaName: "browser",
                            actionName: "openWebPage",
                            parameters: { site: "apple.com/investor" },
                        },
                    ],
                    order: "any",
                    dimensions: { variation: 0 },
                },
                {
                    id: "neg-0",
                    role: "negative",
                    utterance: "What is Apple's market cap?",
                    expectedActions: [],
                    order: "any",
                    dimensions: { boundary: "question" },
                },
            ],
        };

        const result = runTranslationBenchFormatChecker(clear, loop);
        expect(result.passed).toBe(true);
        expect(result.issues).toEqual([]);
    });
});

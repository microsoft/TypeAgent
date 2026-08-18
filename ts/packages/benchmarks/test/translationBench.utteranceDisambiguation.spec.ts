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

    it("finds curated github-cli.browseIssue ↔ browser.openWebPage pair", () => {
        const catalog: TranslationBenchBenchmarkSchema[] = [
            ...browserCatalog(),
            {
                schemaName: "github-cli",
                description: "github cli",
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "browseIssue",
                            description: "Browse a GitHub issue",
                            parameters: {
                                type: "object",
                                properties: { number: { type: "number" } },
                            },
                        },
                    },
                ],
                typeAgent: {
                    sourceHash: `github-${HASH}`,
                    schemaType: "GithubAction",
                    parsedActionSchema: toJSONParsedActionSchema(
                        parseToolsJsonSchema([
                            {
                                name: "browseIssue",
                                description: "Browse a GitHub issue",
                                inputSchema: {
                                    type: "object",
                                    properties: {
                                        number: { type: "number" },
                                    },
                                    additionalProperties: false,
                                },
                            },
                        ]),
                    ),
                },
            },
        ];
        const siblings = findTranslationBenchConfusableSiblings(
            { schemaName: "github-cli", actionName: "browseIssue" },
            catalog,
        );
        expect(siblings.map((s) => `${s.schemaName}.${s.actionName}`)).toEqual(
            expect.arrayContaining(["browser.openWebPage"]),
        );
    });

    it("finds curated browser.external.openTab ↔ browser.openWebPage pair", () => {
        const catalog: TranslationBenchBenchmarkSchema[] = [
            ...browserCatalog(),
            {
                schemaName: "browser.external",
                description: "external browser",
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "openTab",
                            description: "Open external browser tab",
                            parameters: {
                                type: "object",
                                properties: { url: { type: "string" } },
                            },
                        },
                    },
                ],
                typeAgent: {
                    sourceHash: `external-${HASH}`,
                    schemaType: "ExternalAction",
                    parsedActionSchema: toJSONParsedActionSchema(
                        parseToolsJsonSchema([
                            {
                                name: "openTab",
                                description: "Open external browser tab",
                                inputSchema: {
                                    type: "object",
                                    properties: {
                                        url: { type: "string" },
                                    },
                                    additionalProperties: false,
                                },
                            },
                        ]),
                    ),
                },
            },
        ];
        const siblings = findTranslationBenchConfusableSiblings(
            { schemaName: "browser.external", actionName: "openTab" },
            catalog,
        );
        expect(siblings.map((s) => `${s.schemaName}.${s.actionName}`)).toEqual(
            expect.arrayContaining(["browser.openWebPage"]),
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

    it("rejects getWebFlowsForDomain gold that reads as detectPageActions", () => {
        // gen1k case generated-000920: "Inspect github.com to discover which
        // browser actions are supported for that domain" — terra/luna both
        // chose detectPageActions; utterance never says web flows.
        const discoveryCatalog: TranslationBenchBenchmarkSchema[] = [
            {
                schemaName: "browser.actionDiscovery",
                description: "discovery",
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "getWebFlowsForDomain",
                            description: "List web flows for a domain",
                            parameters: {
                                type: "object",
                                properties: {
                                    domain: { type: "string" },
                                },
                            },
                        },
                    },
                    {
                        type: "function",
                        function: {
                            name: "detectPageActions",
                            description: "Detect page actions",
                            parameters: { type: "object", properties: {} },
                        },
                    },
                ],
                typeAgent: {
                    sourceHash: `discovery-${HASH}`,
                    schemaType: "DiscoveryAction",
                    parsedActionSchema: toJSONParsedActionSchema(
                        parseToolsJsonSchema([
                            {
                                name: "getWebFlowsForDomain",
                                description: "List web flows for a domain",
                                inputSchema: {
                                    type: "object",
                                    properties: {
                                        domain: { type: "string" },
                                    },
                                    additionalProperties: false,
                                },
                            },
                            {
                                name: "detectPageActions",
                                description: "Detect page actions",
                                inputSchema: {
                                    type: "object",
                                    properties: {},
                                    additionalProperties: false,
                                },
                            },
                        ]),
                    ),
                },
            },
            ...catalog,
        ];
        const target = {
            schemaName: "browser.actionDiscovery",
            actionName: "getWebFlowsForDomain",
        } as const;
        const siblings = findTranslationBenchConfusableSiblings(
            target,
            discoveryCatalog,
        );
        expect(siblings.map((s) => s.actionName)).toEqual(
            expect.arrayContaining(["detectPageActions", "openWebPage"]),
        );
        const ambiguous = checkTranslationBenchUtteranceDisambiguation(
            "Inspect github.com to discover which browser actions are supported for that domain.",
            target,
            siblings,
            "$.seed.utterance",
        );
        expect(ambiguous.ok).toBe(false);
        expect(ambiguous.message).toMatch(/disambiguat|confusable|cue/i);

        const clear = checkTranslationBenchUtteranceDisambiguation(
            "List the saved web flows for the domain github.com",
            target,
            siblings,
            "$.seed.utterance",
        );
        expect(clear.ok).toBe(true);
        expect(clear.targetCuesMatched.length).toBeGreaterThan(0);
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

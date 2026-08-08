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
    checkTranslationBenchCandidateNegativeFairness,
    checkTranslationBenchNegativeFairness,
} from "../src/translationBench/synthesizer/negativeFairness.js";

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

describe("translation bench negative fairness classifier", () => {
    it("accepts pure refusals", () => {
        const r = checkTranslationBenchNegativeFairness(
            "Don't take a screenshot of my online banking page.",
            { schemaName: "browser", actionName: "captureScreenshot" },
            "$.genCases[0].utterance",
        );
        expect(r.ok).toBe(true);
        expect(r.kind).toBe("pure_refusal");
    });

    it("accepts non-action status questions", () => {
        const r = checkTranslationBenchNegativeFairness(
            "Is Bluetooth currently enabled on this computer?",
            { schemaName: "desktop", actionName: "BluetoothToggle" },
            "$.genCases[0].utterance",
        );
        expect(r.ok).toBe(true);
        expect(r.kind).toBe("non_action_question");
    });

    it("rejects contrastive imperatives with empty gold", () => {
        const r = checkTranslationBenchNegativeFairness(
            "Close only the current web page and leave my other tabs open.",
            targetOpenWebPage,
            "$.genCases[0].utterance",
        );
        expect(r.ok).toBe(false);
        expect(["unfair_imperative", "unfair_contrastive"]).toContain(r.kind);
    });

    it("rejects adjacent search commands used as empty-gold negatives", () => {
        const r = checkTranslationBenchNegativeFairness(
            "Search Bing for Microsoft's current stock price.",
            { schemaName: "browser", actionName: "changeSearchProvider" },
            "$.genCases[0].utterance",
        );
        expect(r.ok).toBe(false);
        expect(["unfair_imperative", "unfair_sibling_command"]).toContain(
            r.kind,
        );
    });

    it("rejects click-link imperatives as empty-gold negatives", () => {
        const r = checkTranslationBenchNegativeFairness(
            'Click the link titled "Museum Opening Hours."',
            { schemaName: "browser", actionName: "openWebPage" },
            "$.genCases[0].utterance",
        );
        expect(r.ok).toBe(false);
    });

    it("rejects partial constraints that still request an action", () => {
        const r = checkTranslationBenchNegativeFairness(
            "Open https://example.com in my browser, but don't bookmark it.",
            { schemaName: "browser", actionName: "openWebPage" },
            "$.genCases[0].utterance",
        );
        // "Open … but don't bookmark" — partial constraint / mixed command.
        expect(r.ok).toBe(false);
    });
});

describe("translation bench candidate negative fairness", () => {
    it("flags unfair negatives on a candidate", () => {
        const issues = checkTranslationBenchCandidateNegativeFairness(
            {
                seed: {
                    utterance: "Go to the Apple investor site.",
                    expectedActions: [
                        {
                            schemaName: "browser",
                            actionName: "openWebPage",
                            parameters: { site: "apple.com" },
                        },
                    ],
                    order: "strict",
                },
                genCases: [
                    {
                        id: "pos-1",
                        role: "positive",
                        utterance: "Open the apple.com website in this tab.",
                        expectedActions: [
                            {
                                schemaName: "browser",
                                actionName: "openWebPage",
                                parameters: { site: "apple.com" },
                            },
                        ],
                        order: "strict",
                        dimensions: { kind: "paraphrase" },
                    },
                    {
                        id: "neg-1",
                        role: "negative",
                        utterance:
                            'Click the link titled "Museum Opening Hours."',
                        expectedActions: [],
                        order: "strict",
                        dimensions: { kind: "contrastive" },
                    },
                ],
            },
            targetOpenWebPage,
            browserCatalog(),
        );
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0]!.code).toBe("BAD_NEGATIVE");
        expect(issues[0]!.path).toContain("genCases[1]");
    });

    it("format checker rejects unfair negatives before semantic review", () => {
        const catalog = browserCatalog();
        const schema = catalog[0]!;
        const loop = {
            targetAction: targetOpenWebPage,
            schema,
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

        const candidate = {
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
                    utterance: 'Click the link titled "Museum Opening Hours."',
                    expectedActions: [],
                    order: "strict" as const,
                    dimensions: { variation: "contrastive" },
                },
            ],
        };

        const result = runTranslationBenchFormatChecker(candidate, loop);
        expect(result.passed).toBe(false);
        expect(result.issues.some((i) => i.code === "BAD_NEGATIVE")).toBe(true);
    });

    it("format checker accepts pure-refusal negatives", () => {
        const catalog = browserCatalog();
        const schema = catalog[0]!;
        const loop = {
            targetAction: targetOpenWebPage,
            schema,
            catalogSchemas: catalog,
            activeSchemas: ["browser"],
            genCaseCount: 2,
            maxAttempts: 5,
            generator: { model: "g", complete: async () => "" },
            reviewer: { model: "r", complete: async () => "" },
            anchor: {
                candidateId: "anchor-2",
                utterance: "open something",
                sourceCalls: [],
            },
        } as unknown as TranslationBenchGenerationQualityLoopOptions;

        const candidate = {
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
                    utterance:
                        "Don't open any websites right now — leave my browser alone.",
                    expectedActions: [],
                    order: "strict" as const,
                    dimensions: { negativeKind: "pure_refusal" },
                },
            ],
        };

        const result = runTranslationBenchFormatChecker(candidate, loop);
        expect(result.passed).toBe(true);
        expect(result.issues).toEqual([]);
    });
});

describe("translation bench negative fairness adversarial holes", () => {
    const target = {
        schemaName: "browser",
        actionName: "closeAllWebPages",
    };

    it("rejects refuse-then-alternate multi-clause negatives", () => {
        for (const utt of [
            "Don't close all tabs; just close this one.",
            "Never close everything — close only the current tab.",
            "Do not screenshot; open banking instead.",
            "Don't take a screenshot; open cnn.com instead.",
        ]) {
            const r = checkTranslationBenchNegativeFairness(utt, target, "$.n");
            expect(r.ok).toBe(false);
        }
    });

    it("rejects bare-? contrastive commands", () => {
        for (const utt of [
            "Find MSFT on Bing?",
            "Look up the weather?",
            "Shut the other tabs?",
            "Would you mind closing just this tab?",
            "Maybe search Bing for MSFT stock?",
        ]) {
            const r = checkTranslationBenchNegativeFairness(utt, target, "$.n");
            expect(r.ok).toBe(false);
        }
    });

    it("accepts leave-alone pure refusals", () => {
        const r = checkTranslationBenchNegativeFairness(
            "Leave my browser tabs alone.",
            target,
            "$.n",
        );
        expect(r.ok).toBe(true);
        expect(r.kind).toBe("pure_refusal");
    });

    it("accepts missing-info clarifications", () => {
        const r = checkTranslationBenchNegativeFairness(
            "I'm not sure which tab you mean — please clarify.",
            target,
            "$.n",
        );
        expect(r.ok).toBe(true);
        expect(r.kind).toBe("missing_info");
    });

    it("rejects capability questions that still solicit an action", () => {
        const r = checkTranslationBenchNegativeFairness(
            "Is there a way to open google.com right now?",
            targetOpenWebPage,
            "$.n",
        );
        expect(r.ok).toBe(false);
    });
});

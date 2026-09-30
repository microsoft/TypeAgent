// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createGrammarModelQuery,
    defaultClaudeGrammarModel,
    defaultGrammarModel,
    resolveGrammarModel,
} from "../src/generation/grammarModel.js";
import { SchemaToGrammarGenerator } from "../src/generation/schemaToGrammarGenerator.js";
import { ScenarioBasedGrammarGenerator } from "../src/generation/scenarioBasedGenerator.js";
import { GrammarWarmer } from "../src/generation/grammarWarmer.js";
import { SchemaInfo } from "../src/generation/schemaReader.js";

const schemaInfo: SchemaInfo = {
    schemaName: "test",
    actions: new Map([
        [
            "listCategories",
            {
                actionName: "listCategories",
                parameters: new Map(),
            },
        ],
    ]),
    entityTypes: new Set(),
    converters: new Map(),
};

describe("grammar model selection", () => {
    it("defaults to Copilot GPT-5.6 Sol and preserves explicit Claude", () => {
        expect(resolveGrammarModel({})).toEqual({
            provider: "copilot",
            model: defaultGrammarModel,
        });
        expect(resolveGrammarModel({ provider: "claude" })).toEqual({
            provider: "claude",
            model: defaultClaudeGrammarModel,
        });
        expect(resolveGrammarModel({ model: "claude-custom" }).provider).toBe(
            "claude",
        );
    });

    it("uses an injected query without contacting a provider", async () => {
        const prompts: string[] = [];
        const query = async (prompt: string) => {
            prompts.push(prompt);
            return "offline";
        };
        await expect(
            createGrammarModelQuery({ query })("prompt"),
        ).resolves.toBe("offline");
        expect(prompts).toEqual(["prompt"]);
    });
});

describe("offline grammar generation", () => {
    it("runs SchemaToGrammarGenerator through its injected query", async () => {
        const responses = [
            '["listCategories"]',
            '["list categories"]',
            `<Start> = <listCategories>;
<listCategories> = list categories -> { actionName: "listCategories" };`,
        ];
        const prompts: string[] = [];
        const query = async (prompt: string) => {
            prompts.push(prompt);
            return responses.shift() ?? "";
        };
        const generator = new SchemaToGrammarGenerator({
            query,
            maxRetries: 0,
        });

        const result = await generator.generateGrammar(schemaInfo, {
            examplesPerAction: 1,
        });

        expect(result.successfulActions).toEqual(["listCategories"]);
        expect(result.testCases).toHaveLength(1);
        expect(prompts).toHaveLength(3);
    });

    it("runs GrammarWarmer test generation through its injected query", async () => {
        const prompts: string[] = [];
        const query = async (prompt: string) => {
            prompts.push(prompt);
            return JSON.stringify([
                {
                    request: "list categories",
                    actionName: "listCategories",
                    parameters: {},
                    isCommon: true,
                },
            ]);
        };

        const result = await GrammarWarmer.createTestSet(
            schemaInfo,
            undefined,
            1,
            undefined,
            1,
            undefined,
            query,
        );

        expect(result).toHaveLength(1);
        expect(result[0].actionName).toBe("listCategories");
        expect(prompts).toHaveLength(1);
    });

    it("runs ScenarioBasedGrammarGenerator through its injected query", async () => {
        const prompts: string[] = [];
        const responses = [
            '["list categories"]',
            `<Start> = list categories -> { actionName: "listCategories" };`,
        ];
        const generator = new ScenarioBasedGrammarGenerator({
            query: async (prompt) => {
                prompts.push(prompt);
                return responses.shift() ?? "";
            },
            maxRetries: 1,
        });

        const result = await generator.generateGrammar(schemaInfo, {
            scenarios: [
                {
                    id: "offline",
                    name: "Offline",
                    description: "An offline test",
                    userContext: {
                        situation: "testing",
                        physicalState: "stationary",
                        emotionalState: "focused",
                        formality: "neutral",
                    },
                    vocabulary: ["list"],
                    exampleGoals: ["list categories"],
                    language: "en",
                },
            ],
            patternsPerScenario: 1,
            includePrefixSuffixPatterns: false,
        });

        expect(result.stats.totalPatterns).toBe(1);
        expect(result.grammarText).toContain("list categories");
        expect(prompts).toHaveLength(2);
    });
});

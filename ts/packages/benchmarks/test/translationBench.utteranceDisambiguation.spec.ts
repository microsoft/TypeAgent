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
    findTranslationBenchConfusableSiblings,
    summarizeTranslationBenchConfusableSiblings,
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

function crossSchemaCatalog(): TranslationBenchBenchmarkSchema[] {
    const mk = (
        schemaName: string,
        actions: ReadonlyArray<{ name: string; description: string }>,
    ): TranslationBenchBenchmarkSchema =>
        ({
            schemaName,
            description: `${schemaName} actions`,
            tools: actions.map((a) => ({
                type: "function" as const,
                function: {
                    name: a.name,
                    description: a.description,
                    parameters: {
                        type: "object",
                        properties: {},
                        additionalProperties: false,
                    },
                },
            })),
            typeAgent: {
                sourceHash: `${schemaName}-${HASH}`,
                schemaType: "X",
                parsedActionSchema: undefined,
            },
        }) as unknown as TranslationBenchBenchmarkSchema;
    return [
        mk("code", [
            {
                name: "newTextFile",
                description: "Create a new text file in the editor",
            },
        ]),
        mk("utility", [
            {
                name: "writeFile",
                description: "Write a new text file to disk",
            },
            {
                name: "readFile",
                description: "Read the contents of a file",
            },
        ]),
    ];
}

describe("translation bench confusable siblings", () => {
    it("finds cross-schema equivalent (newTextFile ↔ writeFile)", () => {
        const catalog = crossSchemaCatalog();
        const siblings = findTranslationBenchConfusableSiblings(
            { schemaName: "code", actionName: "newTextFile" },
            catalog,
        );
        expect(siblings.map((s) => s.actionName)).toEqual(
            expect.arrayContaining(["writeFile"]),
        );
        expect(siblings.map((s) => s.actionName)).not.toContain("readFile");
    });

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

    it("summarizes siblings without cue lists", () => {
        const catalog = browserCatalog();
        const target = {
            schemaName: "browser",
            actionName: "openWebPage",
        } as const;
        const summary = summarizeTranslationBenchConfusableSiblings(
            target,
            findTranslationBenchConfusableSiblings(target, catalog),
        );
        expect(summary.length).toBeGreaterThan(0);
        for (const row of summary) {
            expect(row).toEqual(
                expect.objectContaining({
                    action: expect.any(String),
                    reason: expect.any(String),
                }),
            );
            expect(row).not.toHaveProperty("preferTargetCues");
            expect(row).not.toHaveProperty("avoidCuesThatMeanSibling");
        }
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { executeBrowserPageToolsAction } from "../src/agent/pageToolsActionHandler.mjs";

describe("browser page-tools actions", () => {
    it("maps page tools to canonical commands and arguments", async () => {
        const calls: unknown[][] = [];
        const execute = async (...args: unknown[]) => {
            calls.push(args);
            return undefined;
        };
        const handlers = { description: "test", commands: {} } as any;
        const context = { id: "context" } as any;
        const cases = [
            ["extractCurrentPageKnowledge", undefined],
            ["answerCurrentPageQuestion", { question: "What is this about?" }],
            ["startPageActionRecording", { name: "Add to cart" }],
            ["stopPageActionRecording", { description: "Adds one item" }],
        ] as const;

        for (const [actionName, parameters] of cases) {
            await executeBrowserPageToolsAction(
                {
                    schemaName: "browser.pageTools",
                    actionName,
                    ...(parameters === undefined ? {} : { parameters }),
                } as any,
                context,
                handlers,
                execute as any,
            );
        }

        expect(calls).toEqual([
            [handlers, ["extractKnowledge"], undefined, context],
            [
                handlers,
                ["ask"],
                {
                    args: { question: "What is this about?" },
                    flags: undefined,
                },
                context,
            ],
            [
                handlers,
                ["actions", "record"],
                { args: { name: "Add to cart" }, flags: undefined },
                context,
            ],
            [
                handlers,
                ["actions", "stop", "recording"],
                {
                    args: { description: "Adds one item" },
                    flags: undefined,
                },
                context,
            ],
        ]);
    });
});

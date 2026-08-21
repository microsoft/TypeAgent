// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, it, jest } from "@jest/globals";
import { executeGrammarAction } from "../src/context/system/action/grammarActionHandler.js";

it("runs grammar collision scans without a persisted grammar store", async () => {
    const run = jest.fn(async () => undefined);
    const handlers = {
        description: "system",
        commands: {
            grammar: {
                description: "grammar",
                commands: {
                    collisions: {
                        description: "collisions",
                        parameters: {
                            flags: {
                                json: { type: "string", optional: true },
                            },
                        },
                        run,
                    },
                },
            },
        },
    } as any;
    const context = {
        sessionContext: { agentContext: { persistedGrammarStore: undefined } },
    } as any;

    await executeGrammarAction(
        {
            schemaName: "system.grammar",
            actionName: "scanGrammarCollisions",
            parameters: { jsonPath: "collisions.json" },
        },
        context,
        handlers,
    );

    expect(run).toHaveBeenCalledWith(
        context,
        { args: {}, flags: { json: "collisions.json" } },
        undefined,
    );
});

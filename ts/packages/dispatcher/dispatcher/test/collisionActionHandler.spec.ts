// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { executeCollisionAction } from "../src/context/system/action/collisionActionHandler.js";

type CommandCall = {
    commands: string[];
    params: unknown;
    context: unknown;
};

const handlers = { description: "test", commands: {} } as any;
const context = { id: "context" } as any;

async function run(action: any) {
    const calls: CommandCall[] = [];
    const execute = async (
        _handlers: unknown,
        commands: string[],
        params: unknown,
        actionContext: unknown,
    ) => {
        calls.push({ commands, params, context: actionContext });
        return undefined;
    };
    await executeCollisionAction(
        { schemaName: "system.collision", ...action },
        context,
        handlers,
        execute as any,
    );
    expect(calls).toHaveLength(1);
    return calls[0];
}

describe("collision actions", () => {
    it("maps collision-event defaults", async () => {
        expect(await run({ actionName: "showCollisionEvents" })).toEqual({
            commands: ["events"],
            params: { args: {}, flags: { limit: 10 } },
            context,
        });
    });

    it("maps corpus arrays to command CSV flags", async () => {
        expect(
            await run({
                actionName: "generateCollisionCorpus",
                parameters: {
                    schemas: ["calendar", "email"],
                    models: ["GPT_5", "GPT_5_NANO"],
                    styles: ["imperative", "casual"],
                    outputPath: "corpus.json",
                },
            }),
        ).toEqual({
            commands: ["corpus", "generate"],
            params: {
                args: {},
                flags: {
                    schemas: "calendar,email",
                    models: "GPT_5,GPT_5_NANO",
                    styles: "imperative,casual",
                    concurrency: 8,
                    out: "corpus.json",
                },
            },
            context,
        });
    });

    it("preserves target-first keyword token ordering", async () => {
        expect(
            await run({
                actionName: "manageCollisionKeywords",
                parameters: {
                    operation: "add",
                    target: "list.addItems",
                    keywords: ["grocery", "shopping"],
                },
            }),
        ).toEqual({
            commands: ["keywords"],
            params: {
                args: {
                    tokens: ["list.addItems", "add", "grocery", "shopping"],
                },
                flags: {},
            },
            context,
        });
    });

    it("shows one target when the keyword operation is omitted", async () => {
        expect(
            await run({
                actionName: "manageCollisionKeywords",
                parameters: { target: "list.addItems" },
            }),
        ).toEqual({
            commands: ["keywords"],
            params: {
                args: { tokens: ["list.addItems", "show"] },
                flags: {},
            },
            context,
        });
    });

    it("maps optimization filters and defaults", async () => {
        expect(
            await run({
                actionName: "runCollisionOptimizationPipeline",
                parameters: {
                    from: "explore",
                    levers: ["schema", "keywords"],
                    severities: ["blocker", "minor"],
                    dryRun: true,
                },
            }),
        ).toEqual({
            commands: ["optimize", "run"],
            params: {
                args: {},
                flags: {
                    from: "explore",
                    top: 5,
                    depth: 2,
                    lever: "schema,keywords",
                    severity: "blocker,minor",
                    "dry-run": true,
                    "skip-distill": false,
                    "distill-min-attempts": 10,
                },
            },
            context,
        });
    });

    it("serializes preference candidate sets", async () => {
        expect(
            await run({
                actionName: "setCollisionPreference",
                parameters: {
                    candidates: ["player.play", "list.play"],
                    chosen: "player.play",
                },
            }),
        ).toEqual({
            commands: ["preferences", "set"],
            params: {
                args: {
                    candidates: "player.play,list.play",
                    chosen: "player.play",
                },
                flags: {},
            },
            context,
        });
    });
});

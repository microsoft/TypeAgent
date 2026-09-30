// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import { ReasoningRecipeGenerator } from "../src/reasoning/recipeGenerator.js";
import {
    ScriptRecipeGenerator,
    type ScriptCapture,
} from "../src/reasoning/scriptRecipeGenerator.js";
import type { ReasoningTrace } from "../src/reasoning/tracing/types.js";
import {
    DEFAULT_GENERATION_MODEL,
    runQueryWithTimeout,
} from "../src/validation/queryWithTimeout.mjs";

function successfulTrace(
    action: NonNullable<ReasoningTrace["steps"][number]["action"]>,
): ReasoningTrace {
    return {
        session: {
            sessionId: "session",
            requestId: "request",
            startTime: "2026-01-01T00:00:00.000Z",
            model: "test",
            originalRequest: "perform the task",
            planReuseEnabled: false,
        },
        steps: [
            {
                stepNumber: 1,
                timestamp: "2026-01-01T00:00:00.000Z",
                action,
                result: { success: true, data: "done" },
            },
        ],
        metrics: { totalSteps: 1, totalToolCalls: 1, duration: 1 },
        result: { success: true },
    };
}

describe("provider-neutral generation", () => {
    it("uses the Copilot GPT-5.6 Sol model by default", async () => {
        let requestedModel: string | undefined;
        const model = {
            complete: async () => ({ success: true, data: "generated" }),
        } as unknown as Pick<ChatModel, "complete">;

        await expect(
            runQueryWithTimeout("prompt", undefined, 100, (modelName) => {
                requestedModel = modelName;
                return model;
            }),
        ).resolves.toBe("generated");
        expect(requestedModel).toBe(DEFAULT_GENERATION_MODEL);
        expect(DEFAULT_GENERATION_MODEL).toBe("gpt-5.6-sol");
    });

    it("maps legacy Claude model options to the Copilot default", async () => {
        let requestedModel: string | undefined;
        const model = {
            complete: async () => ({ success: true, data: "generated" }),
        } as unknown as Pick<ChatModel, "complete">;

        await runQueryWithTimeout(
            "prompt",
            { model: "claude-sonnet-4-20250514" },
            100,
            (modelName) => {
                requestedModel = modelName;
                return model;
            },
        );

        expect(requestedModel).toBe(DEFAULT_GENERATION_MODEL);
    });

    it("aborts an injected model when the query times out", async () => {
        let signal: AbortSignal | undefined;
        const model = {
            complete: (
                _prompt: unknown,
                _usage: unknown,
                _schema: unknown,
                _log: unknown,
                abortSignal?: AbortSignal,
            ) => {
                signal = abortSignal;
                return new Promise(() => {});
            },
        } as unknown as Pick<ChatModel, "complete">;

        await expect(
            runQueryWithTimeout("prompt", {}, 1, () => model),
        ).rejects.toThrow("Generation query timed out after 1ms");
        expect(signal?.aborted).toBe(true);
    });

    it("generates a TaskFlow recipe with an injected offline model", async () => {
        const prompts: string[] = [];
        const generator = new ReasoningRecipeGenerator(async (prompt) => {
            prompts.push(prompt);
            return JSON.stringify({
                name: "playFavorite",
                description: "Play a favorite song",
                parameters: [],
                script: "async function execute(api: TaskFlowScriptAPI, params: FlowParams): Promise<TaskFlowScriptResult> { return { success: true }; }",
                grammarPatterns: ["favorite playlist"],
            });
        });

        const recipe = await generator.generate(
            successfulTrace({
                tool: "execute_action",
                schemaName: "player",
                actionName: "play",
                parameters: { track: "favorite" },
            }),
        );

        expect(recipe?.name).toBe("playFavorite");
        expect(recipe?.source?.sourceId).toBe("request");
        expect(prompts).toHaveLength(1);
        expect(prompts[0]).toContain("player");
        expect(prompts[0]).toContain('"gpt-5.6-sol"');
    });

    it("generates a PowerShell recipe with an injected offline model", async () => {
        const response: Omit<
            Awaited<ReturnType<ScriptRecipeGenerator["generate"]>>[number],
            "source"
        > = {
            version: 1,
            actionName: "listFiles",
            description: "List files",
            displayName: "List Files",
            parameters: [],
            script: {
                language: "powershell",
                body: "Get-ChildItem",
                expectedOutputFormat: "objects",
            },
            grammarPatterns: [
                {
                    pattern: "files list now",
                    isAlias: false,
                    examples: ["files list now"],
                },
            ],
            sandbox: {
                allowedCmdlets: ["Get-ChildItem"],
                allowedPaths: ["$PWD"],
                allowedModules: ["Microsoft.PowerShell.Management"],
                maxExecutionTime: 30,
                networkAccess: false,
            },
        };
        let prompt = "";
        const generator = new ScriptRecipeGenerator(async (value) => {
            prompt = value;
            return JSON.stringify(response);
        });
        const capture: ScriptCapture = {
            stepNumber: 1,
            rawCommand: "Get-ChildItem",
            scriptBody: "Get-ChildItem",
            output: "file.txt",
            exitCode: 0,
            originalRequest: "list files",
        };

        const recipes = await generator.generate(
            successfulTrace({
                tool: "Bash",
                parameters: { command: capture.rawCommand },
            }),
        );

        expect(recipes).toHaveLength(1);
        expect(recipes[0].actionName).toBe("listFiles");
        expect(prompt).toContain(capture.scriptBody);
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    handleSlashCommand,
    routePrompt,
    type RoutePromptDependencies,
} from "../src/hooks/hook-router.js";
import type { UserPromptSubmittedInput } from "@typeagent/agent-harness-hooks/copilot-cli";

const input: UserPromptSubmittedInput = {
    sessionId: "session-1",
    timestamp: 1,
    cwd: ".",
    prompt: "Read the workspace",
};

function createDependencies(
    claimed: boolean | "child",
): RoutePromptDependencies {
    return {
        recipeOwner: () => "plugin",
        claimRecording: jest.fn(async () => claimed),
        localRecipes: jest.fn(async () => ({})),
    };
}

describe("macro recording routing override", () => {
    it("plugin-local misses fall through natively, never to TypeAgent's planner", async () => {
        const dependencies = {
            ...createDependencies(false),
            recipeOwner: () => "plugin" as const,
            localRecipes: jest.fn(async () => ({})),
        };
        await expect(
            routePrompt(
                input,
                "direct",
                new AbortController().signal,
                dependencies,
            ),
        ).resolves.toEqual({});
        expect(dependencies.localRecipes).toHaveBeenCalledTimes(1);
    });
    it.each(["direct", "mcp", "dev", "bypass"] as const)(
        "off disables recording and recipe execution in %s mode",
        async (mode) => {
            const dependencies = {
                ...createDependencies(false),
                recipeOwner: () => "off" as const,
            };
            await expect(
                routePrompt(
                    input,
                    mode,
                    new AbortController().signal,
                    dependencies,
                ),
            ).resolves.toEqual({});
            expect(dependencies.claimRecording).not.toHaveBeenCalled();
            expect(dependencies.localRecipes).not.toHaveBeenCalled();
        },
    );
    it.each(["direct", "mcp", "dev", "bypass"] as const)(
        "requests a success receipt for selected child learning in %s mode without taking task ownership from Copilot",
        async (mode) => {
            const dependencies = createDependencies("child");
            const output = await routePrompt(
                input,
                mode,
                new AbortController().signal,
                dependencies,
            );
            expect(output.additionalContext).toContain(
                "typeagent_recorded_task_succeeded",
            );
            expect(output.additionalContext).toContain(
                "Do not call it after failed",
            );
            expect(output.additionalContext).toContain("do not rerun the task");
            expect(output.handled).toBeUndefined();
            expect(output.modifiedPrompt).toBeUndefined();
            expect(dependencies.claimRecording).toHaveBeenCalledWith(input);
            expect(dependencies.localRecipes).not.toHaveBeenCalled();
        },
    );
    it.each([
        "list the playlists",
        "learn: create a playlist",
        "dev: create a playlist",
        "record: create a playlist",
        "dev: learn: create a playlist",
        'keep "quotes", 東京 and\nnewlines',
    ])("keeps the exact user prompt for local matching: %s", async (prompt) => {
        const dependencies = createDependencies(false);
        const request = { ...input, prompt };
        await routePrompt(
            request,
            "direct",
            new AbortController().signal,
            dependencies,
        );
        expect(dependencies.localRecipes).toHaveBeenCalledWith(
            request,
            expect.any(AbortSignal),
        );
    });
    it.each(["direct", "mcp", "dev", "bypass"] as const)(
        "falls through one claimed interaction in %s mode",
        async (mode) => {
            const dependencies = createDependencies(true);

            await expect(
                routePrompt(
                    input,
                    mode,
                    new AbortController().signal,
                    dependencies,
                ),
            ).resolves.toEqual({});
            expect(dependencies.claimRecording).toHaveBeenCalledTimes(1);
            expect(dependencies.claimRecording).toHaveBeenCalledWith(input);
            expect(dependencies.localRecipes).not.toHaveBeenCalled();
        },
    );

    it("does not match or execute recipes for an unclaimed bypass request", async () => {
        const dependencies = createDependencies(false);

        await expect(
            routePrompt(
                input,
                "bypass",
                new AbortController().signal,
                dependencies,
            ),
        ).resolves.toEqual({});
        expect(dependencies.claimRecording).toHaveBeenCalledWith(input);
        expect(dependencies.localRecipes).not.toHaveBeenCalled();
    });
});

describe("@typeagent command routing", () => {
    it("rejects retired redirect settings without forwarding them to TypeAgent", async () => {
        const direct = jest.fn(async () => ({ handled: true }));
        const output = await handleSlashCommand(
            {
                ...input,
                prompt: "@typeagent powershell on",
            },
            { direct },
        );
        expect(output?.responseContent).toContain("setting has been removed");
        expect(output?.handled).toBe(true);
        expect(direct).not.toHaveBeenCalled();
    });
    it("forces handling for @typeagent run", async () => {
        const direct = jest.fn(async () => ({ handled: true }));
        const runInput = {
            ...input,
            prompt: "@typeagent run @package group list",
        };

        await expect(handleSlashCommand(runInput, { direct })).resolves.toEqual(
            { handled: true },
        );
        expect(direct).toHaveBeenCalledWith(
            {
                ...runInput,
                prompt: "@package group list",
            },
            { forceHandled: true },
        );
    });

    it("keeps catch-all commands in ordinary direct mode", async () => {
        const direct = jest.fn(async () => ({ handled: true }));
        const catchAllInput = {
            ...input,
            prompt: "@typeagent list the playlists",
        };

        await expect(
            handleSlashCommand(catchAllInput, { direct }),
        ).resolves.toEqual({ handled: true });
        expect(direct).toHaveBeenCalledWith(
            {
                ...catchAllInput,
                prompt: "list the playlists",
            },
            undefined,
        );
    });
});

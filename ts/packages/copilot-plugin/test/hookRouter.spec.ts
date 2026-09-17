// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    handleSlashCommand,
    routePrompt,
    type RoutePromptDependencies,
} from "../src/hooks/hook-router.js";
import type { HookInput } from "../src/hooks/types.js";

const input: HookInput = {
    sessionId: "session-1",
    timestamp: 1,
    cwd: ".",
    prompt: "Read the workspace",
};

function createDependencies(claimed: boolean): RoutePromptDependencies {
    return {
        claimRecording: jest.fn(async () => claimed),
        direct: jest.fn(async () => ({ handled: true })),
        mcp: jest.fn(() => ({ modifiedPrompt: "mcp" })),
        dev: jest.fn(async () => ({ handled: true })),
    };
}

describe("macro recording routing override", () => {
    it.each(["direct", "mcp", "dev"] as const)(
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
            expect(dependencies.direct).not.toHaveBeenCalled();
            expect(dependencies.mcp).not.toHaveBeenCalled();
            expect(dependencies.dev).not.toHaveBeenCalled();
        },
    );

    it("does not claim recordings while bypassed", async () => {
        const dependencies = createDependencies(true);

        await expect(
            routePrompt(
                input,
                "bypass",
                new AbortController().signal,
                dependencies,
            ),
        ).resolves.toEqual({});
        expect(dependencies.claimRecording).not.toHaveBeenCalled();
    });
});

describe("@typeagent command routing", () => {
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

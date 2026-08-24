// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
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

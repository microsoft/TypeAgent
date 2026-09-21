// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createMcpAppAgentProvider } from "../src/mcpAgentProvider.js";

describe("createMcpAppAgentProvider", () => {
    it("reports and settles a failed background server-command startup", async () => {
        const provider = createMcpAppAgentProvider("test", "0.0.0", {
            failing: {
                emojiChar: "",
                description: "Failing server",
                serverCommand: process.execPath,
                serverCommandArgs: ["-e", "process.exit(17)"],
            },
        });
        let failureCount = 0;
        let resolveFirstFailure!: (value: {
            agentName: string;
            error: Error;
        }) => void;
        let resolveRetryFailure!: (value: {
            agentName: string;
            error: Error;
        }) => void;
        const firstFailure = new Promise<{
            agentName: string;
            error: Error;
        }>((resolve) => {
            resolveFirstFailure = resolve;
        });
        const retryFailure = new Promise<{
            agentName: string;
            error: Error;
        }>((resolve) => {
            resolveRetryFailure = resolve;
        });
        provider.onSchemaFailed?.((agentName, error) => {
            failureCount++;
            const failure = { agentName, error };
            if (failureCount === 1) {
                resolveFirstFailure(failure);
            } else {
                resolveRetryFailure(failure);
            }
        });

        const manifest = provider.getAppAgentManifest("failing");
        expect(provider.getLoadingAgentNames?.()).toEqual(["failing"]);
        await manifest;

        await expect(firstFailure).resolves.toMatchObject({
            agentName: "failing",
            error: {
                message: expect.stringContaining(
                    "exited with code 17 before starting",
                ),
            },
        });
        expect(provider.getLoadingAgentNames?.()).toEqual([]);

        await provider.loadAppAgent("failing");
        await expect(retryFailure).resolves.toMatchObject({
            agentName: "failing",
        });
        expect(failureCount).toBe(2);
    });
});

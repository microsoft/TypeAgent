// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    handleUserPromptSubmitted,
    handleUserPromptTransformed,
    routePromptHook,
} from "../src/hooks/hook-router.js";
import { parsePromptInput } from "../src/hooks/parse-input.js";
import type { MemoryClient } from "../src/shared/memory-client.js";
import { MEMORY_CONTEXT_MARKER } from "../src/shared/context.js";

function fakeClient(
    answer = "use pnpm",
): MemoryClient & { requests: string[] } {
    const cache = new Map<string, string>();
    const requests: string[] = [];
    return {
        requests,
        captureRequest: async (text) => {
            requests.push(text);
        },
        captureResult: async () => undefined,
        remember: async () => ({ ok: true }),
        recall: async () => ({ type: "Answered", answer }),
        readRecallCache: async (sessionId, prompt) =>
            cache.get(`${sessionId}:${prompt}`),
        writeRecallCache: async (sessionId, prompt, context) => {
            cache.set(`${sessionId}:${prompt}`, context);
        },
    };
}

describe("prompt hooks", () => {
    it("captures the request and returns recalled context", async () => {
        const client = fakeClient();
        const output = await handleUserPromptSubmitted(
            {
                sessionId: "s1",
                cwd: "/repo",
                prompt: "how do I install dependencies?",
            },
            client,
        );

        expect(client.requests).toEqual(["how do I install dependencies?"]);
        expect(output.additionalContext).toContain("use pnpm");
        expect(output.additionalContext).toContain(MEMORY_CONTEXT_MARKER);
    });

    it("injects the cached recall into the transformed prompt", async () => {
        const client = fakeClient();
        const input = {
            sessionId: "s1",
            cwd: "/repo",
            prompt: "how do I install dependencies?",
        };
        await handleUserPromptSubmitted(input, client);
        const output = await handleUserPromptTransformed(
            { ...input, transformedPrompt: "how do I install dependencies?" },
            client,
        );

        expect(output.modifiedTransformedPrompt).toContain("use pnpm");
        expect(client.requests).toHaveLength(1);
    });

    it("does not inject a second copy when the marker is already present", async () => {
        const client = fakeClient();
        const transformed = `question\n\n${MEMORY_CONTEXT_MARKER}\nalready`;
        const output = await handleUserPromptTransformed(
            {
                sessionId: "s1",
                cwd: "/repo",
                prompt: "question",
                transformedPrompt: transformed,
            },
            client,
        );
        expect(output.modifiedTransformedPrompt).toBe(transformed);
    });

    it("routes transformed payloads to the injection hook", async () => {
        const client = fakeClient();
        const output = await routePromptHook(
            parsePromptInput({
                sessionId: "s1",
                cwd: "/repo",
                prompt: "question",
                transformedPrompt: "question",
            }),
            client,
        );
        expect(output.modifiedTransformedPrompt).toContain("use pnpm");
        expect(client.requests).toEqual([]);
    });
});

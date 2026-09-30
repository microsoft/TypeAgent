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
): MemoryClient & { requests: string[]; recalls: string[] } {
    const requests: string[] = [];
    const recalls: string[] = [];
    return {
        requests,
        recalls,
        captureRequest: async (text) => {
            requests.push(text);
        },
        captureResult: async () => undefined,
        remember: async () => ({ ok: true }),
        recall: async (query) => {
            recalls.push(query);
            return { type: "Answered", answer };
        },
    };
}

describe("prompt hooks", () => {
    it("captures the request without recalling", async () => {
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
        expect(client.recalls).toEqual([]);
        expect(output).toEqual({});
    });

    it("recalls once and injects into the transformed prompt", async () => {
        const client = fakeClient();
        const output = await handleUserPromptTransformed(
            {
                sessionId: "s1",
                cwd: "/repo",
                prompt: "how do I install dependencies?",
                transformedPrompt: "how do I install dependencies?",
            },
            client,
        );

        expect(output.modifiedTransformedPrompt).toBe(
            "<typeagent-memory>\nRelevant memory from earlier sessions in this workspace:\nuse pnpm\n</typeagent-memory>\n\nhow do I install dependencies?",
        );
        expect(client.recalls).toHaveLength(1);
        expect(client.requests).toEqual([]);
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

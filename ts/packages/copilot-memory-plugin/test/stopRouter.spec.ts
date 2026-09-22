// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleAgentStop } from "../src/hooks/stop-router.js";
import type { MemoryClient } from "../src/shared/memory-client.js";

function fakeClient(): MemoryClient & {
    results: { text: string; knowledge?: unknown }[];
} {
    const results: { text: string; knowledge?: unknown }[] = [];
    return {
        results,
        captureRequest: async () => undefined,
        captureResult: async (text, knowledge) => {
            results.push(knowledge ? { text, knowledge } : { text });
        },
        remember: async () => ({ ok: true }),
        recall: async () => ({ type: "NoAnswer" }),
    };
}

describe("agentStop capture", () => {
    it("stores a supplied result and optional knowledge", async () => {
        const client = fakeClient();
        await handleAgentStop(
            {
                sessionId: "s1",
                cwd: "/repo",
                response: "installed with pnpm",
                knowledge: {
                    entities: [{ name: "pnpm", type: ["tool"] }],
                    actions: [],
                    inverseActions: [],
                    topics: [],
                },
            },
            client,
        );
        expect(client.results).toEqual([
            {
                text: "installed with pnpm",
                knowledge: {
                    entities: [{ name: "pnpm", type: ["tool"] }],
                    actions: [],
                    inverseActions: [],
                    topics: [],
                },
            },
        ]);
    });

    it("reads the latest assistant message from transcriptPath", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "memory-stop-"));
        const transcript = path.join(dir, "events.jsonl");
        await writeFile(
            transcript,
            [
                JSON.stringify({
                    type: "user.message",
                    data: { content: "install deps" },
                }),
                JSON.stringify({
                    type: "assistant.message",
                    data: { content: "installed with pnpm" },
                }),
            ].join("\n"),
            "utf8",
        );
        const client = fakeClient();
        await handleAgentStop(
            { sessionId: "s1", cwd: "/repo", transcriptPath: transcript },
            client,
        );
        expect(client.results).toEqual([{ text: "installed with pnpm" }]);
    });
});

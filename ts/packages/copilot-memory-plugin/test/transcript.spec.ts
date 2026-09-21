// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { extractAssistantTurn } from "../src/shared/transcript.js";

describe("extractAssistantTurn", () => {
    it("reads the latest assistant.message from a Copilot events transcript", () => {
        const raw = [
            JSON.stringify({
                type: "user.message",
                data: { content: "install deps" },
            }),
            JSON.stringify({
                type: "assistant.message",
                data: { content: "running pnpm install" },
            }),
            JSON.stringify({
                type: "assistant.message",
                data: { content: "installed with pnpm" },
            }),
        ].join("\n");

        expect(extractAssistantTurn(raw)?.text).toBe("installed with pnpm");
    });

    it("keeps an optional knowledge payload on the stop event", () => {
        const raw = JSON.stringify({
            type: "assistant.message",
            data: { content: "use pnpm" },
            knowledge: {
                entities: [{ name: "pnpm", type: ["tool"] }],
                actions: [],
                inverseActions: [],
                topics: ["package manager"],
            },
        });

        expect(extractAssistantTurn(raw)?.knowledge?.entities).toEqual([
            { name: "pnpm", type: ["tool"] },
        ]);
    });

    it("falls back to plain text when the transcript is not JSON", () => {
        expect(extractAssistantTurn("plain result")?.text).toBe("plain result");
    });
});

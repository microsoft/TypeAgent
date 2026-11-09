// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getRecentChatHistory } from "../src/greetingCommandHandler.js";

describe("getRecentChatHistory", () => {
    test("continues without conversation history when search fails", async () => {
        const context = {
            sessionContext: {
                conversationManager: {
                    getSearchResponse: async () => {
                        throw new Error("embedding model failed to load");
                    },
                },
                agentContext: {
                    user: {},
                },
            },
        } as unknown as Parameters<typeof getRecentChatHistory>[0];

        await expect(getRecentChatHistory(context)).resolves.toEqual(["###"]);
    });
});

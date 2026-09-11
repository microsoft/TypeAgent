// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createStructuredActionClient } from "../src/shared/structured-action-client.js";
import { StructuredActionClient } from "@typeagent/agent-server-client";

describe("plugin structured client configuration", () => {
    it("uses the shared public connector with the configured public conversation id", async () => {
        const saved = process.env.TYPEAGENT_CONVERSATION_ID;
        process.env.TYPEAGENT_CONVERSATION_ID = "configured-public-id";
        try {
            const client = createStructuredActionClient();
            expect(client).toBeInstanceOf(StructuredActionClient);
            expect(client.binding).toEqual({
                conversationId: "configured-public-id",
                connected: false,
            });
            expect(JSON.stringify(client)).toBe("{}");
            await client.close();
        } finally {
            if (saved === undefined)
                delete process.env.TYPEAGENT_CONVERSATION_ID;
            else process.env.TYPEAGENT_CONVERSATION_ID = saved;
        }
    });
});

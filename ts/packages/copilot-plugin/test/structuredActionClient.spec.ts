// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createStructuredActionClient } from "../src/shared/structured-action-client.js";
import {
    StructuredActionClient,
    type AgentServerConnection,
    type Dispatcher,
} from "@typeagent/agent-server-client";
import { jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../src/shared/plugin-config.js";

describe("plugin structured client configuration", () => {
    let directory: string;
    const environment = {
        TYPEAGENT_PLUGIN_DATA: process.env.TYPEAGENT_PLUGIN_DATA,
        TYPEAGENT_MODE: process.env.TYPEAGENT_MODE,
        TYPEAGENT_CONVERSATION_ID: process.env.TYPEAGENT_CONVERSATION_ID,
    };
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "mixed-binding-"));
        process.env.TYPEAGENT_PLUGIN_DATA = directory;
        delete process.env.TYPEAGENT_MODE;
        delete process.env.TYPEAGENT_CONVERSATION_ID;
    });
    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
        for (const [key, value] of Object.entries(environment)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it.each(["mixed", "delegate", "direct"] as const)(
        "selects %s conversation context without changing structured ownership",
        async (policy) => {
            const searchActions = jest.fn(async () => ({
                protocolVersion: 1,
                scopeId: "scope",
                actions: [],
            }));
            const dispatcher = { searchActions } as unknown as Dispatcher;
            const joinConversation = jest.fn<
                AgentServerConnection["joinConversation"]
            >(async (_io, options) => ({
                conversationId:
                    options?.conversationId ?? "existing-nl-conversation",
                name: "context",
                connectionId: "connection",
                dispatcher,
                ...(options?.structuredActions
                    ? {
                          structuredActions: {
                              resumeToken: "private-capability",
                          },
                      }
                    : {}),
            }));
            const leaveConversation = jest.fn<
                AgentServerConnection["leaveConversation"]
            >(async () => {});
            const createConversation = jest.fn(async (name: string) => ({
                conversationId: "dedicated",
                name,
            }));
            const connection = {
                joinConversation,
                leaveConversation,
                createConversation,
                listConversations: async () => [],
                close: async () => {},
            } as unknown as AgentServerConnection;
            // A mode switch after MCP startup must apply before its first binding.
            writeConfig({ mode: "direct" });
            const client = createStructuredActionClient(async () => connection);
            writeConfig(
                policy === "direct"
                    ? { mode: "direct", mcpRouting: "mixed" }
                    : { mode: "mcp", mcpRouting: policy },
            );
            try {
                await client.searchActions({ query: "lists" });
                await client.searchActions({ query: "lists again" });
                const expected = "existing-nl-conversation";
                expect(client.binding.conversationId).toBe(expected);
                expect(joinConversation).toHaveBeenLastCalledWith(
                    expect.anything(),
                    {
                        conversationId: expected,
                        structuredActions: {},
                    },
                );
                expect(joinConversation).toHaveBeenCalledTimes(2);
                expect(joinConversation.mock.calls[0][1]).toEqual({
                    filter: true,
                    clientType: "shell",
                });
                expect(leaveConversation).toHaveBeenCalledWith(expected);
                expect(
                    leaveConversation.mock.invocationCallOrder[0],
                ).toBeLessThan(joinConversation.mock.invocationCallOrder[1]);
                expect(createConversation).not.toHaveBeenCalled();
                expect(searchActions).toHaveBeenCalledTimes(2);
            } finally {
                await client.close();
            }
        },
    );

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

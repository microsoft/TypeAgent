// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeConfig } from "../src/shared/plugin-config.js";

const connectDispatcher = jest.fn(async () => ({}));
const joinConversation = jest.fn(async () => ({
    conversationId: "default-first",
}));
const leaveConversation = jest.fn(async () => {});
const close = jest.fn(async () => {});
const connectAgentServer = jest.fn(async () => ({
    joinConversation,
    leaveConversation,
    close,
}));
jest.unstable_mockModule("@typeagent/agent-server-client", () => ({
    connectDispatcher,
    connectAgentServer,
}));
const { connectToTypeAgent, createClientIO } = await import(
    "../src/shared/typeagent-client.js"
);

describe("shared natural-language conversation selection", () => {
    let directory: string;
    const environment = {
        TYPEAGENT_PLUGIN_DATA: process.env.TYPEAGENT_PLUGIN_DATA,
        TYPEAGENT_MODE: process.env.TYPEAGENT_MODE,
        TYPEAGENT_CONVERSATION_ID: process.env.TYPEAGENT_CONVERSATION_ID,
        COPILOT_AGENT_SESSION_ID: process.env.COPILOT_AGENT_SESSION_ID,
    };
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "mixed-nl-binding-"));
        process.env.TYPEAGENT_PLUGIN_DATA = directory;
        process.env.COPILOT_AGENT_SESSION_ID = "session-1";
        delete process.env.TYPEAGENT_MODE;
        delete process.env.TYPEAGENT_CONVERSATION_ID;
        connectDispatcher.mockClear();
        connectAgentServer.mockClear();
        joinConversation.mockClear();
        joinConversation.mockResolvedValue({ conversationId: "default-first" });
        leaveConversation.mockClear();
        close.mockClear();
    });
    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
        for (const [key, value] of Object.entries(environment)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it.each(["default", "config", "environment"] as const)(
        "uses the same %s context selection as the mixed structured client",
        async (source) => {
            writeConfig({
                mode: "mcp",
                mcpRouting: "mixed",
                ...(source === "default"
                    ? {}
                    : { conversationId: "configured" }),
            });
            if (source === "environment")
                process.env.TYPEAGENT_CONVERSATION_ID = "environment";
            const io = createClientIO({});
            await connectToTypeAgent(io);
            expect(connectDispatcher).toHaveBeenCalledWith(
                io,
                expect.any(String),
                {
                    filter: true,
                    clientType: "shell",
                    conversationId:
                        source === "default"
                            ? "default-first"
                            : source === "config"
                              ? "configured"
                              : "environment",
                },
            );
        },
    );

    it.each(["direct", "mcp", "dev"] as const)(
        "honors the same explicit ID in %s mode",
        async (mode) => {
            writeConfig({
                mode,
                mcpRouting: "delegate",
                conversationId: "shared",
            });
            const io = createClientIO({});
            await connectToTypeAgent(io);
            expect(connectDispatcher).toHaveBeenCalledWith(
                io,
                expect.any(String),
                {
                    filter: true,
                    clientType: "shell",
                    conversationId: "shared",
                },
            );
            expect(connectAgentServer).not.toHaveBeenCalled();
        },
    );

    it("pins default selection across NL calls and mode changes without reconnecting to resolve it", async () => {
        writeConfig({ mode: "direct" });
        const io = createClientIO({});
        await connectToTypeAgent(io);
        joinConversation.mockResolvedValue({
            conversationId: "default-changed",
        });
        writeConfig({ mode: "mcp", mcpRouting: "mixed" });
        await connectToTypeAgent(io);
        expect(connectAgentServer).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(leaveConversation).toHaveBeenCalledWith("default-first");
        expect(connectDispatcher.mock.calls).toHaveLength(2);
        expect(connectDispatcher).toHaveBeenLastCalledWith(
            io,
            expect.any(String),
            {
                filter: true,
                clientType: "shell",
                conversationId: "default-first",
            },
        );
    });

    it("closes the resolution connection and does not dispatch after a resolution failure", async () => {
        joinConversation.mockRejectedValueOnce(
            new Error("Unavailable default"),
        );
        await expect(connectToTypeAgent(createClientIO({}))).rejects.toThrow(
            "Unavailable default",
        );
        expect(close).toHaveBeenCalledTimes(1);
        expect(connectDispatcher).not.toHaveBeenCalled();
    });

    it("does not replace a missing pinned conversation after an NL join failure", async () => {
        const io = createClientIO({});
        await connectToTypeAgent(io);
        connectDispatcher.mockRejectedValueOnce(
            new Error("Conversation not found: default-first"),
        );
        await expect(connectToTypeAgent(io)).rejects.toThrow(
            "Conversation not found",
        );
        expect(connectAgentServer).toHaveBeenCalledTimes(1);
    });

    it("lets a fresh session select the current default after another session loses its conversation", async () => {
        const io = createClientIO({});
        await connectToTypeAgent(io, "old-session");
        connectDispatcher.mockRejectedValueOnce(
            new Error("Conversation not found: default-first"),
        );
        await expect(connectToTypeAgent(io, "old-session")).rejects.toThrow(
            "Conversation not found",
        );
        expect(connectAgentServer).toHaveBeenCalledTimes(1);
        joinConversation.mockResolvedValue({
            conversationId: "current-default",
        });
        await connectToTypeAgent(io, "new-session");
        expect(connectDispatcher).toHaveBeenLastCalledWith(
            io,
            expect.any(String),
            {
                filter: true,
                clientType: "shell",
                conversationId: "current-default",
            },
        );
        expect(connectAgentServer).toHaveBeenCalledTimes(2);
    });

    it.each(["config", "environment"] as const)(
        "never resolves a default for a missing explicit %s pin",
        async (source) => {
            if (source === "config")
                writeConfig({ mode: "mcp", conversationId: "missing" });
            else process.env.TYPEAGENT_CONVERSATION_ID = "missing";
            connectDispatcher.mockRejectedValueOnce(
                new Error("Conversation not found: missing"),
            );
            await expect(
                connectToTypeAgent(createClientIO({}), "fresh-session"),
            ).rejects.toThrow("Conversation not found: missing");
            expect(connectAgentServer).not.toHaveBeenCalled();
            expect(connectDispatcher).toHaveBeenCalledTimes(1);
        },
    );
});

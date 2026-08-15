// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createAgentServerConnection } from "@typeagent/agent-server-client";
import { MacroManager } from "@typeagent/copilot-macros";
import type { ConversationManager } from "../src/conversationManager.js";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";

describe("macro recording RPC", () => {
    it("records a trace without joining a conversation", async () => {
        const instanceDir = await mkdtemp(path.join(os.tmpdir(), "macro-rpc-"));
        let clientAdapter: ChannelProviderAdapter | undefined;
        const serverAdapter = createChannelProviderAdapter(
            "macro-rpc:server",
            (message) => clientAdapter?.notifyMessage(message),
        );
        clientAdapter = createChannelProviderAdapter(
            "macro-rpc:client",
            (message) => serverAdapter.notifyMessage(message),
        );
        const { handler } = createAgentServerConnectionHandler({
            conversationManager: {} as ConversationManager,
            macroManager: new MacroManager(instanceDir),
            shutdown: () => {},
            getUserIdentity: () => ({
                username: "test",
                displayName: "Test",
                initial: "T",
            }),
        });
        handler(serverAdapter, () => {});
        const connection = createAgentServerConnection(clientAdapter, () => {});

        const token = await connection.armMacroRecording({
            sessionId: "session-1",
        });
        await connection.claimMacroRecording({
            sessionId: "session-1",
            cwd: ".",
            promptHash: createHash("sha256").update("Read data").digest("hex"),
        });
        const summary = await connection.finalizeMacroRecording({
            tokenId: token.id,
            trace: {
                schemaVersion: 1,
                sessionId: "session-1",
                cwd: ".",
                prompt: "Read data",
                response: "Done",
                startedAt: "2026-08-14T10:00:00.000Z",
                completedAt: "2026-08-14T10:00:01.000Z",
                toolCalls: [],
            },
        });

        await expect(
            connection.getMacroRecordingState("session-1"),
        ).resolves.toEqual({ status: "completed", trace: summary });
        await connection.close();
    });
});

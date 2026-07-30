// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the @conversation command handlers. Each builds the
 * manage-conversation payload and forwards it to the client. The commands are
 * canonical (the conversation actions run them), so the payload mapping is
 * verified here.
 */

import { describe, it, expect, jest } from "@jest/globals";

// getRequestId is the only runtime value the handlers import from the context
// module; stub it so the takeAction call is assertable.
const mockRequestId = { requestId: "test-request-id" };
jest.unstable_mockModule("../src/context/commandHandlerContext.js", () => ({
    getRequestId: jest.fn(() => mockRequestId),
}));

const { getConversationCommandHandlers } =
    await import("../src/context/system/handlers/conversationCommandHandlers.js");

const commands = getConversationCommandHandlers().commands;

let mockTakeAction: jest.Mock;
function makeContext() {
    mockTakeAction = jest.fn();
    return {
        sessionContext: {
            agentContext: { clientIO: { takeAction: mockTakeAction } },
        },
    } as any;
}

async function runCommand(name: string, params: any) {
    const handler = commands[name] as any;
    await handler.run(makeContext(), params);
}

function expectPayload(payload: any) {
    expect(mockTakeAction).toHaveBeenCalledWith(
        mockRequestId,
        "manage-conversation",
        payload,
    );
}

describe("@conversation command handlers build manage-conversation payloads", () => {
    it("new with a name", async () => {
        await runCommand("new", { args: { name: "research" } });
        expectPayload({ subcommand: "new", name: "research" });
    });

    it("new without a name", async () => {
        await runCommand("new", { args: {} });
        expectPayload({ subcommand: "new" });
    });

    it("preserves names that contain spaces", async () => {
        await runCommand("new", { args: { name: "my work project" } });
        expectPayload({ subcommand: "new", name: "my work project" });
    });

    it("list", async () => {
        await runCommand("list", undefined);
        expectPayload({ subcommand: "list" });
    });

    it("info", async () => {
        await runCommand("info", undefined);
        expectPayload({ subcommand: "info" });
    });

    it("switch with a name", async () => {
        await runCommand("switch", { args: { name: "work" } });
        expectPayload({ subcommand: "switch", name: "work" });
    });

    it("switch without a name cycles to next", async () => {
        await runCommand("switch", { args: {} });
        expectPayload({ subcommand: "next" });
    });

    it("prev", async () => {
        await runCommand("prev", undefined);
        expectPayload({ subcommand: "prev" });
    });

    it("next", async () => {
        await runCommand("next", undefined);
        expectPayload({ subcommand: "next" });
    });

    it("rename the current conversation (one arg)", async () => {
        await runCommand("rename", { args: { nameOrNewName: "my project" } });
        expectPayload({ subcommand: "rename", newName: "my project" });
    });

    it("rename a named conversation (two args)", async () => {
        await runCommand("rename", {
            args: { nameOrNewName: "test7", newName: "test5" },
        });
        expectPayload({
            subcommand: "rename",
            name: "test7",
            newName: "test5",
        });
    });

    it("delete", async () => {
        await runCommand("delete", { args: { name: "old-project" } });
        expectPayload({ subcommand: "delete", name: "old-project" });
    });

    it("help", async () => {
        await runCommand("help", undefined);
        expectPayload({ subcommand: "help" });
    });
});

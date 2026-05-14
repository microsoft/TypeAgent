// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for executeConversationAction in sessionActionHandler.ts.
 *
 * getRequestId is mocked to return a stable RequestId, and
 * clientIO.takeAction is a mock on the context stub.
 */

import { describe, it, expect, jest } from "@jest/globals";

// ── Mock getRequestId before importing the handler ──────────────────────────

const mockRequestId = { requestId: "test-request-id" };

jest.unstable_mockModule("../src/context/commandHandlerContext.js", () => ({
    getRequestId: jest.fn(() => mockRequestId),
}));

// ── Dynamic import after mocks are installed ──────────────────────────────────

const { executeConversationAction } = await import(
    "../src/context/system/action/conversationActionHandler.js"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

let mockTakeAction: jest.Mock;

/** Minimal ActionContext stub — agentContext with clientIO.takeAction. */
function makeContext() {
    mockTakeAction = jest.fn();
    return {
        sessionContext: {
            agentContext: {
                clientIO: {
                    takeAction: mockTakeAction,
                },
                currentRequestId: mockRequestId,
            },
        },
    } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("executeConversationAction — newConversation", () => {
    it("sends manage-conversation with subcommand new and name", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "newConversation",
                parameters: { name: "research" },
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "new", name: "research" },
        );
    });

    it("sends manage-conversation with subcommand new without name when omitted", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "newConversation",
                parameters: {},
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "new" },
        );
    });

    it("preserves conversation names that contain spaces", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "newConversation",
                parameters: { name: "my work project" },
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "new", name: "my work project" },
        );
    });
});

describe("executeConversationAction — listConversation", () => {
    it("sends manage-conversation with subcommand list", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "listConversation",
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "list" },
        );
    });
});

describe("executeConversationAction — showConversationInfo", () => {
    it("sends manage-conversation with subcommand info", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "showConversationInfo",
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "info" },
        );
    });
});

describe("executeConversationAction — switchConversation", () => {
    it("sends manage-conversation with subcommand switch", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "switchConversation",
                parameters: { name: "work" },
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "switch", name: "work" },
        );
    });

    it("preserves conversation names that contain spaces", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "switchConversation",
                parameters: { name: "my work project" },
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "switch", name: "my work project" },
        );
    });
});

describe("executeConversationAction — renameConversation", () => {
    it("sends manage-conversation with subcommand rename and newName (current conversation)", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "renameConversation",
                parameters: { newName: "my project" },
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "rename", newName: "my project" },
        );
    });

    it("sends manage-conversation with subcommand rename, name, and newName (targeted conversation)", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "renameConversation",
                parameters: { name: "test7", newName: "test5" },
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "rename", name: "test7", newName: "test5" },
        );
    });
});

describe("executeConversationAction — deleteConversation", () => {
    it("sends manage-conversation with subcommand delete", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "deleteConversation",
                parameters: { name: "old-project" },
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "delete", name: "old-project" },
        );
    });

    it("preserves conversation names that contain spaces", async () => {
        const ctx = makeContext();
        await executeConversationAction(
            {
                schemaName: "system.conversation",
                actionName: "deleteConversation",
                parameters: { name: "old work project" },
            },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "delete", name: "old work project" },
        );
    });
});

describe("executeConversationAction — invalid action", () => {
    it("throws on an unrecognized action name", async () => {
        const ctx = makeContext();
        await expect(
            executeConversationAction(
                {
                    schemaName: "system.conversation",
                    actionName: "unknownAction",
                } as any,
                ctx,
            ),
        ).rejects.toThrow("Invalid action name: unknownAction");
    });
});

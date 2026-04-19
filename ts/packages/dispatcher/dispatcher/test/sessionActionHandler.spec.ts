// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for executeSessionAction in sessionActionHandler.ts.
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

const { executeSessionAction } = await import(
    "../src/context/system/action/sessionActionHandler.js"
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

describe("executeSessionAction — newSession", () => {
    it("sends manage-conversation with subcommand new and name", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "newSession",
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
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "newSession",
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

    it("preserves session names that contain spaces", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "newSession",
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

describe("executeSessionAction — listSession", () => {
    it("sends manage-conversation with subcommand list", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            { schemaName: "system.session", actionName: "listSession" },
            ctx,
        );
        expect(mockTakeAction).toHaveBeenCalledWith(
            mockRequestId,
            "manage-conversation",
            { subcommand: "list" },
        );
    });
});

describe("executeSessionAction — showConversationInfo", () => {
    it("sends manage-conversation with subcommand info", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            {
                schemaName: "system.session",
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

describe("executeSessionAction — switchSession", () => {
    it("sends manage-conversation with subcommand switch", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "switchSession",
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

    it("preserves session names that contain spaces", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "switchSession",
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

describe("executeSessionAction — renameSession", () => {
    it("sends manage-conversation with subcommand rename and newName (current session)", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "renameSession",
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

    it("sends manage-conversation with subcommand rename, name, and newName (targeted session)", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "renameSession",
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

describe("executeSessionAction — deleteSession", () => {
    it("sends manage-conversation with subcommand delete", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "deleteSession",
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

    it("preserves session names that contain spaces", async () => {
        const ctx = makeContext();
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "deleteSession",
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

describe("executeSessionAction — invalid action", () => {
    it("throws on an unrecognized action name", async () => {
        const ctx = makeContext();
        await expect(
            executeSessionAction(
                {
                    schemaName: "system.session",
                    actionName: "unknownAction",
                } as any,
                ctx,
            ),
        ).rejects.toThrow("Invalid action name: unknownAction");
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the @conversation command handler in conversationCommands.ts.
 *
 * Subcommands:
 *   new <name>      — create a conversation, optionally switch to it
 *   switch <name>   — switch to a named conversation
 *   list [filter]   — list conversations with current marker
 *   rename <name>   — rename the current conversation
 *   delete <name>   — delete a conversation after confirmation
 *
 * The tests mock AgentServerConnection methods and readline to verify
 * routing, argument validation, and interactive confirmation flows.
 *
 * Because the module under test (conversationCommands.ts) imports `readline`
 * and `chalk` which are ESM-only, we use `jest.unstable_mockModule` to mock
 * readline *before* the dynamic import of the module under test.
 */

import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    jest,
} from "@jest/globals";
import type {
    AgentServerConnection,
    ConversationDispatcher,
    ConversationInfo,
} from "@typeagent/agent-server-client";

// ── readline mock (must be installed before importing the module under test) ─

type QuestionCallback = (answer: string) => void;

let questionCallbacks: QuestionCallback[];

jest.unstable_mockModule("readline", () => ({
    createInterface: jest.fn(() => ({
        question: jest.fn((_prompt: string, cb: QuestionCallback) => {
            questionCallbacks.push(cb);
        }),
        close: jest.fn(),
    })),
}));

// ── Dynamic import of the module under test (after the mock is installed) ──

const { handleConversationCommand } = await import(
    "../src/conversationCommands.js"
);
type ConversationCommandContext =
    import("../src/conversationCommands.js").ConversationCommandContext;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal ConversationInfo factory. */
function makeSession(
    overrides: Partial<ConversationInfo> & {
        conversationId: string;
        name: string;
    },
): ConversationInfo {
    return {
        clientCount: 1,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

/** Build mock AgentServerConnection with jest.fn() stubs. */
function makeConnection() {
    return {
        listConversations:
            jest.fn<AgentServerConnection["listConversations"]>(),
        createConversation:
            jest.fn<AgentServerConnection["createConversation"]>(),
        renameConversation:
            jest.fn<AgentServerConnection["renameConversation"]>(),
        deleteConversation:
            jest.fn<AgentServerConnection["deleteConversation"]>(),
        // Unused stubs required by the interface
        joinConversation: jest.fn(),
        leaveConversation: jest.fn(),
        close: jest.fn(),
    } as unknown as AgentServerConnection & {
        listConversations: jest.Mock;
        createConversation: jest.Mock;
        renameConversation: jest.Mock;
        deleteConversation: jest.Mock;
    };
}

/** Simulate the user answering the outstanding readline question. */
function answerPrompt(answer: string) {
    expect(questionCallbacks.length).toBeGreaterThan(0);
    const cb = questionCallbacks.shift()!;
    cb(answer);
}

/** Wait for microtasks + setImmediate so async code can progress. */
function flushAsync() {
    return new Promise<void>((resolve) => setImmediate(resolve));
}

// ── Spying on console.log ──────────────────────────────────────────────────

let logSpy: ReturnType<typeof jest.spyOn>;
let logOutput: string[];

function capturedLog(): string {
    return logOutput.join("\n");
}

// ── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
    questionCallbacks = [];
    logOutput = [];
    logSpy = jest
        .spyOn(console, "log")
        .mockImplementation((...args: unknown[]) => {
            logOutput.push(args.map(String).join(" "));
        });
});

afterEach(() => {
    logSpy.mockRestore();
});

// ── Context factory ────────────────────────────────────────────────────────

function makeCtx(
    overrides: Partial<ConversationCommandContext> = {},
): ConversationCommandContext & {
    connection: ReturnType<typeof makeConnection>;
    switchConversation: jest.Mock;
} {
    const connection = makeConnection();
    const switchConversation =
        jest.fn<(conversationId: string) => Promise<ConversationDispatcher>>();
    return {
        connection,
        getCurrentConversationId: () => "current-id",
        getCurrentConversationName: () => "Current Session",
        switchConversation,
        ...overrides,
    } as ConversationCommandContext & {
        connection: ReturnType<typeof makeConnection>;
        switchConversation: jest.Mock;
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("handleConversationCommand — routing", () => {
    it("prints help when args are empty", async () => {
        const ctx = makeCtx();
        await handleConversationCommand(ctx, "");
        expect(capturedLog()).toContain("@conversation commands:");
    });

    it("prints help when args are whitespace-only", async () => {
        const ctx = makeCtx();
        await handleConversationCommand(ctx, "   ");
        expect(capturedLog()).toContain("@conversation commands:");
    });

    it("prints error for unknown subcommand", async () => {
        const ctx = makeCtx();
        await handleConversationCommand(ctx, "foobar");
        expect(capturedLog()).toContain("Unknown subcommand");
        expect(capturedLog()).toContain("foobar");
    });
});

describe("@conversation new", () => {
    it("prints usage when name is missing", async () => {
        const ctx = makeCtx();
        await handleConversationCommand(ctx, "new");
        expect(capturedLog()).toContain("Usage");
        expect(capturedLog()).toContain("@conversation new");
    });

    it("creates conversation and does NOT switch when user answers 'n'", async () => {
        const ctx = makeCtx();
        ctx.connection.createConversation.mockResolvedValue(
            makeSession({ conversationId: "new-id", name: "MyChat" }),
        );

        const promise = handleConversationCommand(ctx, "new MyChat");

        // Wait for the readline question callback to be queued
        await flushAsync();
        answerPrompt("n");
        await promise;

        expect(ctx.connection.createConversation).toHaveBeenCalledWith(
            "MyChat",
        );
        expect(capturedLog()).toContain("Created conversation");
        expect(ctx.switchConversation).not.toHaveBeenCalled();
    });

    it("creates conversation and switches when user answers 'y'", async () => {
        const ctx = makeCtx();
        ctx.connection.createConversation.mockResolvedValue(
            makeSession({ conversationId: "new-id", name: "MyChat" }),
        );

        const promise = handleConversationCommand(ctx, "new MyChat");

        await flushAsync();
        answerPrompt("y");
        await promise;

        expect(ctx.connection.createConversation).toHaveBeenCalledWith(
            "MyChat",
        );
        // switchConversation called with the conversationId from createConversation's return value
        expect(ctx.switchConversation).toHaveBeenCalledWith("new-id");
    });

    it("handles quoted name argument", async () => {
        const ctx = makeCtx();
        ctx.connection.createConversation.mockResolvedValue(
            makeSession({ conversationId: "new-id", name: "My Chat Room" }),
        );

        const promise = handleConversationCommand(ctx, 'new "My Chat Room"');

        await flushAsync();
        answerPrompt("n");
        await promise;

        expect(ctx.connection.createConversation).toHaveBeenCalledWith(
            "My Chat Room",
        );
    });
});

describe("@conversation switch", () => {
    it("prints usage when name is missing", async () => {
        const ctx = makeCtx();
        await handleConversationCommand(ctx, "switch");
        expect(capturedLog()).toContain("Usage");
        expect(capturedLog()).toContain("@conversation switch");
    });

    it("prints error when name is not found", async () => {
        const ctx = makeCtx();
        ctx.connection.listConversations.mockResolvedValue([]);

        await handleConversationCommand(ctx, "switch ghost");

        expect(capturedLog()).toContain("No conversation named 'ghost' found");
        expect(ctx.switchConversation).not.toHaveBeenCalled();
    });

    it("prints message when already in that conversation", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "already-here",
        });
        ctx.connection.listConversations.mockResolvedValue([
            makeSession({ conversationId: "already-here", name: "Current" }),
        ]);

        await handleConversationCommand(ctx, "switch Current");

        expect(capturedLog()).toContain("Already in conversation");
        expect(ctx.switchConversation).not.toHaveBeenCalled();
    });

    it("resolves case-insensitively and switches", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "old-id",
        });
        ctx.connection.listConversations.mockResolvedValue([
            makeSession({ conversationId: "target-id", name: "MyChat" }),
        ]);

        await handleConversationCommand(ctx, "switch mychat");

        expect(ctx.switchConversation).toHaveBeenCalledWith("target-id");
    });

    it("prints error when multiple conversations match", async () => {
        const ctx = makeCtx();
        ctx.connection.listConversations.mockResolvedValue([
            makeSession({ conversationId: "id-1", name: "dup" }),
            makeSession({ conversationId: "id-2", name: "Dup" }),
        ]);

        await handleConversationCommand(ctx, "switch dup");

        expect(capturedLog()).toContain(
            "Multiple conversations named 'dup' found",
        );
        expect(ctx.switchConversation).not.toHaveBeenCalled();
    });
});

describe("@conversation list", () => {
    it("prints 'No conversations found.' for empty list", async () => {
        const ctx = makeCtx();
        ctx.connection.listConversations.mockResolvedValue([]);

        await handleConversationCommand(ctx, "list");

        expect(capturedLog()).toContain("No conversations found.");
    });

    it("shows single conversation with current marker", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "sess-1",
        });
        ctx.connection.listConversations.mockResolvedValue([
            makeSession({
                conversationId: "sess-1",
                name: "OnlySession",
                clientCount: 2,
                createdAt: "2026-01-15T10:00:00.000Z",
            }),
        ]);

        await handleConversationCommand(ctx, "list");

        const output = capturedLog();
        expect(output).toContain("▸");
        expect(output).toContain("OnlySession");
        expect(output).toContain("(current)");
    });

    it("shows multiple conversations sorted by createdAt descending, current marked", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "sess-2",
        });
        ctx.connection.listConversations.mockResolvedValue([
            makeSession({
                conversationId: "sess-1",
                name: "Older",
                clientCount: 1,
                createdAt: "2026-01-01T00:00:00.000Z",
            }),
            makeSession({
                conversationId: "sess-2",
                name: "Middle",
                clientCount: 3,
                createdAt: "2026-02-01T00:00:00.000Z",
            }),
            makeSession({
                conversationId: "sess-3",
                name: "Newest",
                clientCount: 0,
                createdAt: "2026-03-01T00:00:00.000Z",
            }),
        ]);

        await handleConversationCommand(ctx, "list");

        const output = capturedLog();

        // Newest should appear before Older in the output (descending sort)
        const newestIdx = output.indexOf("Newest");
        const middleIdx = output.indexOf("Middle");
        const olderIdx = output.indexOf("Older");
        expect(newestIdx).toBeLessThan(middleIdx);
        expect(middleIdx).toBeLessThan(olderIdx);

        // "▸" appears on the current session line (Middle)
        const lines = output.split("\n");
        const currentLine = lines.find((l) => l.includes("Middle"));
        expect(currentLine).toBeDefined();
        expect(currentLine).toContain("▸");
        expect(currentLine).toContain("(current)");

        // Non-current session lines should NOT have "▸"
        const newestLine = lines.find(
            (l) => l.includes("Newest") && !l.includes("NAME"),
        );
        expect(newestLine).toBeDefined();
        expect(newestLine).not.toContain("▸");
    });

    it("passes filter to listConversations", async () => {
        const ctx = makeCtx();
        ctx.connection.listConversations.mockResolvedValue([]);

        await handleConversationCommand(ctx, "list myFilter");

        expect(ctx.connection.listConversations).toHaveBeenCalledWith(
            "myFilter",
        );
    });

    it("passes undefined filter when no filter given", async () => {
        const ctx = makeCtx();
        ctx.connection.listConversations.mockResolvedValue([]);

        await handleConversationCommand(ctx, "list");

        expect(ctx.connection.listConversations).toHaveBeenCalledWith(
            undefined,
        );
    });

    it("displays clientCount for each conversation", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "sess-1",
        });
        ctx.connection.listConversations.mockResolvedValue([
            makeSession({
                conversationId: "sess-1",
                name: "Chat",
                clientCount: 5,
                createdAt: "2026-01-15T10:00:00.000Z",
            }),
        ]);

        await handleConversationCommand(ctx, "list");

        expect(capturedLog()).toContain("5");
    });
});

describe("@conversation rename", () => {
    it("prints usage when name is missing", async () => {
        const ctx = makeCtx();
        await handleConversationCommand(ctx, "rename");
        expect(capturedLog()).toContain("Usage");
        expect(capturedLog()).toContain("@conversation rename");
    });

    it("calls renameConversation with current conversation ID and new name", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "my-session-id",
        });
        ctx.connection.renameConversation.mockResolvedValue(undefined);

        await handleConversationCommand(ctx, "rename NewName");

        expect(ctx.connection.renameConversation).toHaveBeenCalledWith(
            "my-session-id",
            "NewName",
        );
        expect(capturedLog()).toContain("Renamed current conversation");
        expect(capturedLog()).toContain("NewName");
    });

    it("handles quoted new name", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "my-session-id",
        });
        ctx.connection.renameConversation.mockResolvedValue(undefined);

        await handleConversationCommand(ctx, 'rename "New Name With Spaces"');

        expect(ctx.connection.renameConversation).toHaveBeenCalledWith(
            "my-session-id",
            "New Name With Spaces",
        );
    });
});

describe("@conversation delete", () => {
    it("prints usage when name is missing", async () => {
        const ctx = makeCtx();
        await handleConversationCommand(ctx, "delete");
        expect(capturedLog()).toContain("Usage");
        expect(capturedLog()).toContain("@conversation delete");
    });

    it("prints error when trying to delete the current conversation", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "current-id",
        });
        ctx.connection.listConversations.mockResolvedValue([
            makeSession({ conversationId: "current-id", name: "ActiveChat" }),
        ]);

        await handleConversationCommand(ctx, "delete ActiveChat");

        expect(capturedLog()).toContain(
            "Cannot delete the active conversation",
        );
        expect(ctx.connection.deleteConversation).not.toHaveBeenCalled();
    });

    it("does not delete when user cancels confirmation", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "other-id",
        });
        ctx.connection.listConversations.mockResolvedValue([
            makeSession({ conversationId: "target-id", name: "OldChat" }),
        ]);

        const promise = handleConversationCommand(ctx, "delete OldChat");

        await flushAsync();
        answerPrompt("n");
        await promise;

        expect(capturedLog()).toContain("Cancelled");
        expect(ctx.connection.deleteConversation).not.toHaveBeenCalled();
    });

    it("deletes when user confirms", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "other-id",
        });
        ctx.connection.listConversations.mockResolvedValue([
            makeSession({ conversationId: "target-id", name: "OldChat" }),
        ]);
        ctx.connection.deleteConversation.mockResolvedValue(undefined);

        const promise = handleConversationCommand(ctx, "delete OldChat");

        await flushAsync();
        answerPrompt("y");
        await promise;

        expect(ctx.connection.deleteConversation).toHaveBeenCalledWith(
            "target-id",
        );
        expect(capturedLog()).toContain("Deleted conversation");
    });

    it("prints error when conversation name is not found", async () => {
        const ctx = makeCtx({
            getCurrentConversationId: () => "other-id",
        });
        ctx.connection.listConversations.mockResolvedValue([]);

        await handleConversationCommand(ctx, "delete ghost");

        expect(capturedLog()).toContain("No conversation named 'ghost' found");
        expect(ctx.connection.deleteConversation).not.toHaveBeenCalled();
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the @conversation command handler in conversationCommands.ts.
 *
 * Subcommands:
 *   new <name>      — create a session, optionally switch to it
 *   switch <name>   — switch to a named session
 *   list [filter]   — list sessions with current marker
 *   rename <name>   — rename the current session
 *   delete <name>   — delete a session after confirmation
 *
 * The tests mock AgentServerConnection methods and readline to verify
 * routing, argument validation, and interactive confirmation flows.
 */

import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    jest,
} from "@jest/globals";
import * as readline from "readline";
import type {
    AgentServerConnection,
    SessionDispatcher,
    SessionInfo,
} from "@typeagent/agent-server-client";
import {
    handleConversationCommand,
    type ConversationCommandContext,
} from "../src/conversationCommands.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal SessionInfo factory. */
function makeSession(
    overrides: Partial<SessionInfo> & { sessionId: string; name: string },
): SessionInfo {
    return {
        clientCount: 1,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

/** Build mock AgentServerConnection with jest.fn() stubs. */
function makeConnection(): jest.Mocked<
    Pick<
        AgentServerConnection,
        "listSessions" | "createSession" | "renameSession" | "deleteSession"
    >
> &
    AgentServerConnection {
    return {
        listSessions: jest.fn<AgentServerConnection["listSessions"]>(),
        createSession: jest.fn<AgentServerConnection["createSession"]>(),
        renameSession: jest.fn<AgentServerConnection["renameSession"]>(),
        deleteSession: jest.fn<AgentServerConnection["deleteSession"]>(),
        // Unused stubs
        joinSession: jest.fn(),
        leaveSession: jest.fn(),
        close: jest.fn(),
    } as unknown as jest.Mocked<
        Pick<
            AgentServerConnection,
            "listSessions" | "createSession" | "renameSession" | "deleteSession"
        >
    > &
        AgentServerConnection;
}

type FakeRl = {
    question: jest.Mock;
    close: jest.Mock;
};

let fakeRl: FakeRl;
let createInterfaceSpy: ReturnType<typeof jest.spyOn>;

/**
 * Install a spy on readline.createInterface that returns a fake rl object.
 * Call `answerPrompt(text)` to simulate the user typing a response.
 */
function installReadlineSpy() {
    fakeRl = {
        question: jest.fn(),
        close: jest.fn(),
    };
    createInterfaceSpy = jest
        .spyOn(readline, "createInterface")
        .mockReturnValue(fakeRl as unknown as readline.Interface);
}

/** Simulate the user answering the outstanding readline question. */
function answerPrompt(answer: string) {
    const calls = fakeRl.question.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // rl.question(prompt, callback) — invoke the callback
    const lastCall = calls[calls.length - 1];
    const callback = lastCall[1] as (answer: string) => void;
    callback(answer);
}

// ── Spying on console.log ──────────────────────────────────────────────────

let logSpy: ReturnType<typeof jest.spyOn>;
let logOutput: string[];

function capturedLog(): string {
    return logOutput.join("\n");
}

// ── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
    logOutput = [];
    logSpy = jest
        .spyOn(console, "log")
        .mockImplementation((...args: unknown[]) => {
            logOutput.push(args.map(String).join(" "));
        });
    installReadlineSpy();
});

afterEach(() => {
    logSpy.mockRestore();
    createInterfaceSpy.mockRestore();
});

// ── Context factory ────────────────────────────────────────────────────────

function makeCtx(
    overrides: Partial<ConversationCommandContext> = {},
): ConversationCommandContext & {
    connection: ReturnType<typeof makeConnection>;
    switchSession: jest.Mock;
} {
    const connection = makeConnection();
    const switchSession =
        jest.fn<(sessionId: string) => Promise<SessionDispatcher>>();
    return {
        connection,
        getCurrentSessionId: () => "current-id",
        getCurrentSessionName: () => "Current Session",
        switchSession,
        ...overrides,
    } as ConversationCommandContext & {
        connection: ReturnType<typeof makeConnection>;
        switchSession: jest.Mock;
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

    it("creates session and does NOT switch when user answers 'n'", async () => {
        const ctx = makeCtx();
        (ctx.connection.createSession as jest.Mock).mockResolvedValue(
            makeSession({ sessionId: "new-id", name: "MyChat" }),
        );
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({ sessionId: "new-id", name: "MyChat" }),
        ]);

        const promise = handleConversationCommand(ctx, "new MyChat");

        // Wait for the readline question to be called
        await new Promise<void>((r) => setImmediate(r));
        answerPrompt("n");
        await promise;

        expect(ctx.connection.createSession).toHaveBeenCalledWith("MyChat");
        expect(capturedLog()).toContain("Created conversation");
        expect(ctx.switchSession).not.toHaveBeenCalled();
    });

    it("creates session and switches when user answers 'y'", async () => {
        const ctx = makeCtx();
        (ctx.connection.createSession as jest.Mock).mockResolvedValue(
            makeSession({ sessionId: "new-id", name: "MyChat" }),
        );
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({ sessionId: "new-id", name: "MyChat" }),
        ]);

        const promise = handleConversationCommand(ctx, "new MyChat");

        await new Promise<void>((r) => setImmediate(r));
        answerPrompt("y");
        await promise;

        expect(ctx.connection.createSession).toHaveBeenCalledWith("MyChat");
        expect(ctx.switchSession).toHaveBeenCalledWith("new-id");
        expect(capturedLog()).toContain("Switched to conversation");
    });

    it("handles quoted name argument", async () => {
        const ctx = makeCtx();
        (ctx.connection.createSession as jest.Mock).mockResolvedValue(
            makeSession({
                sessionId: "new-id",
                name: "My Chat Room",
            }),
        );
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({
                sessionId: "new-id",
                name: "My Chat Room",
            }),
        ]);

        const promise = handleConversationCommand(ctx, 'new "My Chat Room"');

        await new Promise<void>((r) => setImmediate(r));
        answerPrompt("n");
        await promise;

        expect(ctx.connection.createSession).toHaveBeenCalledWith(
            "My Chat Room",
        );
    });

    it("does not switch if the created session is not found in listSessions", async () => {
        const ctx = makeCtx();
        (ctx.connection.createSession as jest.Mock).mockResolvedValue(
            makeSession({ sessionId: "new-id", name: "Ephemeral" }),
        );
        // listSessions returns empty — session disappeared
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([]);

        const promise = handleConversationCommand(ctx, "new Ephemeral");

        await new Promise<void>((r) => setImmediate(r));
        answerPrompt("y");
        await promise;

        // Even though user said yes, there is no target to switch to
        expect(ctx.switchSession).not.toHaveBeenCalled();
    });
});

describe("@conversation switch", () => {
    it("prints usage when name is missing", async () => {
        const ctx = makeCtx();
        await handleConversationCommand(ctx, "switch");
        expect(capturedLog()).toContain("Usage");
        expect(capturedLog()).toContain("@conversation switch");
    });

    it("throws/prints error when name is not found", async () => {
        const ctx = makeCtx();
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([]);

        await expect(
            handleConversationCommand(ctx, "switch ghost"),
        ).rejects.toThrow("No conversation named 'ghost' found");
    });

    it("prints message when already in that session", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "already-here",
        });
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({
                sessionId: "already-here",
                name: "Current",
            }),
        ]);

        await handleConversationCommand(ctx, "switch Current");

        expect(capturedLog()).toContain("Already in conversation");
        expect(ctx.switchSession).not.toHaveBeenCalled();
    });

    it("resolves case-insensitively and switches", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "old-id",
        });
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({
                sessionId: "target-id",
                name: "MyChat",
            }),
        ]);

        await handleConversationCommand(ctx, "switch mychat");

        expect(ctx.switchSession).toHaveBeenCalledWith("target-id");
        expect(capturedLog()).toContain("Switched to conversation");
    });

    it("throws error when multiple sessions match", async () => {
        const ctx = makeCtx();
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({ sessionId: "id-1", name: "dup" }),
            makeSession({ sessionId: "id-2", name: "Dup" }),
        ]);

        await expect(
            handleConversationCommand(ctx, "switch dup"),
        ).rejects.toThrow("Multiple conversations named 'dup' found");
    });
});

describe("@conversation list", () => {
    it("prints 'No conversations found.' for empty list", async () => {
        const ctx = makeCtx();
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([]);

        await handleConversationCommand(ctx, "list");

        expect(capturedLog()).toContain("No conversations found.");
    });

    it("shows single session with current marker '▸'", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "sess-1",
        });
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({
                sessionId: "sess-1",
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

    it("shows multiple sessions sorted by createdAt descending, current marked", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "sess-2",
        });
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({
                sessionId: "sess-1",
                name: "Older",
                clientCount: 1,
                createdAt: "2026-01-01T00:00:00.000Z",
            }),
            makeSession({
                sessionId: "sess-2",
                name: "Middle",
                clientCount: 3,
                createdAt: "2026-02-01T00:00:00.000Z",
            }),
            makeSession({
                sessionId: "sess-3",
                name: "Newest",
                clientCount: 0,
                createdAt: "2026-03-01T00:00:00.000Z",
            }),
        ]);

        await handleConversationCommand(ctx, "list");

        const output = capturedLog();

        // Newest should appear before Older in the output
        const newestIdx = output.indexOf("Newest");
        const middleIdx = output.indexOf("Middle");
        const olderIdx = output.indexOf("Older");
        expect(newestIdx).toBeLessThan(middleIdx);
        expect(middleIdx).toBeLessThan(olderIdx);

        // "▸" appears on the current session line (Middle)
        // The current marker line also contains "(current)"
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

    it("passes filter to listSessions", async () => {
        const ctx = makeCtx();
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([]);

        await handleConversationCommand(ctx, "list myFilter");

        expect(ctx.connection.listSessions).toHaveBeenCalledWith("myFilter");
    });

    it("passes undefined filter when no filter given", async () => {
        const ctx = makeCtx();
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([]);

        await handleConversationCommand(ctx, "list");

        expect(ctx.connection.listSessions).toHaveBeenCalledWith(undefined);
    });

    it("displays clientCount for each session", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "sess-1",
        });
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({
                sessionId: "sess-1",
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

    it("calls renameSession with current session ID and new name", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "my-session-id",
        });
        (ctx.connection.renameSession as jest.Mock).mockResolvedValue(
            undefined,
        );

        await handleConversationCommand(ctx, "rename NewName");

        expect(ctx.connection.renameSession).toHaveBeenCalledWith(
            "my-session-id",
            "NewName",
        );
        expect(capturedLog()).toContain("Renamed current conversation");
        expect(capturedLog()).toContain("NewName");
    });

    it("handles quoted new name", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "my-session-id",
        });
        (ctx.connection.renameSession as jest.Mock).mockResolvedValue(
            undefined,
        );

        await handleConversationCommand(ctx, 'rename "New Name With Spaces"');

        expect(ctx.connection.renameSession).toHaveBeenCalledWith(
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

    it("prints error when trying to delete the current session", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "current-id",
        });
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({
                sessionId: "current-id",
                name: "ActiveChat",
            }),
        ]);

        await handleConversationCommand(ctx, "delete ActiveChat");

        expect(capturedLog()).toContain(
            "Cannot delete the active conversation",
        );
        expect(ctx.connection.deleteSession).not.toHaveBeenCalled();
    });

    it("does not delete when user cancels confirmation", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "other-id",
        });
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({
                sessionId: "target-id",
                name: "OldChat",
            }),
        ]);

        const promise = handleConversationCommand(ctx, "delete OldChat");

        await new Promise<void>((r) => setImmediate(r));
        answerPrompt("n");
        await promise;

        expect(capturedLog()).toContain("Cancelled");
        expect(ctx.connection.deleteSession).not.toHaveBeenCalled();
    });

    it("deletes when user confirms", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "other-id",
        });
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([
            makeSession({
                sessionId: "target-id",
                name: "OldChat",
            }),
        ]);
        (ctx.connection.deleteSession as jest.Mock).mockResolvedValue(
            undefined,
        );

        const promise = handleConversationCommand(ctx, "delete OldChat");

        await new Promise<void>((r) => setImmediate(r));
        answerPrompt("y");
        await promise;

        expect(ctx.connection.deleteSession).toHaveBeenCalledWith("target-id");
        expect(capturedLog()).toContain("Deleted conversation");
    });

    it("throws error when session name is not found", async () => {
        const ctx = makeCtx({
            getCurrentSessionId: () => "other-id",
        });
        (ctx.connection.listSessions as jest.Mock).mockResolvedValue([]);

        await expect(
            handleConversationCommand(ctx, "delete ghost"),
        ).rejects.toThrow("No conversation named 'ghost' found");
    });
});

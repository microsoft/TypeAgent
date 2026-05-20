// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the CLI's Phase 1 server-side queue UX:
 *   - createEnhancedClientIO updates `cliQueueState` from push events.
 *   - `applyQueueSnapshot` bootstraps the cached state.
 *   - `/queue list` calls `dispatcher.getQueueSnapshot()` and prints
 *     a formatted listing.
 *   - `/queue cancel <id>` resolves a (≥4-char) prefix against the
 *     refreshed snapshot and calls `dispatcher.cancelCommand`.
 *   - `/queue cancel <unknown>` and ambiguous prefixes print a sensible
 *     error without invoking the dispatcher.
 *
 * Tests for raw-mode Ctrl+C handling are deferred — `startExecutionKeyListener`
 * is not a public export, and the rl-mode SIGINT handler is wired
 * inside `processCommandsEnhanced` which requires a full readline harness.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
    createEnhancedClientIO,
    getCliQueueState,
    applyQueueSnapshot,
} from "../src/enhancedConsole.js";
import {
    handleSlashCommand,
    setQueueDispatcher,
} from "../src/slashCommands.js";
import type {
    Dispatcher,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";

// ── stdout capture ───────────────────────────────────────────────────────────

let stdoutOutput: string[];
let realStdoutWrite: typeof process.stdout.write;
let realConsoleLog: typeof console.log;

beforeEach(() => {
    stdoutOutput = [];
    realStdoutWrite = process.stdout.write.bind(process.stdout);
    realConsoleLog = console.log;
    // Capture both raw stdout writes and console.log lines.
    process.stdout.write = ((chunk: any) => {
        stdoutOutput.push(typeof chunk === "string" ? chunk : String(chunk));
        return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => {
        stdoutOutput.push(args.map((a) => String(a)).join(" ") + "\n");
    };
    // Reset module-level state.
    applyQueueSnapshot(undefined);
    setQueueDispatcher(undefined);
});

afterEach(() => {
    process.stdout.write = realStdoutWrite;
    console.log = realConsoleLog;
    applyQueueSnapshot(undefined);
    setQueueDispatcher(undefined);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(
    requestId: string,
    text: string,
    state: QueuedRequest["state"] = "queued",
): QueuedRequest {
    const now = Date.now();
    return {
        requestId,
        originatorConnectionId: "conn-test",
        text,
        submittedAt: now,
        state,
        ...(state === "running" ? { startedAt: now } : {}),
    };
}

function makeSnapshot(
    running: QueuedRequest | null,
    queued: QueuedRequest[],
): QueueSnapshot {
    return { running, queued, paused: false };
}

const captured = () => stdoutOutput.join("");

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CLI queue state — push events", () => {
    it("requestQueued / requestStarted / requestCancelled / queueStateChanged update cliQueueState", () => {
        const clientIO = createEnhancedClientIO(undefined, {
            current: undefined,
        });

        expect(getCliQueueState()).toBeUndefined();

        const e1 = makeEntry("11111111-aaaa-aaaa-aaaa-000000000001", "hello");
        clientIO.requestQueued!(e1);
        let snap = getCliQueueState();
        expect(snap).toBeDefined();
        expect(snap!.queued.map((e) => e.requestId)).toEqual([e1.requestId]);
        expect(snap!.running).toBeNull();

        // queueStateChanged is the authoritative reset.
        const auth = makeSnapshot({ ...e1, state: "running" }, []);
        clientIO.queueStateChanged!(auth);
        snap = getCliQueueState();
        expect(snap!.running?.requestId).toBe(e1.requestId);
        expect(snap!.queued).toEqual([]);

        // Followed by a started event for a NEW entry.
        const e2 = makeEntry(
            "22222222-bbbb-bbbb-bbbb-000000000002",
            "world",
            "running",
        );
        clientIO.requestStarted!(e2);
        snap = getCliQueueState();
        expect(snap!.running?.requestId).toBe(e2.requestId);

        // Cancel the running one.
        clientIO.requestCancelled!(e2.requestId, "user");
        snap = getCliQueueState();
        expect(snap!.running).toBeNull();
    });

    it("applyQueueSnapshot bootstraps the cached state", () => {
        const e1 = makeEntry("aaaaaaaa-1111-1111-1111-000000000001", "boot");
        applyQueueSnapshot(makeSnapshot(e1, []));
        const snap = getCliQueueState();
        expect(snap?.running?.requestId).toBe(e1.requestId);

        applyQueueSnapshot(undefined);
        expect(getCliQueueState()).toBeUndefined();
    });
});

// ── /queue slash commands ────────────────────────────────────────────────────

interface QueueCalls {
    getQueueSnapshot: number;
    cancelCommand: string[];
}

function makeQueueDispatcher(snapshot: QueueSnapshot | undefined): {
    dispatcher: Dispatcher;
    calls: QueueCalls;
} {
    const calls: QueueCalls = { getQueueSnapshot: 0, cancelCommand: [] };
    const dispatcher = {
        getQueueSnapshot: async () => {
            calls.getQueueSnapshot++;
            return snapshot;
        },
        cancelCommand: (requestId: string) => {
            calls.cancelCommand.push(requestId);
        },
    } as unknown as Dispatcher;
    return { dispatcher, calls };
}

describe("/queue slash command", () => {
    it("/queue list prints the formatted snapshot from the dispatcher", async () => {
        const running = makeEntry(
            "11111111-aaaa-aaaa-aaaa-000000000001",
            "in-flight task",
            "running",
        );
        const queued = makeEntry(
            "22222222-bbbb-bbbb-bbbb-000000000002",
            "next task",
        );
        const { dispatcher, calls } = makeQueueDispatcher(
            makeSnapshot(running, [queued]),
        );
        setQueueDispatcher(dispatcher);

        const result = await handleSlashCommand("/queue list", async () => {});
        expect(result.handled).toBe(true);
        expect(calls.getQueueSnapshot).toBe(1);
        const out = captured();
        expect(out).toContain("Queue:");
        expect(out).toContain("11111111"); // short running id
        expect(out).toContain("22222222"); // short queued id
        expect(out).toContain("in-flight task");
        expect(out).toContain("next task");
    });

    it("/queue (no args) defaults to list", async () => {
        const { dispatcher, calls } = makeQueueDispatcher(
            makeSnapshot(null, []),
        );
        setQueueDispatcher(dispatcher);

        await handleSlashCommand("/queue", async () => {});
        expect(calls.getQueueSnapshot).toBe(1);
        expect(captured()).toContain("(idle)");
    });

    it("/queue cancel <prefix> resolves the prefix and calls cancelCommand", async () => {
        const queued = makeEntry(
            "deadbeef-cafe-0000-0000-000000000001",
            "drop me",
        );
        const { dispatcher, calls } = makeQueueDispatcher(
            makeSnapshot(null, [queued]),
        );
        setQueueDispatcher(dispatcher);

        await handleSlashCommand("/queue cancel deadbeef", async () => {});
        expect(calls.cancelCommand).toEqual([queued.requestId]);
    });

    it("/queue cancel rejects prefixes shorter than 4 chars", async () => {
        const queued = makeEntry("deadbeef-cafe-0000-0000-000000000001", "x");
        const { dispatcher, calls } = makeQueueDispatcher(
            makeSnapshot(null, [queued]),
        );
        setQueueDispatcher(dispatcher);

        await handleSlashCommand("/queue cancel dea", async () => {});
        expect(calls.cancelCommand).toEqual([]);
        expect(captured()).toMatch(/at least 4 characters/i);
    });

    it("/queue cancel <unknown> prints an error and does not call cancelCommand", async () => {
        const queued = makeEntry("11111111-aaaa-aaaa-aaaa-000000000001", "x");
        const { dispatcher, calls } = makeQueueDispatcher(
            makeSnapshot(null, [queued]),
        );
        setQueueDispatcher(dispatcher);

        await handleSlashCommand("/queue cancel zzzzzzzz", async () => {});
        expect(calls.cancelCommand).toEqual([]);
        expect(captured()).toMatch(/no queued or running request/i);
    });

    it("/queue cancel ambiguous prefix prints an error and does not call cancelCommand", async () => {
        const a = makeEntry("abcd1111-aaaa-aaaa-aaaa-000000000001", "first");
        const b = makeEntry("abcd2222-aaaa-aaaa-aaaa-000000000002", "second");
        const { dispatcher, calls } = makeQueueDispatcher(
            makeSnapshot(null, [a, b]),
        );
        setQueueDispatcher(dispatcher);

        await handleSlashCommand("/queue cancel abcd", async () => {});
        expect(calls.cancelCommand).toEqual([]);
        expect(captured()).toMatch(/ambiguous/i);
    });

    it("/queue help prints usage and does not call the dispatcher", async () => {
        const { dispatcher, calls } = makeQueueDispatcher(
            makeSnapshot(null, []),
        );
        setQueueDispatcher(dispatcher);

        await handleSlashCommand("/queue help", async () => {});
        expect(calls.getQueueSnapshot).toBe(0);
        const out = captured();
        expect(out).toContain("/queue");
        expect(out).toMatch(/cancel/);
    });

    it("/queue list reports unavailability when no dispatcher is bound", async () => {
        // setQueueDispatcher(undefined) was already done in beforeEach.
        await handleSlashCommand("/queue list", async () => {});
        expect(captured()).toMatch(/unavailable/i);
    });
});

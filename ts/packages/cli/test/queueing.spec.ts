// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the CLI's Phase 1 server-side queue UX:
 *   - createEnhancedClientIO updates `cliQueueState` from push events.
 *   - `applyQueueSnapshot` bootstraps the cached state.
 *   - `/queue list` formats the dispatcher snapshot.
 *   - `/queue cancel <id>` resolves a (≥4-char) prefix and calls cancelCommand.
 *   - Unknown/ambiguous prefixes print an error without invoking the dispatcher.
 *
 * Raw-mode Ctrl+C tests are deferred (require readline + raw stdin harness).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
    createEnhancedClientIO,
    getCliQueueState,
    applyQueueSnapshot,
    getEnhancedConsolePrompt,
    formatQueueBadge,
    cancelAllInQueue,
    __testGetCurrentRequestId,
    __testSetCurrentRequestId,
} from "../src/enhancedConsole.js";
import {
    handleSlashCommand,
    setQueueDispatcher,
    setCliConnectionId,
} from "../src/slashCommands.js";
import type {
    Dispatcher,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";

// stdout capture

let stdoutOutput: string[];
let realStdoutWrite: typeof process.stdout.write;
let realConsoleLog: typeof console.log;

beforeEach(() => {
    stdoutOutput = [];
    realStdoutWrite = process.stdout.write.bind(process.stdout);
    realConsoleLog = console.log;
    process.stdout.write = ((chunk: any) => {
        stdoutOutput.push(typeof chunk === "string" ? chunk : String(chunk));
        return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => {
        stdoutOutput.push(args.map((a) => String(a)).join(" ") + "\n");
    };
    applyQueueSnapshot(undefined);
    setQueueDispatcher(undefined);
    setCliConnectionId(undefined);
    __testSetCurrentRequestId(undefined);
});

afterEach(() => {
    process.stdout.write = realStdoutWrite;
    console.log = realConsoleLog;
    applyQueueSnapshot(undefined);
    setQueueDispatcher(undefined);
    setCliConnectionId(undefined);
    __testSetCurrentRequestId(undefined);
});

// Helpers

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
    version = 1,
): QueueSnapshot {
    return { running, queued, paused: false, version };
}

const captured = () => stdoutOutput.join("");

// Tests

describe("CLI queue state — push events", () => {
    it("requestQueued / requestStarted / requestCancelled / queueStateChanged update cliQueueState", () => {
        const clientIO = createEnhancedClientIO(undefined, {
            current: undefined,
        });

        expect(getCliQueueState()).toBeUndefined();

        const e1 = makeEntry("11111111-aaaa-aaaa-aaaa-000000000001", "hello");
        clientIO.requestQueued!(e1, 1);
        let snap = getCliQueueState();
        expect(snap).toBeDefined();
        expect(snap!.queued.map((e) => e.requestId)).toEqual([e1.requestId]);
        expect(snap!.running).toBeNull();

        // queueStateChanged is the authoritative reset.
        const auth = makeSnapshot({ ...e1, state: "running" }, [], 2);
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
        clientIO.requestStarted!(e2, 3);
        snap = getCliQueueState();
        expect(snap!.running?.requestId).toBe(e2.requestId);

        // Cancel the running one.
        clientIO.requestCancelled!(e2.requestId, "user", 4);
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

// /queue slash commands

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
        await handleSlashCommand("/queue list", async () => {});
        expect(captured()).toMatch(/unavailable/i);
    });
});

// CLI cancel UX

describe("CLI cancel UX", () => {
    it("requestStarted for an entry whose originator is THIS CLI does not print the running marker", () => {
        const ourConn = "conn-cli-self";
        setCliConnectionId(ourConn);
        const clientIO = createEnhancedClientIO(undefined, {
            current: undefined,
        });

        // Server pushes requestStarted for our just-submitted entry; originator check makes this race-free.
        const ours: QueuedRequest = {
            requestId: "11111111-aaaa-aaaa-aaaa-000000000001",
            originatorConnectionId: ourConn,
            text: "hello",
            submittedAt: Date.now(),
            startedAt: Date.now(),
            state: "running",
        };
        clientIO.requestStarted!(ours, 1);
        expect(captured()).not.toContain("▶ running:");

        // Sanity: a started event from a different originator DOES print the marker.
        stdoutOutput.length = 0;
        const peer: QueuedRequest = {
            requestId: "22222222-bbbb-bbbb-bbbb-000000000002",
            originatorConnectionId: "conn-other",
            text: "from peer",
            submittedAt: Date.now(),
            startedAt: Date.now(),
            state: "running",
        };
        clientIO.requestStarted!(peer, 2);
        expect(captured()).toContain("▶ running:");
    });

    it("commandComplete notify clears currentRequestId when the completed id matches", () => {
        const clientIO = createEnhancedClientIO(undefined, {
            current: undefined,
        });

        const id = "33333333-cccc-cccc-cccc-000000000003";
        __testSetCurrentRequestId(id);
        expect(__testGetCurrentRequestId()).toBe(id);

        clientIO.notify(
            { connectionId: "c1", requestId: id, clientRequestId: "x" },
            "commandComplete",
            { result: null },
            "system",
        );
        expect(__testGetCurrentRequestId()).toBeUndefined();

        // Mismatched id must not clear.
        const stale = "44444444-dddd-dddd-dddd-000000000004";
        __testSetCurrentRequestId(stale);
        clientIO.notify(
            {
                connectionId: "c1",
                requestId: "no-match",
                clientRequestId: "y",
            },
            "commandComplete",
            { result: null },
            "system",
        );
        expect(__testGetCurrentRequestId()).toBe(stale);
    });

    it("requestCancelled clears currentRequestId when the cancelled id matches", () => {
        // Verifies the requestCancelled clearing path that SIGINT priority depends on:
        // when the server cancels the running request, currentRequestId must clear
        // so the next SIGINT doesn't target a stale id.
        const clientIO = createEnhancedClientIO(undefined, {
            current: undefined,
        });

        const runningId = "55555555-eeee-eeee-eeee-000000000005";
        const queuedId = "66666666-ffff-ffff-ffff-000000000006";

        // Bootstrap: running=R1, queued=[R2].
        applyQueueSnapshot({
            running: {
                requestId: runningId,
                originatorConnectionId: "c1",
                text: "R1",
                submittedAt: Date.now(),
                startedAt: Date.now(),
                state: "running",
            },
            queued: [
                {
                    requestId: queuedId,
                    originatorConnectionId: "c1",
                    text: "R2",
                    submittedAt: Date.now(),
                    state: "queued",
                },
            ],
            paused: false,
            version: 0,
        });
        __testSetCurrentRequestId(runningId);

        // Simulate the running request being cancelled server-side.
        clientIO.requestCancelled!(runningId, "user", 1);

        expect(__testGetCurrentRequestId()).toBeUndefined();
        expect(getCliQueueState()?.running).toBeNull();
    });

    it("queueStateChanged updates the badge content (prompt would be redrawn)", () => {
        // We can't observe the redraw directly (no active rl in the test harness),
        // but `formatQueueBadge` shares the visibility logic gating the redraw.
        const clientIO = createEnhancedClientIO(undefined, {
            current: undefined,
        });

        // Snapshot 1: 1 running, 0 queued.
        const snap1: QueueSnapshot = {
            running: makeEntry(
                "77777777-aaaa-aaaa-aaaa-000000000007",
                "peer task",
                "running",
            ),
            queued: [],
            paused: false,
            version: 1,
        };
        clientIO.queueStateChanged!(snap1);
        const prompt1 = getEnhancedConsolePrompt("");
        // `getEnhancedConsolePrompt` is the static base; live badge is added by `formatQueueBadge()`.
        const badge1 = formatQueueBadge();
        expect(prompt1).not.toContain("queue:");
        expect(badge1).toContain("queue: 1");

        // Snapshot 2: 1 running + 2 queued.
        const snap2: QueueSnapshot = {
            running: makeEntry(
                "77777777-aaaa-aaaa-aaaa-000000000007",
                "peer task",
                "running",
            ),
            queued: [
                makeEntry("88888888-bbbb-bbbb-bbbb-000000000008", "x"),
                makeEntry("88888888-cccc-cccc-cccc-000000000009", "y"),
            ],
            paused: false,
            version: 2,
        };
        clientIO.queueStateChanged!(snap2);
        const prompt2 = getEnhancedConsolePrompt("");
        const badge2 = formatQueueBadge();
        expect(prompt2).not.toContain("queue:");
        expect(badge2).toContain("queue: 3");

        // Snapshot 3: idle. Badge gone.
        clientIO.queueStateChanged!({
            running: null,
            queued: [],
            paused: false,
            version: 3,
        });
        const prompt3 = getEnhancedConsolePrompt("");
        const badge3 = formatQueueBadge();
        expect(prompt3).not.toContain("queue:");
        expect(badge3).toBe("");
    });
});

// Stale-version event admission
describe("CLI queue version watermark", () => {
    it("ignores push events whose version is strictly older than the last applied version", () => {
        const clientIO = createEnhancedClientIO(undefined, {
            current: undefined,
        });

        // Apply snapshot at version 10.
        const initial = makeSnapshot(null, [], 10);
        applyQueueSnapshot(initial);
        expect(getCliQueueState()?.version).toBe(10);

        // Stale (version 5) is ignored.
        const stale = makeEntry(
            "11111111-aaaa-aaaa-aaaa-000000000001",
            "stale",
        );
        clientIO.requestQueued!(stale, 5);
        expect(getCliQueueState()?.queued).toEqual([]);

        // Fresh (version 11) is admitted.
        const fresh = makeEntry(
            "22222222-bbbb-bbbb-bbbb-000000000002",
            "fresh",
        );
        clientIO.requestQueued!(fresh, 11);
        expect(getCliQueueState()?.queued.map((e) => e.requestId)).toEqual([
            fresh.requestId,
        ]);
    });

    // Server pairs each fine-grained event with a same-version queueStateChanged snapshot;
    // strict `<` admits both so the snapshot reconciles state idempotently.
    it("admits push events at the SAME version (paired event + snapshot)", () => {
        const clientIO = createEnhancedClientIO(undefined, {
            current: undefined,
        });

        const initial = makeSnapshot(null, [], 10);
        applyQueueSnapshot(initial);
        expect(getCliQueueState()?.version).toBe(10);

        // Event at the SAME version (10) must NOT be dropped.
        const sameVer = makeEntry(
            "33333333-cccc-cccc-cccc-000000000003",
            "same-version",
        );
        clientIO.requestQueued!(sameVer, 10);
        expect(getCliQueueState()?.queued.map((e) => e.requestId)).toEqual([
            sameVer.requestId,
        ]);
    });

    // Verifies that requestCancelled + a later drain-completion snapshot reconcile cleanly.
    it("requestCancelled then drain-completion snapshot reconciles cleanly", () => {
        const clientIO = createEnhancedClientIO(undefined, {
            current: undefined,
        });

        // Boot with a running entry at version 5.
        const rid = "44444444-dddd-dddd-dddd-000000000004";
        const running = makeEntry(rid, "long-task", "running");
        applyQueueSnapshot(makeSnapshot(running, [], 5));
        expect(getCliQueueState()?.running?.requestId).toBe(rid);

        // requestCancelled at version 6.
        clientIO.requestCancelled!(rid, "user", 6);
        expect(getCliQueueState()?.running).toBeNull();

        // Drain-completion snapshot at version 7 confirms cancel.
        clientIO.queueStateChanged!(makeSnapshot(null, [], 7));
        expect(getCliQueueState()?.running).toBeNull();
        expect(getCliQueueState()?.version).toBe(7);
    });
});

// /queue list truncation
describe("/queue list truncation", () => {
    it("truncates queued list past 10 entries with a footer hint", async () => {
        const queued: QueuedRequest[] = [];
        for (let i = 0; i < 25; i++) {
            const hex = i.toString(16).padStart(2, "0");
            queued.push(
                makeEntry(
                    `${hex}${hex}${hex}${hex}-aaaa-aaaa-aaaa-${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}`,
                    `task-${i}`,
                ),
            );
        }
        const { dispatcher } = makeQueueDispatcher(makeSnapshot(null, queued));
        setQueueDispatcher(dispatcher);

        await handleSlashCommand("/queue list", async () => {});
        const out = captured();

        // Visible: tasks 0..9.
        for (let i = 0; i < 10; i++) {
            expect(out).toContain(`task-${i}`);
        }
        // Hidden: tasks 10..24.
        for (let i = 10; i < 25; i++) {
            expect(out).not.toContain(`task-${i}`);
        }
        expect(out).toContain("and 15 more queued");
        expect(out).toContain("/queue cancel");
    });

    it("does not truncate when total queued is at or below the limit", async () => {
        const queued: QueuedRequest[] = [];
        for (let i = 0; i < 10; i++) {
            const hex = i.toString(16).padStart(2, "0");
            queued.push(
                makeEntry(
                    `${hex}${hex}${hex}${hex}-aaaa-aaaa-aaaa-${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}`,
                    `task-${i}`,
                ),
            );
        }
        const { dispatcher } = makeQueueDispatcher(makeSnapshot(null, queued));
        setQueueDispatcher(dispatcher);

        await handleSlashCommand("/queue list", async () => {});
        const out = captured();

        for (let i = 0; i < 10; i++) {
            expect(out).toContain(`task-${i}`);
        }
        expect(out).not.toContain("more queued");
    });
});

// cancelAllInQueue (double-Escape clear queue)
describe("cancelAllInQueue (double-Escape clear queue)", () => {
    it("cancels the running entry plus every queued entry exactly once", async () => {
        const running = makeEntry(
            "11111111-aaaa-aaaa-aaaa-111111111111",
            "r",
            "running",
        );
        const queued = [
            makeEntry("22222222-aaaa-aaaa-aaaa-222222222222", "q1"),
            makeEntry("33333333-aaaa-aaaa-aaaa-333333333333", "q2"),
            makeEntry("44444444-aaaa-aaaa-aaaa-444444444444", "q3"),
        ];
        const snap = makeSnapshot(running, queued);
        const { dispatcher, calls } = makeQueueDispatcher(snap);

        const result = await cancelAllInQueue(dispatcher, snap);

        expect(result).toEqual({ cancelled: 4, running: 1, queued: 3 });
        expect(calls.cancelCommand).toHaveLength(4);
        expect(new Set(calls.cancelCommand)).toEqual(
            new Set([running.requestId, ...queued.map((e) => e.requestId)]),
        );
    });

    it("returns zeros and issues no RPCs on an empty snapshot", async () => {
        const { dispatcher, calls } = makeQueueDispatcher(undefined);

        const empty = await cancelAllInQueue(dispatcher, undefined);
        const idle = await cancelAllInQueue(dispatcher, makeSnapshot(null, []));

        expect(empty).toEqual({ cancelled: 0, running: 0, queued: 0 });
        expect(idle).toEqual({ cancelled: 0, running: 0, queued: 0 });
        expect(calls.cancelCommand).toEqual([]);
    });

    it("returns zeros when no dispatcher is bound", async () => {
        const snap = makeSnapshot(
            makeEntry("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "r", "running"),
            [makeEntry("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "q")],
        );
        const result = await cancelAllInQueue(undefined, snap);
        expect(result).toEqual({ cancelled: 0, running: 0, queued: 0 });
    });

    it("swallows per-id cancel errors so siblings still get cancelled", async () => {
        const snap = makeSnapshot(
            makeEntry("11111111-aaaa-aaaa-aaaa-111111111111", "r", "running"),
            [
                makeEntry("22222222-aaaa-aaaa-aaaa-222222222222", "q1"),
                makeEntry("33333333-aaaa-aaaa-aaaa-333333333333", "q2"),
            ],
        );
        const seen: string[] = [];
        const dispatcher = {
            cancelCommand: async (rid: string) => {
                seen.push(rid);
                if (rid.startsWith("22222222")) {
                    throw new Error("simulated server error");
                }
            },
        } as unknown as Dispatcher;

        const result = await cancelAllInQueue(dispatcher, snap);

        expect(seen).toHaveLength(3);
        // running + q2 succeeded; q1 threw and was absorbed.
        expect(result.cancelled).toBe(2);
        expect(result.running).toBe(1);
        expect(result.queued).toBe(1);
    });
});

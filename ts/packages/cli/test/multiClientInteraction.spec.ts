// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for multi-client interaction handling in createEnhancedClientIO.
 *
 * The scenario: multiple CLI clients connect to the same SharedDispatcher
 * session.  The server broadcasts requestInteraction to all clients; the first
 * to call respondToInteraction wins.  When a winner is found, the server
 * broadcasts interactionResolved (or interactionCancelled on timeout/cancel)
 * to all remaining clients so they dismiss their open prompts.
 *
 * These tests exercise the activeInteractions map and AbortController logic
 * by replacing process.stdin with a controllable fake and verifying that
 * respondToInteraction is called (or not called) at the right times.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { EventEmitter } from "node:events";
import { createEnhancedClientIO } from "../src/enhancedConsole.js";
import type { PendingInteractionRequest, Dispatcher } from "agent-dispatcher";

// ── Stdin/stdout stubs ───────────────────────────────────────────────────────

/** Minimal fake stdin that lets tests push characters programmatically. */
class FakeStdin extends EventEmitter {
    isTTY = true;
    isRaw = false;
    encoding: BufferEncoding | null = null;

    setRawMode(raw: boolean) {
        this.isRaw = raw;
        return this;
    }
    setEncoding(enc: BufferEncoding) {
        this.encoding = enc;
        return this;
    }
    resume() {
        return this;
    }
    pause() {
        return this;
    }

    /** Simulate the user typing a string followed by Enter. */
    typeAnswer(text: string) {
        for (const ch of text) {
            this.emit("data", ch);
        }
        this.emit("data", "\r");
    }
}

let fakeStdin: FakeStdin;
let stdoutOutput: string[];
let realStdin: NodeJS.ReadStream;
let realStdout: NodeJS.WriteStream;

// ── Dispatcher stub ──────────────────────────────────────────────────────────

interface CallRecord {
    method: "respondToInteraction";
    args: unknown[];
}

function makeDispatcherStub(): { dispatcher: Dispatcher; calls: CallRecord[] } {
    const calls: CallRecord[] = [];
    const dispatcher = {
        respondToInteraction: async (...args: unknown[]) => {
            calls.push({ method: "respondToInteraction", args });
        },
        // The remaining Dispatcher methods are not exercised by these tests.
    } as unknown as Dispatcher;
    return { dispatcher, calls };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAskYesNo(id: string): PendingInteractionRequest {
    return {
        interactionId: id,
        type: "askYesNo",
        message: "Are you sure?",
        defaultValue: false,
        requestId: { requestId: "req-1" },
        source: "test",
        timestamp: Date.now(),
    };
}

function makePopupQuestion(id: string): PendingInteractionRequest {
    return {
        interactionId: id,
        type: "popupQuestion",
        message: "Pick one",
        choices: ["alpha", "beta", "gamma"],
        defaultId: 0,
        requestId: { requestId: "req-1" },
        source: "test",
        timestamp: Date.now(),
    };
}

/** Wait for microtasks and a short real tick so async IIFEs inside
 *  requestInteraction have a chance to reach the await question() call. */
function flushAsync() {
    return new Promise<void>((resolve) => setImmediate(resolve));
}

// ── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
    fakeStdin = new FakeStdin();
    stdoutOutput = [];

    // Capture originals before overriding so afterEach can restore them.
    realStdin = process.stdin;
    realStdout = process.stdout;

    Object.defineProperty(process, "stdin", {
        value: fakeStdin,
        writable: true,
        configurable: true,
    });
    Object.defineProperty(process, "stdout", {
        value: {
            write: (s: string) => {
                stdoutOutput.push(s);
                return true;
            },
            columns: 80,
        },
        writable: true,
        configurable: true,
    });
});

afterEach(() => {
    Object.defineProperty(process, "stdin", {
        value: realStdin,
        writable: true,
        configurable: true,
    });
    Object.defineProperty(process, "stdout", {
        value: realStdout,
        writable: true,
        configurable: true,
    });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("requestInteraction — user answers", () => {
    it("calls respondToInteraction with true when user types y", async () => {
        const { dispatcher, calls } = makeDispatcherStub();
        const dispatcherRef = { current: dispatcher };
        const clientIO = createEnhancedClientIO(undefined, dispatcherRef);

        clientIO.requestInteraction(makeAskYesNo("int-1"));
        await flushAsync(); // let the IIFE reach question()

        fakeStdin.typeAnswer("y");
        await flushAsync();

        expect(calls).toHaveLength(1);
        expect(calls[0].args[0]).toMatchObject({
            interactionId: "int-1",
            type: "askYesNo",
            value: true,
        });
    });

    it("calls respondToInteraction with false when user types n", async () => {
        const { dispatcher, calls } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        clientIO.requestInteraction(makeAskYesNo("int-2"));
        await flushAsync();

        fakeStdin.typeAnswer("n");
        await flushAsync();

        expect(calls).toHaveLength(1);
        expect(calls[0].args[0]).toMatchObject({ value: false });
    });

    it("uses defaultValue when user types unrecognised input", async () => {
        const { dispatcher, calls } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        const interaction = makeAskYesNo("int-3");
        (interaction as any).defaultValue = true;
        clientIO.requestInteraction(interaction);
        await flushAsync();

        fakeStdin.typeAnswer("maybe");
        await flushAsync();

        expect(calls[0].args[0]).toMatchObject({ value: true });
    });

    it("calls respondToInteraction with correct index for popupQuestion", async () => {
        const { dispatcher, calls } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        clientIO.requestInteraction(makePopupQuestion("int-4"));
        await flushAsync();

        fakeStdin.typeAnswer("2"); // 1-based → index 1 = "beta"
        await flushAsync();

        expect(calls[0].args[0]).toMatchObject({
            interactionId: "int-4",
            type: "popupQuestion",
            value: 1,
        });
    });
});

describe("interactionResolved — dismisses pending prompt", () => {
    it("aborts question() and does NOT call respondToInteraction", async () => {
        const { dispatcher, calls } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        clientIO.requestInteraction(makeAskYesNo("int-5"));
        await flushAsync(); // IIFE reaches question(), now waiting on stdin

        // Another client answered — server tells this client to dismiss
        clientIO.interactionResolved("int-5", true);
        await flushAsync();

        // The user hasn't typed anything; no respondToInteraction should have fired
        expect(calls).toHaveLength(0);
    });

    it("prints a notice to stdout", async () => {
        const { dispatcher } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        clientIO.requestInteraction(makeAskYesNo("int-6"));
        await flushAsync();

        clientIO.interactionResolved("int-6", true);
        await flushAsync();

        const combined = stdoutOutput.join("");
        expect(combined).toContain("answered by another client");
    });
});

describe("interactionCancelled — dismisses pending prompt", () => {
    it("aborts question() and does NOT call respondToInteraction", async () => {
        const { dispatcher, calls } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        clientIO.requestInteraction(makeAskYesNo("int-7"));
        await flushAsync();

        clientIO.interactionCancelled("int-7");
        await flushAsync();

        expect(calls).toHaveLength(0);
    });

    it("prints a cancellation notice to stdout", async () => {
        const { dispatcher } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        clientIO.requestInteraction(makeAskYesNo("int-8"));
        await flushAsync();

        clientIO.interactionCancelled("int-8");
        await flushAsync();

        const combined = stdoutOutput.join("");
        expect(combined).toContain("Cancelled!");
    });
});

describe("interactionResolved / interactionCancelled with unknown id", () => {
    it("is a no-op and does not throw for resolved", () => {
        const clientIO = createEnhancedClientIO(undefined, {
            current: makeDispatcherStub().dispatcher,
        });
        expect(() =>
            clientIO.interactionResolved("no-such-id", true),
        ).not.toThrow();
    });

    it("is a no-op and does not throw for cancelled", () => {
        const clientIO = createEnhancedClientIO(undefined, {
            current: makeDispatcherStub().dispatcher,
        });
        expect(() => clientIO.interactionCancelled("no-such-id")).not.toThrow();
    });
});

describe("multiple concurrent interactions", () => {
    it("dismissing one interaction does not affect the other", async () => {
        const { dispatcher, calls } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        // Start two prompts simultaneously
        clientIO.requestInteraction(makeAskYesNo("int-A"));
        clientIO.requestInteraction(makeAskYesNo("int-B"));
        await flushAsync();

        // Resolve int-A (answered by another client)
        clientIO.interactionResolved("int-A", true);
        await flushAsync();

        // int-B is still active — the user can still answer it
        fakeStdin.typeAnswer("y");
        await flushAsync();

        // Only int-B should have called respondToInteraction
        expect(calls).toHaveLength(1);
        expect(calls[0].args[0]).toMatchObject({ interactionId: "int-B" });
    });

    it("resolving an already-dismissed interaction is a no-op", async () => {
        const { dispatcher, calls } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        clientIO.requestInteraction(makeAskYesNo("int-C"));
        await flushAsync();

        // User answers
        fakeStdin.typeAnswer("y");
        await flushAsync();

        // Server sends interactionResolved after the fact (race condition in delivery)
        expect(() => clientIO.interactionResolved("int-C", true)).not.toThrow();
        expect(calls).toHaveLength(1); // still just the one from the user's answer
    });
});

describe("proposeAction", () => {
    it("is silently ignored (not yet supported)", async () => {
        const { dispatcher, calls } = makeDispatcherStub();
        const clientIO = createEnhancedClientIO(undefined, {
            current: dispatcher,
        });

        const interaction: PendingInteractionRequest = {
            interactionId: "int-D",
            type: "proposeAction",
            actionTemplates: {} as any,
            requestId: { requestId: "req-1" },
            source: "test",
            timestamp: Date.now(),
        };

        clientIO.requestInteraction(interaction);
        await flushAsync();

        expect(calls).toHaveLength(0);
    });
});

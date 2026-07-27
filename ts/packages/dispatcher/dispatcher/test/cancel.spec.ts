// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Smoke test for Escape/Ctrl+C cancellation (AbortSignal wired end-to-end).
 *
 * Strategy: create a dispatcher whose agent handler blocks indefinitely on a
 * slow Promise.  Intercept setUserRequest() to capture the internal requestId,
 * then immediately call cancelCommand() — simulating Escape/Ctrl+C.  Verify:
 *   1. processCommand() resolves (does not hang).
 *   2. CommandResult.cancelled === true.
 *   3. The whole round-trip completes in well under 500 ms.
 */

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { createDispatcher } from "../src/dispatcher.js";
import { awaitCommand } from "@typeagent/dispatcher-types";
import type { Dispatcher } from "@typeagent/dispatcher-types";
import type { ClientIO, RequestId } from "@typeagent/dispatcher-types";

// ── Slow agent that hangs for 30 s (simulates LLM network call) ─────────────

const slowConfig: AppAgentManifest = {
    emojiChar: "🐢",
    description: "Slow test agent",
};

const slowHandlers = {
    description: "Slow Command Table",
    commands: {
        slow: {
            description: "A command that takes 30 seconds",
            run: async (): Promise<void> => {
                // Never resolves within normal test time
                await new Promise<void>((resolve) =>
                    setTimeout(resolve, 30_000),
                );
            },
        },
    },
} as const;

const slowAgent: AppAgent = {
    ...getCommandInterface(slowHandlers),
};

const slowAgentProvider: AppAgentProvider = {
    getAppAgentNames: () => ["slow"],
    getAppAgentManifest: async (name) => {
        if (name !== "slow") throw new Error(`Unknown agent: ${name}`);
        return slowConfig;
    },
    loadAppAgent: async (name) => {
        if (name !== "slow") throw new Error(`Unknown agent: ${name}`);
        return slowAgent;
    },
    unloadAppAgent: async () => {},
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a ClientIO that captures the first requestId from setUserRequest()
 * and resolves a promise so the test can call cancelCommand() immediately.
 */
function makeCapturingClientIO(): {
    clientIO: ClientIO;
    requestIdPromise: Promise<string>;
} {
    let resolveId!: (id: string) => void;
    const requestIdPromise = new Promise<string>((r) => {
        resolveId = r;
    });

    const clientIO: ClientIO = {
        clear: () => {},
        exit: () => process.exit(0),
        shutdown: () => process.exit(0),
        setUserRequest: (requestId: RequestId) => {
            resolveId(requestId.requestId);
        },
        setDisplayInfo: () => {},
        setDisplay: () => {},
        appendDisplay: () => {},
        appendDiagnosticData: () => {},
        setDynamicDisplay: () => {},
        question: async (_r, _m, _c, defaultId) => defaultId ?? 0,
        proposeAction: async () => undefined,
        notify: () => {},
        openLocalView: async () => {},
        closeLocalView: async () => {},
        requestChoice: () => {},
        requestForm: () => {},
        requestInteraction: () => {},
        interactionResolved: () => {},
        interactionCancelled: () => {},
        takeAction: (_requestId, action) => {
            throw new Error(`Action ${action} not supported`);
        },
    };

    return { clientIO, requestIdPromise };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Cancellation (AbortSignal smoke tests)", () => {
    let dispatcher: Dispatcher;
    const { clientIO, requestIdPromise } = makeCapturingClientIO();

    beforeAll(async () => {
        dispatcher = await createDispatcher("test", {
            agents: {
                actions: false,
                schemas: false,
            },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            appAgentProviders: [slowAgentProvider],
            collectCommandResult: true,
            clientIO,
        });
    });

    afterAll(async () => {
        if (dispatcher) {
            await dispatcher.close();
        }
    });

    it("cancels a slow command quickly and sets cancelled:true", async () => {
        const start = Date.now();

        // Start the slow command — it will block for 30 s unless cancelled.
        const resultPromise = awaitCommand(dispatcher, "@slow slow");

        // As soon as the dispatcher registers the request (setUserRequest fires),
        // immediately cancel it — simulating the user pressing Escape.
        const requestId = await requestIdPromise;
        dispatcher.cancelCommand(requestId);

        const result = await resultPromise;
        const elapsed = Date.now() - start;

        expect(result).toBeDefined();
        expect(result!.cancelled).toBe(true);
        // Should return well within 500 ms — not wait 30 s.
        expect(elapsed).toBeLessThan(500);
    }, 5_000 /* generous 5 s jest timeout */);
});
describe("Early cancellation via cancelCommandByClientId", () => {
    let dispatcher: Dispatcher;

    // ClientIO that captures setUserRequest so the first (blocking) command
    // can be cancelled once it's running, freeing the lock for the second.
    function makeBlockingClientIO(): {
        clientIO: ClientIO;
        firstRequestIdPromise: Promise<string>;
    } {
        let resolved = false;
        let resolveId!: (id: string) => void;
        const firstRequestIdPromise = new Promise<string>((r) => {
            resolveId = r;
        });
        const clientIO: ClientIO = {
            clear: () => {},
            exit: () => process.exit(0),
            shutdown: () => process.exit(0),
            setUserRequest: (requestId: RequestId) => {
                if (!resolved) {
                    resolved = true;
                    resolveId(requestId.requestId);
                }
            },
            setDisplayInfo: () => {},
            setDisplay: () => {},
            appendDisplay: () => {},
            appendDiagnosticData: () => {},
            setDynamicDisplay: () => {},
            question: async (_r, _m, _c, defaultId) => defaultId ?? 0,
            proposeAction: async () => undefined,
            notify: () => {},
            openLocalView: async () => {},
            closeLocalView: async () => {},
            requestChoice: () => {},
            requestForm: () => {},
            requestInteraction: () => {},
            interactionResolved: () => {},
            interactionCancelled: () => {},
            takeAction: (_requestId, action) => {
                throw new Error(`Action ${action} not supported`);
            },
        };
        return { clientIO, firstRequestIdPromise };
    }

    const { clientIO, firstRequestIdPromise } = makeBlockingClientIO();

    beforeAll(async () => {
        dispatcher = await createDispatcher("test-early", {
            agents: {
                actions: false,
                schemas: false,
            },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            appAgentProviders: [slowAgentProvider],
            collectCommandResult: true,
            clientIO,
        });
    });

    afterAll(async () => {
        if (dispatcher) {
            await dispatcher.close();
        }
    });

    it("cancels a queued command by client-assigned id before setUserRequest fires", async () => {
        const clientRequestId = "test-client-id-early-cancel";

        // Start a slow command that will hold the command lock.
        const firstResultPromise = awaitCommand(dispatcher, "@slow slow");

        // Wait for the first command to be running (setUserRequest fired).
        const firstRequestId = await firstRequestIdPromise;

        // Queue a second command with a client-assigned id while the first is still running.
        // It is now blocked behind the command lock — setUserRequest has not yet fired for it.
        const start = Date.now();
        const secondResultPromise = awaitCommand(
            dispatcher,
            "@slow slow",
            undefined,
            undefined,
            clientRequestId,
        );

        // Cancel the second command by client id — before it acquires the lock.
        // This is the early-cancel path: the AbortController exists but setUserRequest
        // has not yet been called, so the server requestId is not yet known to the caller.
        dispatcher.cancelCommandByClientId(clientRequestId);

        // Also cancel the first command so the test doesn't hang.
        dispatcher.cancelCommand(firstRequestId);

        const [firstResult, secondResult] = await Promise.all([
            firstResultPromise,
            secondResultPromise,
        ]);
        const elapsed = Date.now() - start;

        expect(firstResult?.cancelled).toBe(true);
        expect(secondResult).toBeDefined();
        expect(secondResult!.cancelled).toBe(true);
        // Second command should cancel quickly once the first releases the lock.
        expect(elapsed).toBeLessThan(1000);
    }, 10_000);
});

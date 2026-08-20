// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Proves that cancelCommandByClientId records a `requestQueue:cancel` event
// for a running request *before* the AbortController fires. The prior
// implementation aborted the controller straight from the client-id map and
// never went through the queue, so the queue's cancel event was missing and
// observers watching the structured log stream had no way to see the running
// request had been cancelled by the client.

import { jest } from "@jest/globals";
import type { LogEvent } from "@typeagent/telemetry";
import type { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { awaitCommand } from "@typeagent/dispatcher-types";
import type {
    ClientIO,
    Dispatcher,
    RequestId,
} from "@typeagent/dispatcher-types";

const captured: LogEvent[] = [];
jest.unstable_mockModule("../src/otel/structuredLogSink.js", () => ({
    createDispatcherOtelLoggerSink: () => ({
        logEvent(event: LogEvent) {
            captured.push(event);
        },
    }),
}));

const { createDispatcher } = await import("../src/dispatcher.js");

// A slow agent that blocks for 30 s unless aborted - long enough that the
// test's cancel path is what unblocks it, and the jest timeout is what
// enforces liveness on a broken cancel.
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

const slowAgentProvider = {
    getAppAgentNames: () => ["slow"],
    getAppAgentManifest: async (name: string) => {
        if (name !== "slow") throw new Error(`Unknown agent: ${name}`);
        return slowConfig;
    },
    loadAppAgent: async (name: string) => {
        if (name !== "slow") throw new Error(`Unknown agent: ${name}`);
        return slowAgent;
    },
    unloadAppAgent: async () => {},
};

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

describe("cancelCommandByClientId records queue cancel before abort", () => {
    let dispatcher: Dispatcher;
    const { clientIO, requestIdPromise } = makeCapturingClientIO();

    beforeAll(async () => {
        dispatcher = await createDispatcher("cancel-by-client-id-ordering", {
            agents: { actions: false, schemas: false },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            appAgentProviders: [slowAgentProvider as any],
            collectCommandResult: true,
            clientIO,
            telemetry: { structuredLogs: true },
        });
    });

    afterAll(async () => {
        if (dispatcher) {
            await dispatcher.close();
        }
    });

    it("emits requestQueue:cancel for the running phase before the command returns", async () => {
        captured.length = 0;
        const clientRequestId = "test-client-id-running-cancel";
        const resultPromise = awaitCommand(
            dispatcher,
            "@slow slow",
            undefined,
            undefined,
            clientRequestId,
        );
        // Wait until the command is actually running (setUserRequest fired)
        // so cancelCommandByClientId hits the running-phase branch, not the
        // queued-phase one.
        await requestIdPromise;

        dispatcher.cancelCommandByClientId(clientRequestId);

        const result = await resultPromise;
        expect(result?.cancelled).toBe(true);

        const cancelEvents = captured.filter(
            (event) => event.eventName === "dispatcher:requestQueue:cancel",
        );
        // Exactly one queue cancel event and it identifies the running phase.
        // Before the fix, the running-cancel path aborted the controller
        // straight from the client-id map and this event was missing.
        expect(cancelEvents).toHaveLength(1);
        expect(cancelEvents[0]?.event).toMatchObject({
            phase: "running",
            reason: "user",
        });

        const completeEvent = captured.find(
            (event) => event.eventName === "dispatcher:requestQueue:complete",
        );
        expect(completeEvent).toBeDefined();
        // The queue cancel event must precede the queue complete event: the
        // fix routes cancellation through the queue first so downstream
        // consumers see the request move to a cancelled state before the
        // run-loop finalizes it.
        const cancelIndex = captured.indexOf(cancelEvents[0]!);
        const completeIndex = captured.indexOf(completeEvent!);
        expect(cancelIndex).toBeLessThan(completeIndex);
    }, 10_000);
});

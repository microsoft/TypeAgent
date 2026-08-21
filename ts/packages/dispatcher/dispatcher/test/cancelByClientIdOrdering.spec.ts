// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { awaitCommand } from "@typeagent/dispatcher-types";
import type {
    ClientIO,
    Dispatcher,
    QueueSnapshot,
    RequestId,
} from "@typeagent/dispatcher-types";
import { QueueStateMirror } from "@typeagent/dispatcher-types";
import type { LogEvent } from "@typeagent/telemetry";

const captured: LogEvent[] = [];
jest.unstable_mockModule("../src/otel/structuredLogSink.js", () => ({
    createDispatcherOtelLoggerSink: () => ({
        logEvent(event: LogEvent) {
            captured.push(event);
        },
    }),
}));

const { createDispatcher } = await import("../src/dispatcher.js");

const slowConfig: AppAgentManifest = {
    emojiChar: "S",
    description: "Slow test agent",
};

const slowAgent: AppAgent = {
    ...getCommandInterface({
        description: "Slow commands",
        commands: {
            slow: {
                description: "Wait until cancelled",
                run: async (): Promise<void> => {
                    await new Promise<void>((resolve) =>
                        setTimeout(resolve, 30_000),
                    );
                },
            },
        },
    } as const),
};

const slowAgentProvider = {
    getAppAgentNames: () => ["slow"],
    getAppAgentManifest: async () => slowConfig,
    loadAppAgent: async () => slowAgent,
    unloadAppAgent: async () => {},
};

function createClientIO(): {
    clientIO: ClientIO;
    requestId: Promise<string>;
    queueObservations: Array<{
        event: "cancelled" | "snapshot";
        running: string | null;
    }>;
    cancelOnStart(callback: (() => void) | undefined): void;
} {
    let resolveRequestId!: (id: string) => void;
    let onStart: (() => void) | undefined;
    const mirror = new QueueStateMirror();
    const queueObservations: Array<{
        event: "cancelled" | "snapshot";
        running: string | null;
    }> = [];
    const observe = (event: "cancelled" | "snapshot") => {
        queueObservations.push({
            event,
            running: mirror.snapshot?.running?.requestId ?? null,
        });
    };
    const requestId = new Promise<string>((resolve) => {
        resolveRequestId = resolve;
    });
    return {
        requestId,
        queueObservations,
        cancelOnStart(callback) {
            onStart = callback;
        },
        clientIO: {
            clear: () => {},
            exit: () => process.exit(0),
            shutdown: () => process.exit(0),
            setUserRequest: (request: RequestId) =>
                resolveRequestId(request.requestId),
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
            requestStarted: (entry, version) => {
                mirror.applyStarted(entry, version);
                onStart?.();
            },
            requestCancelled: (id, _reason, version) => {
                mirror.applyCancelled(id, version);
                observe("cancelled");
            },
            queueStateChanged: (snapshot: QueueSnapshot) => {
                mirror.applyQueueStateChanged(snapshot);
                observe("snapshot");
            },
            takeAction: (_requestId, action) => {
                throw new Error(`Action ${action} not supported`);
            },
        },
    };
}

describe("cancelCommandByClientId ordering", () => {
    let dispatcher: Dispatcher;
    const { clientIO, requestId, queueObservations, cancelOnStart } =
        createClientIO();

    beforeAll(async () => {
        dispatcher = await createDispatcher("cancel-ordering", {
            agents: { actions: false, schemas: false },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            appAgentProviders: [slowAgentProvider],
            collectCommandResult: true,
            clientIO,
            telemetry: { structuredLogs: true },
        });
    });

    afterAll(async () => {
        await dispatcher.close();
    });

    it("records the running cancellation before abort completion", async () => {
        captured.length = 0;
        const clientRequestId = "running-cancel";
        const result = awaitCommand(
            dispatcher,
            "@slow slow",
            undefined,
            undefined,
            clientRequestId,
        );
        await requestId;

        dispatcher.cancelCommandByClientId(clientRequestId);

        await expect(result).resolves.toMatchObject({ cancelled: true });
        const cancelEvents = captured.filter(
            (event) => event.eventName === "dispatcher:requestQueue:cancel",
        );
        expect(cancelEvents).toHaveLength(1);
        expect(cancelEvents[0]!.event).toMatchObject({
            phase: "running",
            reason: "user",
        });
        const completed = captured.find(
            (event) => event.eventName === "dispatcher:requestQueue:complete",
        );
        expect(completed).toBeDefined();
        expect(captured.indexOf(cancelEvents[0]!)).toBeLessThan(
            captured.indexOf(completed!),
        );
    }, 10_000);

    it("preserves cancellation when requestStarted races controller setup", async () => {
        const clientRequestId = "request-start-race";
        queueObservations.length = 0;
        cancelOnStart(() =>
            dispatcher.cancelCommandByClientId(clientRequestId),
        );
        try {
            await expect(
                awaitCommand(
                    dispatcher,
                    "@slow slow",
                    undefined,
                    undefined,
                    clientRequestId,
                ),
            ).resolves.toMatchObject({ cancelled: true });
            const cancelledIndex = queueObservations.findIndex(
                ({ event }) => event === "cancelled",
            );
            expect(cancelledIndex).toBeGreaterThanOrEqual(0);
            expect(
                queueObservations
                    .slice(cancelledIndex + 1)
                    .some(
                        ({ event, running }) =>
                            event === "snapshot" && running !== null,
                    ),
            ).toBe(false);
        } finally {
            cancelOnStart(undefined);
        }
    }, 10_000);
});

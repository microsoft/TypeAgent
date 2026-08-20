// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { awaitCommand } from "@typeagent/dispatcher-types";
import type {
    ClientIO,
    Dispatcher,
    RequestId,
} from "@typeagent/dispatcher-types";
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
    cancelOnStart(callback: (() => void) | undefined): void;
} {
    let resolveRequestId!: (id: string) => void;
    let onStart: (() => void) | undefined;
    const requestId = new Promise<string>((resolve) => {
        resolveRequestId = resolve;
    });
    return {
        requestId,
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
            requestStarted: () => onStart?.(),
            takeAction: (_requestId, action) => {
                throw new Error(`Action ${action} not supported`);
            },
        },
    };
}

describe("cancelCommandByClientId ordering", () => {
    let dispatcher: Dispatcher;
    const { clientIO, requestId, cancelOnStart } = createClientIO();

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
        } finally {
            cancelOnStart(undefined);
        }
    }, 10_000);
});

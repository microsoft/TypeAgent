// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import type { LogEvent } from "@typeagent/telemetry";
import { awaitCommand, type Dispatcher } from "@typeagent/dispatcher-types";
import type { AppAgentProvider } from "../src/agentProvider/agentProvider.js";

const captured: LogEvent[] = [];
jest.unstable_mockModule("../src/otel/structuredLogSink.js", () => ({
    createDispatcherOtelLoggerSink: () => ({
        logEvent(event: LogEvent) {
            captured.push(event);
        },
    }),
}));

const { createDispatcher } = await import("../src/dispatcher.js");

const throwingAgentManifest: AppAgentManifest = {
    emojiChar: "🧪",
    description: "Structured event test agent",
};
const throwingAgent: AppAgent = {
    ...getCommandInterface({
        description: "Structured event test commands",
        commands: {
            fail: {
                description: "Throw an error",
                run: async () => {
                    throw new Error("agent command failed");
                },
            },
        },
    }),
};
const throwingAgentProvider: AppAgentProvider = {
    getAppAgentNames: () => ["throwing"],
    getAppAgentManifest: async () => throwingAgentManifest,
    loadAppAgent: async () => throwingAgent,
    unloadAppAgent: async () => {},
};

describe("dispatcher structured request lifecycle", () => {
    let dispatcher: Dispatcher;

    beforeAll(async () => {
        dispatcher = await createDispatcher("structured-events-integration", {
            agents: { actions: false, schemas: false },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            appAgentProviders: [throwingAgentProvider],
            collectCommandResult: true,
            telemetry: { structuredLogs: true },
        });
    });

    afterAll(async () => {
        await dispatcher.close();
    });

    it("emits correlated lifecycle events for an offline command", async () => {
        captured.length = 0;

        await awaitCommand(dispatcher, "@help");

        const lifecycle = captured.filter((event) =>
            [
                "dispatcher:request:received",
                "dispatcher:request:completed",
            ].includes(event.eventName),
        );
        expect(lifecycle.map((event) => event.eventName)).toEqual([
            "dispatcher:request:received",
            "dispatcher:request:completed",
        ]);
        expect(lifecycle[0]?.event).toMatchObject({
            kind: "command",
            attachmentCount: 0,
        });
        expect(lifecycle[1]?.event).toMatchObject({
            status: "completed",
            success: true,
            cancelled: false,
        });
        expect(lifecycle[0]?.event.requestId).toBe(
            lifecycle[1]?.event.requestId,
        );
        expect(
            captured.find((event) => event.eventName === "dispatcher:command")
                ?.event.requestId,
        ).toBe(lifecycle[0]?.event.requestId);
        expect(JSON.stringify(lifecycle)).not.toContain("@help");
    });

    it("classifies a failed command without exporting the request", async () => {
        captured.length = 0;

        await awaitCommand(dispatcher, "@definitelyNotACommand");

        const exception = captured.find(
            (event) => event.eventName === "dispatcher:command:exception",
        );
        expect(exception?.severity).toBe("error");
        // The optional fields must stay absent rather than be invented.
        expect(exception?.event).toMatchObject({ errorCategory: "internal" });
        expect(exception?.event.httpStatus).toBeUndefined();
        expect(exception?.event.retryable).toBeUndefined();
        expect(exception?.event.requestId).toBe(
            captured.find(
                (event) => event.eventName === "dispatcher:request:received",
            )?.event.requestId,
        );
    });

    it("records an app-agent command exception as a structured event", async () => {
        captured.length = 0;

        const result = await awaitCommand(dispatcher, "@throwing fail");

        expect(result?.disposition).toEqual({
            status: "failed",
            path: "command",
            mayHaveSideEffects: true,
        });
        const exception = captured.find(
            (event) => event.eventName === "dispatcher:command:exception",
        );
        expect(exception?.severity).toBe("error");
        expect(exception?.event).toMatchObject({
            errorCategory: "internal",
        });
        expect(exception?.event.requestId).toBe(
            captured.find(
                (event) => event.eventName === "dispatcher:request:received",
            )?.event.requestId,
        );
    });
});

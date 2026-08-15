// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { LogEvent } from "@typeagent/telemetry";
import { awaitCommand, type Dispatcher } from "@typeagent/dispatcher-types";

const captured: LogEvent[] = [];
jest.unstable_mockModule("../src/otel/structuredLogSink.js", () => ({
    createDispatcherOtelLoggerSink: () => ({
        logEvent(event: LogEvent) {
            captured.push(event);
        },
    }),
}));

const { createDispatcher } = await import("../src/dispatcher.js");

describe("dispatcher structured request lifecycle", () => {
    let dispatcher: Dispatcher;

    beforeAll(async () => {
        dispatcher = await createDispatcher("structured-events-integration", {
            agents: { actions: false, schemas: false },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
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
});

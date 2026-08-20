// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { LogEvent } from "@typeagent/telemetry";
import { awaitCommand, type Dispatcher } from "@typeagent/dispatcher-types";
import {
    getChatModelTelemetryContext,
    type ChatModelTelemetryContext,
} from "@typeagent/aiclient";

const captured: LogEvent[] = [];
jest.unstable_mockModule("../src/otel/structuredLogSink.js", () => ({
    createDispatcherOtelLoggerSink: () => ({
        logEvent(event: LogEvent) {
            captured.push(event);
        },
    }),
}));

const { createDispatcher } = await import("../src/dispatcher.js");
// `randomCommandHandler` sits in an import cycle: it imports `command.js`,
// whose graph reaches `systemAgent.js`, which builds the random command table
// at module scope. Reaching it through the already-evaluated dispatcher graph
// above (rather than loading it as a graph of its own) gets the same
// evaluation order the app uses, so the handler class is initialized before
// that table is built.
const { getRandomCommandHandlers } = await import(
    "../src/context/system/handlers/randomCommandHandler.js"
);

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

    it("classifies a failed command without exporting the request", async () => {
        captured.length = 0;

        await awaitCommand(dispatcher, "@definitelyNotACommand");

        const exception = captured.find(
            (event) => event.eventName === "dispatcher:command:exception",
        );
        expect(exception?.severity).toBe("error");
        // Nothing about an unknown command is retryable, an HTTP failure, or
        // an enumerated provider code, so only the category is asserted - the
        // optional fields must stay absent rather than be invented.
        expect(exception?.event).toMatchObject({ errorCategory: "internal" });
        expect(exception?.event.httpStatus).toBeUndefined();
        expect(exception?.event.retryable).toBeUndefined();
        expect(exception?.event.requestId).toBe(
            captured.find(
                (event) => event.eventName === "dispatcher:request:received",
            )?.event.requestId,
        );
    });
});

// `@random online` asks the model to invent sample user requests. It is a
// grounded model call from a command handler, so it reports a purpose of its
// own instead of arriving at the central model wrapper unclassified. The
// assertion reads the aiclient telemetry context from inside the translator
// stub, which is exactly what that wrapper reads when it records
// `llm:started` / `llm:completed`.
describe("@random online classification", () => {
    it("reports foreground sample-request generation", async () => {
        const observed: ChatModelTelemetryContext[] = [];
        const online = getRandomCommandHandlers().commands
            .online as unknown as {
            getTypeChatResponse(
                userInput: string,
                chat: { translate: unknown },
            ): Promise<unknown>;
        };
        const chat = {
            translate: async () => {
                observed.push(getChatModelTelemetryContext());
                return { success: true, data: { messages: [] } };
            },
        };

        await online.getTypeChatResponse(
            "Generate 10 random user requests.",
            chat,
        );

        // Foreground because the user waits on the command that asked for
        // them, and a purpose of its own because this is not translating a
        // user request.
        expect(observed).toEqual([
            {
                phase: "unknown",
                purpose: "sample-request-generation",
                scope: "foreground",
                classificationSource: "explicit",
            },
        ]);
    });
});

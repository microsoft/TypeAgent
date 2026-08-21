// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context, createContextKey, type Context } from "@opentelemetry/api";
import {
    createInMemorySpanManager,
    type InMemorySpanManager,
} from "@typeagent/telemetry/testing/inMemorySpanManager";
import { createDispatcherFromContext } from "../src/dispatcher.js";
import type { CommandHandlerContext } from "../src/context/commandHandlerContext.js";

interface CapturedQueueInput {
    traceContext?: Context;
}

function createTestDispatcher(joinActiveTrace: boolean): {
    dispatcher: ReturnType<typeof createDispatcherFromContext>;
    getCapturedInput(): CapturedQueueInput | undefined;
} {
    let capturedInput: CapturedQueueInput | undefined;
    const commandContext = {
        telemetryOptions: { joinActiveTrace },
        requestQueue: {
            submit(input: CapturedQueueInput) {
                capturedInput = input;
                return {
                    requestId: "request-1",
                    originatorConnectionId: "connection-1",
                    text: "test",
                    submittedAt: Date.now(),
                    state: "queued",
                    completion: Promise.resolve(undefined),
                };
            },
        },
    } as unknown as CommandHandlerContext;
    return {
        dispatcher: createDispatcherFromContext(commandContext, "connection-1"),
        getCapturedInput: () => capturedInput,
    };
}

describe("dispatcher queued trace context", () => {
    let spanManager: InMemorySpanManager;

    beforeEach(() => {
        spanManager = createInMemorySpanManager();
    });

    afterEach(async () => {
        await spanManager.shutdown();
    });

    it("captures the active context when the host opts into trace joining", async () => {
        const key = createContextKey("dispatcher-rpc-parent");
        const parentContext = context.active().setValue(key, "rpc-server");
        const test = createTestDispatcher(true);

        await context.with(parentContext, () =>
            test.dispatcher.submitCommand("test"),
        );

        expect(test.getCapturedInput()?.traceContext).toBe(parentContext);
    });

    it("keeps embedded dispatcher requests independent by default", async () => {
        const key = createContextKey("embedded-host-parent");
        const parentContext = context.active().setValue(key, "host");
        const test = createTestDispatcher(false);

        await context.with(parentContext, () =>
            test.dispatcher.submitCommand("test"),
        );

        expect(test.getCapturedInput()?.traceContext).toBeUndefined();
    });
});

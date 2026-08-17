// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Logger } from "@typeagent/telemetry";
import {
    DISPATCHER_STRUCTURED_EVENTS,
    logActionCompleted,
    logActionStarted,
    logRequestCompleted,
    logRequestReceived,
    logTranslationCompleted,
    logTranslationStarted,
} from "../src/otel/structuredEvents.js";

function createCapture(): {
    logger: Logger;
    events: {
        name: string;
        data: Record<string, unknown>;
        severity: string | undefined;
    }[];
} {
    const events: {
        name: string;
        data: Record<string, unknown>;
        severity: string | undefined;
    }[] = [];
    return {
        events,
        logger: {
            logEvent(name, data, severity) {
                events.push({ name, data, severity });
            },
        },
    };
}

describe("dispatcher structured lifecycle events", () => {
    it("records a content-free successful action request lifecycle", () => {
        const { logger, events } = createCapture();

        logRequestReceived(logger, {
            requestId: "request-1",
            connectionId: "connection-1",
            kind: "request",
            attachmentCount: 1,
        });
        logTranslationStarted(logger, {
            requestId: "request-1",
            schemaNames: ["calendar"],
        });
        logTranslationCompleted(logger, {
            requestId: "request-1",
            strategy: "grammar",
            success: true,
            actions: [
                {
                    action: {
                        schemaName: "calendar",
                        actionName: "addEvent",
                    },
                },
            ],
        });
        logActionStarted(logger, {
            requestId: "request-1",
            schemaName: "calendar",
            actionName: "addEvent",
            appAgentName: "calendar",
            actionIndex: 0,
        });
        logActionCompleted(logger, {
            requestId: "request-1",
            schemaName: "calendar",
            actionName: "addEvent",
            appAgentName: "calendar",
            actionIndex: 0,
            success: true,
        });
        logRequestCompleted(logger, "request-1", {
            disposition: {
                status: "handled",
                path: "action",
                schemas: ["calendar"],
            },
        });

        expect(events.map(({ name }) => name)).toEqual([
            DISPATCHER_STRUCTURED_EVENTS.requestReceived,
            DISPATCHER_STRUCTURED_EVENTS.translationStarted,
            DISPATCHER_STRUCTURED_EVENTS.translationCompleted,
            DISPATCHER_STRUCTURED_EVENTS.actionStarted,
            DISPATCHER_STRUCTURED_EVENTS.actionCompleted,
            DISPATCHER_STRUCTURED_EVENTS.requestCompleted,
        ]);
        expect(events[1]?.data).toEqual({
            requestId: "request-1",
            count: 1,
        });
        expect(events[2]?.data).toEqual({
            requestId: "request-1",
            strategy: "grammar",
            success: true,
            status: "succeeded",
            schemaNames: ["calendar"],
            actionNames: ["calendar.addEvent"],
            count: 1,
        });
        expect(events[4]).toMatchObject({
            severity: "info",
            data: { status: "succeeded", success: true },
        });
        expect(events[5]).toMatchObject({
            severity: "info",
            data: {
                status: "handled",
                success: true,
                cancelled: false,
                path: "action",
                schemaNames: ["calendar"],
            },
        });
        expect(JSON.stringify(events)).not.toContain("parameters");
        expect(JSON.stringify(events)).not.toContain("user request");
    });

    it("distinguishes failed and cancelled lifecycle phases", () => {
        const { logger, events } = createCapture();

        logActionCompleted(logger, {
            requestId: "request-2",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 0,
            success: false,
        });
        logRequestCompleted(logger, "request-2", { cancelled: true });
        logTranslationCompleted(logger, {
            requestId: "request-2",
            strategy: "translate",
            success: false,
            cancelled: true,
            actions: [],
        });
        logActionCompleted(logger, {
            requestId: "request-2",
            schemaName: "email",
            actionName: "send",
            appAgentName: "email",
            actionIndex: 1,
            success: false,
            cancelled: true,
        });

        expect(events[0]).toMatchObject({
            severity: "error",
            data: { status: "failed", success: false },
        });
        expect(events[1]).toMatchObject({
            severity: "warning",
            data: {
                status: "cancelled",
                success: false,
                cancelled: true,
            },
        });
        expect(events[2]).toMatchObject({
            severity: "warning",
            data: {
                status: "cancelled",
                success: false,
                cancelled: true,
            },
        });
        expect(events[3]).toMatchObject({
            severity: "warning",
            data: {
                status: "cancelled",
                success: false,
                cancelled: true,
            },
        });
    });
});

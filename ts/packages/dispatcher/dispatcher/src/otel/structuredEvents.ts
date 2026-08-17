// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CommandResult } from "@typeagent/dispatcher-types";
import type { Logger } from "@typeagent/telemetry";

export const DISPATCHER_STRUCTURED_EVENTS = {
    requestReceived: "request:received",
    translationStarted: "translation:started",
    translationCompleted: "translation:completed",
    reasoningStarted: "reasoning:started",
    reasoningCompleted: "reasoning:completed",
    actionStarted: "action:started",
    actionCompleted: "action:completed",
    requestCompleted: "request:completed",
} as const;

export function logRequestReceived(
    logger: Logger | undefined,
    data: {
        requestId: string;
        connectionId?: string;
        kind: "command" | "request";
        attachmentCount: number;
    },
): void {
    logger?.logEvent(DISPATCHER_STRUCTURED_EVENTS.requestReceived, data);
}

export function logTranslationStarted(
    logger: Logger | undefined,
    data: {
        requestId: string;
        schemaNames: readonly string[];
    },
): void {
    logger?.logEvent(DISPATCHER_STRUCTURED_EVENTS.translationStarted, {
        requestId: data.requestId,
        count: data.schemaNames.length,
    });
}

export function logTranslationCompleted(
    logger: Logger | undefined,
    data: {
        requestId: string;
        strategy: string;
        success: boolean;
        actions: readonly {
            action: { schemaName: string; actionName: string };
        }[];
    },
): void {
    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.translationCompleted,
        {
            requestId: data.requestId,
            strategy: data.strategy,
            success: data.success,
            status: data.success ? "succeeded" : "failed",
            schemaNames: [
                ...new Set(data.actions.map(({ action }) => action.schemaName)),
            ],
            actionNames: data.actions.map(
                ({ action }) => `${action.schemaName}.${action.actionName}`,
            ),
            count: data.actions.length,
        },
        data.success ? "info" : "error",
    );
}

export function logReasoningStarted(
    logger: Logger | undefined,
    data: {
        requestId: string;
        provider?: string;
        model?: string;
    },
): void {
    logger?.logEvent(DISPATCHER_STRUCTURED_EVENTS.reasoningStarted, data);
}

export function logReasoningCompleted(
    logger: Logger | undefined,
    data: {
        requestId: string;
        provider?: string;
        model?: string;
        success: boolean;
        cancelled: boolean;
        elapsedMs: number;
    },
): void {
    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.reasoningCompleted,
        {
            ...data,
            status: data.cancelled
                ? "cancelled"
                : data.success
                  ? "succeeded"
                  : "failed",
        },
        data.success ? "info" : data.cancelled ? "warning" : "error",
    );
}

export function logActionStarted(
    logger: Logger | undefined,
    data: {
        requestId: string;
        schemaName: string;
        actionName: string;
        appAgentName: string;
        actionIndex: number;
    },
): void {
    logger?.logEvent(DISPATCHER_STRUCTURED_EVENTS.actionStarted, data);
}

export function logActionCompleted(
    logger: Logger | undefined,
    data: {
        requestId: string;
        schemaName: string;
        actionName: string;
        appAgentName: string;
        actionIndex: number;
        success: boolean;
    },
): void {
    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.actionCompleted,
        {
            ...data,
            status: data.success ? "succeeded" : "failed",
        },
        data.success ? "info" : "error",
    );
}

export function logRequestCompleted(
    logger: Logger | undefined,
    requestId: string,
    result: CommandResult | undefined,
): void {
    const disposition = result?.disposition;
    const cancelled = result?.cancelled === true;
    const status = cancelled
        ? "cancelled"
        : (disposition?.status ?? "completed");
    const success = !cancelled && disposition?.status !== "failed";

    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.requestCompleted,
        {
            requestId,
            status,
            success,
            cancelled,
            ...(disposition !== undefined && "path" in disposition
                ? { path: disposition.path }
                : {}),
            ...(disposition !== undefined && "reason" in disposition
                ? { reason: disposition.reason }
                : {}),
            ...(disposition !== undefined && "schemas" in disposition
                ? { schemaNames: disposition.schemas }
                : {}),
        },
        success ? "info" : cancelled ? "warning" : "error",
    );
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CommandResult } from "@typeagent/dispatcher-types";
import type { Logger } from "@typeagent/telemetry";

export const DISPATCHER_STRUCTURED_EVENTS = {
    requestReceived: "request:received",
    actionsSelected: "request:actionsSelected",
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

export function logActionsSelected(
    logger: Logger | undefined,
    data: {
        requestId: string;
        strategy: string;
        actions: readonly {
            action: { schemaName: string; actionName: string };
        }[];
    },
): void {
    logger?.logEvent(DISPATCHER_STRUCTURED_EVENTS.actionsSelected, {
        requestId: data.requestId,
        strategy: data.strategy,
        schemaNames: [
            ...new Set(data.actions.map(({ action }) => action.schemaName)),
        ],
        actionNames: data.actions.map(
            ({ action }) => `${action.schemaName}.${action.actionName}`,
        ),
        count: data.actions.length,
    });
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

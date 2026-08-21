// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CommandResult } from "@typeagent/dispatcher-types";
import type { Logger } from "@typeagent/telemetry";
import type { TranslationRoutingSummary } from "./translationSpan.js";

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

/**
 * Stable, low-cardinality routing decision for `translation:completed`. Answers
 * "why did this request take the schema/cache/fallback path it did?" without
 * exposing user input. On success it is derived from the terminal translation
 * `strategy`; on a failed/cancelled translation there is no trustworthy
 * terminal strategy, so it is derived from the routes actually observed and
 * omitted when none reached a terminal decision. The accompanying
 * `routes`/`matchOutcome`/`cacheBypassReason`/`fallback`/`retryCount` fields add
 * the additive routing, cache-lookup, and fallback/retry nuance.
 */
export type TranslationRoutingReason =
    | "user_action"
    | "cache_construction"
    | "cache_grammar"
    | "llm_translation";

function deriveTranslationRoutingReason(
    strategy: string,
): TranslationRoutingReason | undefined {
    switch (strategy) {
        case "user":
            return "user_action";
        case "construction":
            return "cache_construction";
        case "grammar":
            return "cache_grammar";
        case "translate":
            return "llm_translation";
        default:
            return undefined;
    }
}

/**
 * Derive a routing reason from the mechanisms actually observed on the span.
 * Used for failed/cancelled translations, where the terminal `strategy` is a
 * placeholder that must not be trusted (a failure during cache matching would
 * otherwise be reported as `llm_translation`). Returns `undefined` when no
 * single terminal route is known so the event omits the reason rather than
 * fabricating one.
 */
function deriveRoutingReasonFromRoutes(
    routes: readonly string[] | undefined,
): TranslationRoutingReason | undefined {
    if (routes === undefined || routes.length === 0) {
        return undefined;
    }
    // The model path is unambiguous: if the LLM ran, that is the route taken,
    // even alongside a preceding cache/grammar hit in a mixed translation.
    if (routes.includes("llm")) {
        return "llm_translation";
    }
    if (routes.length === 1) {
        if (routes[0] === "cache") {
            return "cache_construction";
        }
        if (routes[0] === "grammar") {
            return "cache_grammar";
        }
    }
    // Cache + grammar without an LLM call has no single terminal route; don't
    // guess.
    return undefined;
}

export function logTranslationCompleted(
    logger: Logger | undefined,
    data: {
        requestId: string;
        strategy: string;
        success: boolean;
        cancelled?: boolean;
        // Duration of the translation phase measured at the call boundary.
        elapsedMs?: number;
        // Bounded routing decisions captured during translation.
        routing?: TranslationRoutingSummary | undefined;
        actions: readonly {
            action: { schemaName: string; actionName: string };
        }[];
    },
): void {
    // On success `strategy` names the real terminal route. On a
    // failed/cancelled translation `strategy` is only a placeholder, so fall
    // back to the routes actually observed and omit the reason when none is
    // conclusive - never fabricate `llm_translation` for a cache-stage failure.
    const routingReason = data.success
        ? deriveTranslationRoutingReason(data.strategy)
        : deriveRoutingReasonFromRoutes(data.routing?.routes);
    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.translationCompleted,
        {
            requestId: data.requestId,
            strategy: data.strategy,
            success: data.success,
            ...(data.cancelled === undefined
                ? {}
                : { cancelled: data.cancelled }),
            status: data.cancelled
                ? "cancelled"
                : data.success
                  ? "succeeded"
                  : "failed",
            ...(data.elapsedMs === undefined
                ? {}
                : { elapsedMs: data.elapsedMs }),
            ...(routingReason === undefined ? {} : { routingReason }),
            ...(data.routing?.matchOutcome === undefined
                ? {}
                : { matchOutcome: data.routing.matchOutcome }),
            ...(data.routing?.cacheBypassReason === undefined
                ? {}
                : { cacheBypassReason: data.routing.cacheBypassReason }),
            ...(data.routing?.routes === undefined ||
            data.routing.routes.length === 0
                ? {}
                : { routes: data.routing.routes }),
            ...(data.routing === undefined
                ? {}
                : {
                      fallback: data.routing.fallback,
                      retryCount: data.routing.retryCount,
                  }),
            schemaNames: [
                ...new Set(data.actions.map(({ action }) => action.schemaName)),
            ],
            actionNames: data.actions.map(
                ({ action }) => `${action.schemaName}.${action.actionName}`,
            ),
            count: data.actions.length,
        },
        data.success ? "info" : data.cancelled ? "warning" : "error",
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
        cancelled?: boolean;
        // Duration of the action-execution phase measured at the call boundary.
        elapsedMs?: number;
    },
): void {
    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.actionCompleted,
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

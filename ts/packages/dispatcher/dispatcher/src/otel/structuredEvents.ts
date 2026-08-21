// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CommandResult } from "@typeagent/dispatcher-types";
import type { Logger } from "@typeagent/telemetry";
import { otel } from "@typeagent/telemetry";
import type { TranslationRoutingSummary } from "./translationSpan.js";

export const DISPATCHER_STRUCTURED_EVENTS = {
    requestReceived: "request:received",
    commandException: "command:exception",
    translationStarted: "translation:started",
    translationCompleted: "translation:completed",
    reasoningStarted: "reasoning:started",
    reasoningCompleted: "reasoning:completed",
    actionStarted: "action:started",
    actionCompleted: "action:completed",
    requestCompleted: "request:completed",
} as const;

/**
 * Classify a completion once, so the disposition, event `status`, log
 * severity, and classification fields cannot disagree. The phase spans record
 * their cancellation from the same `otel.isTelemetryCancellation`, which walks
 * the `cause` chain, so a wrapped cancellation is not reported as a plain
 * failure.
 */
type CompletionOutcome = {
    readonly status: "succeeded" | "failed" | "cancelled";
    readonly cancelled: boolean;
    /**
     * Emitted only for a real failure with a thrown value: an agent reporting
     * failure through a typed `ActionResult.error` never threw, so asserting a
     * category would be an invention.
     */
    readonly classification: otel.TelemetryErrorClassification | undefined;
};

function classifyCompletion(
    success: boolean,
    error: unknown,
    cancelledHint: boolean | undefined,
): CompletionOutcome {
    // Ignoring a thrown value on the success path keeps `status` from
    // contradicting `success`.
    const failure = success ? undefined : error;
    const classification =
        failure === undefined
            ? undefined
            : otel.classifyTelemetryError(failure);
    const cancelled = otel.isTelemetryCancellation(failure, cancelledHint);
    return {
        status: cancelled ? "cancelled" : success ? "succeeded" : "failed",
        cancelled,
        classification: cancelled ? undefined : classification,
    };
}

/** Log severity implied by an outcome. */
function outcomeLevel(
    outcome: CompletionOutcome,
): "info" | "warning" | "error" {
    switch (outcome.status) {
        case "succeeded":
            return "info";
        case "cancelled":
            return "warning";
        default:
            return "error";
    }
}

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

/**
 * Record a command that failed with an exception. Only the bounded
 * classification is allowlisted through to OTel; `request`, `name`, `message`,
 * and `stack` can contain user input and stay in the local debug and opt-in
 * database sinks (see `createDispatcherOtelLoggerSink`).
 */
export function logCommandException(
    logger: Logger | undefined,
    data: {
        requestId: string;
        request: string;
        error: unknown;
    },
): void {
    const outcome = classifyCompletion(false, data.error, undefined);
    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.commandException,
        {
            requestId: data.requestId,
            ...outcome.classification,
            request: data.request,
            ...stringField(data.error, "name"),
            ...stringField(data.error, "message"),
            ...stringField(data.error, "stack"),
        },
        outcomeLevel(outcome),
    );
}

/**
 * Read one string property off a thrown value. A thrown value can be anything,
 * including an object whose getters throw, so a failed read contributes
 * nothing rather than turning logging into a second failure.
 */
function stringField(
    source: unknown,
    name: "name" | "message" | "stack",
): Record<string, string> | Record<string, never> {
    if (source === null || typeof source !== "object") {
        return {};
    }
    try {
        const value = (source as Record<string, unknown>)[name];
        return typeof value === "string" ? { [name]: value } : {};
    } catch {
        return {};
    }
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
        // What the call site knows from outside the error; a cancellation
        // carried inside the thrown value is detected from the value itself.
        cancelled?: boolean;
        // Duration of the translation phase measured at the call boundary.
        elapsedMs?: number;
        // Bounded routing decisions captured during translation.
        routing?: TranslationRoutingSummary | undefined;
        // The thrown value on the failure path; omitted when the failure did
        // not come from a throw.
        error?: unknown;
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
    const outcome = classifyCompletion(
        data.success,
        data.error,
        data.cancelled,
    );
    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.translationCompleted,
        {
            requestId: data.requestId,
            strategy: data.strategy,
            success: data.success,
            ...(data.cancelled === undefined && !outcome.cancelled
                ? {}
                : { cancelled: outcome.cancelled }),
            status: outcome.status,
            ...(data.elapsedMs === undefined
                ? {}
                : { elapsedMs: data.elapsedMs }),
            ...outcome.classification,
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
        outcomeLevel(outcome),
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
        // Decided by the reasoning span's same cancellation test, so the span
        // status and this event always agree.
        cancelled: boolean;
        elapsedMs: number;
    },
): void {
    const outcome = classifyCompletion(data.success, undefined, data.cancelled);
    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.reasoningCompleted,
        {
            ...data,
            status: outcome.status,
        },
        outcomeLevel(outcome),
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
        // What the call site knows from outside the error; a cancellation
        // carried inside the thrown value is detected from the value itself.
        cancelled?: boolean;
        // Duration of the action-execution phase measured at the call boundary.
        elapsedMs?: number;
        // The thrown value on the failure path. An agent that reports failure
        // through a typed `ActionResult.error` never threw, so it omits this.
        error?: unknown;
    },
): void {
    const { error, cancelled, ...eventData } = data;
    const outcome = classifyCompletion(data.success, error, cancelled);
    logger?.logEvent(
        DISPATCHER_STRUCTURED_EVENTS.actionCompleted,
        {
            ...eventData,
            ...(cancelled === undefined && !outcome.cancelled
                ? {}
                : { cancelled: outcome.cancelled }),
            status: outcome.status,
            ...outcome.classification,
        },
        outcomeLevel(outcome),
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

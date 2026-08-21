// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function getStructuredLogMessage(
    eventName: string,
    body: unknown,
): string | undefined {
    const data = asRecord(body);
    switch (eventName) {
        case "dispatcher:server:requestReceived":
            return "Request received by agent server";
        case "dispatcher:server:requestRejected":
            return `Request rejected: ${stringValue(data, "reason", "unknown reason")}`;
        case "dispatcher:server:responseReady":
            return `Response ready: ${stringValue(data, "status", "completed")}`;
        case "dispatcher:requestQueue:submit":
            return `Request accepted and queued (${numberValue(data, "queuedAhead", 0)} ahead)`;
        case "dispatcher:requestQueue:interrupt":
            return "Interrupt request accepted and queued next";
        case "dispatcher:requestQueue:start":
            return `Request execution started after ${numberValue(data, "waitMs", 0)} ms in queue`;
        case "dispatcher:requestQueue:complete":
            return `Queue processing ${stringValue(data, "state", "completed")} in ${numberValue(data, "totalMs", 0)} ms`;
        case "dispatcher:requestQueue:rejected":
            return `Request queue rejected submission: ${stringValue(data, "reason", "unknown reason")}`;
        case "dispatcher:requestQueue:cancel":
            return `Request cancelled while ${stringValue(data, "phase", "queued")}`;
        case "dispatcher:request:received":
            return "Dispatcher began processing request";
        case "dispatcher:command:exception":
            return `Command failed: ${formatErrorClassification(data)}`;
        case "dispatcher:translation:started":
            return `Translation started with ${numberValue(data, "count", 0)} candidate schemas`;
        case "dispatcher:translation:completed":
            return formatTranslationCompleted(data);
        case "dispatcher:reasoning:started":
            return `Reasoning started${formatModel(data)}`;
        case "dispatcher:reasoning:completed":
            return `Reasoning ${stringValue(data, "status", "completed")} in ${numberValue(data, "elapsedMs", 0)} ms`;
        case "dispatcher:action:started":
            return `Action started: ${formatAction(data)}`;
        case "dispatcher:action:completed":
            return `Action ${stringValue(data, "status", "completed")}: ${formatAction(data)}${formatElapsed(data)}${formatFailureNote(data)}`;
        case "dispatcher:request:completed":
            return `Request completed: ${stringValue(data, "status", "completed")}`;
        case "aiclient:llm:started":
            return `LLM started: ${formatLlmOperation(data)}${formatScope(data)}${formatModel(data)}${booleanValue(data, "streaming") ? " (streaming)" : ""}`;
        case "aiclient:llm:completed":
            return formatLlmCompleted(data);
        case "aiclient:llm:classification:default":
            return `${numberValue(data, "count", 0)} foreground LLM call(s) ran with default (unclassified) phase/purpose`;
        default:
            return undefined;
    }
}

function formatTranslationCompleted(data: Record<string, unknown>): string {
    const status = stringValue(data, "status", "completed");
    const strategy = stringValue(data, "strategy", "unknown strategy");
    const actions = stringArrayValue(data, "actionNames");
    return `Translation ${status} via ${strategy}${formatRoutingNote(
        data,
    )}${formatElapsed(data)}${formatFailureNote(data)}${actions.length === 0 ? "" : `: ${actions.join(", ")}`}`;
}

/**
 * Render the bounded classification fields only - the original message and
 * stack are never part of a rendered message.
 */
function formatErrorClassification(data: Record<string, unknown>): string {
    const category = stringValue(data, "errorCategory", "internal");
    const details: string[] = [];
    const code = data.errorCode;
    if (typeof code === "string" && code.length > 0) {
        details.push(code);
    }
    const httpStatus = data.httpStatus;
    if (typeof httpStatus === "number" && Number.isFinite(httpStatus)) {
        details.push(`HTTP ${httpStatus}`);
    }
    if (data.retryable === true) {
        details.push("retryable");
    }
    return details.length === 0
        ? category
        : `${category} (${details.join(", ")})`;
}

/**
 * Append the failure classification to a lifecycle message, but only when the
 * event carries one.
 */
function formatFailureNote(data: Record<string, unknown>): string {
    return typeof data.errorCategory === "string" && data.errorCategory !== ""
        ? ` [${formatErrorClassification(data)}]`
        : "";
}

// Note only the routing nuance that `strategy` does not already convey: a
// mixed activity-context translation that reached the model despite a
// cache/grammar strategy (`+llm`), assistant-switch fallback, and retries. JSON
// fields remain primary.
function formatRoutingNote(data: Record<string, unknown>): string {
    const parts: string[] = [];
    const strategy = stringValue(data, "strategy", "");
    const routes = stringArrayValue(data, "routes");
    if (routes.includes("llm") && strategy !== "" && strategy !== "translate") {
        parts.push("+llm");
    }
    if (data.fallback === true) {
        parts.push("fallback");
    }
    const retryCount = numberValue(data, "retryCount", 0);
    if (retryCount > 0) {
        parts.push(`retry x${retryCount}`);
    }
    return parts.length === 0 ? "" : ` [${parts.join(", ")}]`;
}

function formatElapsed(data: Record<string, unknown>): string {
    const value = data.elapsedMs;
    return typeof value === "number" && Number.isFinite(value)
        ? ` in ${value} ms`
        : "";
}

function formatLlmCompleted(data: Record<string, unknown>): string {
    const status = stringValue(data, "status", "completed");
    const elapsedMs = numberValue(data, "elapsedMs", 0);
    const totalTokens = data.totalTokens;
    return `LLM ${status}: ${formatLlmOperation(data)}${formatScope(data)}${formatModel(data)} in ${elapsedMs} ms${
        typeof totalTokens === "number" ? ` (${totalTokens} tokens)` : ""
    }${formatFailureNote(data)}`;
}

function formatLlmOperation(data: Record<string, unknown>): string {
    const phase = stringValue(data, "phase", "unknown");
    const purpose = stringValue(data, "purpose", "unknown");
    const operation = phase === purpose ? phase : `${phase}.${purpose}`;
    return data.classificationSource === "default"
        ? `${operation} (unclassified)`
        : operation;
}

function formatScope(data: Record<string, unknown>): string {
    return data.scope === "background" ? " [background]" : "";
}

function formatModel(data: Record<string, unknown>): string {
    const provider = data.provider;
    const model = data.model;
    const values = [
        ...(typeof provider === "string" ? [provider] : []),
        ...(typeof model === "string" ? [model] : []),
    ];
    return values.length === 0 ? "" : ` (${values.join("/")})`;
}

function formatAction(data: Record<string, unknown>): string {
    const schemaName = stringValue(data, "schemaName", "unknown");
    const actionName = stringValue(data, "actionName", "action");
    return `${schemaName}.${actionName}`;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function stringValue(
    data: Record<string, unknown>,
    name: string,
    fallback: string,
): string {
    const value = data[name];
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(
    data: Record<string, unknown>,
    name: string,
    fallback: number,
): number {
    const value = data[name];
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : fallback;
}

function booleanValue(data: Record<string, unknown>, name: string): boolean {
    return data[name] === true;
}

function stringArrayValue(
    data: Record<string, unknown>,
    name: string,
): string[] {
    const value = data[name];
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];
}

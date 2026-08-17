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
            return `Action ${stringValue(data, "status", "completed")}: ${formatAction(data)}`;
        case "dispatcher:request:completed":
            return `Request completed: ${stringValue(data, "status", "completed")}`;
        case "aiclient:llm:started":
            return `LLM started: ${formatLlmOperation(data)}${formatScope(data)}${formatModel(data)}${booleanValue(data, "streaming") ? " (streaming)" : ""}`;
        case "aiclient:llm:completed":
            return formatLlmCompleted(data);
        default:
            return undefined;
    }
}

function formatTranslationCompleted(data: Record<string, unknown>): string {
    const status = stringValue(data, "status", "completed");
    const strategy = stringValue(data, "strategy", "unknown strategy");
    const actions = stringArrayValue(data, "actionNames");
    return `Translation ${status} via ${strategy}${
        actions.length === 0 ? "" : `: ${actions.join(", ")}`
    }`;
}

function formatLlmCompleted(data: Record<string, unknown>): string {
    const status = stringValue(data, "status", "completed");
    const elapsedMs = numberValue(data, "elapsedMs", 0);
    const totalTokens = data.totalTokens;
    return `LLM ${status}: ${formatLlmOperation(data)}${formatScope(data)}${formatModel(data)} in ${elapsedMs} ms${
        typeof totalTokens === "number" ? ` (${totalTokens} tokens)` : ""
    }`;
}

function formatLlmOperation(data: Record<string, unknown>): string {
    const phase = stringValue(data, "phase", "unknown");
    const purpose = stringValue(data, "purpose", "unknown");
    return phase === purpose ? phase : `${phase}.${purpose}`;
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

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context, createContextKey } from "@opentelemetry/api";

export type ChatModelTelemetryPhase =
    | "translation"
    | "reasoning"
    | "action"
    | "background"
    | "unknown";

export type ChatModelTelemetryPurpose =
    | "schema-selection"
    | "action-generation"
    | "action-validation"
    | "entity-resolution"
    | "reasoning"
    | "action"
    | "cache-generation"
    | "unknown";

export type ChatModelTelemetryScope = "foreground" | "background";

export interface ChatModelTelemetryContext {
    readonly phase: ChatModelTelemetryPhase;
    readonly purpose: ChatModelTelemetryPurpose;
    readonly scope: ChatModelTelemetryScope;
}

const CHAT_MODEL_TELEMETRY_CONTEXT_KEY = createContextKey(
    "typeagent.aiclient.chatModelTelemetryContext",
);

const DEFAULT_CHAT_MODEL_TELEMETRY_CONTEXT: ChatModelTelemetryContext =
    Object.freeze({
        phase: "unknown",
        purpose: "unknown",
        scope: "foreground",
    });

export function getChatModelTelemetryContext(): ChatModelTelemetryContext {
    return (
        (context
            .active()
            .getValue(
                CHAT_MODEL_TELEMETRY_CONTEXT_KEY,
            ) as ChatModelTelemetryContext) ??
        DEFAULT_CHAT_MODEL_TELEMETRY_CONTEXT
    );
}

export function withChatModelTelemetryContext<T>(
    telemetryContext: Partial<ChatModelTelemetryContext>,
    body: () => T,
): T {
    const current = getChatModelTelemetryContext();
    return context.with(
        context.active().setValue(CHAT_MODEL_TELEMETRY_CONTEXT_KEY, {
            ...current,
            ...telemetryContext,
        }),
        body,
    );
}

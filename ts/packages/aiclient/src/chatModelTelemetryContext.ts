// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

export type ChatModelTelemetryPhase =
    | "translation"
    | "reasoning"
    | "action"
    | "explanation";

export type ChatModelTelemetryPurpose =
    | "schema-selection"
    | "action-generation"
    | "action-validation"
    | "entity-resolution"
    | "reasoning"
    | "action"
    | "cache-generation";

export type ChatModelTelemetryScope = "foreground" | "background";

export interface ChatModelTelemetryContext {
    readonly phase: ChatModelTelemetryPhase;
    readonly purpose: ChatModelTelemetryPurpose;
    readonly scope: ChatModelTelemetryScope;
}

const chatModelTelemetryContext =
    new AsyncLocalStorage<ChatModelTelemetryContext>();

export function getChatModelTelemetryContext():
    | ChatModelTelemetryContext
    | undefined {
    return chatModelTelemetryContext.getStore();
}

export function withChatModelTelemetryContext<T>(
    telemetryContext: ChatModelTelemetryContext,
    body: () => T,
): T {
    return chatModelTelemetryContext.run(telemetryContext, body);
}

export function withChatModelTelemetryPurpose<T>(
    purpose: ChatModelTelemetryPurpose,
    body: () => T,
): T {
    const current = getChatModelTelemetryContext();
    if (current === undefined) {
        return body();
    }
    return withChatModelTelemetryContext({ ...current, purpose }, body);
}

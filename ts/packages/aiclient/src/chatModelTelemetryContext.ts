// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

export type ChatModelTelemetryPhase =
    | "translation"
    | "reasoning"
    | "action"
    | "explanation"
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
    | "capability-description"
    | "keyword-authoring"
    | "sample-request-generation"
    | "optimization-case-classification"
    | "optimization-hypothesis-generation"
    | "optimization-guideline-distillation"
    | "unknown";

export type ChatModelTelemetryScope = "foreground" | "background";

export type ChatModelTelemetryClassificationSource = "explicit" | "default";

export interface ChatModelTelemetryContext {
    readonly phase: ChatModelTelemetryPhase;
    readonly purpose: ChatModelTelemetryPurpose;
    readonly scope: ChatModelTelemetryScope;
    readonly classificationSource: ChatModelTelemetryClassificationSource;
}

export type ChatModelTelemetryClassification = Partial<
    Omit<ChatModelTelemetryContext, "classificationSource">
>;

const classificationStore = new AsyncLocalStorage<ChatModelTelemetryContext>();

const DEFAULT_CHAT_MODEL_TELEMETRY_CONTEXT: ChatModelTelemetryContext =
    Object.freeze({
        phase: "unknown",
        purpose: "unknown",
        scope: "foreground",
        classificationSource: "default",
    });

export function getChatModelTelemetryContext(): ChatModelTelemetryContext {
    return (
        classificationStore.getStore() ?? DEFAULT_CHAT_MODEL_TELEMETRY_CONTEXT
    );
}

export function withChatModelTelemetryContext<T>(
    classification: ChatModelTelemetryClassification,
    body: () => T,
): T {
    return classificationStore.run(
        {
            ...getChatModelTelemetryContext(),
            ...classification,
            classificationSource: "explicit",
        },
        body,
    );
}

export function withChatModelTelemetryPurpose<T>(
    purpose: ChatModelTelemetryPurpose,
    body: () => T,
): T {
    return withChatModelTelemetryContext({ purpose }, body);
}

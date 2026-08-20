// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";

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
    | "capability-description"
    | "keyword-authoring"
    | "sample-request-generation"
    | "optimization-case-classification"
    | "optimization-hypothesis-generation"
    | "optimization-guideline-distillation"
    | "unknown";

export type ChatModelTelemetryScope = "foreground" | "background";

/**
 * Whether the recorded phase/purpose/scope came from a call site
 * (`"explicit"`) or from the fallback used when no call site classified the
 * call (`"default"`).
 *
 * Without this, an `unknown` phase is ambiguous: it could mean "a call site
 * looked at this call and genuinely could not place it" or "nobody classified
 * this call at all". Only the second is an attribution gap worth chasing, and
 * only this field distinguishes them.
 */
export type ChatModelTelemetryClassificationSource = "explicit" | "default";

export interface ChatModelTelemetryContext {
    readonly phase: ChatModelTelemetryPhase;
    readonly purpose: ChatModelTelemetryPurpose;
    readonly scope: ChatModelTelemetryScope;
    readonly classificationSource: ChatModelTelemetryClassificationSource;
}

/**
 * What a call site may set. `classificationSource` is excluded on purpose:
 * calling {@link withChatModelTelemetryContext} *is* the explicit
 * classification, so the wrapper sets it and callers cannot claim (or forget)
 * it themselves.
 */
export type ChatModelTelemetryClassification = Partial<
    Omit<ChatModelTelemetryContext, "classificationSource">
>;

/**
 * Storage for the active classification.
 *
 * This deliberately does *not* ride on the OTel context. That context only
 * propagates when a global context manager is installed, and the telemetry
 * bootstrap installs one with the **traces** signal - so in a logs-only
 * process every classification would be dropped and every call would report
 * `default` however carefully call sites classify themselves, making the
 * attribution field useless exactly where logs are the only signal. Owning
 * storage here also keeps this out of the contest for the single global
 * context-manager slot, which the host application may want for its own
 * instrumentation.
 */
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

/**
 * Run `body` with the given LLM classification applied to every model call it
 * makes, including calls made from `await` continuations and microtasks.
 * Work that is deliberately detached from the caller - a promise chain started
 * outside this call, a worker thread, or a child process - does not inherit it
 * and has to classify itself at its own entry point.
 *
 * Fields the caller omits keep the enclosing context's value, so an inner
 * wrapper can refine `purpose` without restating the phase its caller set.
 */
export function withChatModelTelemetryContext<T>(
    classification: ChatModelTelemetryClassification,
    body: () => T,
): T {
    const next: ChatModelTelemetryContext = {
        ...getChatModelTelemetryContext(),
        ...classification,
        classificationSource: "explicit",
    };
    return classificationStore.run(next, body);
}

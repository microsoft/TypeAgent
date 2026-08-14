// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    createContextKey,
    type Context,
    type Span,
} from "@opentelemetry/api";
import { redactText, type RedactionOptions } from "./redaction.js";

/**
 * Stable span-name and attribute-key contract for TypeAgent-owned OTel
 * instrumentation.
 *
 * This module defines *only* names. It does not acquire a tracer, wrap
 * `@opentelemetry/api`, or provide a span type. Call sites use
 * `@opentelemetry/api` directly (see docs/architecture/telemetry/opentelemetry.md
 * for the design rationale that forbids a `TypeAgentSpan`).
 *
 * The helpers in this module make privacy review tractable. Span attributes
 * are restricted to the allowlisted keys declared here, and exceptions use
 * stable classifications instead of original messages and stacks by default.
 */

/**
 * Frozen span-name constants for the five phases of a TypeAgent request that
 * the Phase 1 core-trace work instruments. Names are namespaced under
 * `typeagent.*` per the design doc's guidance ("If names are unstable, use
 * documented `typeagent.*` instruments instead."). GenAI conventions are
 * carried on span *attributes* (see {@link TYPEAGENT_SPAN_ATTRIBUTES}) rather
 * than span names, since the GenAI conventions for span *names* are still in
 * flux.
 */
export const TYPEAGENT_SPAN_NAMES = Object.freeze({
    /** Root command/request span - the outermost boundary of a user request. */
    REQUEST: "typeagent.request",
    /** Natural-language-to-typed-action translation. */
    TRANSLATION: "typeagent.translation",
    /** Model reasoning/planning phase. */
    REASONING: "typeagent.reasoning",
    /** Dispatched agent action execution. */
    ACTION: "typeagent.action",
    /** One LLM call (not HTTP; the LLM operation). */
    LLM: "typeagent.llm",
} as const);

/** Type of a well-known TypeAgent span name value. */
export type TypeAgentSpanName =
    (typeof TYPEAGENT_SPAN_NAMES)[keyof typeof TYPEAGENT_SPAN_NAMES];

/**
 * Frozen attribute-key constants. Names track the design doc exactly:
 *
 * - `typeagent.agent.name`, `typeagent.action.name` - TypeAgent-owned.
 * - `gen_ai.system`, `gen_ai.request.model` - GenAI semantic conventions.
 * - `typeagent.session.id`, `typeagent.activation.id` - TypeAgent correlation.
 * - `typeagent.trace.id` - preserved caller trace id (OTel owns the canonical
 *   trace id; this attribute carries the value the caller previously used so
 *   existing logs can still be joined).
 */
export const TYPEAGENT_SPAN_ATTRIBUTES = Object.freeze({
    AGENT_NAME: "typeagent.agent.name",
    ACTION_NAME: "typeagent.action.name",
    GEN_AI_SYSTEM: "gen_ai.system",
    GEN_AI_REQUEST_MODEL: "gen_ai.request.model",
    SESSION_ID: "typeagent.session.id",
    ACTIVATION_ID: "typeagent.activation.id",
    TRACE_ID: "typeagent.trace.id",
} as const);

/** Type of a well-known TypeAgent attribute-key value. */
export type TypeAgentSpanAttributeKey =
    (typeof TYPEAGENT_SPAN_ATTRIBUTES)[keyof typeof TYPEAGENT_SPAN_ATTRIBUTES];

/**
 * The typed value bag that {@link setTypeAgentSpanAttributes} accepts.
 * Every field is optional; a caller sets only what it actually knows.
 * All values are strings by design: these are stable correlation
 * identifiers, not free-form data.
 */
export interface TypeAgentSpanAttributes {
    /** `typeagent.agent.name` - the dispatched agent's name (e.g. `player`). */
    readonly agentName?: string;
    /** `typeagent.action.name` - the typed action name inside the agent schema. */
    readonly actionName?: string;
    /** `gen_ai.system` - LLM provider system (e.g. `openai`, `azure_openai`). */
    readonly genAiSystem?: string;
    /** `gen_ai.request.model` - deployment or model name for the request. */
    readonly genAiRequestModel?: string;
    /** `typeagent.session.id` - TypeAgent session identifier. */
    readonly sessionId?: string;
    /** `typeagent.activation.id` - dispatcher activation id (not per request). */
    readonly activationId?: string;
    /**
     * `typeagent.trace.id` - the caller's pre-OTel trace id (preserved for
     * log correlation). OTel owns the canonical trace id.
     */
    readonly traceId?: string;
}

const ACTIVE_TYPEAGENT_ATTRIBUTES = createContextKey(
    "typeagent.active-span-attributes",
);

export function getActiveTypeAgentSpanAttributes():
    | TypeAgentSpanAttributes
    | undefined {
    return context.active().getValue(ACTIVE_TYPEAGENT_ATTRIBUTES) as
        | TypeAgentSpanAttributes
        | undefined;
}

export function setActiveTypeAgentSpanAttributes(
    activeContext: Context,
    attributes: TypeAgentSpanAttributes,
): Context {
    return activeContext.setValue(ACTIVE_TYPEAGENT_ATTRIBUTES, attributes);
}

const ATTRIBUTE_KEY_FOR_FIELD: {
    readonly [K in keyof TypeAgentSpanAttributes]-?: TypeAgentSpanAttributeKey;
} = {
    agentName: TYPEAGENT_SPAN_ATTRIBUTES.AGENT_NAME,
    actionName: TYPEAGENT_SPAN_ATTRIBUTES.ACTION_NAME,
    genAiSystem: TYPEAGENT_SPAN_ATTRIBUTES.GEN_AI_SYSTEM,
    genAiRequestModel: TYPEAGENT_SPAN_ATTRIBUTES.GEN_AI_REQUEST_MODEL,
    sessionId: TYPEAGENT_SPAN_ATTRIBUTES.SESSION_ID,
    activationId: TYPEAGENT_SPAN_ATTRIBUTES.ACTIVATION_ID,
    traceId: TYPEAGENT_SPAN_ATTRIBUTES.TRACE_ID,
};

/**
 * Set the TypeAgent-standard attributes on an OTel span.
 *
 * This is a helper, not a wrapper: it takes the span from the caller
 * (obtained through `@opentelemetry/api` directly) and mutates it. Callers
 * remain fully in control of the span lifecycle, status, exceptions, and
 * events.
 *
 * Behavior:
 *
 * - Only the allowlisted fields declared on {@link TypeAgentSpanAttributes}
 *   are considered. Any other property on the input object is ignored,
 *   which is what makes this a defensible privacy boundary: an untyped
 *   caller cannot smuggle prompt/response/user content through it.
 * - `undefined` and empty strings are dropped, not written as attributes.
 * - String values are run through {@link redactText} so a value that happens
 *   to contain a recognizable secret format is scrubbed before it reaches
 *   the OTel API. In practice these attributes should already be plain
 *   identifiers; redaction is defense in depth.
 * - The `setAttribute` call is guarded per attribute; a broken span
 *   implementation cannot prevent the remaining attributes from being set.
 */
export function setTypeAgentSpanAttributes(
    span: Span,
    attributes: TypeAgentSpanAttributes,
    options?: RedactionOptions,
): void {
    for (const field of Object.keys(
        ATTRIBUTE_KEY_FOR_FIELD,
    ) as (keyof TypeAgentSpanAttributes)[]) {
        const raw = attributes[field];
        if (typeof raw !== "string" || raw.length === 0) {
            continue;
        }
        const redacted = redactText(raw, options);
        if (redacted.length === 0) {
            continue;
        }
        span.setAttribute(ATTRIBUTE_KEY_FOR_FIELD[field], redacted);
    }
}

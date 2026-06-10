// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type StudioConversationTarget = "onboarding" | "schemaAuthor";

export interface StudioConversationContext {
    activePanel?: "wizard" | "schemaStudio" | "impactReport" | "traceViewer";
    selectedAgent?: string;
    filePath?: string;
}

export interface StudioConversationRoute {
    target: StudioConversationTarget;
    reason:
        | "create-agent-intent"
        | "schema-edit-intent"
        | "panel-default"
        | "fallback";
    prompt: string;
    context: StudioConversationContext;
}

const CREATE_AGENT_PATTERNS = [
    /\b(create|new|scaffold|bootstrap|generate)\b.*\b(agent|plugin|tool)\b/i,
    /\bonboard\b/i,
    /\bwizard\b/i,
];

const SCHEMA_AUTHOR_PATTERNS = [
    /\b(schema|grammar|action|manifest|collision|disambiguat|variant)\b/i,
    /\bfix\b.*\b(schema|grammar|action)\b/i,
];

/**
 * F0.7 lightweight conversational entry routing.
 *
 * Routes existing conversational paths to either `onboarding` or
 * `schemaAuthor` without introducing a new conversational agent.
 */
export function routeStudioConversation(
    prompt: string,
    context: StudioConversationContext = {},
): StudioConversationRoute {
    const normalized = prompt.trim();

    if (matchesAny(normalized, CREATE_AGENT_PATTERNS)) {
        return {
            target: "onboarding",
            reason: "create-agent-intent",
            prompt: normalized,
            context,
        };
    }

    if (matchesAny(normalized, SCHEMA_AUTHOR_PATTERNS)) {
        return {
            target: "schemaAuthor",
            reason: "schema-edit-intent",
            prompt: normalized,
            context,
        };
    }

    if (context.activePanel === "wizard") {
        return {
            target: "onboarding",
            reason: "panel-default",
            prompt: normalized,
            context,
        };
    }

    if (context.activePanel === "schemaStudio") {
        return {
            target: "schemaAuthor",
            reason: "panel-default",
            prompt: normalized,
            context,
        };
    }

    return {
        target: "schemaAuthor",
        reason: "fallback",
        prompt: normalized,
        context,
    };
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(text));
}

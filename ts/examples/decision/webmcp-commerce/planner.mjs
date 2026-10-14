// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { eligibleTools } from "./schema.mjs";

export const PLAN_BUDGET = 3;
export const MAX_INTENT_CHARS = 200;

const PLAN_WORDS = new Set([
    "a",
    "an",
    "and",
    "catalog",
    "details",
    "find",
    "food",
    "for",
    "in",
    "matching",
    "of",
    "only",
    "product",
    "products",
    "read",
    "search",
    "show",
    "the",
    "then",
    "to",
    "with",
]);

export const GENERATIVE_PLAN_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["subtasks"],
    properties: {
        subtasks: {
            type: "array",
            minItems: 1,
            maxItems: PLAN_BUDGET,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["intent"],
                properties: {
                    intent: {
                        type: "string",
                        minLength: 1,
                        maxLength: MAX_INTENT_CHARS,
                    },
                },
            },
        },
    },
};

export const GENERATIVE_PLAN_PROMPT = [
    "Decompose the original user request into at most 3 read-only subtasks.",
    "Return only JSON matching the schema. Each subtask has only an intent string.",
    "Do not choose tool names, argument values, product ids, store names, permissions, secrets, or selectors.",
    "Do not execute anything. Free-text arguments must later be exact spans of the original user text, not of your rewrite.",
    "Use only words from the original request plus the planning words find, show, details, search, read, matching, catalog, product, products, food.",
    "If the request asks to change state, do not add authority. The host will already have declined it.",
].join(" ");

export const GEN_ONLY_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["proposedTool", "note"],
    properties: {
        proposedTool: { type: "string", minLength: 1, maxLength: 80 },
        note: { type: "string", minLength: 1, maxLength: 200 },
    },
};

export const GEN_ONLY_PROMPT =
    "Propose one tool name for comparison only. Do not execute, add permissions, or invent arguments. The host will ignore the proposal for execution.";

const FORBIDDEN_KEY =
    /(^id$|_id$|permission|secret|token|password|selector|tool|store)/i;

export function validatePlan(original, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, reason: "plan_must_be_object" };
    }
    if (forbiddenKey(value)) return { ok: false, reason: "forbidden_field" };
    if (Object.keys(value).some((key) => key !== "subtasks")) {
        return { ok: false, reason: "forbidden_field" };
    }
    if (!Array.isArray(value.subtasks) || value.subtasks.length === 0) {
        return { ok: false, reason: "empty_plan" };
    }
    if (value.subtasks.length > PLAN_BUDGET) {
        return { ok: false, reason: "plan_budget_exceeded" };
    }
    const subtasks = [];
    for (const item of value.subtasks) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            return { ok: false, reason: "invalid_subtask" };
        }
        if (Object.keys(item).some((key) => key !== "intent")) {
            return { ok: false, reason: "forbidden_field" };
        }
        if (
            typeof item.intent !== "string" ||
            item.intent.length < 1 ||
            item.intent.length > MAX_INTENT_CHARS
        ) {
            return { ok: false, reason: "invalid_intent" };
        }
        if (!intentUsesOriginalWords(original, item.intent)) {
            return { ok: false, reason: "intent_introduces_entity" };
        }
        subtasks.push({ intent: item.intent });
    }
    return { ok: true, subtasks };
}

export function intentUsesOriginalWords(original, intent) {
    const originalWords = new Set(words(original));
    return words(intent).every(
        (word) => originalWords.has(word) || PLAN_WORDS.has(word),
    );
}

function words(text) {
    return text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

function forbiddenKey(value) {
    if (!value || typeof value !== "object") return false;
    for (const [key, nested] of Object.entries(value)) {
        if (FORBIDDEN_KEY.test(key) || forbiddenKey(nested)) return true;
    }
    return false;
}

export function assessGenOnlyProposal(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, reason: "invalid_proposal", executed: false };
    }
    if (
        Object.keys(value).some(
            (key) => !["proposedTool", "note"].includes(key),
        )
    ) {
        return { ok: false, reason: "forbidden_field", executed: false };
    }
    if (
        typeof value.proposedTool !== "string" ||
        typeof value.note !== "string" ||
        !value.proposedTool ||
        !value.note
    ) {
        return { ok: false, reason: "invalid_proposal", executed: false };
    }
    const eligible = eligibleTools().some(
        (tool) => tool.name === value.proposedTool,
    );
    return {
        ok: true,
        executed: false,
        mutated: false,
        proposedTool: value.proposedTool,
        eligible,
        note: value.note,
    };
}

export function plannerEvidence(original) {
    return {
        originalInput: original,
        eligibleReadOnlyTools: eligibleTools().map((tool) => tool.name),
        budget: PLAN_BUDGET,
        forbidden: [
            "tool arguments",
            "product ids",
            "store names",
            "permissions",
            "secrets",
            "selectors",
            "execution",
        ],
    };
}

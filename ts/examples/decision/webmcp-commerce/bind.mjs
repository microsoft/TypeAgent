// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DIETARY, PRODUCTS } from "./catalog.mjs";
import {
    eligibleTools,
    FIT_THRESHOLD,
    literalSpans,
    NO_FIT,
    NO_SPAN,
    NONE,
    productGrounded,
    toolByName,
    validateArguments,
} from "./schema.mjs";

export { productGrounded };

const STATE_CHANGE =
    /\b(add(?:\s+\w+){0,3}\s+to\s+(?:the\s+)?cart|add_to_cart|checkout|check\s*out|log\s*in|login|purchase|buy|charge|place\s+the\s+order|pay)\b/i;
const UNKNOWN_STORE = /\b(greenleaf|harbor foods|penny pantry)\b/i;
const UNSUPPORTED_DEPARTMENT = /\b(weapons|pharmacy|electronics)\b/i;

export function dietaryQuestion(tag) {
    return `dietary_${tag.replaceAll("-", "_")}`;
}

export function classifyRequest(original) {
    if (typeof original !== "string" || !original.trim()) {
        return { status: "no_fit", reason: "empty" };
    }
    if (STATE_CHANGE.test(original)) {
        return { status: "declined", reason: "state_changing_request" };
    }
    if (UNKNOWN_STORE.test(original)) {
        return { status: "no_fit", reason: "unknown_store" };
    }
    if (UNSUPPORTED_DEPARTMENT.test(original)) {
        return { status: "no_fit", reason: "unsupported_department" };
    }
    const hyphenated = original
        .toLowerCase()
        .match(/[a-z0-9]+(?:-[a-z0-9]+)+/g);
    if (hyphenated?.some((token) => !DIETARY.includes(token))) {
        return { status: "no_fit", reason: "unsupported_constraint" };
    }
    return { status: "candidate" };
}

export function looksMultiIntent(original) {
    return (
        /\b(details for|show details)\b/i.test(original) &&
        /\b(and|then)\b/i.test(original) &&
        /\b(find|search|any)\b/i.test(original)
    );
}

export function buildQuestions(original) {
    const spans = literalSpans(original);
    const tools = eligibleTools();
    const questions = {
        fit: {
            type: "noul",
            instructions:
                "Is exactly one eligible read-only tool sufficient, with no missing required argument and no state change?",
        },
        tool: {
            type: "choice",
            instructions:
                "Select one eligible read-only tool, or no_fit. Do not select a denied, unlisted, or state-changing tool.",
            criteria: {
                ...Object.fromEntries(
                    tools.map((tool) => [tool.name, tool.description]),
                ),
                [NO_FIT]:
                    "No eligible tool fits, arguments are missing, or the request is ambiguous.",
            },
        },
        department: {
            type: "choice",
            instructions:
                "Select the advertised department, or none if the user did not name one.",
            criteria: {
                ...Object.fromEntries(
                    toolByName("search_products").fields.department.values.map(
                        (value) => [value, value],
                    ),
                ),
                [NONE]: "No department constraint.",
            },
        },
        organic_specified: {
            type: "noul",
            instructions:
                "Does the original request explicitly constrain organic to true or false?",
        },
        organic: {
            type: "noul",
            instructions:
                "If organic is constrained, is the requested value true? Answer false when the user asks for not organic.",
        },
        query_span: {
            type: "choice",
            instructions:
                "Select an exact span id from the original user text, or no_span. Do not invent text.",
            criteria: Object.fromEntries(
                spans.map((span) => [
                    span.id,
                    span.id === NO_SPAN
                        ? "No free-text query."
                        : `Exact slice [${span.start},${span.end}): ${JSON.stringify(span.text)}`,
                ]),
            ),
        },
        product_id: {
            type: "choice",
            instructions:
                "Select a catalog product id only when its name is an exact span of the original request. Otherwise select none.",
            criteria: {
                ...Object.fromEntries(
                    PRODUCTS.map((product) => [
                        product.id,
                        `${product.name} (${product.department})`,
                    ]),
                ),
                [NONE]: "No catalog product name is an exact original span.",
            },
        },
    };
    for (const tag of DIETARY) {
        questions[dietaryQuestion(tag)] = {
            type: "noul",
            instructions: `Does the original request ask for the advertised dietary tag ${tag}?`,
        };
    }
    return { questions, spans, tools };
}

export function bindAnswers(
    original,
    response,
    spans = literalSpans(original),
) {
    const allowedTools = [...eligibleTools().map((tool) => tool.name), NO_FIT];
    const fit = predicate(response, "fit");
    const tool = choice(response, "tool", allowedTools);
    if (!fit.ok || !tool.ok) {
        return { status: "failed_closed", reason: "invalid_decision" };
    }
    if (fit.value < FIT_THRESHOLD || tool.value === NO_FIT) {
        return { status: "no_fit", reason: "fit_gate" };
    }
    const selected = toolByName(tool.value);
    if (!selected || selected.policy !== "allow" || !selected.readOnly) {
        return { status: "declined", reason: "tool_denied_before_execution" };
    }
    const args = {};
    if (selected.name === "search_products") {
        const search = bindSearch(selected, response, spans);
        if (search.status) return search;
        Object.assign(args, search.arguments);
    } else {
        const product = choice(response, "product_id", [
            ...PRODUCTS.map((item) => item.id),
            NONE,
        ]);
        if (!product.ok) {
            return { status: "failed_closed", reason: "invalid_decision" };
        }
        if (product.value === NONE) {
            return {
                status: "manual_handoff",
                reason: "missing_required",
                missing: ["product_id"],
            };
        }
        if (!productGrounded(original, product.value, spans)) {
            return {
                status: "manual_handoff",
                reason: "ungrounded_product",
                missing: ["product_id"],
            };
        }
        args.product_id = product.value;
    }
    const validated = validateArguments(selected, args, original, spans);
    if (!validated.ok) {
        return {
            status: "failed_closed",
            reason: validated.reason,
            field: validated.field,
        };
    }
    return {
        status: "bound",
        tool: selected.name,
        arguments: validated.value,
    };
}

function bindSearch(selected, response, spans) {
    const department = choice(response, "department", [
        ...selected.fields.department.values,
        NONE,
    ]);
    const query = choice(
        response,
        "query_span",
        spans.map((span) => span.id),
    );
    const specified = predicate(response, "organic_specified");
    const organic = predicate(response, "organic");
    if (!department.ok || !query.ok || !specified.ok || !organic.ok) {
        return { status: "failed_closed", reason: "invalid_decision" };
    }
    const args = {};
    if (department.value !== NONE) args.department = department.value;
    if (specified.value >= FIT_THRESHOLD) {
        args.organic = organic.value >= FIT_THRESHOLD;
    }
    const dietary = [];
    for (const tag of DIETARY) {
        const answer = predicate(response, dietaryQuestion(tag));
        if (!answer.ok) {
            return { status: "failed_closed", reason: "invalid_decision" };
        }
        if (answer.value >= FIT_THRESHOLD) dietary.push(tag);
    }
    if (dietary.length) args.dietary = dietary;
    const span = spans.find((item) => item.id === query.value);
    if (query.value !== NO_SPAN) args.query = span;
    if (!Object.keys(args).length) {
        return {
            status: "manual_handoff",
            reason: "missing_required",
            missing: ["department", "dietary", "organic", "query"],
        };
    }
    return { arguments: args };
}

function choice(response, name, allowed) {
    const answer = response?.answers?.[name];
    if (
        answer?.type !== "choice" ||
        typeof answer.choice !== "string" ||
        !allowed.includes(answer.choice)
    ) {
        return { ok: false };
    }
    return { ok: true, value: answer.choice };
}

function predicate(response, name) {
    const value = response?.answers?.[name]?.noul;
    if (
        response?.answers?.[name]?.type !== "noul" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1
    ) {
        return { ok: false };
    }
    return { ok: true, value };
}

export function decisionState(original, spans, subtaskIntent = null) {
    return {
        originalInput: original,
        subtaskIntent,
        eligibleTools: eligibleTools().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: Object.keys(tool.fields),
        })),
        spanCandidates: spans.map((span) => ({
            id: span.id,
            text: span.text,
            start: span.start,
            end: span.end,
        })),
        authority:
            "Select advertised ids only. Do not invent products, stores, selectors, permissions, or secrets.",
    };
}

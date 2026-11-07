// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ModelRequestConstraints } from "@typeagent/config";
import {
    isChatWireRequest,
    outputReservation,
    outputTokenLimitField,
    outputTokenLimitFields,
    RequestAdmissionError,
} from "./requestBudget.js";

type OutputField = (typeof outputTokenLimitFields)[number];
type OutputLimit = { tokens: number; field: OutputField };
export type OutputReduction = OutputLimit & {
    previousTokens: number;
    reason: "advertised" | "halved";
};

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function outputField(value: unknown): OutputField | undefined {
    return outputTokenLimitFields.find((field) => field === value);
}

function positiveInteger(value: unknown): number | undefined {
    const parsed =
        typeof value === "string" ? Number(value.replaceAll(",", "")) : value;
    return typeof parsed === "number" &&
        Number.isSafeInteger(parsed) &&
        parsed > 0
        ? parsed
        : undefined;
}

function providerError(text: string): Record<string, unknown> {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return { message: text };
    }
    const root = object(value);
    return (
        object(root?.error) ??
        (typeof root?.error === "string" ? { message: root.error } : root) ?? {
            message: text,
        }
    );
}

function advertisedCapacity(
    error: Record<string, unknown>,
    message: string,
    context: boolean,
): number | undefined {
    const fields = context
        ? ["context_tokens", "context_length", "max_context_tokens"]
        : [
              ...outputTokenLimitFields,
              "output_token_limit",
              "output_tokens_limit",
          ];
    fields.push("limit", "maximum", "capacity");
    for (const field of fields) {
        const value = positiveInteger(error[field]);
        if (value !== undefined) return value;
    }
    const patterns = context
        ? [
              /maximum context (?:length|window)(?: is| of|:)?\s*([\d,]+)\s*tokens/i,
              /context (?:length|window|limit).*?(?:maximum|limit|at most|up to|is|of|:)\s*([\d,]+)\s*tokens/i,
          ]
        : [
              /(?:at most|up to|maximum of)\s*([\d,]+)\s*(?:output|completion)?\s*tokens/i,
              /(?:maximum|max|limit)(?: supported)?(?: (?:output|completion))?(?: tokens?)?(?: is| of|:|=)?\s*([\d,]+)\s*(?:output|completion)?\s*tokens/i,
              /(?:max_tokens|max_completion_tokens|max_output_tokens).*?(?:<=|less than or equal to|at most|maximum|limit(?: is| of|:)?|must be (?:less than|under))\s*([\d,]+)/i,
              /(?:output|completion) token(?:s)? (?:capacity|limit|budget)(?: is| of|:|=)?\s*([\d,]+)/i,
          ];
    for (const pattern of patterns) {
        const match = pattern.exec(message);
        if (!match) continue;
        const value = positiveInteger(match[1]);
        if (value !== undefined) {
            return /must be (?:under|less than(?! or equal to))/i.test(match[0])
                ? value - 1
                : value;
        }
    }
    return undefined;
}

function capacityKind(
    error: Record<string, unknown>,
    message: string,
): "context" | "output" | undefined {
    const code = typeof error.code === "string" ? error.code.toLowerCase() : "";
    if (
        [
            "unsupported_parameter",
            "content_filter",
            "content_policy_violation",
        ].includes(code)
    )
        return undefined;
    if (
        code === "context_length_exceeded" ||
        /(?:maximum context (?:length|window)|context (?:length|window|limit).*(?:exceed|too (?:large|long)))/i.test(
            message,
        )
    )
        return "context";
    if (
        ["max_tokens_exceeded", "output_token_limit_exceeded"].includes(code) ||
        (outputField(error.param) !== undefined &&
            (["limit", "maximum", "capacity"].some(
                (field) => positiveInteger(error[field]) !== undefined,
            ) ||
                /(?:exceed|too large|maximum|limit|capacity|at most|less than|<=)/i.test(
                    message,
                ))) ||
        /(?:max_tokens|max_completion_tokens|max_output_tokens|output tokens?|completion tokens?).*(?:exceed|too large|maximum|limit|capacity|at most|less than|<=)/i.test(
            message,
        ) ||
        /(?:at most|maximum|limit|exceed).*(?:output|completion) tokens?/i.test(
            message,
        )
    )
        return "output";
    return undefined;
}

export class OutputCapacity {
    private learned: OutputLimit | undefined;
    private contextTokens: number | undefined;

    public constructor(private readonly defaultOutputTokens: number) {}

    public apply(options: RequestInit): RequestInit {
        if (!this.learned || typeof options.body !== "string") return options;
        const body: Record<string, unknown> = JSON.parse(options.body);
        const tokens = Math.min(
            this.learned.tokens,
            outputReservation(body, this.defaultOutputTokens),
            this.contextTokens === undefined
                ? Infinity
                : this.contextTokens -
                      Buffer.byteLength(options.body, "utf8") -
                      1024,
        );
        if (tokens < 1)
            throw new RequestAdmissionError(
                "Serialized prompt exceeds learned endpoint context capacity",
            );
        const field = outputTokenLimitField(body) ?? this.learned.field;
        return {
            ...options,
            body: JSON.stringify({ ...body, [field]: tokens }),
        };
    }

    public async reduce(
        response: Response,
        options: RequestInit,
    ): Promise<OutputReduction | undefined> {
        if (
            ![400, 413, 422].includes(response.status) ||
            typeof options.body !== "string"
        )
            return undefined;
        const body: Record<string, unknown> = JSON.parse(options.body);
        const error = providerError(await response.clone().text());
        const message = typeof error.message === "string" ? error.message : "";
        const kind = capacityKind(error, message);
        if (!kind) return undefined;
        const context = kind === "context";
        const previousTokens = outputReservation(
            body,
            this.defaultOutputTokens,
        );
        const capacity = advertisedCapacity(error, message, context);
        const tokens =
            capacity !== undefined
                ? context
                    ? capacity - Buffer.byteLength(options.body, "utf8") - 1024
                    : capacity
                : Math.floor(previousTokens / 2);
        if (
            !Number.isSafeInteger(tokens) ||
            tokens < 1 ||
            tokens >= previousTokens
        )
            return undefined;
        const field =
            outputTokenLimitField(body) ??
            outputField(error.param) ??
            ("input" in body ? "max_output_tokens" : "max_completion_tokens");
        const reduction: OutputReduction = {
            field,
            tokens,
            previousTokens,
            reason: capacity === undefined ? "halved" : "advertised",
        };
        this.learned = {
            field,
            tokens: Math.min(this.learned?.tokens ?? tokens, tokens),
        };
        if (context && capacity !== undefined)
            this.contextTokens = Math.min(
                this.contextTokens ?? capacity,
                capacity,
            );
        return reduction;
    }
}

const capacities = new WeakMap<object, Map<string, OutputCapacity>>();

export function getOutputCapacity(
    url: string,
    options: RequestInit | undefined,
    constraints: ModelRequestConstraints | undefined,
    owner: object | undefined,
): OutputCapacity | undefined {
    if (typeof options?.body !== "string" || !constraints?.outputTokens)
        return undefined;
    const body = object(JSON.parse(options.body));
    if (!body || !isChatWireRequest(body)) return undefined;
    const scope = owner ?? options;
    const key = JSON.stringify([url, body.model, "input" in body]);
    let endpoints = capacities.get(scope);
    if (!endpoints) {
        endpoints = new Map();
        capacities.set(scope, endpoints);
    }
    let capacity = endpoints.get(key);
    if (!capacity) {
        capacity = new OutputCapacity(constraints.outputTokens);
        endpoints.set(key, capacity);
    }
    return capacity;
}

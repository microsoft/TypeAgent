// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

function findBalancedJsonEnd(text: string, start: number): number | undefined {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index++) {
        const char = text[index]!;
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === "{" || char === "[") {
            stack.push(char);
            continue;
        }
        if (char !== "}" && char !== "]") continue;

        const opening = stack.pop();
        if (
            opening === undefined ||
            (char === "}" && opening !== "{") ||
            (char === "]" && opening !== "[")
        ) {
            return undefined;
        }
        if (stack.length === 0) return index;
    }
    return undefined;
}

function extractJsonCandidate(text: string): string | undefined {
    for (let start = 0; start < text.length; start++) {
        if (text[start] !== "{" && text[start] !== "[") continue;
        const end = findBalancedJsonEnd(text, start);
        if (end === undefined) continue;
        const candidate = text.slice(start, end + 1);
        try {
            JSON.parse(candidate);
            return candidate;
        } catch {
            // A prose brace or code fragment may precede the JSON payload.
        }
    }
    return undefined;
}

/** Extract the first complete JSON object or array from an LLM response. */
export function extractLlmJsonText(response: string): string {
    const text = response.trim();
    if (!text) {
        throw new Error("LLM response is empty");
    }

    const sources: string[] = [];
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
        if (match[1] !== undefined) sources.push(match[1].trim());
    }
    sources.push(text);

    for (const source of sources) {
        const candidate = extractJsonCandidate(source);
        if (candidate !== undefined) return candidate;
    }
    throw new Error("LLM response has no complete JSON object or array");
}

export function parseLlmJsonValue(response: string, label: string): unknown {
    try {
        return JSON.parse(extractLlmJsonText(response)) as unknown;
    } catch (error) {
        throw new Error(
            `${label} returned invalid JSON (retry): ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

export function parseLlmJsonWithZod<T>(
    response: string,
    schema: z.ZodType<T>,
    label: string,
): T {
    const value = parseLlmJsonValue(response, label);
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((issue) => {
                const path =
                    issue.path.length === 0 ? "$" : issue.path.join(".");
                return `${path}: ${issue.message}`;
            })
            .join("; ");
        throw new Error(`${label} JSON failed schema validation: ${detail}`);
    }
    return parsed.data;
}

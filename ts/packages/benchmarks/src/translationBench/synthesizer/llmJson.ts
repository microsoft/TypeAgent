// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Robust LLM JSON extraction + Zod validation.
 *
 * Accepts:
 * - raw JSON object/array text
 * - optional markdown fences: ```json ... ``` or ``` ... ```
 * - leading/trailing prose around a single fenced or balanced JSON value
 */

import { z } from "zod";

/**
 * Pull JSON text out of an LLM response. Fences are optional.
 * Prefers a fenced block when present; otherwise the first balanced
 * `{...}` or `[...]` span; otherwise the trimmed whole string.
 */
export function extractLlmJsonText(response: string): string {
    const trimmed = response.trim();
    if (!trimmed) {
        throw new Error("LLM response is empty");
    }

    const fencedBlocks = [
        ...trimmed.matchAll(/```(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)```/g),
    ];
    for (const match of fencedBlocks) {
        const body = match[1]?.trim();
        if (body && looksLikeJsonStart(body)) {
            return body;
        }
    }
    // Whole response is a single fence (no trailing junk after close).
    const wholeFence =
        /^```(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(trimmed);
    if (wholeFence?.[1] !== undefined) {
        const body = wholeFence[1].trim();
        if (body) return body;
    }

    const balanced = extractBalancedJsonSpan(trimmed);
    if (balanced !== undefined) {
        return balanced;
    }

    return trimmed;
}

function looksLikeJsonStart(text: string): boolean {
    const c = text[0];
    return c === "{" || c === "[";
}

/** First top-level `{...}` or `[...]` with string-aware brace matching. */
function extractBalancedJsonSpan(text: string): string | undefined {
    const startObj = text.indexOf("{");
    const startArr = text.indexOf("[");
    let start = -1;
    let open: "{" | "[" | undefined;
    let close: "}" | "]" | undefined;
    if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
        start = startObj;
        open = "{";
        close = "}";
    } else if (startArr >= 0) {
        start = startArr;
        open = "[";
        close = "]";
    } else {
        return undefined;
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
        const ch = text[i]!;
        if (inString) {
            if (escape) {
                escape = false;
            } else if (ch === "\\") {
                escape = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === open) {
            depth += 1;
        } else if (ch === close) {
            depth -= 1;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }
    return undefined;
}

export function parseLlmJsonValue(response: string, label: string): unknown {
    const jsonText = extractLlmJsonText(response);
    try {
        return JSON.parse(jsonText) as unknown;
    } catch (error) {
        throw new Error(
            `${label} returned invalid JSON: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

/**
 * Extract JSON from an LLM response (fences optional) and validate with Zod.
 */
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

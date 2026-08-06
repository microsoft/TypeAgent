// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";

/** First `{`/`[` … last matching `}`/`]`; caller retries if JSON.parse fails. */
export function extractLlmJsonText(response: string): string {
    let text = response.trim();
    if (!text) {
        throw new Error("LLM response is empty");
    }

    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    if (fence?.[1] !== undefined) {
        text = fence[1].trim();
    }

    const startObj = text.indexOf("{");
    const startArr = text.indexOf("[");
    let start = -1;
    let endChar = "";
    if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
        start = startObj;
        endChar = "}";
    } else if (startArr >= 0) {
        start = startArr;
        endChar = "]";
    } else {
        throw new Error("LLM response has no JSON object or array");
    }

    const end = text.lastIndexOf(endChar);
    if (end <= start) {
        throw new Error("LLM response JSON is unclosed");
    }
    return text.slice(start, end + 1);
}

export function parseLlmJsonValue(response: string, label: string): unknown {
    const jsonText = extractLlmJsonText(response);
    try {
        return JSON.parse(jsonText) as unknown;
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

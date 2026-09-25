// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * XML tag wrapping memory injected into a turn. Hooks skip a second
 * injection when the opening tag is already present.
 */
const MEMORY_CONTEXT_TAG = "typeagent-memory";
export const MEMORY_CONTEXT_MARKER = `<${MEMORY_CONTEXT_TAG}>`;

export type RecallAnswer = {
    type: "Answered" | "NoAnswer";
    answer?: string;
    whyNoAnswer?: string;
};

function formatMemoryContext(answer: string): string {
    return [
        MEMORY_CONTEXT_MARKER,
        "Relevant memory from earlier sessions in this workspace:",
        answer.trim(),
        `</${MEMORY_CONTEXT_TAG}>`,
    ].join("\n");
}

/**
 * Puts tagged memory before the prompt so the user's request stays last:
 *   <typeagent-memory>...use pnpm...</typeagent-memory>\n\nhow do I install?
 */
export function appendMemoryContext(prompt: string, answer: string): string {
    const trimmed = answer.trim();
    if (!trimmed || prompt.includes(MEMORY_CONTEXT_MARKER)) {
        return prompt;
    }
    return `${formatMemoryContext(trimmed)}\n\n${prompt}`;
}

export function readString(
    input: Record<string, unknown>,
    ...keys: string[]
): string | undefined {
    for (const key of keys) {
        const value = input[key];
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
    }
    return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}

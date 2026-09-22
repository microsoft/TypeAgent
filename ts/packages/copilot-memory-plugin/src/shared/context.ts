// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Marker prepended to memory injected into a turn. Hooks skip a second
 * injection when this marker is already present.
 */
export const MEMORY_CONTEXT_MARKER = "TYPEAGENT_MEMORY_CONTEXT";

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
    ].join("\n");
}

export function appendMemoryContext(prompt: string, answer: string): string {
    const trimmed = answer.trim();
    if (!trimmed || prompt.includes(MEMORY_CONTEXT_MARKER)) {
        return prompt;
    }
    return `${prompt}\n\n${formatMemoryContext(trimmed)}`;
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

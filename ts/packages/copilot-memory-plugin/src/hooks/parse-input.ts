// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asRecord, readString } from "../shared/context.js";
import type { PromptHookInput, StopHookInput } from "./types.js";

export function parsePromptInput(value: unknown): PromptHookInput {
    const input = asRecord(value);
    if (!input) {
        throw new Error("Hook input must be a JSON object.");
    }
    const prompt = readString(input, "prompt") ?? "";
    const transformed = readString(input, "transformedPrompt");
    const parsed: PromptHookInput = {
        timestamp:
            typeof input.timestamp === "number" ? input.timestamp : Date.now(),
        sessionId: readString(input, "sessionId") ?? "default",
        cwd: readString(input, "cwd") ?? process.cwd(),
        prompt,
    };
    return transformed ? { ...parsed, transformedPrompt: transformed } : parsed;
}

export function parseStopInput(value: unknown): StopHookInput {
    const input = asRecord(value);
    if (!input) {
        throw new Error("Hook input must be a JSON object.");
    }
    const parsed: StopHookInput = {
        timestamp:
            typeof input.timestamp === "number" ? input.timestamp : Date.now(),
        sessionId: readString(input, "sessionId") ?? "default",
        cwd: readString(input, "cwd") ?? process.cwd(),
    };
    const transcriptPath = readString(input, "transcriptPath");
    if (transcriptPath) {
        parsed.transcriptPath = transcriptPath;
    }
    const response = readString(input, "response", "lastAssistantMessage");
    if (response) {
        parsed.response = response;
    }
    if ("knowledge" in input) {
        parsed.knowledge = input.knowledge;
    }
    return parsed;
}

export function isTransformInput(input: PromptHookInput): boolean {
    return "transformedPrompt" in input;
}

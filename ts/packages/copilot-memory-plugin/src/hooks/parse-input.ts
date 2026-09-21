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
    const transformed = readString(
        input,
        "transformedPrompt",
        "transformed_prompt",
    );
    const parsed: PromptHookInput = {
        sessionId: readString(input, "sessionId", "session_id") ?? "default",
        cwd: readString(input, "cwd") ?? process.cwd(),
        prompt,
    };
    if (typeof input.timestamp === "number") {
        parsed.timestamp = input.timestamp;
    }
    if (transformed) {
        parsed.transformedPrompt = transformed;
    }
    return parsed;
}

export function parseStopInput(value: unknown): StopHookInput {
    const input = asRecord(value);
    if (!input) {
        throw new Error("Hook input must be a JSON object.");
    }
    const parsed: StopHookInput = {
        sessionId: readString(input, "sessionId", "session_id") ?? "default",
        cwd: readString(input, "cwd") ?? process.cwd(),
    };
    if (typeof input.timestamp === "number") {
        parsed.timestamp = input.timestamp;
    }
    const transcriptPath = readString(
        input,
        "transcriptPath",
        "transcript_path",
    );
    if (transcriptPath) {
        parsed.transcriptPath = transcriptPath;
    }
    const response = readString(
        input,
        "response",
        "lastAssistantMessage",
        "last_assistant_message",
    );
    if (response) {
        parsed.response = response;
    }
    if ("knowledge" in input) {
        parsed.knowledge = input.knowledge;
    }
    return parsed;
}

export function isTransformInput(input: PromptHookInput): boolean {
    return input.transformedPrompt !== undefined;
}

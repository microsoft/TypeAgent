// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * userPromptSubmitted: capture the request and recall.
 * userPromptTransformed: inject that recall into the model-facing prompt.
 *
 * Copilot CLI drops command-hook output from userPromptSubmitted, including
 * additionalContext. userPromptTransformed is the hook whose
 * modifiedTransformedPrompt actually reaches the model. Both are wired so
 * hosts that still honor additionalContext keep working.
 */

import { fileURLToPath } from "node:url";
import {
    appendMemoryContext,
    formatMemoryContext,
    type RecallAnswer,
} from "../shared/context.js";
import {
    withWorkspaceMemory,
    type MemoryClient,
} from "../shared/memory-client.js";
import { isTransformInput, parsePromptInput } from "./parse-input.js";
import { logHookError, readStdin, writeHookOutput } from "./stdio.js";
import type { HookOutput, PromptHookInput } from "./types.js";

export async function recallContext(
    client: MemoryClient,
    input: PromptHookInput,
): Promise<string> {
    const cached = await client.readRecallCache(input.sessionId, input.prompt);
    if (cached !== undefined) {
        return cached;
    }
    let answer: RecallAnswer;
    try {
        answer = await client.recall(input.prompt);
    } catch (error) {
        logHookError(error);
        return "";
    }
    const context = answer.type === "Answered" ? (answer.answer ?? "") : "";
    try {
        await client.writeRecallCache(input.sessionId, input.prompt, context);
    } catch (error) {
        logHookError(error);
    }
    return context;
}

export async function handleUserPromptSubmitted(
    input: PromptHookInput,
    client: MemoryClient,
): Promise<HookOutput> {
    const prompt = input.prompt.trim();
    if (!prompt) {
        return {};
    }
    const context = await recallContext(client, { ...input, prompt });
    try {
        await client.captureRequest(prompt);
    } catch (error) {
        logHookError(error);
    }
    if (!context.trim()) {
        return {};
    }
    return { additionalContext: formatMemoryContext(context) };
}

export async function handleUserPromptTransformed(
    input: PromptHookInput,
    client: MemoryClient,
): Promise<HookOutput> {
    const prompt = input.prompt.trim();
    const transformed = input.transformedPrompt ?? prompt;
    if (!prompt) {
        return {};
    }
    const context = await recallContext(client, { ...input, prompt });
    if (!context.trim()) {
        return {};
    }
    return {
        modifiedTransformedPrompt: appendMemoryContext(transformed, context),
    };
}

export async function routePromptHook(
    input: PromptHookInput,
    client: MemoryClient,
): Promise<HookOutput> {
    if (isTransformInput(input)) {
        return handleUserPromptTransformed(input, client);
    }
    return handleUserPromptSubmitted(input, client);
}

async function main(): Promise<void> {
    const input = parsePromptInput(JSON.parse(await readStdin()));
    const output = await withWorkspaceMemory(input.cwd, (client) =>
        routePromptHook(input, client),
    );
    writeHookOutput(output);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        logHookError(error);
        writeHookOutput({});
    });
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * userPromptSubmitted: capture the request only.
 * userPromptTransformed: recall memory and inject it into the model-facing
 * prompt.
 *
 * Copilot CLI drops command-hook output from userPromptSubmitted, so recall is
 * done once in userPromptTransformed, whose modifiedTransformedPrompt is the
 * text that actually reaches the model.
 */

import { fileURLToPath } from "node:url";
import { appendMemoryContext, type RecallAnswer } from "../shared/context.js";
import {
    withWorkspaceMemory,
    type MemoryClient,
} from "../shared/memory-client.js";
import { isTransformInput, parsePromptInput } from "./parse-input.js";
import { logHookError, readStdin, writeHookOutput } from "./stdio.js";
import type { HookOutput, PromptHookInput } from "./types.js";

async function recallContext(
    client: MemoryClient,
    prompt: string,
): Promise<string> {
    let answer: RecallAnswer;
    try {
        answer = await client.recall(prompt);
    } catch (error) {
        logHookError(error);
        return "";
    }
    return answer.type === "Answered" ? (answer.answer ?? "") : "";
}

export async function handleUserPromptSubmitted(
    input: PromptHookInput,
    client: MemoryClient,
): Promise<HookOutput> {
    const prompt = input.prompt.trim();
    if (!prompt) {
        return {};
    }
    try {
        await client.captureRequest(prompt);
    } catch (error) {
        logHookError(error);
    }
    return {};
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
    const context = await recallContext(client, prompt);
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

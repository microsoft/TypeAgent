// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    copilotApiSettingsFromConfig,
    openai,
    type ChatModel,
} from "@typeagent/aiclient";
import registerDebug from "debug";

const debug = registerDebug("typeagent:validation:timeout");

export const DEFAULT_GENERATION_MODEL = "gpt-5.6-sol";

/**
 * Default upper bound for a single generation LLM call.
 *
 * Generation runs while the dispatcher command lock is held, so a hung query
 * blocks the entire dispatcher. This bounds how long any one call can stall.
 */
export const DEFAULT_VALIDATION_QUERY_TIMEOUT_MS = 30_000;

export interface QueryOptions {
    model?: string;
}

export type QueryChatModelFactory = (
    modelName: string,
) => Pick<ChatModel, "complete">;

const createCopilotModel: QueryChatModelFactory = (modelName) =>
    openai.createChatModel(copilotApiSettingsFromConfig(modelName));

/**
 * Run a single-shot query through the Copilot transport and return its text,
 * enforcing a hard timeout.
 *
 * The model factory is injectable so callers can test generation offline.
 *
 * @throws if the query times out or produces no terminal result.
 */
export async function runQueryWithTimeout(
    prompt: string,
    options: QueryOptions = {},
    timeoutMs: number = DEFAULT_VALIDATION_QUERY_TIMEOUT_MS,
    modelFactory: QueryChatModelFactory = createCopilotModel,
): Promise<string> {
    const requestedModel = options.model;
    // Existing validation callers pass their former Claude default. Keep those
    // calls working while routing the provider-neutral API through Copilot.
    const modelName =
        requestedModel === undefined || requestedModel.startsWith("claude-")
            ? DEFAULT_GENERATION_MODEL
            : requestedModel;
    const model = modelFactory(modelName);
    return runWithTimeout(async (signal) => {
        const result = await model.complete(
            prompt,
            undefined,
            undefined,
            undefined,
            signal,
        );
        if (!result.success) {
            throw new Error(result.message);
        }
        return result.data;
    }, timeoutMs);
}

async function runWithTimeout(
    execute: (signal: AbortSignal) => Promise<string>,
    timeoutMs: number,
): Promise<string> {
    const abortController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            abortController.abort();
            reject(
                new Error(`Generation query timed out after ${timeoutMs}ms`),
            );
        }, timeoutMs);
    });

    const consume = execute(abortController.signal);

    consume.catch((error) => {
        debug(`query consumption settled after race: ${error}`);
    });

    try {
        return await Promise.race([consume, timeoutPromise]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

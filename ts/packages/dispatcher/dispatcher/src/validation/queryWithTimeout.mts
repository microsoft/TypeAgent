// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import registerDebug from "debug";

const debug = registerDebug("typeagent:validation:timeout");

/**
 * Default upper bound for a single grammar-validation LLM call.
 *
 * Grammar validation (adversary scoring, pattern refinement) runs while the
 * dispatcher command lock is held, so a hung query blocks the entire
 * dispatcher. This bounds how long any one call can stall.
 */
export const DEFAULT_VALIDATION_QUERY_TIMEOUT_MS = 30_000;

/**
 * Run a single-shot Claude Agent SDK query and return the final success result
 * text, enforcing a hard timeout.
 *
 * On timeout the underlying query is aborted (freeing its subprocess) and this
 * rejects, so callers fall back to a safe default instead of hanging forever.
 *
 * @throws if the query times out or produces no terminal result.
 */
export async function runQueryWithTimeout(
    prompt: string,
    options: Options,
    timeoutMs: number = DEFAULT_VALIDATION_QUERY_TIMEOUT_MS,
): Promise<string> {
    const abortController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            abortController.abort();
            reject(
                new Error(
                    `Grammar validation query timed out after ${timeoutMs}ms`,
                ),
            );
        }, timeoutMs);
    });

    const queryInstance = query({
        prompt,
        options: { ...options, abortController },
    });

    const consume = (async (): Promise<string> => {
        let responseText = "";
        for await (const message of queryInstance) {
            // Break on the first terminal result regardless of subtype so an
            // error/non-success result can't leave the stream open and hang.
            if (message.type === "result") {
                if (message.subtype === "success") {
                    responseText = message.result ?? "";
                }
                break;
            }
        }
        return responseText;
    })();

    // If the timeout wins the race, the consume promise may reject later when
    // the abort propagates — swallow it so it doesn't surface as an unhandled
    // rejection.
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

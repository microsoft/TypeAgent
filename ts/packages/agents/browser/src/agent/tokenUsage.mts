// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import { ActionTokenUsage } from "@typeagent/agent-sdk";

// Per-request LLM token accumulator propagated implicitly through the async
// call tree of executeBrowserAction. The browser agent has many LLM call
// sites spread across deep helper modules; using AsyncLocalStorage lets each
// of them attribute usage to the in-flight request without threading an
// accumulator parameter through every function, and stays correct even if
// multiple browser actions run concurrently.
const tokenUsageStore = new AsyncLocalStorage<ActionTokenUsage>();

// Runs `fn` with `usage` as the active accumulator for the duration of the
// (possibly async) call. LLM call sites reached during `fn` add their usage
// to it via hookModelTokenUsage().
export function runWithTokenUsage<T>(usage: ActionTokenUsage, fn: () => T): T {
    return tokenUsageStore.run(usage, fn);
}

// Minimal structural shape of the aiclient chat models used across this agent:
// they expose an optional completionCallback invoked with the raw completion
// response (which carries `.usage`).
type CompletionCallbackModel = {
    completionCallback?: ((params: any, data: any) => void) | undefined;
};

// Attaches the active request's token accumulator to a freshly created chat
// model. Composes with any existing completionCallback rather than replacing
// it. No-op when called outside of runWithTokenUsage (e.g. background work),
// so it is always safe to call right after creating a model. Accepts `unknown`
// so callers can pass models declared as TypeChatLanguageModel (which doesn't
// surface completionCallback in its type) without casts.
export function hookModelTokenUsage(model: unknown): void {
    const usage = tokenUsageStore.getStore();
    if (usage === undefined) {
        return;
    }
    const target = model as CompletionCallbackModel;
    const previous = target.completionCallback;
    target.completionCallback = (params: any, data: any) => {
        if (previous) {
            previous(params, data);
        }
        const stats = (data as any)?.usage;
        if (stats) {
            usage.prompt_tokens += stats.prompt_tokens ?? 0;
            usage.completion_tokens += stats.completion_tokens ?? 0;
            usage.total_tokens += stats.total_tokens ?? 0;
        }
    };
}

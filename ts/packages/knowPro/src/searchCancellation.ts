// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import type { ChatModel } from "@typeagent/aiclient";
import type { TypeChatLanguageModel } from "typechat";

const cancellation = new AsyncLocalStorage<AbortSignal>();

export function currentSearchAbortSignal(): AbortSignal | undefined {
    return cancellation.getStore();
}

export function runWithSearchCancellation<T>(
    signal: AbortSignal,
    operation: () => T,
): T {
    signal.throwIfAborted();
    return cancellation.run(signal, operation);
}

function isChatModel(model: TypeChatLanguageModel): model is ChatModel {
    return "completionSettings" in model;
}

export function cancellableSearchModel(
    model: TypeChatLanguageModel,
): TypeChatLanguageModel {
    return new Proxy(model, {
        get(target, property) {
            if (property === "complete")
                return async (
                    prompt: Parameters<TypeChatLanguageModel["complete"]>[0],
                ) => {
                    const signal = currentSearchAbortSignal();
                    signal?.throwIfAborted();
                    const result = isChatModel(target)
                        ? await target.complete(
                              prompt,
                              undefined,
                              undefined,
                              undefined,
                              signal,
                          )
                        : await target.complete(prompt);
                    signal?.throwIfAborted();
                    return result;
                };
            return Reflect.get(target, property, target);
        },
    });
}

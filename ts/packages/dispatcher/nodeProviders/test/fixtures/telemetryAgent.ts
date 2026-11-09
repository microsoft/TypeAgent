// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    AppAgent,
    AppAgentInitSettings,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResult } from "@typeagent/agent-sdk/helpers/action";

export function instantiate(): AppAgent {
    return {
        async initializeAgentContext(settings?: AppAgentInitSettings) {
            const callback = (settings?.options as { callback?: unknown })
                ?.callback;
            if (typeof callback !== "function") {
                throw new Error("Expected an initialization callback");
            }
            await callback();
        },
        async executeAction(action: TypeAgentAction, context: ActionContext) {
            switch (action.actionName) {
                case "succeed":
                    return createActionResult("success");
                case "fail":
                    throw new Error("fixture failure");
                case "cancel":
                    await waitForCancellation(context.abortSignal);
                    return createActionResult("unexpected completion");
                default:
                    throw new Error(
                        `Unknown fixture action: ${action.actionName}`,
                    );
            }
        },
    };
}

function waitForCancellation(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted === true) {
        return Promise.reject(
            signal.reason ??
                new DOMException("The operation was aborted.", "AbortError"),
        );
    }
    return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
            "abort",
            () =>
                reject(
                    signal.reason ??
                        new DOMException(
                            "The operation was aborted.",
                            "AbortError",
                        ),
                ),
            { once: true },
        );
    });
}

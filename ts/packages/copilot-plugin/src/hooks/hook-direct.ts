// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Scenario A: Direct handling hook.
 * Connects to TypeAgent, processes the command, and returns the response
 * directly — skipping the Copilot LLM entirely.
 */

import type { Dispatcher } from "@typeagent/agent-server-client";
import { awaitCommand } from "@typeagent/dispatcher-types";
import { collectMessage } from "../shared/message-formatter.js";
import {
    createClientIO,
    connectToTypeAgent,
} from "../shared/typeagent-client.js";
import type { HookInput, HookOutput } from "./types.js";

export async function handleDirect(input: HookInput): Promise<HookOutput> {
    // In direct mode every user submission goes to TypeAgent first.
    // If the dispatcher doesn't recognize an action below, we fall through
    // to the Copilot LLM by returning {}.
    const responseCollector = { messages: [] as string[] };
    const clientIO = createClientIO({
        onSetDisplay: (message) => {
            collectMessage(message, undefined, responseCollector);
        },
        onAppendDisplay: (message, mode) => {
            collectMessage(message, mode, responseCollector);
        },
    });

    let dispatcher: Dispatcher | null = null;
    try {
        dispatcher = await connectToTypeAgent(clientIO);
        const result = await awaitCommand(dispatcher, input.prompt);

        if (result?.cancelled) {
            return {};
        }

        const hasRecognizedAction = result?.actions?.some(
            (action) => action.actionName !== "unknown",
        );

        if (!hasRecognizedAction) {
            return {};
        }

        const responseContent =
            responseCollector.messages.length > 0
                ? responseCollector.messages.join("\n\n")
                : result?.lastError
                  ? `TypeAgent recognized the action but encountered an error: ${result.lastError}`
                  : "Request processed successfully.";

        return {
            handled: true,
            responseContent,
            handledBy: "typeagent",
        };
    } catch (error) {
        console.error("TypeAgent error:", error);
        return {};
    } finally {
        if (dispatcher) {
            await dispatcher.close();
        }
    }
}

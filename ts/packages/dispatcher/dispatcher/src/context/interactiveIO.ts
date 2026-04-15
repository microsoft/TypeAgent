// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandlerContext,
    getCommandResult,
    requestIdToString,
    getRequestId,
} from "./commandHandlerContext.js";
import { DisplayContent, MessageContent } from "@typeagent/agent-sdk";
import {
    RequestId,
    IAgentMessage,
    ClientIO,
} from "@typeagent/dispatcher-types";

export enum NotifyCommands {
    ShowSummary = "summarize",
    Clear = "clear",
    ShowUnread = "unread",
    ShowAll = "all",
}

function messageContentToString(content: MessageContent): string {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content[0])) {
        // Table
        return (content as string[][]).map((row) => row.join(" | ")).join("\n");
    }
    // Multiple lines
    return content.join("\n");
}

export function makeClientIOMessage(
    context: CommandHandlerContext,
    message: DisplayContent,
    requestId: RequestId,
    source: string,
    actionIndex?: number,
): IAgentMessage {
    if (
        typeof message === "object" &&
        !Array.isArray(message) &&
        message.kind === "error"
    ) {
        const commandResult = getCommandResult(context);
        if (commandResult !== undefined) {
            commandResult.lastError = messageContentToString(message.content);
        }
    }

    // Get the source icon (emoji) from the agent manifest
    let sourceIcon: string | undefined;
    try {
        if (context.agents.isAppAgentName(source)) {
            sourceIcon = context.agents.getAppAgentEmoji(source);
        }
    } catch {
        // If we can't get the emoji, that's okay - just leave it undefined
    }

    return {
        message,
        requestId,
        source,
        sourceIcon,
        actionIndex,
        metrics: context.metricsManager?.getMetrics(
            requestIdToString(requestId),
        ),
    };
}

export async function askYesNoWithContext(
    context: CommandHandlerContext,
    message: string,
    defaultValue: boolean = false,
) {
    if (context?.batchMode) {
        return defaultValue;
    }
    const defaultId = defaultValue ? 0 : 1;
    const index = await context.clientIO.question(
        getRequestId(context),
        message,
        ["Yes", "No"],
        defaultId,
    );
    return index === 0;
}

export const nullClientIO: ClientIO = {
    clear: () => {},
    exit: () => process.exit(0),
    setUserRequest: () => {},
    setDisplayInfo: () => {},
    setDisplay: () => {},
    appendDisplay: () => {},
    appendDiagnosticData: () => {},
    setDynamicDisplay: () => {},
    question: async (
        _requestId: RequestId | undefined,
        _message: string,
        _choices: string[],
        defaultId?: number,
    ) => defaultId ?? 0,
    proposeAction: async () => undefined,
    notify: () => {},
    openLocalView: async () => {},
    closeLocalView: async () => {},
    requestChoice: () => {},
    requestInteraction: () => {},
    interactionResolved: () => {},
    interactionCancelled: () => {},
    takeAction: (requestId: RequestId, action: string) => {
        throw new Error(`Action ${action} not supported`);
    },
};

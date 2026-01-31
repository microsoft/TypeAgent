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
    return context?.batchMode
        ? defaultValue
        : context.clientIO.askYesNo(
              getRequestId(context),
              message,
              defaultValue,
          );
}

export const nullClientIO: ClientIO = {
    clear: () => {},
    exit: () => process.exit(0),
    setDisplayInfo: () => {},
    setDisplay: () => {},
    appendDisplay: () => {},
    appendDiagnosticData: () => {},
    setDynamicDisplay: () => {},
    askYesNo: async (
        requestId: RequestId,
        message: string,
        defaultValue: boolean = false,
    ) => defaultValue,
    proposeAction: async () => undefined,
    popupQuestion: async () => {
        throw new Error("popupQuestion not implemented");
    },
    notify: () => {},
    openLocalView: async () => {},
    closeLocalView: async () => {},
    takeAction: (requestId: RequestId, action: string) => {
        throw new Error(`Action ${action} not supported`);
    },
};

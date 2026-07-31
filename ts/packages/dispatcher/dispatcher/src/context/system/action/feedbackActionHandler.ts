// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { FeedbackAction } from "../schema/feedbackActionSchema.js";

export function executeFeedbackAction(
    action: TypeAgentAction<FeedbackAction, "system.feedback">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "listFeedback":
            return executeCommandFromHandlers(
                handlers,
                ["list"],
                {
                    args: {},
                    flags: {
                        limit: action.parameters?.limit ?? 20,
                        all: action.parameters?.includeAllEntries ?? false,
                    },
                },
                context,
            );
        case "summarizeFeedback":
            return executeCommandFromHandlers(
                handlers,
                ["top"],
                {
                    args: {},
                    flags: {
                        limit: action.parameters?.categoryLimit ?? 10,
                    },
                },
                context,
            );
        case "filterFeedback":
            return executeCommandFromHandlers(
                handlers,
                ["filter"],
                {
                    args: {},
                    flags: {
                        ...(action.parameters?.rating === undefined
                            ? {}
                            : { rating: action.parameters.rating }),
                        ...(action.parameters?.category === undefined
                            ? {}
                            : { category: action.parameters.category }),
                        ...(action.parameters?.since === undefined
                            ? {}
                            : { since: action.parameters.since }),
                        ...(action.parameters?.until === undefined
                            ? {}
                            : { until: action.parameters.until }),
                        limit: action.parameters?.limit ?? 50,
                        all: action.parameters?.includeAllEntries ?? false,
                    },
                },
                context,
            );
        case "exportFeedback":
            return executeCommandFromHandlers(
                handlers,
                ["export"],
                {
                    args: { file: action.parameters.file },
                    flags: {
                        ...(action.parameters.format === undefined
                            ? {}
                            : { format: action.parameters.format }),
                        all: action.parameters.includeAllEntries ?? false,
                    },
                },
                context,
            );
        case "countFeedback":
            return executeCommandFromHandlers(
                handlers,
                ["count"],
                undefined,
                context,
            );
    }
}

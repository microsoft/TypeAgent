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
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { FeedbackAction } from "../schema/feedbackActionSchema.js";
import { CommandParams, actionParams, opt } from "./actionParams.js";

export function executeFeedbackAction(
    action: TypeAgentAction<FeedbackAction, "system.feedback">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    const execute = (commands: string[], params?: CommandParams) =>
        executeCommandFromHandlers(handlers, commands, params, context);
    const p = actionParams(action);

    switch (action.actionName) {
        case "listFeedback":
            return execute(["list"], {
                args: {},
                flags: {
                    limit: p.limit ?? 20,
                    all: p.includeAllEntries ?? false,
                },
            });
        case "summarizeFeedback":
            return execute(["top"], {
                args: {},
                flags: { limit: p.categoryLimit ?? 10 },
            });
        case "filterFeedback":
            return execute(["filter"], {
                args: {},
                flags: {
                    ...opt(p.rating, "rating"),
                    ...opt(p.category, "category"),
                    ...opt(p.since, "since"),
                    ...opt(p.until, "until"),
                    limit: p.limit ?? 50,
                    all: p.includeAllEntries ?? false,
                },
            });
        case "exportFeedback":
            return execute(["export"], {
                args: { file: p.file },
                flags: {
                    ...opt(p.format, "format"),
                    all: p.includeAllEntries ?? false,
                },
            });
        case "countFeedback":
            return execute(["count"], undefined);
        default:
            throw new Error(
                `Unknown feedback action: ${(action as FeedbackAction).actionName}`,
            );
    }
}

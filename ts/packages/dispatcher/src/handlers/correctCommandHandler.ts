// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { printProcessExplanationResult } from "agent-cache";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import {
    CommandHandler,
    ParsedCommandParams,
} from "@typeagent/agent-sdk/helpers/command";
import { ActionContext } from "@typeagent/agent-sdk";

export class CorrectCommandHandler implements CommandHandler {
    public readonly description = "Correct the last explanation";
    public readonly parameters = {
        args: {
            correction: {
                description: "Correction for the last explanation",
                implicitQuotes: true,
            },
        },
    };
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        if (systemContext.lastRequestAction === undefined) {
            throw new Error("No last request action to correct");
        }
        if (systemContext.lastExplanation === undefined) {
            throw new Error("No last explanation to correct");
        }
        const result = await systemContext.agentCache.correctExplanation(
            systemContext.lastRequestAction,
            systemContext.lastExplanation,
            params.args.correction,
        );
        printProcessExplanationResult(result);
    }
}

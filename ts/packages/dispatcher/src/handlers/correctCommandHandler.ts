// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { printProcessExplanationResult } from "agent-cache";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/commands";
import { ActionContext } from "@typeagent/agent-sdk";

export class CorrectCommandHandler implements CommandHandler {
    public readonly description = "Correct the last explanation";
    public async run(
        input: string,
        context: ActionContext<CommandHandlerContext>,
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
            input,
        );
        printProcessExplanationResult(result);
    }
}

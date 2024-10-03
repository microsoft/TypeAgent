// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { printProcessExplanationResult } from "agent-cache";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { CommandHandlerNoParse } from "@typeagent/agent-sdk/helpers/command";
import { ActionContext } from "@typeagent/agent-sdk";

export class CorrectCommandHandler implements CommandHandlerNoParse {
    public readonly description = "Correct the last explanation";
    public readonly parameters = true;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        input: string,
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

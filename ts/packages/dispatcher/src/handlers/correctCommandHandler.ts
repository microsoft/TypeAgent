// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { printProcessExplanationResult } from "agent-cache";
import { CommandHandler } from "./common/commandHandler.js";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";

export class CorrectCommandHandler implements CommandHandler {
    public readonly description = "Correct the last explanation";
    public async run(input: string, context: CommandHandlerContext) {
        if (context.lastRequestAction === undefined) {
            throw new Error("No last request action to correct");
        }
        if (context.lastExplanation === undefined) {
            throw new Error("No last explanation to correct");
        }
        const result = await context.agentCache.correctExplanation(
            context.lastRequestAction,
            context.lastExplanation,
            input,
        );
        printProcessExplanationResult(result);
    }
}

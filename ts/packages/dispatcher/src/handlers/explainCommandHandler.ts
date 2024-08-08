// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { log } from "node:console";
import { CommandHandler } from "./common/commandHandler.js";
import {
    CommandHandlerContext,
    updateCorrectionContext,
} from "./common/commandHandlerContext.js";
import { RequestAction, printProcessRequestActionResult } from "agent-cache";

export class ExplainCommandHandler implements CommandHandler {
    public readonly description = "Explain a translated request with action";
    public async run(input: string, context: CommandHandlerContext) {
        const requestAction = RequestAction.fromString(input);
        context.requestIO.status(
            `Generating explanation for '${requestAction}'`,
        );
        const result = await context.agentCache.processRequestAction(
            requestAction,
            false,
        );
        updateCorrectionContext(
            context,
            requestAction,
            result.explanationResult.explanation,
        );
        context.requestIO.result((log) => {
            printProcessRequestActionResult(result, log);
        });
    }
}

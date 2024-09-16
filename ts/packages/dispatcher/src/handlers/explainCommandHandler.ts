// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { CommandHandler } from "@typeagent/agent-sdk/helpers/commands";
import {
    CommandHandlerContext,
    updateCorrectionContext,
} from "./common/commandHandlerContext.js";
import { RequestAction, printProcessRequestActionResult } from "agent-cache";
import { ActionContext } from "@typeagent/agent-sdk";
import { displayResult, displayStatus } from "./common/interactiveIO.js";

export class ExplainCommandHandler implements CommandHandler {
    public readonly description = "Explain a translated request with action";
    public async run(
        input: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const requestAction = RequestAction.fromString(input);
        displayStatus(`Generating explanation for '${requestAction}'`, context);
        const systemContext = context.sessionContext.agentContext;
        const result = await systemContext.agentCache.processRequestAction(
            requestAction,
            false,
        );
        updateCorrectionContext(
            systemContext,
            requestAction,
            result.explanationResult.explanation,
        );
        displayResult((log) => {
            printProcessRequestActionResult(result, log);
        }, context);
    }
}

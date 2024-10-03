// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { CommandHandlerNoParse } from "@typeagent/agent-sdk/helpers/command";
import {
    CommandHandlerContext,
    updateCorrectionContext,
} from "./common/commandHandlerContext.js";
import { RequestAction, printProcessRequestActionResult } from "agent-cache";
import { ActionContext } from "@typeagent/agent-sdk";
import {
    displayResult,
    displayStatus,
} from "@typeagent/agent-sdk/helpers/display";

export class ExplainCommandHandler implements CommandHandlerNoParse {
    public readonly description = "Explain a translated request with action";
    public readonly parameters = true;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        input: string,
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

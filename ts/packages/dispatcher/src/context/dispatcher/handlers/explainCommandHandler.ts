// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayStatus,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { RequestAction, printProcessRequestActionResult } from "agent-cache";

export class ExplainCommandHandler implements CommandHandler {
    public readonly description = "Explain a translated request with action";
    public readonly parameters = {
        args: {
            requestAction: {
                description: "Request to explain",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const requestAction = RequestAction.fromString(
            params.args.requestAction,
        );
        displayStatus(`Generating explanation for '${requestAction}'`, context);
        const systemContext = context.sessionContext.agentContext;
        const result = await systemContext.agentCache.processRequestAction(
            requestAction,
            false,
        );
        displayResult((log) => {
            printProcessRequestActionResult(result, log);
        }, context);
    }
}

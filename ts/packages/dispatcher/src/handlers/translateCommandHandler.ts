// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler } from "@typeagent/agent-sdk/helpers/commands";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { translateRequest } from "./requestCommandHandler.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { displaySuccess } from "./common/interactiveIO.js";

export class TranslateCommandHandler implements CommandHandler {
    public readonly description = "Translate a request";
    public async run(
        request: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        const requestAction = await translateRequest(
            request,
            context.sessionContext.agentContext,
        );
        displaySuccess(`${requestAction}`, context);
    }
}

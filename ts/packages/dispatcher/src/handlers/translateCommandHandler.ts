// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { translateRequest } from "./requestCommandHandler.js";
import { ActionContext } from "@typeagent/agent-sdk";
import { CommandHandlerNoParse } from "@typeagent/agent-sdk/helpers/command";
import { displaySuccess } from "@typeagent/agent-sdk/helpers/display";

export class TranslateCommandHandler implements CommandHandlerNoParse {
    public readonly description = "Translate a request";
    public readonly parameters = true;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        request: string,
    ) {
        const requestAction = await translateRequest(request, context);
        displaySuccess(`${requestAction}`, context);
    }
}

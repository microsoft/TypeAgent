// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler } from "./common/commandHandler.js";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { translateRequest } from "./requestCommandHandler.js";

export class TranslateCommandHandler implements CommandHandler {
    public readonly description = "Translate a request";
    public async run(request: string, context: CommandHandlerContext) {
        const requestAction = await translateRequest(request, context);
        console.log(requestAction);
    }
}

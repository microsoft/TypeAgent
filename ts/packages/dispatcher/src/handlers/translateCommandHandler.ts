// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DispatcherCommandHandler } from "./common/commandHandler.js";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import { translateRequest } from "./requestCommandHandler.js";

export class TranslateCommandHandler implements DispatcherCommandHandler {
    public readonly description = "Translate a request";
    public async run(request: string, context: CommandHandlerContext) {
        const requestAction = await translateRequest(request, context);
        context.requestIO.success(`${requestAction}`);
    }
}

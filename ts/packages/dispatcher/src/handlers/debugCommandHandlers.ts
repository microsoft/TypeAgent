// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler } from "@typeagent/agent-sdk/helpers/commands";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import inspector from "node:inspector";
import { ActionContext } from "@typeagent/agent-sdk";
import { displayWarn } from "./common/interactiveIO.js";

export class DebugCommandHandler implements CommandHandler {
    public readonly description = "Start node inspector";
    private debugging = false;
    public async run(
        input: string,
        context: ActionContext<CommandHandlerContext>,
    ) {
        if (this.debugging) {
            displayWarn("Node inspector already started", context);
            return;
        }
        inspector.open(undefined, undefined, true);
        this.debugging = true;
    }
}

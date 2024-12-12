// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandlerNoParams } from "@typeagent/agent-sdk/helpers/command";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import inspector from "node:inspector";
import { ActionContext } from "@typeagent/agent-sdk";
import {
    displayStatus,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";

export class DebugCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Start node inspector";
    private debugging = false;
    public async run(context: ActionContext<CommandHandlerContext>) {
        if (this.debugging) {
            displayWarn("Node inspector already started.", context);
            return;
        }
        displayStatus("Waiting for debugger to attach", context);
        inspector.open(undefined, undefined, true);
        this.debugging = true;
        displaySuccess("Debugger attached", context);
    }
}

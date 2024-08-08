// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandHandler } from "./common/commandHandler.js";
import { CommandHandlerContext } from "./common/commandHandlerContext.js";
import inspector from "node:inspector";

export class DebugCommandHandler implements CommandHandler {
    public readonly description = "Start node inspector";
    private debugging = false;
    public async run(input: string, context: CommandHandlerContext) {
        if (this.debugging) {
            console.log("Node inspector already started");
            return;
        }
        inspector.open(undefined, undefined, true);
        this.debugging = true;
    }
}

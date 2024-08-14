// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { log } from "node:console";
import { CommandHandler } from "./common/commandHandler.js";
import {
    CommandHandlerContext,
    updateCorrectionContext,
} from "./common/commandHandlerContext.js";
import { RequestAction, printProcessRequestActionResult } from "agent-cache";
import fs from "node:fs";

export class RandomCommandHandler implements CommandHandler {
    public readonly description = "Issues a random user request.";
    public async run(input: string, context: CommandHandlerContext) {
        
        let list = await this.getRequests();
        
        // const requestAction = RequestAction.fromString(input);
        // context.requestIO.status(
        //     `Generating random request...`,
        // );
        // const result = await context.agentCache.processRequestAction(
        //     requestAction,
        //     false,
        // );
        // updateCorrectionContext(
        //     context,
        //     requestAction,
        //     result.explanationResult.explanation,
        // );
        // context.requestIO.result((log) => {
        //     printProcessRequestActionResult(result, log);
        // });
    }

    public async getRequests(): Promise<string[]> {
        
        if (fs.existsSync("../dispatcher/data/requests.txt")) {
            const content = await fs.promises.readFile("../dispatcher/data/requests.txt", "utf-8");
            return content.split(`\r\n`);
        }

        return new Array();
    }
}

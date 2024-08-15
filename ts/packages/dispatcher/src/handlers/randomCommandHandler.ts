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
import { randomInt } from "crypto";
import { request } from "node:http";
import { processCommandNoLock } from "../command.js";

export class RandomCommandHandler implements CommandHandler {
    private list: string[] | undefined;
    
    public readonly description = "Issues a random user request.";
    public async run(input: string, context: CommandHandlerContext) {

        context.requestIO.status(
            `Generating random request...`,
        );
        
        if (this.list == undefined) {
            this.list = await this.getRequests();
        }
        
        const randomRequest = this.list[randomInt(0, this.list.length)];
        
        context.requestIO.notify("randomCommandSelected", { message: randomRequest });
        
        await processCommandNoLock(randomRequest, context, context.requestId);
    }

    public async getRequests(): Promise<string[]> {
        
        if (fs.existsSync("../dispatcher/data/requests.txt")) {
            const content = await fs.promises.readFile("../dispatcher/data/requests.txt", "utf-8");
            return content.split("\n");
        }

        return new Array();
    }
}

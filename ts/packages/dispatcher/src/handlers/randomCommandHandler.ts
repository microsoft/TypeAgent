// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { log } from "node:console";
import { CommandHandler, HandlerTable } from "./common/commandHandler.js";
import {
    CommandHandlerContext,
    updateCorrectionContext,
} from "./common/commandHandlerContext.js";
import { RequestAction, printProcessRequestActionResult } from "agent-cache";
import fs from "node:fs";
import { randomInt } from "crypto";
import { request } from "node:http";
import { processCommandNoLock } from "../command.js";

export interface UserRequest {
    message: string;
}

class RandomOfflineCommandHandler implements CommandHandler {
    private list: string[] | undefined;

    public readonly description =
        "Issues a random request from a dataset of pre-generated requests.";

    public async run(request: string, context: CommandHandlerContext) {

        context.requestIO.status(
            `Selecting random request...`,
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

class RandomOnlineCommandHandler implements CommandHandler {
    private list: string[] | undefined;

    public readonly description =
        "Uses the LLM to generate a random request.";

    public async run(request: string, context: CommandHandlerContext) {

        context.requestIO.status(
            `Generating random request using LLM...`,
        );

        // TODO: impelement
    }
}

export function getRandomCommandHandlers(): HandlerTable {
    return {
        description: "Random request commands",
        defaultCommand: new RandomOfflineCommandHandler(),
        commands: {
            online: new RandomOnlineCommandHandler(),
            offline: new RandomOfflineCommandHandler(),
            default: new RandomOfflineCommandHandler(),
        },
    };
}

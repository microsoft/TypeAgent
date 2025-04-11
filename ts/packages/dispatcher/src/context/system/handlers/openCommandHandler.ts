// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { displayError, displaySuccess } from "@typeagent/agent-sdk/helpers/display";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { existsSync } from "fs";
import { getUserDataDir } from "../../../helpers/userData.js";
import path from "path";

export class OpenCommandHandler implements CommandHandler {
    public readonly description = "Shortcut for opening system related folders"
    public readonly parameters = {
        args: {
            folder: {
                description: "The name or path of the folder to open",
                type: "string",
                multiple: false,
                optional: false,
            },
        }
    } as const;

    public async run(context: ActionContext<CommandHandlerContext>, params: ParsedCommandParams<typeof this.parameters>) {
        let folder = params.args.folder.toLowerCase();

        // did the user supply a valid path
        if (!existsSync(folder)) {

            // did the user mean something type agent specific?
            switch(folder) {
                case "typeagent":
                    folder = getUserDataDir();
                    break;
                case "session":                    
                    folder = context.sessionContext.agentContext.session.sessionDirPath ? context.sessionContext.agentContext.session.sessionDirPath : "";
                    break;
                default:
                    // does the user want a specific agent folder?
                    const agentNames = context.sessionContext.agentContext.agents.getAppAgentNames();
                    agentNames.map((value) => value.toLocaleLowerCase());

                    if (agentNames.indexOf(folder) !== -1) {
                        //const agent: AppAgent = context.sessionContext.agentContext.agents.getAppAgent(folder);
                        const sessionFolder = context.sessionContext.agentContext.session.sessionDirPath ? context.sessionContext.agentContext.session.sessionDirPath : "";
                        folder = path.join(sessionFolder, folder);
                    } else {
                        // did the user specify a environment variable?
                        if (folder.startsWith("%") || folder.startsWith("$")) {
                            folder = folder.substring(1);
                        }

                        if (folder.endsWith("%")) {
                            folder = folder.substring(0, folder.length - 1);
                        }

                        if (process.env[folder]) {
                            folder = process.env[folder]!;
                        }
                    }

                    break;
            }
        }

        if (!existsSync(folder)) {
            // couldn't find what the user was referring to
            displayError(`Unable to open the requested item: '${folder}'`, context);            
            return;            
        }

        // user provided valid path or something we could turn into a valid path
        context.actionIO.takeAction("open-folder", folder);
        displaySuccess(`Opened ${folder}`, context);
    }
}
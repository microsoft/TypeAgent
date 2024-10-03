// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAgentCommandInterface } from "@typeagent/agent-sdk";
import {
    getCommandInterface,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { PlayerActionContext } from "./playerHandlers.js";
import { loadHistoryFile } from "../client.js";

const handlers: CommandHandlerTable = {
    description: "Player App Agent Commands",
    commands: {
        spotify: {
            description: "Configure spotify integration",
            defaultSubCommand: undefined,
            commands: {
                load: {
                    description: "Load spotify user data",
                    run: async (
                        context: ActionContext<PlayerActionContext>,
                        request: string,
                    ) => {
                        if (request === "") {
                            throw new Error("No file specified.");
                        }
                        const sessionContext = context.sessionContext;
                        const agentContext = sessionContext.agentContext;
                        if (agentContext.spotify === undefined) {
                            throw new Error(
                                "Spotify integration is not enabled.",
                            );
                        }
                        context.actionIO.setDisplay(
                            "Loading Spotify user data...",
                        );

                        await loadHistoryFile(
                            sessionContext.profileStorage,
                            request,
                            agentContext.spotify,
                        );

                        context.actionIO.setDisplay(
                            "Spotify user data loaded.",
                        );
                    },
                },
            },
        },
    },
};

export function getPlayerCommandInterface(): AppAgentCommandInterface {
    return getCommandInterface(handlers);
}

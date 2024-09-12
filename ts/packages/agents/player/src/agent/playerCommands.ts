// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import {
    getCommandInterface,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/commands";
import { PlayerActionContext } from "./playerHandlers.js";
import { loadHistoryFile } from "../client.js";
import { AppAgentCommandInterface } from "../../../../agentSdk/dist/agentInterface.js";

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
                        request: string,
                        context: ActionContext<PlayerActionContext>,
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
                        context.actionIO.setActionDisplay(
                            "Loading Spotify user data...",
                        );

                        await loadHistoryFile(
                            sessionContext.profileStorage,
                            request,
                            agentContext.spotify,
                        );

                        context.actionIO.setActionDisplay(
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

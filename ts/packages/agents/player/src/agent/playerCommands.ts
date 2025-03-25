// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgentCommandInterface,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import {
    getCommandInterface,
    CommandHandlerTable,
    CommandHandler,
} from "@typeagent/agent-sdk/helpers/command";
import {
    disableSpotify,
    enableSpotify,
    PlayerActionContext,
} from "./playerHandlers.js";
import { loadHistoryFile } from "../client.js";
import {
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";

const loadHandlerParameters = {
    args: {
        file: {
            description: "File to load",
        },
    },
} as const;
const loadHandler: CommandHandler = {
    description: "Load spotify user data",
    parameters: loadHandlerParameters,
    run: async (
        context: ActionContext<PlayerActionContext>,
        params: ParsedCommandParams<typeof loadHandlerParameters>,
    ) => {
        const sessionContext = context.sessionContext;
        const agentContext = sessionContext.agentContext;
        if (agentContext.spotify === undefined) {
            throw new Error("Spotify integration is not enabled.");
        }

        if (sessionContext.instanceStorage === undefined) {
            throw new Error("User data storage disabled.");
        }
        context.actionIO.setDisplay("Loading Spotify user data...");

        await loadHistoryFile(
            sessionContext.instanceStorage,
            params.args.file,
            agentContext.spotify,
        );

        context.actionIO.setDisplay("Spotify user data loaded.");
    },
};
const handlers: CommandHandlerTable = {
    description: "Player App Agent Commands",
    commands: {
        spotify: {
            description: "Configure spotify integration",
            commands: {
                load: loadHandler,
                login: {
                    description: "Login to Spotify",
                    run: async (
                        context: ActionContext<PlayerActionContext>,
                    ) => {
                        const sessionContext = context.sessionContext;
                        const agentContext = sessionContext.agentContext;
                        const clientContext = agentContext.spotify;
                        if (clientContext !== undefined) {
                            const user =
                                clientContext.service.retrieveUser().username;
                            displayWarn(
                                `Already logged in to Spotify as ${user}`,
                                context,
                            );
                            return;
                        }
                        const user = await enableSpotify(sessionContext);
                        displaySuccess(
                            `Logged in to Spotify as ${user}`,
                            context,
                        );
                    },
                },
                logout: {
                    description: "Logout from Spotify",
                    run: async (
                        context: ActionContext<PlayerActionContext>,
                    ) => {
                        const sessionContext = context.sessionContext;
                        const agentContext = sessionContext.agentContext;
                        if (agentContext.spotify === undefined) {
                            displayWarn("Not logged in to Spotify.", context);
                            return;
                        }

                        disableSpotify(sessionContext, true);
                        displaySuccess("Logged out from Spotify.", context);
                    },
                },
            },
        },
    },
};

export function getPlayerCommandInterface(): AppAgentCommandInterface {
    return getCommandInterface(handlers);
}

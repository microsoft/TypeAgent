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
    PlayerActionContext,
    runLoadSpotifyUserData,
    runSpotifyLogin,
    runSpotifyLogout,
} from "./playerHandlers.js";

const loadHandlerParameters = {
    args: {
        file: {
            description:
                "File or directory to load (a directory loads all Spotify streaming history .json files in it)",
        },
    },
} as const;
const loadHandler: CommandHandler = {
    description: "Load spotify user data",
    action: "loadSpotifyUserData",
    parameters: loadHandlerParameters,
    run: async (
        context: ActionContext<PlayerActionContext>,
        params: ParsedCommandParams<typeof loadHandlerParameters>,
    ) => {
        return runLoadSpotifyUserData(context, params.args.file);
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
                    action: "spotifyLogin",
                    run: async (
                        context: ActionContext<PlayerActionContext>,
                    ) => {
                        return runSpotifyLogin(context);
                    },
                },
                logout: {
                    description: "Logout from Spotify",
                    action: "spotifyLogout",
                    run: async (
                        context: ActionContext<PlayerActionContext>,
                    ) => {
                        return runSpotifyLogout(context);
                    },
                },
            },
        },
    },
};

export function getPlayerCommandInterface(): AppAgentCommandInterface {
    return getCommandInterface(handlers);
}

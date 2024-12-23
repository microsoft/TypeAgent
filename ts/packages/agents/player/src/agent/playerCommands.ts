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
import { PlayerActionContext } from "./playerHandlers.js";
import { loadHistoryFile } from "../client.js";

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
            },
        },
    },
};

export function getPlayerCommandInterface(): AppAgentCommandInterface {
    return getCommandInterface(handlers);
}

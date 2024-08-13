// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandlerContext,
    changeContextConfig,
} from "./common/commandHandlerContext.js";
import { HandlerTable } from "./common/commandHandler.js";
import { loadHistoryFile } from "music";
import path from "node:path";
import { getUserProfileDir } from "../utils/userData.js";
import { getStorage } from "../action/storageImpl.js";

export function getSpotifyConfigCommandHandlers(): HandlerTable {
    return {
        description: "Configure spotify integration",
        commands: {
            off: {
                description: "Turn off spotify integration",
                run: async (
                    request: string,
                    context: CommandHandlerContext,
                ) => {
                    await changeContextConfig(
                        { actions: { player: false } },
                        context,
                    );
                },
            },
            on: {
                description: "Turn on spotify integration.",
                run: async (
                    request: string,
                    context: CommandHandlerContext,
                ) => {
                    await changeContextConfig(
                        { actions: { player: true } },
                        context,
                    );
                },
            },
            load: {
                description: "Load spotify user data",
                run: async (
                    request: string,
                    context: CommandHandlerContext,
                ) => {
                    if (context.action.player.spotify) {
                        const historyPath = path.isAbsolute(request)
                            ? request
                            : path.join(getUserProfileDir(), request);
                        await loadHistoryFile(
                            getStorage("player", getUserProfileDir()),
                            historyPath,
                            context.action.player.spotify,
                        );
                    } else {
                        context.requestIO.error(
                            "Spotify integration is not enabled.",
                        );
                    }
                },
            },
        },
    };
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IClientContext,
    getClientContext,
    PlayerAction,
    handleCall,
    PlayAction,
} from "music";
import chalk from "chalk";
import {
    AppAgent,
    SessionContext,
    AppAction,
    ActionContext,
    DisplayType,
    AppAgentEvent,
    DynamicDisplay,
} from "@typeagent/agent-sdk";
import { createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import { searchAlbum, searchArtists, searchTracks } from "../client.js";
import { htmlStatus } from "../playback.js";
import { getPlayerCommandInterface } from "./playerCommands.js";

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializePlayerContext,
        updateAgentContext: updatePlayerContext,
        executeAction: executePlayerAction,
        validateWildcardMatch: validatePlayerWildcardMatch,
        getDynamicDisplay: getPlayerDynamicDisplay,
        ...getPlayerCommandInterface(),
        getActionCompletion: getPlayerActionCompletion,
    };
}

export type PlayerActionContext = {
    spotify: IClientContext | undefined;
};

async function initializePlayerContext() {
    return {
        spotify: undefined,
    };
}

async function executePlayerAction(
    action: AppAction,
    context: ActionContext<PlayerActionContext>,
) {
    if (context.sessionContext.agentContext.spotify) {
        return handleCall(
            action as PlayerAction,
            context.sessionContext.agentContext.spotify,
            context.actionIO,
        );
    }

    return createActionResultFromError(
        "Action translated but not performed. Spotify integration is not enabled.",
    );
}

async function updatePlayerContext(
    enable: boolean,
    context: SessionContext<PlayerActionContext>,
) {
    if (enable) {
        const user = await enableSpotify(context);
        context.notify(
            AppAgentEvent.Info,
            chalk.blue(`Spotify integration enabled. Logged in as ${user}.`),
        );
    } else {
        const timeoutId = context.agentContext.spotify?.userData?.timeoutId;
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        context.agentContext.spotify = undefined;
    }
}

async function enableSpotify(context: SessionContext<PlayerActionContext>) {
    const clientContext = await getClientContext(context.profileStorage);
    context.agentContext.spotify = clientContext;

    return clientContext.service.retrieveUser().username;
}

async function validatePlayerWildcardMatch(
    action: AppAction,
    context: SessionContext<PlayerActionContext>,
) {
    if (action.actionName === "play") {
        const clientContext = context.agentContext.spotify;
        if (clientContext === undefined) {
            // Can't validate without context, assume true
            return true;
        }
        const playAction = action as PlayAction;
        if (playAction.parameters.query) {
            for (const query of playAction.parameters.query) {
                let result: boolean = false;
                switch (query.constraint) {
                    case "track":
                    case undefined:
                        result = await validateTrack(query.text, clientContext);

                    case "album":
                        result = await validateAlbum(query.text, clientContext);

                    case "artist":
                        result = await validateArtist(
                            query.text,
                            clientContext,
                        );
                }
                if (result === false) {
                    return false;
                }
            }
        }
    }
    return true;
}

async function validateTrack(trackName: string, context: IClientContext) {
    const tracks = await searchTracks(`track:"${trackName}"`, context);
    if (tracks && tracks.tracks && tracks.tracks.length > 0) {
        // For validation for wildcard match, only allow substring match.
        const lowerCaseTrackName = trackName.toLowerCase();
        return tracks.tracks.some((track) =>
            track.name.toLowerCase().includes(lowerCaseTrackName),
        );
    }
    return false;
}

async function validateAlbum(albumName: string, context: IClientContext) {
    // search album already return exact matches.
    return searchAlbum(albumName, context) !== undefined;
}

async function validateArtist(artistName: string, context: IClientContext) {
    const data = await searchArtists(artistName, context);

    if (data && data.artists && data.artists.items.length > 0) {
        // For validation for wildcard match, only allow substring match.
        const lowerCaseArtistName = artistName.toLowerCase();
        return data.artists.items.some((artist) =>
            artist.name.toLowerCase().includes(lowerCaseArtistName),
        );
    }
    return false;
}

async function getPlayerDynamicDisplay(
    type: DisplayType,
    displayId: string,
    context: SessionContext<PlayerActionContext>,
): Promise<DynamicDisplay> {
    if (context.agentContext.spotify === undefined) {
        return {
            content: "Spotify integration is not enabled.",
            nextRefreshMs: -1,
        };
    }
    if (displayId === "status") {
        const status = await htmlStatus(context.agentContext.spotify);
        return {
            content:
                type === "html" ? status.displayContent : status.literalText!,

            nextRefreshMs: 1000,
        };
    }
    throw new Error(`Invalid displayId ${displayId}`);
}

async function getPlayerActionCompletion(
    action: AppAction,
    propertyName: string,
    context: SessionContext<PlayerActionContext>,
): Promise<string[]> {
    if (action.actionName !== "play") {
        return [];
    }
    const userData = context.agentContext.spotify?.userData;
    if (userData === undefined) {
        return [];
    }
    if (!propertyName.startsWith("parameters.query.")) {
        return [];
    }
    const suffix = propertyName.substring("parameters.query.".length);
    if (suffix === "") {
        return [];
    }

    const split = suffix.split(".");
    if (split.length > 2) {
        // Not a valid property.
        return [];
    }
    const index = parseInt(split[0]);
    if (index.toString() !== split[0] || split[1] !== "text") {
        // Not a valid index
        return [];
    }

    const playAction = action as Partial<PlayAction>;
    let track: boolean = true;
    let album: boolean = true;
    let artist: boolean = true;
    switch (playAction.parameters?.query?.[index]?.constraint) {
        case "track":
            album = false;
            artist = false;
            break;
        case "album":
            track = false;
            artist = false;
            break;
        case "artist":
            track = false;
            album = false;
            break;
    }

    const result: string[] = [];

    if (track) {
        for (const track of userData.data.tracks.values()) {
            result.push(track.name);
        }
    }

    if (artist) {
        for (const artist of userData.data.artists.values()) {
            result.push(artist.name);
        }
    }

    if (album) {
        for (const album of userData.data.albums.values()) {
            result.push(album.name);
        }
    }
    return result;
}

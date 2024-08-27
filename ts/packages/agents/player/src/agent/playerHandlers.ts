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
    DispatcherAgent,
    DispatcherAgentContext,
    DispatcherAction,
    createTurnImpressionFromError,
} from "@typeagent/agent-sdk";
import { searchAlbum, searchArtists, searchTracks } from "../client.js";

export function instantiate(): DispatcherAgent {
    return {
        initializeAgentContext: initializePlayerContext,
        updateAgentContext: updatePlayerContext,
        executeAction: executePlayerAction,
        validateWildcardMatch: validatePlayerWildcardMatch,
    };
}

type PlayerActionContext = {
    spotify: IClientContext | undefined;
};

async function initializePlayerContext() {
    return {
        spotify: undefined,
    };
}

async function executePlayerAction(
    action: DispatcherAction,
    context: DispatcherAgentContext<PlayerActionContext>,
) {
    if (context.context.spotify) {
        return handleCall(action as PlayerAction, context.context.spotify);
    }

    return createTurnImpressionFromError(
        "Action translated but not performed. Spotify integration is not enabled.",
    );
}

async function updatePlayerContext(
    enable: boolean,
    context: DispatcherAgentContext<PlayerActionContext>,
) {
    if (enable) {
        const user = await enableSpotify(context);
        context.requestIO.result(
            chalk.blue(`Spotify integration enabled. Logged in as ${user}.`),
        );
    } else {
        const timeoutId = context.context.spotify?.userData?.timeoutId;
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        context.context.spotify = undefined;
    }
}

async function enableSpotify(
    context: DispatcherAgentContext<PlayerActionContext>,
) {
    const clientContext = await getClientContext(context.profileStorage);
    clientContext.updateActionStatus = context.getUpdateActionStatus();
    context.context.spotify = clientContext;

    return clientContext.service.retrieveUser().username;
}

async function validatePlayerWildcardMatch(
    action: DispatcherAction,
    context: DispatcherAgentContext<PlayerActionContext>,
) {
    if (action.actionName === "play") {
        const clientContext = context.context.spotify;
        if (clientContext === undefined) {
            // Can't validate without context, assume true
            return true;
        }
        const playAction = action as PlayAction;
        if (playAction.parameters.query) {
            for (const query of playAction.parameters.query) {
                switch (query.constraint) {
                    case "track":
                    case undefined:
                        return validateTrack(query.text, clientContext);

                    case "album":
                        return validateAlbum(query.text, clientContext);

                    case "artist":
                        return validateArtist(query.text, clientContext);
                }
            }
        }
    }
    return true;
}

async function validateTrack(trackName: string, context: IClientContext) {
    const tracks = await searchTracks(trackName, context);
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

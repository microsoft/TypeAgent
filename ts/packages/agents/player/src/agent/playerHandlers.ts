// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IClientContext, getClientContext, handleCall } from "../client.js";
import chalk from "chalk";
import {
    AppAgent,
    SessionContext,
    AppAction,
    ActionContext,
    DisplayType,
    AppAgentEvent,
    DynamicDisplay,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";
import { searchTracks } from "../client.js";
import { htmlStatus } from "../playback.js";
import { getPlayerCommandInterface } from "./playerCommands.js";
import {
    resolveArtists,
    searchArtists,
    SpotifyQuery,
    toQueryString,
    searchAlbums,
} from "../search.js";
import { PlayerAction } from "./playerSchema.js";
import registerDebug from "debug";

const debugSpotify = registerDebug("typeagent:spotify");

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
    action: TypeAgentAction<PlayerAction>,
    context: ActionContext<PlayerActionContext>,
) {
    if (context.sessionContext.agentContext.spotify) {
        return handleCall(
            action,
            context.sessionContext.agentContext.spotify,
            context.actionIO,
        );
    }

    return createActionResultFromError(
        "Not logged in to Spotify.  Use the command '@player spotify login' to log in.",
    );
}

async function updatePlayerContext(
    enable: boolean,
    context: SessionContext<PlayerActionContext>,
) {
    if (enable) {
        if (context.agentContext.spotify) {
            return;
        }
        try {
            const user = await enableSpotify(context, true);
            const message = `Spotify logged in as ${user}.`;
            debugSpotify(message);
            context.notify(AppAgentEvent.Info, chalk.green(message));
        } catch (e: any) {
            const message = `Spotify not logged in.  Error: ${e.message}`;
            debugSpotify(message);
            context.notify(AppAgentEvent.Error, chalk.red(message));
        }
    } else {
        disableSpotify(context);
    }
}

export async function enableSpotify(
    context: SessionContext<PlayerActionContext>,
    silent: boolean = false,
) {
    const clientContext = await getClientContext(
        context.instanceStorage,
        silent,
    );
    context.agentContext.spotify = clientContext;
    return clientContext.service.retrieveUser().username;
}

export async function disableSpotify(
    context: SessionContext<PlayerActionContext>,
    clearToken: boolean = false,
) {
    const clientContext = context.agentContext.spotify;
    if (clientContext !== undefined) {
        const timeoutId = clientContext.userData?.timeoutId;
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        if (clearToken) {
            await clientContext.service.tokenProvider.clearRefreshToken();
        }
        context.agentContext.spotify = undefined;
    }
}

async function validatePlayerWildcardMatch(
    action: PlayerAction,
    context: SessionContext<PlayerActionContext>,
) {
    const clientContext = context.agentContext.spotify;
    if (clientContext === undefined) {
        // REVIEW: Can't validate without context, assume true
        return true;
    }
    switch (action.actionName) {
        case "playTrack":
            return validateTrack(
                action.parameters.trackName,
                action.parameters.artists,
                action.parameters.albumName,
                clientContext,
            );

        case "playAlbum":
            return await validateAlbum(
                action.parameters.albumName,
                action.parameters.artists,
                clientContext,
            );
        case "playArtist":
            return await validateArtist(
                action.parameters.artist,
                clientContext,
            );
        case "playGenre":
            return false;
    }
    return true;
}

async function validateTrack(
    trackName: string,
    artists: string[] | undefined,
    album: string | undefined,
    context: IClientContext,
) {
    const resolvedArtists = artists
        ? await resolveArtists(artists, context)
        : [];

    if (resolvedArtists === undefined) {
        return false;
    }
    const query: SpotifyQuery = {
        track: [trackName],
        artist: resolvedArtists.map((artist) => artist.name),
    };
    const queryString = toQueryString(query);
    const tracks = await searchTracks(queryString, context);
    if (tracks) {
        // For validation for wildcard match, only allow substring match.
        const lowerCaseTrackName = trackName.toLowerCase();
        const lowerCaseAlbumName = album?.toLowerCase();
        return tracks
            .getTracks()
            .some(
                (track) =>
                    track.name.toLowerCase().includes(lowerCaseTrackName) &&
                    (lowerCaseAlbumName === undefined ||
                        track.album.name
                            .toLowerCase()
                            .includes(lowerCaseAlbumName)),
            );
    }
    return false;
}

async function validateAlbum(
    albumName: string,
    artists: string[] | undefined,
    context: IClientContext,
) {
    const resolvedArtists = artists
        ? await resolveArtists(artists, context)
        : [];

    if (resolvedArtists === undefined) {
        return false;
    }
    const albums = await searchAlbums(albumName, undefined, context);
    if (albums === undefined) {
        return false;
    }

    const lowerCaseAlbumName = albumName.toLowerCase();
    // For validation for wildcard match, only allow substring match.
    const filteredAlbums = albums.filter((album) =>
        album.name.toLowerCase().includes(lowerCaseAlbumName),
    );

    if (filteredAlbums.length === 0) {
        return false;
    }

    if (artists === undefined) {
        return true;
    }

    return resolvedArtists.every((resolvedArtist) =>
        filteredAlbums.some((album) =>
            album.artists.some((artists) => artists.id === resolvedArtist.id),
        ),
    );
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
    const clientContext = context.agentContext.spotify;
    if (clientContext === undefined) {
        return [];
    }
    const userData = clientContext.userData;
    if (userData === undefined) {
        return [];
    }

    let track = false;
    let artist = false;
    let album = false;
    switch (action.actionName) {
        case "playTrack":
            if (propertyName === "parameters.trackName") {
                track = true;
            } else if (propertyName.startsWith("parameters.artists.")) {
                artist = true;
            } else if (propertyName === "parameters.albumName") {
                album = true;
            }
            break;
        case "playAlbum":
            if (propertyName === "parameters.albumName") {
                album = true;
            } else if (propertyName.startsWith("parameters.artists.")) {
                artist = true;
            }
            break;
        case "playArtist":
            if (propertyName === "parameters.artist") {
                artist = true;
            }
            break;
        case "playGenre":
            break;
    }

    const result: string[] = [];
    if (track) {
        for (const track of userData.data.tracks.values()) {
            result.push(track.name);
        }
    }
    if (album) {
        for (const album of userData.data.albums.values()) {
            result.push(album.name);
        }
    }
    if (artist) {
        for (const artist of userData.data.artists.values()) {
            result.push(artist.name);
        }
    }
    return result;
}

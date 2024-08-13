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
    SearchMenuContext,
    createTurnImpressionFromError,
} from "dispatcher-agent";
import { searchAlbum, searchArtists, searchTracks } from "../client.js";
import { getUserDataStrings } from "../client.js";

export function instantiate(): DispatcherAgent {
    return {
        initializeAgentContext: initializePlayerContext,
        updateAgentContext: updatePlayerContext,
        executeAction: executePlayerAction,
        partialInput: playerPartialInput,
        validateWildcardMatch: validatePlayerWildcardMatch,
    };
}

type PlayerActionContext = {
    spotify: IClientContext | undefined;
    spotifyBackend: boolean;
    searchContext?: SearchMenuContext;
};

function initializePlayerContext() {
    return {
        spotify: undefined,
        spotifyBackend: false,
    };
}

async function executePlayerAction(
    action: DispatcherAction,
    context: DispatcherAgentContext<PlayerActionContext>,
) {
    if (context.context.spotify) {
        return handleCall(action as PlayerAction, context.context.spotify);
    }

    if (context.context.spotifyBackend) {
        try {
            const response = await fetch("http://localhost:3027", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(action),
            });
            if (response.ok) {
                const json = await response.json();
                console.log(json);
            } else {
                console.log(response.statusText);
            }
        } catch (e) {
            console.log("Unable to contact music backend. Turning off.");
            context.context.spotifyBackend = false;
        }
        return;
    }

    return createTurnImpressionFromError(
        "Action translated but not performed. Spotify integration is not enabled.",
    );
}

function playerPartialInput(
    partialInputText: string,
    context: DispatcherAgentContext<PlayerActionContext>,
) {
    if (partialInputText.startsWith("play ")) {
        const prefix = partialInputText.substring(5).toLocaleLowerCase();
        if (context.context.spotify) {
            if (!context.context.searchContext) {
                context.context.searchContext = {
                    state: "active",
                    menuId: "player",
                    lastPrefix: prefix,
                };
                const choices = getUserDataStrings(context.context.spotify);
                const searchMenuItems = choices.map((choice) => ({
                    matchText: choice,
                    emojiChar: "🎵",
                    groupName: "player",
                    selectedText: choice,
                }));
                context.context.searchContext.choices = choices;
                context.searchMenuCommand(
                    "player",
                    "register",
                    prefix,
                    searchMenuItems,
                    true,
                );
            } else {
                context.context.searchContext.lastPrefix = prefix;
                if (context.context.searchContext.state === "inactive") {
                    context.context.searchContext.state = "active";
                    context.searchMenuCommand("player", "show", prefix);
                } else {
                    context.searchMenuCommand("player", "complete", prefix);
                }
            }
        }
    }
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
        context.context.spotifyBackend = false;
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
        const lowerCaseTrackeName = trackName.toLowerCase();
        return tracks.tracks.some((track) =>
            track.name.toLowerCase().includes(lowerCaseTrackeName),
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

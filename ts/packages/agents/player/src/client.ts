// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import {
    ChangeVolumeAction,
    CreatePlaylistAction,
    DeletePlaylistAction,
    FilterTracksAction,
    GetFavoritesAction,
    GetPlaylistAction,
    PlayAction,
    PlayerAction,
    SearchTracksAction,
    SelectDeviceAction,
    SetVolumeAction,
    ShuffleAction,
    UnknownAction,
} from "./agent/playerSchema.js";
import { createTokenProvider } from "./defaultTokenProvider.js";
import chalk from "chalk";
import dotenv from "dotenv";
import * as Filter from "./trackFilter.js";
import { TypeChatLanguageModel, createLanguageModel } from "typechat";
import {
    AlbumTrackCollection,
    ITrackCollection,
    PlaylistTrackCollection,
    TrackCollection,
} from "./trackCollections.js";
import { applyFilterExpr } from "./trackFilter.js";
import {
    play,
    getUserProfile,
    getDevices,
    search,
    setVolume,
    limitMax,
    getFavoriteTracks,
    createPlaylist,
    deletePlaylist,
    getPlaylists,
    getPlaybackState,
    getPlaylistTracks,
    pause,
    next,
    previous,
    shuffle,
    getAlbumTracks,
    getQueue,
} from "./endpoints.js";
import {
    htmlStatus,
    listAvailableDevices,
    printStatus,
    selectDevice,
} from "./playback.js";
import { SpotifyService } from "./service.js";
import { fileURLToPath } from "node:url";
import { getAlbumString, toTrackObjectFull } from "./spotifyUtils.js";
import { hostname } from "node:os";
import {
    initializeUserData,
    mergeUserDataKind,
    saveUserData,
    addUserDataStrings,
    UserData,
} from "./userData.js";
import registerDebug from "debug";
import { Storage, TurnImpression } from "@typeagent/agent-sdk";

const debugSpotify = registerDebug("typeagent:spotify");

let languageModel: TypeChatLanguageModel | undefined;
function getTypeChatLanguageModel() {
    if (languageModel === undefined) {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        dotenv.config({ path: path.join(__dirname, "../../../.env") });
        languageModel = createLanguageModel(process.env);
    }
    return languageModel;
}

export interface IClientContext {
    service: SpotifyService;
    deviceId?: string | undefined;
    currentTrackList?: ITrackCollection;
    lastTrackStartIndex?: number;
    lastTrackEndIndex?: number;
    userData?: UserData | undefined;
}

async function printTrackNames(
    trackCollection: ITrackCollection,
    startIndex: number,
    endIndex: number,
    context: IClientContext,
) {
    const fetchedTracks = await trackCollection.getTracks(context.service);
    const selectedTracks = fetchedTracks.slice(startIndex, endIndex);
    let count = startIndex + 1;
    for (const track of selectedTracks) {
        let prefix = "";
        if (context && fetchedTracks.length > 1) {
            prefix = `T${count}: `;
        }
        console.log(chalk.cyanBright(`${prefix}${track.name}`));
        const artists =
            "   Artists: " +
            track.artists.map((artist) => chalk.green(artist.name)).join(", ");
        console.log(artists);
        console.log("   Album: " + chalk.rgb(181, 101, 29)(track.album.name));

        count++;
    }
}

interface SpotifyRecord {
    ts: string;
    master_metadata_track_name: string;
    master_metadata_album_artist_name: string;
    master_metadata_album_album_name: string;
    spotify_track_uri: string;
}

function getIdPart(uri: string) {
    if (uri && uri.startsWith("spotify:track:")) {
        const parts = uri.split(":");
        return parts[parts.length - 1];
    } else {
        console.log(`Invalid uri: ${uri}`);
        return "";
    }
}

export async function loadHistoryFile(
    profileStorage: Storage,
    historyPath: string,
    context: IClientContext,
) {
    if (!(await profileStorage.exists(historyPath))) {
        throw new Error(`History file not found: ${historyPath}`);
    }
    if (!context.userData) {
        throw new Error("User data not enabled");
    }
    try {
        const rawData = await profileStorage.read(historyPath, "utf8");
        let data: SpotifyRecord[] = JSON.parse(rawData);
        for (const record of data) {
            console.log(`${record.master_metadata_track_name}`);
        }
        data = data.filter((r) => r.spotify_track_uri !== null);
        mergeUserDataKind(
            context.userData.data.tracks,
            data.map((r) => ({
                timestamps: [r.ts],
                freq: 1,
                name: r.master_metadata_track_name,
                albumArtist: r.master_metadata_album_artist_name,
                albumName: r.master_metadata_album_album_name,
                id: getIdPart(r.spotify_track_uri),
            })),
        );
        await saveUserData(profileStorage, context.userData.data);
    } catch (e: any) {
        throw new Error(`Error reading history file: ${e.message}`);
    }
}

async function htmlTrackNames(
    trackCollection: ITrackCollection,
    startIndex: number,
    endIndex: number,
    context: IClientContext,
    headText = "Tracks",
) {
    const fetchedTracks = await trackCollection.getTracks(context.service);
    const selectedTracks = fetchedTracks.slice(startIndex, endIndex);
    const turnImpression: TurnImpression = {
        displayText: "",
        literalText: "",
        entities: [],
    };
    let prevUrl = "";
    if (selectedTracks.length > 1) {
        turnImpression.displayText = `<div class='track-list scroll_enabled'><div>${headText}...</div><ol>\n`;
        let entCount = 0;
        for (const track of selectedTracks) {
            if (entCount < 1) {
                // make an entity for the track
                turnImpression.entities.push({
                    name: track.name,
                    type: ["track", "song"],
                });
                // make an entity for each artist
                for (const artist of track.artists) {
                    turnImpression.entities.push({
                        name: artist.name,
                        type: ["artist"],
                    });
                }
                // make an entity for the album
                turnImpression.entities.push({
                    name: track.album.name,
                    type: ["album"],
                });
                entCount++;
            }
            const artistsPrefix =
                track.artists.length > 1 ? "   Artists: " : "   Artist: ";
            const artists =
                artistsPrefix +
                track.artists.map((artist) => artist.name).join(", ");
            if (
                track.album.images.length > 0 &&
                track.album.images[0].url &&
                track.album.images[0].url != prevUrl
            ) {
                // make a list item that is a flex box with an image and a div
                turnImpression.displayText += `  <li><div class='track-album-cover-container'>\n <div class='track-info'> <div class='track-title'>${track.name}</div>\n`;
                turnImpression.displayText += `    <div class='track-artist'>${artists}</div>`;
                turnImpression.displayText += `    <div>Album: ${track.album.name}</div></div>\n`;
                turnImpression.displayText += `  <img src='${track.album.images[0].url}' alt='album cover' class='track-album-cover' />\n`;
                prevUrl = track.album.images[0].url;
                turnImpression.displayText += `  </div></li>\n`;
            } else {
                turnImpression.displayText += `  <li><span class='track-title'>${track.name}</span>`;
                turnImpression.displayText += `    <div class='track-artist'>${artists}</div>`;
                turnImpression.displayText += `    <div>Album: ${track.album.name}</div>\n`;
                turnImpression.displayText += `  </li>\n`;
            }
        }
        turnImpression.displayText += "</ol></div>";
        turnImpression.literalText =
            "Updated the current track list with the numbered list of tracks on the screen";
    } else if (selectedTracks.length === 1) {
        const track = selectedTracks[0];
        const artistsPrefix =
            track.artists.length > 1 ? "   Artists: " : "   Artist: ";
        const artists =
            artistsPrefix +
            track.artists.map((artist) => artist.name).join(", ");
        turnImpression.entities.push({
            name: track.name,
            type: ["track", "song"],
        });
        // make an entity for each artist
        for (const artist of track.artists) {
            turnImpression.entities.push({
                name: artist.name,
                type: ["artist"],
            });
        }
        // make an entity for the album
        turnImpression.entities.push({
            name: track.album.name,
            type: ["album"],
        });
        const litArtistsPrefix =
            track.artists.length > 1 ? "artists: " : "artist ";
        const litArtists =
            litArtistsPrefix +
            track.artists.map((artist) => artist.name).join(", ");
        turnImpression.literalText = `Now playing: ${track.name} from album ${track.album.name} with ${litArtists}`;
        if (track.album.images.length > 0 && track.album.images[0].url) {
            turnImpression.displayText =
                "<div class='track-list scroll_enabled'>";
            turnImpression.displayText +=
                "<div class='track-album-cover-container'>";
            turnImpression.displayText += `  <div class='track-info'>`;
            turnImpression.displayText += `    <div class='track-title'>${track.name}</div>`;
            turnImpression.displayText += `    <div>${artists}</div>`;
            turnImpression.displayText += `    <div>Album: ${track.album.name}</div>`;
            turnImpression.displayText += "</div>";
            turnImpression.displayText += `  <img src='${track.album.images[0].url}' alt='album cover' class='track-album-cover' />\n`;
            turnImpression.displayText += "</div>";
            turnImpression.displayText += "</div>";
        } else {
            turnImpression.displayText =
                "<div class='track-list scroll_enabled'>";
            turnImpression.displayText += `    <div class='track-title'>${track.name}</div>`;
            turnImpression.displayText += `    <div>${artists}</div>`;
            turnImpression.displayText += `    <div>Album: ${track.album.name}</div>`;
            turnImpression.displayText += "</div>";
        }
    } else {
        turnImpression.displayText = "<div>No tracks found</div>";
        turnImpression.literalText = "No tracks found";
    }
    return turnImpression;
}

async function updateTrackListAndPrint(
    collection: ITrackCollection,
    clientContext: IClientContext,
) {
    await printTrackNames(
        collection,
        0,
        collection.getTrackCount(),
        clientContext,
    );
    clientContext.currentTrackList = collection;
    clientContext.lastTrackStartIndex = 0;
    clientContext.lastTrackEndIndex = collection.getTrackCount();
}

export async function getClientContext(
    profileStorage?: Storage,
): Promise<IClientContext> {
    const service = new SpotifyService(
        await createTokenProvider(profileStorage),
    );
    await service.init();
    const userdata = await getUserProfile(service);
    service.storeUser({
        id: userdata?.id,
        username: userdata?.display_name,
    });
    const devices = await getDevices(service);
    let deviceId: string | undefined;
    if (devices && devices.devices.length > 0) {
        const activeDevice =
            devices.devices.find((device) => device.is_active) ??
            devices.devices.find((device) => device.name === hostname()) ??
            devices.devices[0];
        deviceId = activeDevice.id ?? undefined;
    }

    return {
        deviceId,
        service,
        userData: profileStorage
            ? await initializeUserData(profileStorage, service)
            : undefined,
    };
}

export async function searchArtists(
    artistName: string,
    context: IClientContext,
) {
    // REVIEW: strip out "the" from the artist name to improve search results
    const searchTerm = artistName
        .replaceAll(/(?:^|\s)the(?:$|\s)/gi, " ")
        .trim();
    const query: SpotifyApi.SearchForItemParameterObject = {
        q: `artist:"${searchTerm}"`,
        type: "artist",
        limit: 50,
        offset: 0,
    };
    return search(query, context.service);
}

export async function searchTracks(
    queryString: string,
    context: IClientContext,
) {
    const query: SpotifyApi.SearchForItemParameterObject = {
        q: `track:"${queryString}"`,
        type: "track",
        limit: 50,
        offset: 0,
    };
    const data = await search(query, context.service);
    if (data && data.tracks && data.tracks.items.length > 0) {
        return new TrackCollection(data.tracks.items, data.tracks.items.length);
    }
}

export async function searchAlbum(albumName: string, context: IClientContext) {
    const query: SpotifyApi.SearchForItemParameterObject = {
        q: `album:"${albumName}"`,
        type: "album",
        limit: 50,
        offset: 0,
    };
    const data = await search(query, context.service);
    if (data && data.albums && data.albums.items.length > 0) {
        for (const album of data.albums.items) {
            if (album.name === albumName) {
                return album;
            }
        }
    }
    return undefined;
}

async function resolveArtist(artistName: string, context: IClientContext) {
    const data = await searchArtists(artistName, context);
    if (data && data.artists && data.artists.items.length > 0) {
        const lowerArtistName = artistName.toLowerCase();
        const knownArtists = context.userData?.data.artists;
        const artists = data.artists.items.sort((a, b) => {
            if (knownArtists) {
                const knownA = knownArtists.has(a.id) ? 1 : 0;
                const knownB = knownArtists.has(b.id) ? 1 : 0;
                const known = knownB - knownA;
                if (known !== 0) {
                    return known;
                }
            }
            // TODO: Might want to use fuzzy matching here.
            const exactA = lowerArtistName === a.name.toLowerCase() ? 1 : 0;
            const exactB = lowerArtistName === b.name.toLowerCase() ? 1 : 0;
            const exact = exactB - exactA;
            if (exact !== 0) {
                return exact;
            }
            return b.popularity - a.popularity;
        });
        if (debugSpotify.enabled) {
            debugSpotify(
                `Possible artists:\n${artists.map((a) => `${a.popularity.toString().padStart(3)} ${a.name}${knownArtists?.has(a.id) ? " (known)" : ""}`).join("\n")}`,
            );
        }
        // Prefer the known one, then exact match, and then popularity.
        return artists[0].name;
    }
}

async function playTracks(
    trackCollection: ITrackCollection,
    startIndex: number,
    endIndex: number,
    clientContext: IClientContext,
) {
    let turnImpression = {
        displayText: "",
        literalText: "",
        entities: [],
    } as TurnImpression;
    if (clientContext.deviceId) {
        const fetchedTracks = await trackCollection.getTracks(
            clientContext.service,
        );
        const tracks = fetchedTracks.slice(startIndex, endIndex);
        const uris = tracks.map((track) => track.uri);
        console.log(chalk.cyanBright("Playing..."));
        await printTrackNames(
            trackCollection,
            startIndex,
            endIndex,
            clientContext,
        );
        turnImpression = await htmlTrackNames(
            trackCollection,
            startIndex,
            endIndex,
            clientContext,
            "Playing",
        );
        await play(
            clientContext.service,
            clientContext.deviceId,
            uris,
            trackCollection.getContext(),
            startIndex,
        );
    } else {
        console.log(chalk.red("No active device found"));
        turnImpression.displayText = "No active device found";
        turnImpression.literalText = "No active device found";
    }
    return turnImpression;
}

async function playAlbums(
    albums: SpotifyApi.AlbumObjectSimplified[],
    quantity: number,
    clientContext: IClientContext,
) {
    // Play the albums found with the quantity specified
    const albumsToPlay =
        quantity === -1 ? albums : albums.slice(0, quantity > 0 ? quantity : 1);
    console.log(
        chalk.grey(
            `Queueing up albums:\n  ${albumsToPlay
                .map(getAlbumString)
                .join("\n  ")}`,
        ),
    );

    // Get tracks from album
    const albumTracksP = albumsToPlay.map(async (album) => {
        return {
            album,
            tracks: (await getAlbumTracks(clientContext.service, album.id))
                ?.items,
        };
    });
    const albumTracks = (await Promise.all(albumTracksP))
        .filter((result) => result.tracks !== undefined)
        .flatMap((result) =>
            result.tracks!.map((item) => toTrackObjectFull(item, result.album)),
        );

    if (albumTracks && albumTracks.length > 0) {
        // Play the tracks from these album.
        const collection = new TrackCollection(albumTracks, albumTracks.length);
        return playTracks(collection, 0, albumTracks.length, clientContext);
    }
    console.log(chalk.red(`Unable to get track`));
}

type SpotifyQuery = {
    track: string[];
    album: string[];
    artist: string[];
    query: string[];
};

function isEmptyQuery(query: SpotifyQuery) {
    return (
        query.track.length === 0 &&
        query.album.length === 0 &&
        query.artist.length === 0 &&
        query.query.length === 0
    );
}

function toQueryString(query: SpotifyQuery) {
    const queryParts: string[] = [];
    query.track.forEach((track) => queryParts.push(`track:"${track}"`));
    query.album.forEach((album) => queryParts.push(`album:"${album}"`));
    query.artist.forEach((artist) => queryParts.push(`artist:"${artist}"`));
    query.query.forEach((query) => queryParts.push(query));
    return queryParts.join(" ");
}

async function playAlbumsWithQuery(
    query: SpotifyQuery,
    quantity: number,
    clientContext: IClientContext,
) {
    let albums: SpotifyApi.AlbumObjectSimplified[];
    const queryString = toQueryString(query);
    if (query.track.length !== 0) {
        // search for tracks and collect the albums
        const param: SpotifyApi.SearchForItemParameterObject = {
            q: queryString,
            type: "track",
            limit: 50,
            offset: 0,
        };
        const result = await search(param, clientContext.service);
        if (result?.tracks === undefined) {
            console.log(chalk.red(`No tracks found for query: ${queryString}`));
            return;
        }
        const albumsSet = new Set(
            result.tracks.items.map((track) => track.album),
        );
        albums = Array.from(albumsSet.values());
    } else {
        // Look for the albums
        const query: SpotifyApi.SearchForItemParameterObject = {
            q: queryString,
            type: "album",
            limit: 10,
            offset: 0,
        };
        const result = await search(query, clientContext.service);
        if (result?.albums === undefined) {
            console.log(chalk.red(`No albums found for query: ${queryString}`));
            return;
        }
        albums = result.albums.items;
    }
    if (albums.length === 0) {
        console.log(chalk.red(`No albums found for query: ${queryString}`));
        return;
    }

    return playAlbums(albums, quantity, clientContext);
}

async function playTracksWithQuery(
    query: SpotifyQuery,
    quantity: number,
    clientContext: IClientContext,
) {
    // play track
    // search for tracks and collect the albums
    const queryString = toQueryString(query);
    const param: SpotifyApi.SearchForItemParameterObject = {
        q: queryString,
        type: "track",
        limit: 50,
        offset: 0,
    };
    const result = await search(param, clientContext.service);
    const trackResult = result?.tracks;
    if (trackResult === undefined) {
        console.log(chalk.red(`No tracks found for query: ${queryString}`));
        return {
            displayText: "No track found",
            literalText: "No track found",
            entities: [],
        };
    }

    // TODO: if there is not exact match for artist, might want to consider popularity of
    // the artist too.
    let tracks: SpotifyApi.TrackObjectFull[];
    if (query.query.length === 0 && query.track.length === 0) {
        // No search term for track name, just play what we found sorted by popularity
        tracks = trackResult.items.sort((a, b) => b.popularity - a.popularity);
    } else {
        // With search terms for track name, search for matching songs in the albums (to gather multi-movement songs)
        const albums = new Map(
            trackResult.items.map((track) => [
                track.album.id,
                track.album.name,
            ]),
        );

        tracks = [];
        for (const [id, album] of albums) {
            const param: SpotifyApi.SearchForItemParameterObject = {
                q: toQueryString({ ...query, album: [album] }),
                type: "track",
                limit: 50,
                offset: 0,
            };
            const result = await search(param, clientContext.service);
            if (result?.tracks !== undefined) {
                tracks.push(
                    ...result.tracks.items
                        .filter((track) => track.album.id === id)
                        .sort((a, b) => {
                            if (a.disc_number !== b.disc_number) {
                                return a.disc_number - b.disc_number;
                            }
                            return a.track_number - b.track_number;
                        }),
                );
                if (quantity >= 0 && tracks.length > quantity) {
                    break;
                }
            }
        }
    }

    if (tracks.length !== 0) {
        return playTracks(
            new TrackCollection(tracks, tracks.length),
            0,
            quantity > 0 ? quantity : tracks.length,
            clientContext,
        );
    }
    console.log(chalk.red(`No track found for query: ${queryString}`));
    return {
        displayText: "No track found",
        literalText: "No track found",
        entities: [],
    };
}

async function playActionCall(
    clientContext: IClientContext,
    playAction: PlayAction,
) {
    let startIndex = playAction.parameters.trackNumber;
    let endIndex: undefined | number = undefined;
    if (startIndex === undefined) {
        if (playAction.parameters.trackRange) {
            startIndex = playAction.parameters.trackRange[0];
            endIndex = playAction.parameters.trackRange[1];
        }
    }
    if (startIndex !== undefined) {
        // track number or track range specified
        if (endIndex === undefined) {
            endIndex = startIndex + 1;
        }
        if (clientContext.currentTrackList != undefined) {
            return playTracks(
                clientContext.currentTrackList,
                startIndex - 1,
                endIndex - 1,
                clientContext,
            );
        }
    } else {
        // query specified
        const query: SpotifyQuery = {
            track: [],
            album: [],
            artist: [],
            query: [],
        };
        playAction.parameters.query?.forEach((item) => {
            (query[item.constraint ?? "query"] ?? query["query"]).push(
                item.text,
            );
        });
        query.artist = await Promise.all(
            query.artist.map(async (item) => {
                // Resolve the artist
                const artist = await resolveArtist(item, clientContext);
                if (artist) {
                    console.log(
                        chalk.grey(
                            `Search on spotify found artist: ${item} -> ${artist}`,
                        ),
                    );
                    return artist;
                }
                return item;
            }),
        );

        if (!isEmptyQuery(query)) {
            const quantity = playAction.parameters.quantity ?? 0;
            const itemType =
                query.track.length === 0 && query.album.length !== 0
                    ? "album"
                    : "track";

            if (itemType === "album") {
                await playAlbumsWithQuery(query, quantity, clientContext);
            } else {
                let result = await playTracksWithQuery(
                    query,
                    quantity,
                    clientContext,
                );
                return result;
            }
        } else {
            // no parameters specified, just resume playback
            await resumeActionCall(clientContext);
            return {
                displayText: "Resuming playback",
                literalText: "Resuming playback",
                entities: [],
            };
        }
    }
    return {
        displayText: "No tracks to play",
        literalText: "No tracks to play",
        entities: [],
    };
}
function ensureClientId(state: SpotifyApi.CurrentPlaybackResponse) {
    if (state.device.id !== null) {
        return state.device.id;
    }
    console.log(
        chalk.red(
            `Current device '${state.device.name}' is a restricted device and cannot be controlled.`,
        ),
    );
    return undefined;
}

async function resumeActionCall(clientContext: IClientContext) {
    const state = await getPlaybackState(clientContext.service);
    let result = "";
    if (!state) {
        result += "<div>No active playback to resume</div>";
        console.log(chalk.yellow("No active playback to resume"));
        return result;
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) return result;

    if (state.is_playing) {
        result += "<div>Music already playing</div>";
        console.log(chalk.yellow("Music already playing"));
    } else {
        await play(clientContext.service, deviceId);
    }
    await printStatus(clientContext);
    const status = await htmlStatus(clientContext);
    return status;
}

async function pauseActionCall(clientContext: IClientContext) {
    const state = await getPlaybackState(clientContext.service);
    if (!state) {
        console.log(chalk.yellow("No active playback to resume"));
        return {
            displayText: "No active playback to resume",
            literalText: "No active playback to resume",
            entities: [],
        };
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) {
        return {
            displayText: "No device active",
            literalText: "No device active",
            entities: [],
        };
    }
    if (!state.is_playing) {
        console.log(chalk.yellow("Music already stopped."));
    } else {
        await pause(clientContext.service, deviceId);
    }
    await printStatus(clientContext);
    const statusHtml = await htmlStatus(clientContext);
    return statusHtml;
}

async function nextActionCall(clientContext: IClientContext) {
    const state = await getPlaybackState(clientContext.service);
    if (!state) {
        console.log(chalk.yellow("No active playback to resume"));
        return {
            displayText: "No active playback to resume",
            literalText: "No active playback to resume",
            entities: [],
        };
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) {
        return {
            displayText: "No device active",
            literalText: "No device active",
            entities: [],
        };
    }

    await next(clientContext.service, deviceId);
    await printStatus(clientContext);
    const statusHtml = await htmlStatus(clientContext);
    return statusHtml;
}

async function previousActionCall(clientContext: IClientContext) {
    const state = await getPlaybackState(clientContext.service);
    if (!state) {
        console.log(chalk.yellow("No active playback to resume"));
        return {
            displayText: "No active playback to resume",
            literalText: "No active playback to resume",
            entities: [],
        };
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) {
        return {
            displayText: "No device active",
            literalText: "No device active",
            entities: [],
        };
    }

    await previous(clientContext.service, deviceId);
    await printStatus(clientContext);
    const statusHtml = await htmlStatus(clientContext);
    return statusHtml;
}

async function shuffleActionCall(clientContext: IClientContext, on: boolean) {
    const state = await getPlaybackState(clientContext.service);
    if (!state) {
        console.log(chalk.yellow("No active playback to resume"));
        return;
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) return;

    await shuffle(clientContext.service, deviceId, on);
    await printStatus(clientContext);
    const statusHtml = await htmlStatus(clientContext);
    return statusHtml;
}

export function getUserDataStrings(clientContext: IClientContext) {
    return clientContext.userData
        ? Array.from(addUserDataStrings(clientContext.userData.data).keys())
        : [];
}

export async function handleCall(
    action: PlayerAction,
    clientContext: IClientContext,
): Promise<TurnImpression | undefined> {
    let turnResult: TurnImpression = {
        displayText: "",
        literalText: "",
        entities: [],
    };
    switch (action.actionName) {
        case "play": {
            turnResult = await playActionCall(clientContext, action);
            break;
        }
        case "status": {
            await printStatus(clientContext);
            turnResult = await htmlStatus(clientContext);
            break;
        }
        case "getQueue": {
            const currentQueue = await getQueue(clientContext.service);
            if (currentQueue) {
                const filtered = currentQueue.queue.filter(
                    (item) => item.type === "track",
                ) as SpotifyApi.TrackObjectFull[];
                console.log(chalk.magentaBright("Current Queue:"));
                console.log(
                    chalk.cyanBright(
                        `--------------------------------------------`,
                    ),
                );
                const collection = new TrackCollection(
                    filtered,
                    filtered.length,
                );
                await printTrackNames(
                    collection,
                    0,
                    filtered.length,
                    clientContext,
                );
                console.log(
                    chalk.cyanBright(
                        `--------------------------------------------`,
                    ),
                );
                turnResult = await htmlTrackNames(
                    collection,
                    0,
                    filtered.length,
                    clientContext,
                    "Queue",
                );
            }
            break;
        }
        case "pause": {
            turnResult = await pauseActionCall(clientContext);
            break;
        }
        case "next": {
            turnResult = await nextActionCall(clientContext);
            break;
        }
        case "previous": {
            turnResult = await previousActionCall(clientContext);
            break;
        }
        case "shuffle": {
            const shuffleAction = action as ShuffleAction;
            await shuffleActionCall(clientContext, shuffleAction.parameters.on);
            break;
        }
        case "resume": {
            await resumeActionCall(clientContext);
            break;
        }
        case "listDevices": {
            turnResult.displayText =
                (await listAvailableDevices(clientContext)) || "";
            break;
        }
        case "selectDevice": {
            const selectDeviceAction = action as SelectDeviceAction;
            const keyword = selectDeviceAction.parameters.keyword;
            turnResult.displayText = await selectDevice(keyword, clientContext);
            break;
        }
        case "setVolume": {
            const setVolumeAction = action as SetVolumeAction;
            let newVolumeLevel = setVolumeAction.parameters.newVolumeLevel;
            if (newVolumeLevel > 50) {
                newVolumeLevel = 50;
            }
            console.log(
                chalk.yellowBright(`setting volume to ${newVolumeLevel} ...`),
            );
            turnResult.displayText = `setting volume to ${newVolumeLevel} ...`;
            await setVolume(clientContext.service, newVolumeLevel);
            turnResult = await htmlStatus(clientContext);
            break;
        }
        case "changeVolume": {
            const changeVolumeAction = action as ChangeVolumeAction;
            const volumeChangeAmount =
                changeVolumeAction.parameters.volumeChangePercentage;
            const playback = await getPlaybackState(clientContext.service);
            if (playback && playback.device) {
                const volpct = playback.device.volume_percent || 50;
                let nv = Math.floor(
                    (1.0 + volumeChangeAmount / 100.0) * volpct,
                );
                if (nv > 50) {
                    nv = 50;
                }
                console.log(chalk.yellowBright(`setting volume to ${nv} ...`));
                turnResult.displayText = `setting volume to ${nv} ...`;
                await setVolume(clientContext.service, nv);
            }
            break;
        }
        case "searchTracks": {
            const searchTracksAction = action as SearchTracksAction;
            const queryString = searchTracksAction.parameters.query;
            const searchResult = await searchTracks(queryString, clientContext);
            if (searchResult) {
                console.log(chalk.magentaBright("Search Results:"));
                updateTrackListAndPrint(searchResult, clientContext);
                turnResult = await htmlTrackNames(
                    searchResult,
                    0,
                    searchResult.getTrackCount(),
                    clientContext,
                    "Search Results",
                );
            }
            break;
        }
        case "listPlaylists": {
            const playlists = await getPlaylists(clientContext.service);
            if (playlists) {
                turnResult.displayText = "<div>Playlists...</div>";
                for (const playlist of playlists.items) {
                    console.log(chalk.magentaBright(`${playlist.name}`));
                    turnResult.displayText += `<div>${playlist.name}</div>`;
                }
            }
            break;
        }
        case "getPlaylist": {
            const getPlaylistAction = action as GetPlaylistAction;
            const playlistName = getPlaylistAction.parameters.name;
            const playlists = await getPlaylists(clientContext.service);
            const playlist = playlists?.items.find((playlist) => {
                return playlist.name
                    .toLowerCase()
                    .includes(playlistName.toLowerCase());
            });
            if (playlist) {
                const playlistResponse = await getPlaylistTracks(
                    clientContext.service,
                    playlist.id,
                );
                if (playlistResponse) {
                    const collection = new PlaylistTrackCollection(
                        playlist,
                        playlistResponse.items.map((item) => item.track!),
                    );
                    console.log(chalk.magentaBright("Playlist:"));
                    await updateTrackListAndPrint(collection, clientContext);
                    turnResult = await htmlTrackNames(
                        collection,
                        0,
                        collection.getTrackCount(),
                        clientContext,
                        `Playlist: ${playlist.name}`,
                    );
                }
            }
            break;
        }
        case "getAlbum": {
            const getAlbumAction = action as unknown as GetPlaylistAction;
            const name = getAlbumAction.parameters.name;
            let album: SpotifyApi.AlbumObjectSimplified | undefined = undefined;
            let status: SpotifyApi.CurrentPlaybackResponse | undefined =
                undefined;
            if (name.length > 0) {
                console.log(
                    chalk.magentaBright(`searching for album: ${name}`),
                );
                album = await searchAlbum(name, clientContext);
            } else {
                // get album of current playing track and load it as track collection
                status = await getPlaybackState(clientContext.service);
                if (status && status.item && status.item.type === "track") {
                    const track = status.item as SpotifyApi.TrackObjectFull;
                    album = track.album;
                }
            }
            if (album !== undefined) {
                const getTracksResponse = await getAlbumTracks(
                    clientContext.service,
                    album.id,
                );
                if (
                    status !== undefined &&
                    status.is_playing &&
                    status.item !== null &&
                    status.item.type === "track"
                ) {
                    await play(
                        clientContext.service,
                        clientContext.deviceId!,
                        [],
                        album.uri,
                        status.item.track_number - 1,
                        status.progress_ms ? status.progress_ms : 0,
                    );
                }
                if (getTracksResponse) {
                    const collection = new AlbumTrackCollection(
                        album,
                        getTracksResponse.items,
                    );
                    console.log(
                        chalk.magentaBright(
                            `${getAlbumAction.parameters.name}:`,
                        ),
                    );
                    await updateTrackListAndPrint(collection, clientContext);
                    turnResult = await htmlTrackNames(
                        collection,
                        0,
                        collection.getTrackCount(),
                        clientContext,
                    );
                }
            }
            break;
        }
        case "getFavorites": {
            const getFavoritesAction = action as GetFavoritesAction;
            const countOption = getFavoritesAction.parameters.count;
            let count = limitMax;
            if (countOption !== undefined) {
                count = countOption;
            }
            const tops = await getFavoriteTracks(clientContext.service, count);
            if (tops) {
                const tracks = tops.map((pto) => pto.track!);
                const collection = new TrackCollection(tracks, tracks.length);
                console.log(chalk.magentaBright("Favorites:"));
                await updateTrackListAndPrint(collection, clientContext);
                turnResult = await htmlTrackNames(
                    collection,
                    0,
                    tracks.length,
                    clientContext,
                );
            }
            break;
        }
        case "filterTracks": {
            const filterTracksAction = action as FilterTracksAction;
            const trackCollection = clientContext.currentTrackList;
            if (trackCollection) {
                let filterType: string =
                    filterTracksAction.parameters.filterType;
                const filterText = filterTracksAction.parameters.filterValue;
                const negate = filterTracksAction.parameters.negate;
                // TODO: add filter validation to overall instance validation
                if (filterType === "name") {
                    filterType = "description";
                }
                const filter = filterType + ":" + filterText;
                const parseResult = Filter.parseFilter(filter);
                if (parseResult.ast) {
                    const trackList = await trackCollection.getTracks(
                        clientContext.service,
                    );
                    if (trackList) {
                        const tracks = await applyFilterExpr(
                            clientContext,
                            getTypeChatLanguageModel(),
                            parseResult.ast,
                            trackList,
                            negate,
                        );
                        const collection = new TrackCollection(
                            tracks,
                            tracks.length,
                        );
                        console.log(chalk.magentaBright("Filtered Tracks:"));
                        await updateTrackListAndPrint(
                            collection,
                            clientContext,
                        );
                        turnResult = await htmlTrackNames(
                            collection,
                            0,
                            tracks.length,
                            clientContext,
                        );
                    }
                } else {
                    console.log(parseResult.diagnostics);
                }
            } else {
                console.log(chalk.red("no current track list to filter"));
                turnResult.displayText = `<div>no current track list to filter</div>`;
            }
            break;
        }
        case "createPlaylist": {
            const createPlaylistAction = action as CreatePlaylistAction;
            const name = createPlaylistAction.parameters.name;
            const input = clientContext.currentTrackList;
            if (input !== undefined) {
                const trackList = await input.getTracks(clientContext.service);
                const uris = trackList.map((track) => (track ? track.uri : ""));
                await createPlaylist(
                    clientContext.service,
                    name,
                    clientContext.service.retrieveUser().id!,
                    uris,
                    name,
                );
                console.log(`playlist ${name} created with tracks:`);
                printTrackNames(input, 0, input.getTrackCount(), clientContext);
                turnResult.displayText = `<div>playlist ${name} created with tracks...</div>`;
                turnResult.displayText += await htmlTrackNames(
                    input,
                    0,
                    input.getTrackCount(),
                    clientContext,
                );
            } else {
                console.log(chalk.red("no input tracks for createPlaylist"));
                turnResult.displayText = `<div>no input tracks for createPlaylist</div>`;
            }
            break;
        }
        case "deletePlaylist": {
            const deletePlaylistAction = action as DeletePlaylistAction;
            const playlistName = deletePlaylistAction.parameters.name;
            const playlists = await getPlaylists(clientContext.service);
            const playlist = playlists?.items.find((playlist) => {
                return playlist.name
                    .toLowerCase()
                    .includes(playlistName.toLowerCase());
            });
            if (playlist) {
                await deletePlaylist(clientContext.service, playlist.id);
                console.log(
                    chalk.magentaBright(`playlist ${playlist.name} deleted`),
                );
                turnResult.displayText = `<div>playlist ${playlist.name} deleted</div>`;
                break;
            }

            break;
        }
        case "unknown": {
            const unknownAction = action as UnknownAction;
            const text = unknownAction.parameters.text;
            console.log(`Text not understood in this context: ${text}`);
            turnResult.displayText = `<div>Text not understood in this context: ${text}</div>`;
            break;
        }
    }
    if (turnResult.displayText !== "") {
        return turnResult;
    } else {
        return undefined;
    }
}

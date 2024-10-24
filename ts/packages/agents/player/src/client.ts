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
    PlayAlbumAction,
    PlayAlbumTrackAction,
    PlayArtistAction,
    PlayerAction,
    PlayGenreAction,
    PlayTrackAction,
    SearchTracksAction,
    SelectDeviceAction,
    SetVolumeAction,
    ShuffleAction,
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
    getGenreSeeds,
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
import {
    ActionIO,
    DisplayContent,
    Storage,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromHtmlDisplay,
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";

const debugSpotify = registerDebug("typeagent:spotify");
const debugSpotifyError = registerDebug("typeagent:spotify:error");

function createWarningActionResult(message: string) {
    debugSpotifyError(message);
    return createActionResultFromTextDisplay(chalk.yellow(message), message);
}

function createErrorActionResult(message: string) {
    debugSpotifyError(message);
    return createActionResultFromTextDisplay(chalk.red(message), message);
}

function createNotFoundActionResult(kind: string, queryString?: string) {
    if (queryString)
        debugSpotifyError(`No ${kind} found for query: ${queryString}`);
    const message = `No ${kind} found`;
    return createErrorActionResult(message);
}

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
    const displayContent: DisplayContent = {
        type: "html",
        content: "",
    };

    const actionResult: ActionResult = {
        displayContent,
        literalText: "",
        entities: [],
    };
    let prevUrl = "";
    if (selectedTracks.length > 1) {
        displayContent.content = `<div class='track-list scroll_enabled'><div>${headText}...</div><ol>\n`;
        let entCount = 0;
        for (const track of selectedTracks) {
            if (entCount < 1) {
                // make an entity for the track
                actionResult.entities.push({
                    name: track.name,
                    type: ["track", "song"],
                });
                // make an entity for each artist
                for (const artist of track.artists) {
                    actionResult.entities.push({
                        name: artist.name,
                        type: ["artist"],
                    });
                }
                // make an entity for the album
                actionResult.entities.push({
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
                displayContent.content += `  <li><div class='track-album-cover-container'>\n <div class='track-info'> <div class='track-title'>${track.name}</div>\n`;
                displayContent.content += `    <div class='track-artist'>${artists}</div>`;
                displayContent.content += `    <div>Album: ${track.album.name}</div></div>\n`;
                displayContent.content += `  <img src='${track.album.images[0].url}' alt='album cover' class='track-album-cover' />\n`;
                prevUrl = track.album.images[0].url;
                displayContent.content += `  </div></li>\n`;
            } else {
                displayContent.content += `  <li><span class='track-title'>${track.name}</span>`;
                displayContent.content += `    <div class='track-artist'>${artists}</div>`;
                displayContent.content += `    <div>Album: ${track.album.name}</div>\n`;
                displayContent.content += `  </li>\n`;
            }
        }
        displayContent.content += "</ol></div>";
        actionResult.literalText =
            "Updated the current track list with the numbered list of tracks on the screen";
    } else if (selectedTracks.length === 1) {
        const track = selectedTracks[0];
        const artistsPrefix =
            track.artists.length > 1 ? "   Artists: " : "   Artist: ";
        const artists =
            artistsPrefix +
            track.artists.map((artist) => artist.name).join(", ");
        actionResult.entities.push({
            name: track.name,
            type: ["track", "song"],
        });
        // make an entity for each artist
        for (const artist of track.artists) {
            actionResult.entities.push({
                name: artist.name,
                type: ["artist"],
            });
        }
        // make an entity for the album
        actionResult.entities.push({
            name: track.album.name,
            type: ["album"],
        });
        const litArtistsPrefix =
            track.artists.length > 1 ? "artists: " : "artist ";
        const litArtists =
            litArtistsPrefix +
            track.artists.map((artist) => artist.name).join(", ");
        actionResult.literalText = `Now playing: ${track.name} from album ${track.album.name} with ${litArtists}`;
        if (track.album.images.length > 0 && track.album.images[0].url) {
            displayContent.content = "<div class='track-list scroll_enabled'>";
            displayContent.content +=
                "<div class='track-album-cover-container'>";
            displayContent.content += `  <div class='track-info'>`;
            displayContent.content += `    <div class='track-title'>${track.name}</div>`;
            displayContent.content += `    <div>${artists}</div>`;
            displayContent.content += `    <div>Album: ${track.album.name}</div>`;
            displayContent.content += "</div>";
            displayContent.content += `  <img src='${track.album.images[0].url}' alt='album cover' class='track-album-cover' />\n`;
            displayContent.content += "</div>";
            displayContent.content += "</div>";
        } else {
            displayContent.content = "<div class='track-list scroll_enabled'>";
            displayContent.content += `    <div class='track-title'>${track.name}</div>`;
            displayContent.content += `    <div>${artists}</div>`;
            displayContent.content += `    <div>Album: ${track.album.name}</div>`;
            displayContent.content += "</div>";
        }
    } else {
        return createNotFoundActionResult("tracks");
    }
    return actionResult;
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
        q: queryString,
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
        const actionResult = await htmlTrackNames(
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
        return actionResult;
    } else {
        const message = "No active device found";
        return createActionResultFromTextDisplay(chalk.red(message), message);
    }
}

async function playAlbums(
    albums: SpotifyApi.AlbumObjectSimplified[],
    quantity: number,
    trackSpec: string | number[] | undefined,
    clientContext: IClientContext,
): Promise<ActionResult> {
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
    let albumTracks = (await Promise.all(albumTracksP))
        .filter((result) => result.tracks !== undefined)
        .flatMap((result) =>
            result.tracks!.map((item) => toTrackObjectFull(item, result.album)),
        );

    if (albumTracks && albumTracks.length > 0) {
        if (trackSpec !== undefined) {
            if (typeof trackSpec === "string") {
                // TODO: better heuristic match
                albumTracks = albumTracks.filter((track) =>
                    track.name.toLowerCase().includes(trackSpec.toLowerCase()),
                );
            } else {
                albumTracks = albumTracks.filter((track) =>
                    trackSpec.includes(track.track_number),
                );
            }
        }
        // Play the tracks from these album.
        const collection = new TrackCollection(albumTracks, albumTracks.length);
        return playTracks(collection, 0, albumTracks.length, clientContext);
    }
    const message = `Unable to get track`;
    return createActionResultFromTextDisplay(chalk.red(message), message);
}

type SpotifyQuery = {
    track?: string[] | undefined;
    album?: string[] | undefined;
    artist?: string[] | undefined;
    genre?: string[] | undefined;
    query?: string[] | undefined;
};

function toQueryString(query: SpotifyQuery) {
    const queryParts: string[] = [];
    query.track?.forEach((track) => queryParts.push(`track:"${track}"`));
    query.album?.forEach((album) => queryParts.push(`album:"${album}"`));
    query.artist?.forEach((artist) => queryParts.push(`artist:"${artist}"`));
    query.genre?.forEach((genre) => queryParts.push(`genre:"${genre}"`));
    query.query?.forEach((query) => queryParts.push(query));

    const queryString = queryParts.join(" ");
    debugSpotify(`Query: ${queryString}`);
    return queryString;
}

async function playTracksWithQuery(
    query: SpotifyQuery,
    quantity: number,
    clientContext: IClientContext,
): Promise<ActionResult> {
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
        return createNotFoundActionResult("tracks", queryString);
    }

    // TODO: if there is not exact match for artist, might want to consider popularity of
    // the artist too.
    let tracks: SpotifyApi.TrackObjectFull[];
    const hasQuery = query.query !== undefined && query.query.length > 0;
    const hasTrack = query.track !== undefined && query.track.length > 0;
    if (!hasQuery && !hasTrack) {
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
    return createNotFoundActionResult("tracks", queryString);
}

async function playRandomAction(clientContext: IClientContext) {
    const savedTracks = await getFavoriteTracks(clientContext.service);
    if (savedTracks && savedTracks.length > 0) {
        const tracks = savedTracks.map((track) => track.track);
        const collection = new TrackCollection(tracks, tracks.length);
        return playTracks(collection, 0, tracks.length, clientContext);
    }
    const message = "No favorite tracks found";
    return createActionResultFromTextDisplay(chalk.red(message), message);
}

async function resolveArtists(
    clientContext: IClientContext,
    artists: string[] | undefined,
) {
    return artists
        ? await Promise.all(
              artists.map(async (item) => {
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
          )
        : [];
}
async function playTrackAction(
    clientContext: IClientContext,
    playAction: PlayTrackAction,
): Promise<ActionResult> {
    // query specified
    const query: SpotifyQuery = {
        track: [playAction.parameters.trackName],
        artist: await resolveArtists(
            clientContext,
            playAction.parameters.artists,
        ),
    };
    return await playTracksWithQuery(query, 1, clientContext);
}

async function playAlbumAction(
    clientContext: IClientContext,
    playAction: PlayAlbumAction,
): Promise<ActionResult> {
    // query specified
    const query: SpotifyQuery = {
        album: [playAction.parameters.albumName],
        artist: await resolveArtists(
            clientContext,
            playAction.parameters.artists,
        ),
    };
    const queryString = toQueryString(query);
    // Look for the albums
    const searchQuery: SpotifyApi.SearchForItemParameterObject = {
        q: queryString,
        type: "album",
        limit: 1,
        offset: 0,
    };
    const result = await search(searchQuery, clientContext.service);
    const albums = result?.albums?.items;

    if (albums === undefined || albums.length === 0) {
        return createNotFoundActionResult("albums", queryString);
    }

    return playAlbums(
        albums,
        1,
        playAction.parameters.trackNumber,
        clientContext,
    );
}

async function playAlbumTrackAction(
    clientContext: IClientContext,
    playAction: PlayAlbumTrackAction,
): Promise<ActionResult> {
    // query specified
    const query: SpotifyQuery = {
        track: [],
        album: [playAction.parameters.albumName],
        artist: await resolveArtists(
            clientContext,
            playAction.parameters.artists,
        ),
    };
    const queryString = toQueryString(query);
    // Look for the albums
    const searchQuery: SpotifyApi.SearchForItemParameterObject = {
        q: queryString,
        type: "album",
        limit: 1,
        offset: 0,
    };
    const result = await search(searchQuery, clientContext.service);
    const albums = result?.albums?.items;

    if (albums === undefined || albums.length === 0) {
        return createNotFoundActionResult("albums", queryString);
    }
    return playAlbums(
        albums,
        1,
        playAction.parameters.trackName,
        clientContext,
    );
}

async function playArtistAction(
    clientContext: IClientContext,
    playAction: PlayArtistAction,
): Promise<ActionResult> {
    // query specified
    const query: SpotifyQuery = {
        artist: await resolveArtists(clientContext, [
            playAction.parameters.artist,
        ]),
    };
    return await playTracksWithQuery(
        query,
        playAction.parameters.quantity ?? 0,
        clientContext,
    );
}

async function playGenreAction(
    clientContext: IClientContext,
    playAction: PlayGenreAction,
): Promise<ActionResult> {
    // TODO: cache this.

    const genreSeed = await getGenreSeeds(clientContext.service);

    const genre = genreSeed?.genres.find(
        (g) => g === playAction.parameters.genre,
    );

    const query: SpotifyQuery = genre
        ? {
              genre: [genre],
          }
        : {
              query: [playAction.parameters.genre],
          };
    return await playTracksWithQuery(
        query,
        playAction.parameters.quantity ?? 0,
        clientContext,
    );
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
    if (!state) {
        return createWarningActionResult("No active playback to resume");
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) {
        return createWarningActionResult("No device active");
    }

    if (state.is_playing) {
        console.log(chalk.yellow("Music already playing"));
    } else {
        await play(clientContext.service, deviceId);
    }
    await printStatus(clientContext);
    const status = await htmlStatus(clientContext);
    return status;
}

async function pauseActionCall(
    clientContext: IClientContext,
): Promise<ActionResult> {
    const state = await getPlaybackState(clientContext.service);
    if (!state) {
        return createWarningActionResult("No active playback to resume");
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) {
        return createWarningActionResult("No device active");
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
        return createWarningActionResult("No active playback to resume");
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) {
        return createWarningActionResult("No device active");
    }

    await next(clientContext.service, deviceId);
    await printStatus(clientContext);
    const statusHtml = await htmlStatus(clientContext);
    return statusHtml;
}

async function previousActionCall(clientContext: IClientContext) {
    const state = await getPlaybackState(clientContext.service);
    if (!state) {
        return createWarningActionResult("No active playback to resume");
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) {
        return createWarningActionResult("No device active");
    }

    await previous(clientContext.service, deviceId);
    await printStatus(clientContext);
    const statusHtml = await htmlStatus(clientContext);
    return statusHtml;
}

async function shuffleActionCall(clientContext: IClientContext, on: boolean) {
    const state = await getPlaybackState(clientContext.service);
    if (!state) {
        return createWarningActionResult("No active playback to resume");
    }
    const deviceId = ensureClientId(state);
    if (deviceId === undefined) {
        return createWarningActionResult("No device active");
    }

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
    actionIO: ActionIO,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "playRandom":
            return playRandomAction(clientContext);
        case "playTrack":
            return playTrackAction(clientContext, action);
        case "playAlbum":
            return playAlbumAction(clientContext, action);
        case "playAlbumTrack":
            return playAlbumTrackAction(clientContext, action);
        case "playArtist":
            return playArtistAction(clientContext, action);
        case "playGenre":
            return playGenreAction(clientContext, action);
        case "status": {
            await printStatus(clientContext);
            return htmlStatus(clientContext);
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
                return htmlTrackNames(
                    collection,
                    0,
                    filtered.length,
                    clientContext,
                    "Queue",
                );
            }
            return createNotFoundActionResult("tracks in the queue");
        }
        case "pause": {
            return pauseActionCall(clientContext);
        }
        case "next": {
            return nextActionCall(clientContext);
        }
        case "previous": {
            return previousActionCall(clientContext);
        }
        case "shuffle": {
            const shuffleAction = action as ShuffleAction;
            return shuffleActionCall(
                clientContext,
                shuffleAction.parameters.on,
            );
        }
        case "resume": {
            return resumeActionCall(clientContext);
        }
        case "listDevices": {
            const result = await listAvailableDevices(clientContext);
            return result
                ? createActionResultFromHtmlDisplay(result.html, result.lit)
                : createErrorActionResult("No devices found");
        }
        case "selectDevice": {
            const selectDeviceAction = action as SelectDeviceAction;
            const keyword = selectDeviceAction.parameters.keyword;
            const result = await selectDevice(keyword, clientContext);
            if (result) {
                const { html, text } = result;
                return createActionResultFromHtmlDisplay(html, text);
            } else return createErrorActionResult("No devices found");
        }
        case "setVolume": {
            const setVolumeAction = action as SetVolumeAction;
            let newVolumeLevel = setVolumeAction.parameters.newVolumeLevel;
            if (newVolumeLevel > 50) {
                newVolumeLevel = 50;
            }
            actionIO.setDisplay(
                chalk.yellowBright(`setting volume to ${newVolumeLevel} ...`),
            );
            await setVolume(clientContext.service, newVolumeLevel);
            return htmlStatus(clientContext);
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
                actionIO.setDisplay(
                    chalk.yellowBright(`setting volume to ${nv} ...`),
                );
                await setVolume(clientContext.service, nv);
                return htmlStatus(clientContext);
            }
            return createErrorActionResult("No active device found");
        }
        case "searchTracks": {
            const searchTracksAction = action as SearchTracksAction;
            const queryString = searchTracksAction.parameters.query;
            const searchResult = await searchTracks(queryString, clientContext);
            if (searchResult) {
                console.log(chalk.magentaBright("Search Results:"));
                updateTrackListAndPrint(searchResult, clientContext);
                return htmlTrackNames(
                    searchResult,
                    0,
                    searchResult.getTrackCount(),
                    clientContext,
                    "Search Results",
                );
            }
            return createNotFoundActionResult("tracks", queryString);
        }
        case "listPlaylists": {
            const playlists = await getPlaylists(clientContext.service);
            if (playlists) {
                let html = "<div>Playlists...</div>";
                for (const playlist of playlists.items) {
                    console.log(chalk.magentaBright(`${playlist.name}`));
                    html += `<div>${playlist.name}</div>`;
                }
                return createActionResultFromTextDisplay(html);
            }
            return createErrorActionResult("No playlists found");
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
                    return htmlTrackNames(
                        collection,
                        0,
                        collection.getTrackCount(),
                        clientContext,
                        `Playlist: ${playlist.name}`,
                    );
                }
            }
            return createNotFoundActionResult(`playlist ${playlistName}`);
        }
        case "getAlbum": {
            const getAlbumAction = action as unknown as GetPlaylistAction;
            const name = getAlbumAction.parameters.name;
            let album: SpotifyApi.AlbumObjectSimplified | undefined = undefined;
            let status: SpotifyApi.CurrentPlaybackResponse | undefined =
                undefined;
            if (name.length > 0) {
                actionIO.setDisplay(
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
                    actionIO.setDisplay(
                        chalk.magentaBright(
                            `${getAlbumAction.parameters.name}:`,
                        ),
                    );
                    await updateTrackListAndPrint(collection, clientContext);
                    return htmlTrackNames(
                        collection,
                        0,
                        collection.getTrackCount(),
                        clientContext,
                    );
                }
                return createNotFoundActionResult(`tracks from album ${name}`);
            }
            return createNotFoundActionResult("album");
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
                return htmlTrackNames(
                    collection,
                    0,
                    tracks.length,
                    clientContext,
                );
            }
            return createErrorActionResult("No favorites found");
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
                        return await htmlTrackNames(
                            collection,
                            0,
                            tracks.length,
                            clientContext,
                        );
                    }
                } else {
                    console.log(parseResult.diagnostics);
                }
            }
            return createErrorActionResult("no current track list to filter");
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
                return createActionResultFromHtmlDisplay(
                    `<div>playlist ${name} created with tracks...</div>${await htmlTrackNames(
                        input,
                        0,
                        input.getTrackCount(),
                        clientContext,
                    )}`,
                );
            }
            return createErrorActionResult(
                "no input tracks for createPlaylist",
            );
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
            if (playlist !== undefined) {
                await deletePlaylist(clientContext.service, playlist.id);
                return createActionResultFromTextDisplay(
                    chalk.magentaBright(`playlist ${playlist.name} deleted`),
                );
            }
            return createErrorActionResult(
                `playlist ${playlistName} not found`,
            );
        }
        default:
            return createErrorActionResult(
                `Action not supported: ${action.actionName}`,
            );
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { IClientContext } from "./client.js";
import {
    getAlbum,
    getAlbums,
    getArtist,
    getArtistTopTracks,
    getTrack,
    search,
} from "./endpoints.js";
import { MusicItemInfo, SpotifyUserData } from "./userData.js";
import chalk from "chalk";
import { SpotifyService } from "./service.js";
import { Entity } from "@typeagent/agent-sdk";

const debug = registerDebug("typeagent:spotify:search");
const debugReuse = registerDebug("typeagent:spotify:search:reuse");
const debugVerbose = registerDebug("typeagent:spotify-verbose:search");
const debugError = registerDebug("typeagent:spotify:search:error");

export type SpotifyQuery = {
    track?: string[] | undefined;
    album?: string[] | undefined;
    artist?: string[] | undefined;
    genre?: string[] | undefined;
    query?: string[] | undefined;
};

export function quoteString(str: string) {
    // Ignore quote in the str and put outter quotes.
    return `"${str.replace(/"/g, "")}"`;
}

export function toQueryString(query: SpotifyQuery) {
    const queryParts: string[] = [];
    query.track?.forEach((t) => queryParts.push(`track:${quoteString(t)}`));
    query.album?.forEach((t) => queryParts.push(`album:${quoteString(t)}`));
    query.artist?.forEach((t) => queryParts.push(`artist:${quoteString(t)}`));
    query.genre?.forEach((t) => queryParts.push(`genre:${quoteString(t)}`));
    query.query?.forEach((query) => queryParts.push(query));

    return queryParts.join(" ");
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
        q: `artist:${quoteString(searchTerm)}`,
        type: "artist",
        limit: 50,
        offset: 0,
    };
    return search(query, context.service);
}

export async function searchAlbums(
    albumName: string,
    artists: string[] | undefined,
    context: IClientContext,
) {
    const query: SpotifyQuery = {
        album: [albumName],
        artist: artists,
    };

    const queryString = toQueryString(query);
    // Look for the albums
    const searchQuery: SpotifyApi.SearchForItemParameterObject = {
        q: queryString,
        type: "album",
        limit: 50,
        offset: 0,
    };
    const result = await search(searchQuery, context.service);
    if (
        result === undefined ||
        result.albums === undefined ||
        result.albums.items.length === 0
    ) {
        debug(`No album found for query: ${queryString}`);
        return undefined;
    }
    debug(
        `${result.albums.items.length} album found for query: ${queryString}`,
    );
    return result.albums.items;
}

async function getArtistFromEntity(
    artistName: string,
    context: IClientContext,
    artistEntity: Entity | undefined,
) {
    if (
        artistEntity !== undefined &&
        artistEntity.type.includes("artist") &&
        artistEntity.uniqueId !== undefined
    ) {
        debugReuse(
            `Reusing artist entity: ${artistName}: ${artistEntity.uniqueId}`,
        );
        return getArtist(context.service, artistEntity.uniqueId);
    }
    return undefined;
}

async function searchArtistSorted(
    artistName: string,
    context: IClientContext,
    artistEntity: Entity | undefined,
): Promise<SpotifyApi.ArtistObjectFull[] | undefined> {
    if (artistEntity) {
        const artist = await getArtistFromEntity(
            artistName,
            context,
            artistEntity,
        );

        if (artist !== undefined) {
            return [artist];
        }
    }

    const data = await searchArtists(artistName, context);
    if (data && data.artists && data.artists.items.length > 0) {
        // Prefer the known one, then exact match, and then popularity.
        const artists = data.artists.items.sort((a, b) => {
            if (context.userData !== undefined) {
                const compKnown = compareKnownArtists(
                    context.userData.data,
                    [a],
                    [b],
                );
                if (compKnown !== 0) {
                    return compKnown;
                }
            }
            return b.popularity - a.popularity;
        });

        dumpArtists(artists, context.userData?.data.artists);

        return artists;
    }
}

async function getAlbumsByIds(service: SpotifyService, ids: string[]) {
    const albums: SpotifyApi.AlbumObjectFull[] = [];
    for (let i = 0; i < ids.length; i += 20) {
        const result = await getAlbums(service, ids.slice(i, i + 20));
        if (result === undefined || result.albums.length === 0) {
            // skip id not found?
            continue;
        }
        albums.push(...result.albums);
    }

    return albums.length === 0 ? undefined : albums;
}

async function getAlbumFromEntity(
    albumName: string,
    context: IClientContext,
    albumEntity: Entity | undefined,
) {
    if (
        albumEntity !== undefined &&
        albumEntity.type.includes("album") &&
        albumEntity.uniqueId !== undefined
    ) {
        debugReuse(
            `Reusing album entity: ${albumName}: ${albumEntity.uniqueId}`,
        );
        return getAlbum(context.service, albumEntity.uniqueId);
    }
    return undefined;
}

async function searchAlbumSorted(
    albumName: string,
    artists: SpotifyApi.ArtistObjectFull[] | undefined,
    context: IClientContext,
    albumEntity: Entity | undefined,
) {
    const albumFromEntity = await getAlbumFromEntity(
        albumName,
        context,
        albumEntity,
    );
    if (albumFromEntity) {
        if (filterByArtists([albumFromEntity], artists) !== undefined) {
            return [albumFromEntity];
        }
    }

    const artistNames = artists?.map((a) => a.name);
    const albumsResult = await searchAlbums(albumName, artistNames, context);
    const albums = filterByArtists(albumsResult, artists);
    if (albums === undefined) {
        return undefined;
    }
    const fullAlbums = await getAlbumsByIds(
        context.service,
        albums.map((a) => a.id),
    );
    if (fullAlbums === undefined) {
        debugError("Unable to resolve to full albums");
        return undefined;
    }

    if (fullAlbums.length === 1) {
        return fullAlbums;
    }

    return fullAlbums.sort((a, b) => {
        if (context.userData !== undefined) {
            const compKnown = compareKnownAlbums(context.userData.data, a, b);
            if (compKnown !== 0) {
                return compKnown;
            }
        }
        const compName = compareNames(albumName, a, b);
        return compName !== 0 ? compName : b.popularity - a.popularity;
    });
}

type SimplifiedObject =
    | SpotifyApi.TrackObjectSimplified
    | SpotifyApi.AlbumObjectSimplified
    | SpotifyApi.ArtistObjectSimplified;

const nameLocaleCompareOptions = {
    usage: "search",
    sensitivity: "base",
} as const;

export function equivalentNames(a: string, b: string) {
    return a.localeCompare(b, "en", nameLocaleCompareOptions) == 0;
}
function compareNames(name: string, a: SimplifiedObject, b: SimplifiedObject) {
    // TODO: Might want to use fuzzy matching here.
    const equivalentA = equivalentNames(a.name, name) ? 1 : 0;
    const equivalentB = equivalentNames(b.name, name) ? 1 : 0;
    return equivalentB - equivalentA;
}

function compareKnownArtists(
    userData: SpotifyUserData,
    a: SpotifyApi.ArtistObjectSimplified[],
    b: SpotifyApi.ArtistObjectSimplified[],
) {
    const knownArtists = userData.artists;
    const knownA = a.filter((artist) => knownArtists.has(artist.id)).length;
    const knownB = b.filter((artist) => knownArtists.has(artist.id)).length;
    return knownB - knownA;
}

function compareKnownAlbums(
    userData: SpotifyUserData,
    a: SpotifyApi.AlbumObjectSimplified,
    b: SpotifyApi.AlbumObjectSimplified,
) {
    const knownAlbums = userData.albums;
    const knownA = knownAlbums.has(a.id) ? 1 : 0;
    const knownB = knownAlbums.has(b.id) ? 1 : 0;
    const known = knownB - knownA;
    if (known !== 0) {
        return known;
    }

    // both are not known, prefer the album with known artist
    return compareKnownArtists(userData, a.artists, b.artists);
}

function compareKnownTracks(
    userData: SpotifyUserData,
    a: SpotifyApi.TrackObjectFull,
    b: SpotifyApi.TrackObjectFull,
) {
    const knownTracks = userData.tracks;
    const knownA = knownTracks.has(a.id) ? 1 : 0;
    const knownB = knownTracks.has(b.id) ? 1 : 0;
    const known = knownB - knownA;
    if (known !== 0) {
        return known;
    }

    // both are not known, prefer the album with known artist
    const knownArtists = compareKnownArtists(userData, a.artists, b.artists);
    if (knownArtists !== 0) {
        return knownArtists;
    }

    return compareKnownAlbums(userData, a.album, b.album);
}

export async function resolveArtists(
    artistNames: string[],
    context: IClientContext,
    artistEntities?: (Entity | undefined)[],
): Promise<SpotifyApi.ArtistObjectFull[] | undefined> {
    try {
        return await findArtists(artistNames, context, artistEntities);
    } catch {
        return undefined;
    }
}

async function findArtists(
    artistNames: string[],
    context: IClientContext,
    artistEntities: (Entity | undefined)[] | undefined,
): Promise<SpotifyApi.ArtistObjectFull[]> {
    const matches = await Promise.all(
        artistNames.map((a, i) =>
            searchArtistSorted(a, context, artistEntities?.[i]),
        ),
    );

    const artists: SpotifyApi.ArtistObjectFull[] = [];
    for (let i = 0; i < artistNames.length; i++) {
        const match = matches[i];
        if (match === undefined) {
            throw new Error(`Unable to find artist '${artistNames[i]}'`);
        }
        artists.push(match[0]);
    }

    return artists;
}

async function searchAlbumsWithTrackArtists(
    albumName: string,
    artists: SpotifyApi.ArtistObjectFull[],
    context: IClientContext,
    albumEntity: Entity | undefined,
) {
    // Try again without artist, as the artist on the album might not match the one in the tracks.
    let albums = await searchAlbumSorted(
        albumName,
        undefined,
        context,
        albumEntity,
    );
    if (albums === undefined) {
        return undefined;
    }

    const filtered = albums.filter((album) =>
        album.tracks.items.some((track) =>
            track.artists.some((trackArtist) =>
                artists.some((artist) => artist.id === trackArtist.id),
            ),
        ),
    );

    return filtered.length === 0 ? undefined : filtered;
}

export async function findArtistTracksWithGenre(
    artistName: string,
    genre: string,
    context: IClientContext,
    artistEntity: Entity | undefined,
) {
    const artists = await searchArtistSorted(artistName, context, artistEntity);
    if (artists === undefined) {
        throw new Error(`Unable to find artist '${artistName}'`);
    }

    const query: SpotifyQuery = {
        artist: [artistName],
        query: [genre],
    };

    const queryString = toQueryString(query);
    const param: SpotifyApi.SearchForItemParameterObject = {
        q: queryString,
        type: "track",
        limit: 50,
        offset: 0,
    };
    const result = await search(param, context.service);
    const tracks = result?.tracks?.items?.filter((track) =>
        track.artists.some((trackArtist) => trackArtist.id === artists[0].id),
    );
    if (tracks === undefined || tracks.length === 0) {
        throw new Error(
            `Unable find track with genre '${genre}' and artist '${artistName}'`,
        );
    }
    return tracks;
}

export async function findArtistTopTracks(
    artistName: string,
    context: IClientContext,
    artistEntity: Entity | undefined,
): Promise<SpotifyApi.TrackObjectFull[]> {
    const artists = await searchArtistSorted(artistName, context, artistEntity);
    if (artists === undefined) {
        throw new Error(`Unable to find artist '${artistName}'`);
    }

    const artist = artists[0];
    const artistId = artist.id;
    const result = await getArtistTopTracks(context.service, artistId);
    const tracks = result?.tracks;
    if (tracks === undefined || tracks.length === 0) {
        throw new Error(`No tracks found for artist ${artist}`);
    }
    return tracks;
}

export async function findAlbums(
    albumName: string,
    artistNames: string[] | undefined,
    context: IClientContext,
    albumEntity: Entity | undefined,
    artistEntities: (Entity | undefined)[] | undefined,
): Promise<SpotifyApi.AlbumObjectFull[]> {
    let albums: SpotifyApi.AlbumObjectFull[] | undefined;
    if (artistNames !== undefined) {
        // try search for the most likely artist names.
        const matchedArtists = await findArtists(
            artistNames,
            context,
            artistEntities,
        );
        albums = await searchAlbumSorted(
            albumName,
            matchedArtists,
            context,
            albumEntity,
        );

        if (albums === undefined) {
            albums = await searchAlbumsWithTrackArtists(
                albumName,
                matchedArtists,
                context,
                albumEntity,
            );
            if (albums === undefined) {
                throw new Error(
                    `Unable to find album '${albumName}' with artists ${matchedArtists.map((artist) => artist.name).join(", ")}`,
                );
            }
        }
    } else {
        albums = await searchAlbumSorted(
            albumName,
            undefined,
            context,
            albumEntity,
        );
        if (albums === undefined) {
            throw new Error(`Unable to find album '${albumName}'`);
        }
    }

    dumpAlbums(albums, context.userData?.data);

    return albums;
}

async function expandMovementTracks(
    originalQuery: SpotifyQuery,
    tracks: SpotifyApi.TrackObjectFull[],
    quantity: number = 50,
    context: IClientContext,
) {
    // With search terms for track name, search for matching songs in the albums (to gather multi-movement songs)
    const albums = new Map(
        tracks.map((track) => [track.album.id, track.album.name]),
    );

    const expandedTracks = [];
    for (const [id, album] of albums) {
        const param: SpotifyApi.SearchForItemParameterObject = {
            q: toQueryString({ ...originalQuery, album: [album] }),
            type: "track",
            limit: 50,
            offset: 0,
        };
        const result = await search(param, context.service);
        if (result?.tracks !== undefined) {
            expandedTracks.push(
                ...result.tracks.items
                    .filter((track) => track.album.id === id)
                    .sort((a, b) => {
                        if (a.disc_number !== b.disc_number) {
                            return a.disc_number - b.disc_number;
                        }
                        return a.track_number - b.track_number;
                    }),
            );
            if (expandedTracks.length > quantity) {
                break;
            }
        }
    }
    return expandedTracks;
}

async function sortAndExpandMovement(
    context: IClientContext,
    query: SpotifyQuery,
    tracks: SpotifyApi.TrackObjectFull[],
    quantity: number,
) {
    const userData = context.userData?.data;
    const trackName = query.track?.[0];
    let result = tracks.sort((a, b) => {
        if (userData) {
            const compKnown = compareKnownTracks(userData, a, b);
            if (compKnown !== 0) {
                return compKnown;
            }
        }

        if (trackName) {
            const compName = compareNames(trackName, a, b);
            if (compName !== 0) {
                return compName;
            }
        }
        return b.popularity - a.popularity;
    });

    if (quantity > 0) {
        result = result.slice(0, quantity);
    }

    if (trackName && !equivalentNames(result[0].name, trackName)) {
        // Expand movements if it is not an exact match
        result = await expandMovementTracks(query, result, quantity, context);
    }

    dumpTracks(result, userData);
    return result;
}

export async function findTracksWithGenre(
    context: IClientContext,
    genre: string,
    quantity: number = 0,
): Promise<SpotifyApi.TrackObjectFull[]> {
    // TODO: cache this.
    const query: SpotifyQuery = {
        query: [genre],
    };

    const queryString = toQueryString(query);
    const param: SpotifyApi.SearchForItemParameterObject = {
        q: queryString,
        type: "track",
        limit: 50,
        offset: 0,
    };
    const result = await search(param, context.service);
    const tracks = result?.tracks?.items;
    if (tracks === undefined || tracks.length === 0) {
        throw new Error(`Unable find track with genre '${genre}'`);
    }

    return sortAndExpandMovement(context, query, tracks, quantity);
}

function filterByArtists<
    T extends
        | SpotifyApi.TrackObjectSimplified
        | SpotifyApi.AlbumObjectSimplified,
>(
    items: T[] | undefined,
    artists: SpotifyApi.ArtistObjectFull[] | undefined,
): T[] | undefined {
    if (items === undefined || artists === undefined) {
        return items;
    }
    const result = items.filter((track) =>
        track.artists.some((trackArtist) =>
            artists.some((artist) => artist.id === trackArtist.id),
        ),
    );
    return result.length === 0 ? undefined : result;
}

export async function getTrackFromEntity(
    trackName: string,
    context: IClientContext,
    trackEntity: Entity | undefined,
) {
    if (
        trackEntity !== undefined &&
        trackEntity.type.includes("track") &&
        trackEntity.uniqueId !== undefined
    ) {
        debugReuse(
            `Reusing track entity: ${trackName}: ${trackEntity.uniqueId}`,
        );
        return getTrack(context.service, trackEntity.uniqueId);
    }
    return undefined;
}

export async function findTracks(
    context: IClientContext,
    trackName: string,
    artistNames: string[] | undefined,
    trackEntity: Entity | undefined,
    artistEntities: (Entity | undefined)[] | undefined,
    quantity: number = 0,
): Promise<SpotifyApi.TrackObjectFull[]> {
    // try search for the most likely artist names.
    const matchedArtists = artistNames
        ? await findArtists(artistNames, context, artistEntities)
        : undefined;

    const trackFromEntity = await getTrackFromEntity(
        trackName,
        context,
        trackEntity,
    );

    if (trackFromEntity) {
        if (filterByArtists([trackFromEntity], matchedArtists) !== undefined) {
            return [trackFromEntity];
        }
    }

    const matchedArtistNames = matchedArtists?.map((a) => a.name);
    const query: SpotifyQuery = {
        track: [trackName],
        artist: matchedArtistNames,
    };
    const queryString = toQueryString(query);
    const param: SpotifyApi.SearchForItemParameterObject = {
        q: queryString,
        type: "track",
        limit: 50,
        offset: 0,
    };
    const result = await search(param, context.service);
    const trackResult = result?.tracks?.items;

    const tracks = filterByArtists(trackResult, matchedArtists);
    if (tracks === undefined || tracks.length === 0) {
        throw new Error(
            `Unable find track '${trackName}'${matchedArtistNames !== undefined && matchedArtistNames.length > 0 ? ` by ${matchedArtistNames.join(", ")}` : ""}`,
        );
    }

    return sortAndExpandMovement(context, query, tracks, quantity);
}

function dumpArtists(
    items: SpotifyApi.ArtistObjectFull[],
    known?: Map<string, MusicItemInfo>,
) {
    if (!debug.enabled) {
        return;
    }

    debug(`Found ${items.length} possible artists:`);
    for (const item of items) {
        debug(
            `${item.popularity.toString().padStart(3)} ${item.name}${known?.has(item.id) ? chalk.cyan(" (known)") : ""}`,
        );
    }
}

function dumpListWithArtists<
    T extends SpotifyApi.AlbumObjectFull | SpotifyApi.TrackObjectFull,
>(
    kind: string,
    items: T[],
    knownStr: (item: T) => string,
    knownArtists?: Map<string, MusicItemInfo>,
) {
    if (!debug.enabled && !debugVerbose.enabled) {
        return;
    }

    debug(`Found ${items.length} ${kind}:`);
    for (const item of items) {
        const title = `${item.popularity.toString().padStart(3)} ${item.name}`;
        const artists = `${item.artists
            .map(
                (a) =>
                    `${a.name}${knownArtists?.has(a.id) ? chalk.cyan(" (known)") : ""}`,
            )
            .join(", ")}`;

        debug(`${title}${knownStr(item)} - ${artists}`);
        debugVerbose(
            JSON.stringify(
                item,
                (key, value) => {
                    if (key === "available_markets") {
                        return undefined;
                    }
                    return value;
                },
                2,
            ),
        );
    }
}
function dumpAlbums(
    items: SpotifyApi.AlbumObjectFull[],
    userData?: SpotifyUserData,
) {
    dumpListWithArtists(
        "albums",
        items,
        (item) => {
            return userData?.albums?.has(item.id) ? chalk.cyan(" (known)") : "";
        },
        userData?.artists,
    );
}
function dumpTracks(
    items: SpotifyApi.TrackObjectFull[],
    userData?: SpotifyUserData,
) {
    dumpListWithArtists(
        "tracks",
        items,
        (item) => {
            const known: string[] = [];
            if (userData?.albums.has(item.album.id)) {
                known.push("album");
            }

            const knownAlbumArtists = item.album.artists.filter((a) =>
                userData?.artists?.has(a.id),
            );

            if (knownAlbumArtists.length !== 0) {
                known.push(`${knownAlbumArtists.length} album artist`);
            }
            if (known.length == 0) {
                return userData?.tracks?.has(item.id)
                    ? chalk.cyan(" (known)")
                    : "";
            }
            if (userData?.tracks?.has(item.id)) {
                known.unshift("track");
            }
            return chalk.cyan(` (known ${known.join(", ")})`);
        },
        userData?.artists,
    );
}

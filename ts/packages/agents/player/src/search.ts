// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { IClientContext } from "./client.js";
import {
    getAlbums,
    getArtistTopTracks,
    getGenreSeeds,
    search,
} from "./endpoints.js";
import { MusicItemInfo, SpotifyUserData } from "./userData.js";
import chalk from "chalk";
import { SpotifyService } from "./service.js";

const debug = registerDebug("typeagent:spotify:search");
const debugVerbose = registerDebug("typeagent:verbose:spotify:search");
const debugError = registerDebug("typeagent:spotify:search:error");

export type SpotifyQuery = {
    track?: string[] | undefined;
    album?: string[] | undefined;
    artist?: string[] | undefined;
    genre?: string[] | undefined;
    query?: string[] | undefined;
};

export function toQueryString(query: SpotifyQuery) {
    const queryParts: string[] = [];
    query.track?.forEach((track) => queryParts.push(`track:"${track}"`));
    query.album?.forEach((album) => queryParts.push(`album:"${album}"`));
    query.artist?.forEach((artist) => queryParts.push(`artist:"${artist}"`));
    query.genre?.forEach((genre) => queryParts.push(`genre:"${genre}"`));
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
        q: `artist:"${searchTerm}"`,
        type: "artist",
        limit: 50,
        offset: 0,
    };
    return search(query, context.service);
}

async function searchAlbums(
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

async function searchArtistSorted(artistName: string, context: IClientContext) {
    const data = await searchArtists(artistName, context);
    if (data && data.artists && data.artists.items.length > 0) {
        const lowerArtistNames = [artistName.toLowerCase()];

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
            const compName = compareArtistsNames(lowerArtistNames, [a], [b]);
            if (compName !== 0) {
                return compName;
            }
            return b.popularity - a.popularity;
        });

        dumpArtists(artists, context.userData?.data.artists);

        return artists;
    }
}

async function getAlbumsByIds(service: SpotifyService, ids: string[]) {
    const ablums: SpotifyApi.AlbumObjectFull[] = [];
    for (let i = 0; i < ids.length; i += 20) {
        const result = await getAlbums(service, ids.slice(i, i + 20));
        if (result === undefined || result.albums.length === 0) {
            // skip id not found?
            continue;
        }
        ablums.push(...result.albums);
    }

    return ablums.length === 0 ? undefined : ablums;
}
async function searchAlbumSorted(
    albumName: string,
    artists: SpotifyApi.ArtistObjectFull[] | undefined,
    context: IClientContext,
) {
    const artistNames = artists?.map((a) => a.name);
    let albums = await searchAlbums(albumName, artistNames, context);
    if (albums === undefined) {
        return undefined;
    }
    if (artists !== undefined) {
        albums = albums.filter((album) =>
            album.artists.some((albumArtist) =>
                artists.some((artist) => artist.id === albumArtist.id),
            ),
        );

        if (albums.length === 0) {
            return undefined;
        }
    }

    const fullAblums = await getAlbumsByIds(
        context.service,
        albums.map((a) => a.id),
    );
    if (fullAblums === undefined) {
        debugError("Unable to resolve to full albums");
        return undefined;
    }

    if (fullAblums.length === 1) {
        return fullAblums;
    }

    const lowerCaseAlbumName = albumName.toLowerCase();
    const lowerCaseArtistNames = artistNames?.map((a) => a.toLowerCase());

    return fullAblums.sort((a, b) => {
        if (context.userData !== undefined) {
            const compKnown = compareKnownAlbums(context.userData.data, a, b);
            if (compKnown !== 0) {
                return compKnown;
            }
        }
        const compName = compareNameWithArtists(
            lowerCaseAlbumName,
            a,
            b,
            lowerCaseArtistNames,
        );
        return compName !== 0 ? compName : b.popularity - a.popularity;
    });
}

function compareArtistsNames(
    lowerNames: string[],
    a: SpotifyApi.ArtistObjectSimplified[],
    b: SpotifyApi.ArtistObjectSimplified[],
) {
    // TODO: Might want to use fuzzy matching here.
    const exactA = a.filter((a) =>
        lowerNames.some((name) => name === a.name.toLowerCase()),
    );
    const exactB = b.filter((b) =>
        lowerNames.some((name) => name === b.name.toLowerCase()),
    );
    return exactB.length - exactA.length;
}

type SimplifiedObject =
    | SpotifyApi.TrackObjectSimplified
    | SpotifyApi.AlbumObjectSimplified
    | SpotifyApi.ArtistObjectSimplified;

function compareNames(
    lowerName: string,
    a: SimplifiedObject,
    b: SimplifiedObject,
) {
    // TODO: Might want to use fuzzy matching here.
    const exactA = lowerName === a.name.toLowerCase() ? 1 : 0;
    const exactB = lowerName === b.name.toLowerCase() ? 1 : 0;
    return exactB - exactA;
}

function compareNameWithArtists(
    lowerName: string | undefined,
    a: SpotifyApi.TrackObjectSimplified | SpotifyApi.AlbumObjectSimplified,
    b: SpotifyApi.TrackObjectSimplified | SpotifyApi.AlbumObjectSimplified,
    lowerArtistNames: string[] | undefined,
) {
    const exact = lowerName ? compareNames(lowerName, a, b) : 0;
    return exact !== 0 || lowerArtistNames === undefined
        ? exact
        : compareArtistsNames(lowerArtistNames, a.artists, b.artists);
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
): Promise<SpotifyApi.ArtistObjectFull[] | undefined> {
    try {
        return await findArtists(artistNames, context);
    } catch {
        return undefined;
    }
}

async function findArtists(
    artistNames: string[],
    context: IClientContext,
): Promise<SpotifyApi.ArtistObjectFull[]> {
    const matches = await Promise.all(
        artistNames.map((a) => searchArtistSorted(a, context)),
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

async function findAlbumsWithTrackArtists(
    albumName: string,
    artists: SpotifyApi.ArtistObjectFull[],
    context: IClientContext,
) {
    // Try again without artist, as the artist on the album might not match the one in the tracks.
    let albums = await searchAlbumSorted(albumName, undefined, context);
    if (albums === undefined) {
        throw new Error(
            `Unable to find album '${albumName}' with artists ${artists.map((artist) => artist.name).join(", ")}`,
        );
    }

    return albums.filter((album) =>
        album.tracks.items.some((track) =>
            track.artists.some((trackArtist) =>
                artists.some((artist) => artist.id === trackArtist.id),
            ),
        ),
    );
}

export async function findArtistTopTracks(
    artistName: string,
    context: IClientContext,
): Promise<SpotifyApi.TrackObjectFull[]> {
    const artists = await searchArtistSorted(artistName, context);
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
): Promise<SpotifyApi.AlbumObjectFull[]> {
    let albums: SpotifyApi.AlbumObjectFull[] | undefined;
    if (artistNames !== undefined) {
        // try search for the most likely artist names.
        const matchedArtists = await findArtists(artistNames, context);
        albums = await searchAlbumSorted(albumName, matchedArtists, context);

        if (albums === undefined) {
            albums = await findAlbumsWithTrackArtists(
                albumName,
                matchedArtists,
                context,
            );
        }
    } else {
        albums = await searchAlbumSorted(albumName, undefined, context);
        if (albums === undefined) {
            throw new Error(`Unable to find album '${albumName}'`);
        }
    }

    dumpAlbums(albums, context.userData?.data);

    return albums;
}

async function expandMovmentTracks(
    originalQuery: SpotifyQuery,
    tracks: SpotifyApi.TrackObjectFull[],
    context: IClientContext,
    limit: number = 50,
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
            if (expandedTracks.length > limit) {
                break;
            }
        }
    }
    return expandedTracks;
}

async function sortAndExpandMovment(
    context: IClientContext,
    query: SpotifyQuery,
    tracks: SpotifyApi.TrackObjectFull[],
    quantity: number,
) {
    const userData = context.userData?.data;
    const lowerTrackName = query.track?.[0].toLowerCase();
    let result = tracks.sort((a, b) => {
        if (userData) {
            const compKnown = compareKnownTracks(userData, a, b);
            if (compKnown !== 0) {
                return compKnown;
            }
        }

        if (lowerTrackName) {
            const compName = compareNames(lowerTrackName, a, b);
            if (compName !== 0) {
                return compName;
            }
        }
        return b.popularity - a.popularity;
    });

    if (quantity > 0) {
        result = result.slice(0, quantity);
    }

    if (result[0].name.toLowerCase() !== lowerTrackName) {
        // Expand movements
        result = await expandMovmentTracks(query, result, context);
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
    const genreSeed = await getGenreSeeds(context.service);

    const matchedGenre = genreSeed?.genres.find((g) => g === genre);

    const query: SpotifyQuery = matchedGenre
        ? {
              genre: [matchedGenre],
          }
        : {
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

    return sortAndExpandMovment(context, query, tracks, quantity);
}

export async function findTracks(
    context: IClientContext,
    trackName: string,
    artistNames: string[] | undefined,
    quantity: number = 0,
): Promise<SpotifyApi.TrackObjectFull[]> {
    // try search for the most likely artist names.
    const matchedArtists = artistNames
        ? await findArtists(artistNames, context)
        : undefined;

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

    const tracks = matchedArtists
        ? trackResult?.filter((track) =>
              track.artists.some((trackArtist) =>
                  matchedArtists.some(
                      (matchedArtist) => matchedArtist.id === trackArtist.id,
                  ),
              ),
          )
        : trackResult;

    if (tracks === undefined || tracks.length === 0) {
        throw new Error(
            `Unable find track '${trackName}'${matchedArtistNames !== undefined && matchedArtistNames.length > 0 ? ` by ${matchedArtistNames.join(", ")}` : ""}`,
        );
    }

    return sortAndExpandMovment(context, query, tracks, quantity);
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

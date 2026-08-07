// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getFavoriteAlbums,
    getFavoriteTracks,
    getFollowedArtists,
    getPlaylists,
    getRecentlyPlayed,
    getTopUserArtists,
    getTopUserTracks,
} from "./endpoints.js";
import { SpotifyService } from "./service.js";
import registerDebug from "debug";
import { Storage } from "@typeagent/agent-sdk";

const debugData = registerDebug("typeagent:spotify:data");

export interface MusicItemInfo {
    id: string;
    name: string;
    freq: number;
    timestamps: string[];
    albumName?: string;
    albumArtist?: string;
}

export const MAX_ITEM_TIMESTAMPS = 32;

export interface HistorySourceData {
    fingerprint: string;
    tracks: MusicItemInfo[];
    artists: MusicItemInfo[];
    albums: MusicItemInfo[];
}

export interface SpotifyUserData {
    lastUpdated: number;
    playlists?: SpotifyApi.PlaylistObjectSimplified[];
    tracks: Map<string, MusicItemInfo>;
    artists: Map<string, MusicItemInfo>;
    albums: Map<string, MusicItemInfo>;
    historySources?: Record<string, HistorySourceData>;
    nameMap?: Map<string, MusicItemInfo>;
}

interface SpotifyUserDataJSON {
    lastUpdated: number;
    tracks: MusicItemInfo[];
    artists: MusicItemInfo[];
    albums: MusicItemInfo[];
    historySources?: Record<string, HistorySourceData>;
}

function getUserDataFilePath() {
    return "userdata.json";
}

export async function updatePlaylists(
    service: SpotifyService,
    userData: SpotifyUserData,
) {
    try {
        debugData("Updating playlists");
        const rawPlaylists = await getPlaylists(service);
        const playlists: SpotifyApi.PlaylistObjectSimplified[] = [];
        if (rawPlaylists !== undefined) {
            for (const pl of rawPlaylists.items) {
                playlists.push(pl);
            }
        }
        userData.playlists = playlists;
    } catch (error) {
        debugData(`Error updating playlists: ${error}`);
    }
}

// update playlists and return from user data
export async function getPlaylistsFromUserData(
    service: SpotifyService,
    userData: SpotifyUserData,
): Promise<SpotifyApi.PlaylistObjectSimplified[] | undefined> {
    await updatePlaylists(service, userData);
    return userData.playlists;
}

async function loadUserData(
    instanceStorage: Storage,
): Promise<SpotifyUserData> {
    const userDataPath = getUserDataFilePath();
    if (await instanceStorage.exists(userDataPath)) {
        const content = await instanceStorage.read(userDataPath, "utf8");
        const json: SpotifyUserDataJSON = JSON.parse(content);
        const itemsToMap = (items: MusicItemInfo[]) =>
            new Map(
                items.map((item) => [
                    item.id,
                    {
                        ...item,
                        timestamps: boundedTimestamps([...item.timestamps]),
                    },
                ]),
            );
        return {
            lastUpdated: json.lastUpdated,
            tracks: itemsToMap(json.tracks),
            artists: itemsToMap(json.artists),
            albums: itemsToMap(json.albums),
            historySources: json.historySources,
        };
    }
    return {
        lastUpdated: 0,
        tracks: new Map<string, MusicItemInfo>(),
        artists: new Map<string, MusicItemInfo>(),
        albums: new Map<string, MusicItemInfo>(),
    };
}

export async function saveUserData(
    storage: Storage,
    userData: SpotifyUserData,
) {
    const json: SpotifyUserDataJSON = {
        lastUpdated: userData.lastUpdated,
        tracks: Array.from(userData.tracks.values()),
        artists: Array.from(userData.artists.values()),
        albums: Array.from(userData.albums.values()),
        historySources: userData.historySources,
    };
    await storage.write(getUserDataFilePath(), JSON.stringify(json, null, 2));
}

export function mergeUserDataKind(
    existing: Map<string, MusicItemInfo>,
    newItems: MusicItemInfo[],
) {
    let added = 0;
    for (const newItem of newItems) {
        const info = existing.get(newItem.id);
        if (!info) {
            existing.set(newItem.id, {
                ...newItem,
                timestamps: boundedTimestamps([...newItem.timestamps]),
            });
            added++;
        } else {
            // Update the frequency and timestamps
            info.freq += newItem.freq;
            info.timestamps = boundedTimestamps(
                info.timestamps.concat(newItem.timestamps),
            );
            info.name = newItem.name;
        }
    }
    return added;
}

function boundedTimestamps(timestamps: string[]): string[] {
    timestamps.sort();
    return timestamps.slice(-MAX_ITEM_TIMESTAMPS);
}

export function removeUserDataKind(
    existing: Map<string, MusicItemInfo>,
    oldItems: MusicItemInfo[],
): void {
    for (const oldItem of oldItems) {
        const info = existing.get(oldItem.id);
        if (info === undefined) {
            continue;
        }
        info.freq -= oldItem.freq;
        const removed = new Map<string, number>();
        for (const timestamp of oldItem.timestamps) {
            removed.set(timestamp, (removed.get(timestamp) ?? 0) + 1);
        }
        info.timestamps = info.timestamps.filter((timestamp) => {
            const count = removed.get(timestamp) ?? 0;
            if (count === 0) {
                return true;
            }
            removed.set(timestamp, count - 1);
            return false;
        });
        if (info.freq <= 0) {
            existing.delete(oldItem.id);
        }
    }
}

function trackToJSON(track: SpotifyApi.TrackObjectSimplified): MusicItemInfo {
    return {
        id: track.id,
        name: track.name,
        freq: 1,
        timestamps: [],
    };
}

function artistToJSON(
    artist: SpotifyApi.ArtistObjectSimplified,
): MusicItemInfo {
    return {
        id: artist.id,
        name: artist.name,
        freq: 1,
        timestamps: [],
    };
}

function albumToJSON(album: SpotifyApi.AlbumObjectFull): MusicItemInfo {
    return {
        id: album.id,
        name: album.name,
        freq: 1,
        timestamps: [],
    };
}

function mergeUserData(
    userData: SpotifyUserData,
    tracks?: SpotifyApi.TrackObjectSimplified[],
    artists?: SpotifyApi.ArtistObjectSimplified[],
    albums?: SpotifyApi.AlbumObjectFull[],
): [number, number, number] {
    return [
        tracks
            ? mergeUserDataKind(
                  userData.tracks,
                  tracks.map((t) => trackToJSON(t)),
              )
            : 0,
        artists
            ? mergeUserDataKind(
                  userData.artists,
                  artists.map((a) => artistToJSON(a)),
              )
            : 0,
        albums
            ? mergeUserDataKind(
                  userData.albums,
                  albums.map((a) => albumToJSON(a)),
              )
            : 0,
    ];
}

function mergeTracksWithTimestamps(
    userData: SpotifyUserData,
    tracks: SpotifyApi.PlayHistoryObject[],
): [number, number, number] {
    let added = 0;
    for (const track of tracks) {
        let info = userData.tracks.get(track.track.id);
        if (!info) {
            info = {
                id: track.track.id,
                name: track.track.name,
                freq: 1,
                timestamps: [track.played_at],
            };
            userData.tracks.set(track.track.id, info!);
            added++;
        } else {
            // Update the frequency and timestamps
            info.freq++;
            info.timestamps = boundedTimestamps([
                ...info.timestamps,
                track.played_at,
            ]);
        }
    }
    return [added, 0, 0];
}

export function addUserDataStrings(userData: SpotifyUserData) {
    let nameMap = userData.nameMap;
    if (!userData.nameMap) {
        nameMap = new Map<string, MusicItemInfo>();
        for (const track of userData.tracks.values()) {
            let name = track.name.toLocaleLowerCase();
            const match = nameMap.get(name);
            if (match) {
                if (track.albumArtist) {
                    name = `${name} (${track.albumArtist.toLocaleLowerCase()})`;
                } else if (track.albumName) {
                    name = `${name} (${track.albumName.toLocaleLowerCase()})`;
                } else {
                    name = `${name} ${track.id}`;
                }
            }
            nameMap.set(name, track);
        }
        for (const artist of userData.artists.values()) {
            nameMap.set(artist.name.toLocaleLowerCase(), artist);
        }
        for (const album of userData.albums.values()) {
            nameMap.set(album.name.toLocaleLowerCase(), album);
        }
        userData.nameMap = nameMap;
    }
    return userData.nameMap;
}

export function getUserDataCompletions(
    userData: SpotifyUserData,
    track = true,
    artist = false,
    album = false,
    playlist = false,
    partialValue = "",
    limit = 100,
): string[] {
    const completions: string[] = [];
    if (track) {
        // return names of tracks, sorted by timestamp
        const trackNames = rankedItems(userData.tracks).map((t) => t.name);
        completions.push(...trackNames);
    }
    if (artist) {
        // return names of artists, sorted by timestamp
        const artistNames = rankedItems(userData.artists).map((a) => a.name);
        completions.push(...artistNames);
    }
    if (album) {
        // for now just return names no sorting
        const albumNames = rankedItems(userData.albums).map((a) => a.name);
        completions.push(...albumNames);
    }
    if (playlist && userData.playlists) {
        const playlistNames = userData.playlists.map((p) => p.name);
        completions.push(...playlistNames);
    }
    // The same artist or album can appear both as a history-derived entry
    // (keyed by name) and as an API-derived one (keyed by its Spotify id),
    // so drop repeats while keeping the established ordering.
    const query = partialValue.trim().toLocaleLowerCase();
    return dedupe(completions)
        .filter(
            (name) =>
                query.length === 0 || name.toLocaleLowerCase().includes(query),
        )
        .slice(0, limit);
}

function rankedItems(items: Map<string, MusicItemInfo>): MusicItemInfo[] {
    return Array.from(items.values())
        .map((item) => ({
            item,
            recency:
                item.timestamps.length === 0
                    ? 0
                    : Date.parse(item.timestamps[item.timestamps.length - 1]),
        }))
        .sort(
            (a, b) =>
                b.recency - a.recency ||
                b.item.freq - a.item.freq ||
                a.item.name.localeCompare(b.item.name),
        )
        .map(({ item }) => item);
}

function dedupe(names: string[]): string[] {
    const seen = new Set<string>();
    return names.filter((name) => {
        if (name === undefined || name === null) {
            return false;
        }
        const key = name.toLocaleLowerCase();
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export function addFullTracks(
    userData: SpotifyUserData,
    tracks: SpotifyApi.TrackObjectFull[],
) {
    const ts = new Date(Date.now()).toISOString();
    const trackArtists = [] as SpotifyApi.ArtistObjectSimplified[];
    for (const track of tracks) {
        trackArtists.push(...track.artists);
    }
    mergeUserDataKind(
        userData.artists,
        trackArtists.map((a) => ({
            freq: 1,
            timestamps: [ts],
            id: a.id,
            name: a.name,
        })),
    );
    mergeUserDataKind(
        userData.tracks,
        tracks.map((t) => ({
            id: t.id,
            name: t.name,
            freq: 1,
            timestamps: [ts],
            albumName: t.album?.name,
            albumArtist: t.album?.artists[0]?.name,
        })),
    );
}
async function updateUserData(
    storage: Storage,
    service: SpotifyService,
    userData: SpotifyUserData,
) {
    try {
        debugData("Updating user data");
        const [
            favoriteTracks,
            favoriteAlbums,
            followedArtists,
            topArtists,
            topTracks,
            recentlyPlayed,
        ] = await Promise.all([
            getFavoriteTracks(service, Infinity, true),
            getFavoriteAlbums(service, Infinity, true),
            getFollowedArtists(service, Infinity, true),
            getTopUserArtists(service, Infinity, true),
            getTopUserTracks(service, Infinity, true),
            getRecentlyPlayed(service, Infinity, true),
        ]);

        const updates: { [key: string]: [number, number, number, number] } = {};

        if (favoriteTracks) {
            const tracks = favoriteTracks.map((t) => t.track);
            updates["saved tracks"] = [
                tracks.length,
                ...mergeUserData(
                    userData,
                    tracks,
                    tracks.flatMap((t) => t.artists),
                ),
            ];
        }

        if (favoriteAlbums) {
            const albums = favoriteAlbums.map((a) => a.album);
            const tracks = albums.flatMap((a) => a.tracks.items);
            const artists = albums
                .flatMap((a) => a.artists)
                .concat(tracks.flatMap((t) => t.artists));
            updates["saved albums"] = [
                albums.length,
                ...mergeUserData(userData, tracks, artists, albums),
            ];
        }

        if (followedArtists) {
            updates["followed artists"] = [
                followedArtists.length,
                ...mergeUserData(userData, undefined, followedArtists),
            ];
        }

        if (topArtists) {
            updates["top artists"] = [
                topArtists.length,
                ...mergeUserData(userData, undefined, topArtists),
            ];
        }

        if (topTracks) {
            // Don't merge the track artists as play the track doesn't mean the artist is a favorite
            // And top artists should have covered it.
            updates["top tracks"] = [
                topTracks.length,
                ...mergeUserData(userData, topTracks),
            ];
        }

        if (recentlyPlayed) {
            updates["recently played"] = [
                recentlyPlayed.length,
                ...mergeTracksWithTimestamps(userData, recentlyPlayed),
            ];
        }

        if (debugData.enabled) {
            const messages: string[] = [
                [
                    "".padEnd(22),
                    " Fetched",
                    " +Tracks",
                    "+Artists",
                    " +Albums",
                ].join(" | "),
            ];
            for (const [name, data] of Object.entries(updates)) {
                const message: string[] = [];
                message.push(`User ${name}`.padEnd(22));
                message.push(...data.map((d) => d.toString().padStart(8)));
                messages.push(message.join(" | "));
            }
            const length = messages[0].length;
            messages.push("-".repeat(length));
            messages.push(
                [undefined, userData.tracks, userData.artists, userData.albums]
                    .map((d) => d?.size.toString().padStart(8))
                    .join(" | ")
                    .padStart(length),
            );
            messages.unshift("");
            debugData(messages.join("\n"));
        }

        userData.lastUpdated = Date.now();
        await saveUserData(storage, userData);
    } catch (e) {
        debugData("Failed to update user data", e);
    }
}

export type UserData = {
    data: SpotifyUserData;
    instanceStorage: Storage;
    timeoutId?: NodeJS.Timeout;
};

const updateFrequency = 24 * 60 * 60 * 1000; // 24 hours
export async function initializeUserData(
    instanceStorage: Storage,
    service: SpotifyService,
) {
    debugData("Loading saved user data");
    const data = await loadUserData(instanceStorage);
    const result: UserData = { data, instanceStorage };
    await updatePlaylists(service, result.data);
    debugData(
        `Tracks: ${data.tracks.size}, Artists: ${data.artists.size}, Albums: ${data.albums.size}`,
    );
    // Update once a day
    const update = async () => {
        await updateUserData(instanceStorage, service, data);
        result.timeoutId = setTimeout(update, updateFrequency);
    };
    const newUpdateTime = data.lastUpdated + updateFrequency;
    if (newUpdateTime <= Date.now()) {
        update();
    } else {
        result.timeoutId = setTimeout(update, newUpdateTime - Date.now());
    }

    return result;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getFavoriteAlbums,
    getFavoriteTracks,
    getFollowedArtists,
    getRecentlyPlayed,
    getTopUserArtists,
    getTopUserTracks,
} from "./endpoints.js";
import { SpotifyService } from "./service.js";
import registerDebug from "debug";
import { Storage } from "@typeagent/agent-sdk";

const debugSpotify = registerDebug("typeagent:spotify");

export interface MusicItemInfo {
    id: string;
    name: string;
    freq: number;
    timestamps: string[];
    albumName?: string;
    albumArtist?: string;
}

export interface SpotifyUserData {
    lastUpdated: number;
    tracks: Map<string, MusicItemInfo>;
    artists: Map<string, MusicItemInfo>;
    albums: Map<string, MusicItemInfo>;
    nameMap?: Map<string, MusicItemInfo>;
}

interface SpotifyUserDataJSON {
    lastUpdated: number;
    tracks: MusicItemInfo[];
    artists: MusicItemInfo[];
    albums: MusicItemInfo[];
}

function getUserDataFilePath() {
    return "userdata.json";
}

async function loadUserData(profileStorage: Storage): Promise<SpotifyUserData> {
    const userDataPath = getUserDataFilePath();
    if (await profileStorage.exists(userDataPath)) {
        const content = await profileStorage.read(userDataPath, "utf8");
        const json: SpotifyUserDataJSON = JSON.parse(content);
        return {
            lastUpdated: json.lastUpdated,
            tracks: new Map(json.tracks.map((t) => [t.id, t])),
            artists: new Map(json.artists.map((a) => [a.id, a])),
            albums: new Map(json.albums.map((a) => [a.id, a])),
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
    };
    await storage.write(getUserDataFilePath(), JSON.stringify(json, null, 2));
}

export function mergeUserDataKind(
    existing: Map<string, MusicItemInfo>,
    newItems: MusicItemInfo[],
) {
    let added = 0;
    for (const newItem of newItems) {
        let info = existing.get(newItem.id);
        if (!info) {
            existing.set(newItem.id, newItem);
            added++;
        } else {
            // Update the frequency and timestamps
            info.freq += newItem.freq;
            info.timestamps = info.timestamps.concat(newItem.timestamps).sort();
            info.name = newItem.name;
        }
    }
    return added;
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
            info.timestamps.push(track.played_at);
            info.timestamps.sort();
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

async function updateUserData(
    storage: Storage,
    service: SpotifyService,
    userData: SpotifyUserData,
) {
    try {
        debugSpotify("Updating user data");
        const [
            favoriteTracks,
            favoriteAlbums,
            followedArtists,
            topArtists,
            topTracks,
            recentlyPlayed,
        ] = await Promise.all([
            getFavoriteTracks(service, Infinity),
            getFavoriteAlbums(service, Infinity),
            getFollowedArtists(service, Infinity),
            getTopUserArtists(service, Infinity),
            getTopUserTracks(service, Infinity),
            getRecentlyPlayed(service, Infinity),
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

        if (debugSpotify.enabled) {
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
            debugSpotify(messages.join("\n"));
        }

        userData.lastUpdated = Date.now();
        await saveUserData(storage, userData);
    } catch (e) {
        debugSpotify("Failed to update user data", e);
    }
}

export type UserData = {
    data: SpotifyUserData;
    timeoutId?: NodeJS.Timeout;
};

const updateFrequency = 24 * 60 * 60 * 1000; // 24 hours
export async function initializeUserData(
    profileStorage: Storage,
    service: SpotifyService,
) {
    const data = await loadUserData(profileStorage);
    const result: UserData = {
        data,
    };
    // print sizes of each map to console
    console.log(
        `Tracks: ${data.tracks.size}, Artists: ${data.artists.size}, Albums: ${data.albums.size}`,
    );
    // Update once a day
    const update = async () => {
        await updateUserData(profileStorage, service, data);
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

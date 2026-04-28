// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getUserDataCompletions,
    MusicItemInfo,
    SpotifyUserData,
} from "../src/userData.js";

function makeItem(name: string, lastTimestamp?: string): MusicItemInfo {
    return {
        id: name,
        name,
        freq: 1,
        timestamps: lastTimestamp ? [lastTimestamp] : [],
    };
}

function emptyUserData(): SpotifyUserData {
    return {
        lastUpdated: 0,
        tracks: new Map(),
        artists: new Map(),
        albums: new Map(),
    };
}

describe("getUserDataCompletions — playlists", () => {
    test("returns empty array when playlist flag is false", () => {
        const data = emptyUserData();
        data.playlists = [
            {
                id: "1",
                name: "Chill Mix",
            } as SpotifyApi.PlaylistObjectSimplified,
        ];
        const result = getUserDataCompletions(data, false, false, false, false);
        expect(result).toHaveLength(0);
    });

    test("returns empty array when playlists is undefined", () => {
        const data = emptyUserData(); // no playlists field
        const result = getUserDataCompletions(data, false, false, false, true);
        expect(result).toHaveLength(0);
    });

    test("returns playlist names when playlist flag is true", () => {
        const data = emptyUserData();
        data.playlists = [
            {
                id: "1",
                name: "Chill Mix",
            } as SpotifyApi.PlaylistObjectSimplified,
            {
                id: "2",
                name: "Workout Beats",
            } as SpotifyApi.PlaylistObjectSimplified,
            {
                id: "3",
                name: "Jazz Night",
            } as SpotifyApi.PlaylistObjectSimplified,
        ];
        const result = getUserDataCompletions(data, false, false, false, true);
        expect(result).toEqual(["Chill Mix", "Workout Beats", "Jazz Night"]);
    });

    test("playlist names are included alongside track names", () => {
        const data = emptyUserData();
        data.tracks.set("t1", makeItem("Song A", "2024-01-01T00:00:00Z"));
        data.playlists = [
            {
                id: "p1",
                name: "My Playlist",
            } as SpotifyApi.PlaylistObjectSimplified,
        ];
        const result = getUserDataCompletions(data, true, false, false, true);
        expect(result).toContain("Song A");
        expect(result).toContain("My Playlist");
    });
});

describe("getUserDataCompletions — tracks sorted by timestamp", () => {
    test("sorts tracks newest-first", () => {
        const data = emptyUserData();
        data.tracks.set("a", makeItem("Old Track", "2022-01-01T00:00:00Z"));
        data.tracks.set("b", makeItem("New Track", "2024-06-01T00:00:00Z"));
        data.tracks.set("c", makeItem("Mid Track", "2023-03-01T00:00:00Z"));
        const result = getUserDataCompletions(data, true);
        expect(result[0]).toBe("New Track");
        expect(result[1]).toBe("Mid Track");
        expect(result[2]).toBe("Old Track");
    });
});

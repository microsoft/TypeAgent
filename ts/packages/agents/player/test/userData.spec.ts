// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getUserDataCompletions,
    MAX_ITEM_TIMESTAMPS,
    mergeUserDataKind,
    MusicItemInfo,
    SpotifyUserData,
} from "../src/userData.js";
import { getPlayerActionCompletion } from "../src/agent/playerHandlers.js";

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

    describe("mergeUserDataKind", () => {
        test("bounds timestamps while preserving full frequency", () => {
            const items = new Map<string, MusicItemInfo>();
            mergeUserDataKind(items, [
                {
                    id: "track",
                    name: "Track",
                    freq: 100,
                    timestamps: Array.from({ length: 100 }, (_, i) =>
                        String(i).padStart(3, "0"),
                    ),
                },
            ]);
            expect(items.get("track")?.freq).toBe(100);
            expect(items.get("track")?.timestamps).toHaveLength(
                MAX_ITEM_TIMESTAMPS,
            );
        });
    });

    describe("player action completion RPC payload", () => {
        test("uses the partial property value and caps results", async () => {
            const data = emptyUserData();
            for (let i = 0; i < 150; i++) {
                data.tracks.set(
                    String(i),
                    makeItem(
                        `Needle ${i}`,
                        new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
                    ),
                );
            }
            data.tracks.set("other", makeItem("Unrelated"));
            const result = await getPlayerActionCompletion(
                {
                    agentContext: {
                        spotify: {
                            userData: { data },
                        },
                    },
                } as any,
                {
                    actionName: "playMusic",
                    parameters: { target: { trackName: "needle" } },
                } as any,
                "parameters.target.trackName",
            );
            expect(result).toHaveLength(100);
            expect(result[0]).toBe("Needle 149");
            expect(result).not.toContain("Unrelated");
        });

        test("returns the full ranked list when the current property is absent", async () => {
            const data = emptyUserData();
            for (let i = 0; i < 101; i++) {
                data.tracks.set(
                    String(i),
                    makeItem(
                        `Recent unrelated track ${i}`,
                        new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
                    ),
                );
            }
            data.tracks.set(
                "bohemian",
                makeItem("Bohemian Rhapsody", "2000-01-01T00:00:00Z"),
            );

            const result = await getPlayerActionCompletion(
                {
                    agentContext: {
                        spotify: {
                            userData: { data },
                        },
                    },
                } as any,
                {
                    actionName: "playMusic",
                    parameters: { target: { kind: "track" } },
                } as any,
                "parameters.target.trackName",
            );

            expect(result).toHaveLength(102);
            expect(result).toContain("Bohemian Rhapsody");
            expect(result[0]).toBe("Recent unrelated track 100");
        });
    });

    test("filters, ranks, and caps large completion sets", () => {
        const data = emptyUserData();
        for (let i = 0; i < 250; i++) {
            data.tracks.set(
                String(i),
                makeItem(
                    `Needle Track ${i}`,
                    new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
                ),
            );
        }
        data.tracks.set("other", makeItem("Unrelated", "2030-01-01T00:00:00Z"));
        const result = getUserDataCompletions(
            data,
            true,
            false,
            false,
            false,
            "needle",
            100,
        );
        expect(result).toHaveLength(100);
        expect(result[0]).toBe("Needle Track 249");
        expect(result).not.toContain("Unrelated");
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { findTracksWithGenre, genreTrackCache } from "../src/search.js";

function fakeTrack(id: string): SpotifyApi.TrackObjectFull {
    return {
        id,
        name: `Track ${id}`,
        type: "track",
        uri: `spotify:track:${id}`,
        artists: [
            {
                id: "artist1",
                name: "Artist",
                type: "artist",
                uri: "",
                external_urls: {},
                href: "",
            },
        ],
        album: {
            id: "album1",
            name: "Album",
            type: "album",
            uri: "",
            artists: [],
            images: [],
            album_type: "album",
            available_markets: [],
            external_urls: {},
            href: "",
            release_date: "2024-01-01",
            release_date_precision: "day",
            total_tracks: 10,
        },
        disc_number: 1,
        duration_ms: 200000,
        explicit: false,
        external_ids: {},
        external_urls: {},
        href: "",
        is_local: false,
        popularity: 50,
        preview_url: null,
        track_number: 1,
        available_markets: [],
    } as unknown as SpotifyApi.TrackObjectFull;
}

// A fake context that never actually calls Spotify (cache hits don't need it)
const fakeContext = {
    service: {},
} as any;

describe("findTracksWithGenre - cache", () => {
    afterEach(() => {
        genreTrackCache.clear();
    });

    test("uses pre-populated cache and skips API call", async () => {
        const tracks = [fakeTrack("t1"), fakeTrack("t2"), fakeTrack("t3")];
        genreTrackCache.set("jazz", tracks);

        // With the cache populated, findTracksWithGenre should return without
        // calling context.service (which would throw since it's a stub)
        const result = await findTracksWithGenre(fakeContext, "jazz", 0);
        expect(result.length).toBeGreaterThan(0);
    });

    test("cache is keyed by genre", async () => {
        const jazzTracks = [fakeTrack("j1")];
        const rockTracks = [fakeTrack("r1"), fakeTrack("r2")];
        genreTrackCache.set("jazz", jazzTracks);
        genreTrackCache.set("rock", rockTracks);

        expect(genreTrackCache.get("jazz")).toHaveLength(1);
        expect(genreTrackCache.get("rock")).toHaveLength(2);
        expect(genreTrackCache.get("blues")).toBeUndefined();
    });

    test("cache is empty after clear", () => {
        genreTrackCache.set("jazz", [fakeTrack("t1")]);
        genreTrackCache.clear();
        expect(genreTrackCache.size).toBe(0);
    });
});

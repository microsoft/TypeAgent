// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    applyFilterExpr,
    FilterConstraintType,
    parseFilter,
} from "../src/trackFilter.js";

function fakeTrack(
    id: string,
    releaseDate: string,
): SpotifyApi.TrackObjectFull {
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
            release_date: releaseDate,
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

const testTracks = [
    fakeTrack("t1", "1985-03-01"),
    fakeTrack("t2", "1992-07-15"),
    fakeTrack("t3", "2000-01-01"),
    fakeTrack("t4", "2010-12-31"),
];

describe("applyFilterExpr - Year filter", () => {
    test("single year matches track with that release year", async () => {
        const result = await applyFilterExpr(
            null as any,
            null as any,
            {
                type: "constraint",
                constraintType: FilterConstraintType.Year,
                constraintValue: "1992",
            },
            testTracks,
        );
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("t2");
    });

    test("single year returns empty when no tracks match", async () => {
        const result = await applyFilterExpr(
            null as any,
            null as any,
            {
                type: "constraint",
                constraintType: FilterConstraintType.Year,
                constraintValue: "1999",
            },
            testTracks,
        );
        expect(result).toHaveLength(0);
    });

    test("year range includes tracks within range (inclusive)", async () => {
        const result = await applyFilterExpr(
            null as any,
            null as any,
            {
                type: "constraint",
                constraintType: FilterConstraintType.Year,
                // Tokenizer splits "1990-2000" into "1990 - 2000"
                constraintValue: "1990 - 2000",
            },
            testTracks,
        );
        expect(result).toHaveLength(2);
        const ids = result.map((t) => t.id);
        expect(ids).toContain("t2"); // 1992
        expect(ids).toContain("t3"); // 2000
    });

    test("year range excludes tracks outside range", async () => {
        const result = await applyFilterExpr(
            null as any,
            null as any,
            {
                type: "constraint",
                constraintType: FilterConstraintType.Year,
                constraintValue: "1990 - 2000",
            },
            testTracks,
        );
        const ids = result.map((t) => t.id);
        expect(ids).not.toContain("t1"); // 1985 — before range
        expect(ids).not.toContain("t4"); // 2010 — after range
    });

    test("year range with single year at boundary is included", async () => {
        const result = await applyFilterExpr(
            null as any,
            null as any,
            {
                type: "constraint",
                constraintType: FilterConstraintType.Year,
                constraintValue: "1985 - 1985",
            },
            testTracks,
        );
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("t1");
    });
});

describe("parseFilter - Year range tokenization", () => {
    test("year:1990-2000 parses to range constraint value", () => {
        const result = parseFilter("year:1990-2000");
        expect(result.ast).toBeDefined();
        expect(result.diagnostics).toBeUndefined();
        const node = result.ast!;
        expect(node.type).toBe("constraint");
        if (node.type === "constraint") {
            expect(node.constraintType).toBe(FilterConstraintType.Year);
            expect(node.constraintValue).toBe("1990 - 2000");
        }
    });
});

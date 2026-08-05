// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * End-to-end test for `@player spotify load` → action completion.
 *
 * Loading streaming history is only useful if the names it brings in then
 * show up as completions and are accepted by wildcard validation, so this
 * exercises the whole join: parse the files, merge into the in-memory user
 * data, and read it back the way getPlayerActionCompletion does.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadHistoryFile } from "../src/client.js";
import {
    addUserDataStrings,
    getUserDataCompletions,
    type SpotifyUserData,
} from "../src/userData.js";

function record(
    trackName: string,
    artist: string,
    album: string,
    id: string,
    ts = "2024-01-01T00:00:00Z",
) {
    return {
        ts,
        master_metadata_track_name: trackName,
        master_metadata_album_artist_name: artist,
        master_metadata_album_album_name: album,
        spotify_track_uri: `spotify:track:${id}`,
    };
}

// Minimal Storage stand-in: loadHistoryFile only reads the history files
// through it and writes userdata.json back.
function fakeStorage(dir: string) {
    const written = new Map<string, string>();
    return {
        written,
        async exists(p: string) {
            return fs.existsSync(path.join(dir, p));
        },
        async read(p: string) {
            return fs.readFileSync(path.join(dir, p), "utf8");
        },
        async write(p: string, data: string) {
            written.set(p, data);
        },
        async list(p: string) {
            return fs.readdirSync(path.join(dir, p));
        },
        async getFullPath(p: string) {
            return path.join(dir, p);
        },
    } as any;
}

function emptyUserData(): SpotifyUserData {
    return {
        lastUpdated: 0,
        tracks: new Map(),
        artists: new Map(),
        albums: new Map(),
    };
}

describe("loadHistoryFile → completions", () => {
    let dir: string;
    let context: any;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "player-history-"));
        context = {
            userData: { data: emptyUserData(), instanceStorage: undefined },
        };
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    function writeHistory(name: string, records: unknown[]) {
        fs.writeFileSync(path.join(dir, name), JSON.stringify(records));
    }

    test("track names from a loaded file become completions", async () => {
        writeHistory("history.json", [
            record("Song A", "Artist A", "Album A", "aaa"),
            record("Song B", "Artist B", "Album B", "bbb"),
        ]);
        const result = await loadHistoryFile(
            fakeStorage(dir),
            path.join(dir, "history.json"),
            context,
        );
        expect(result.records).toBe(2);
        const tracks = getUserDataCompletions(context.userData.data, true);
        expect(tracks).toEqual(expect.arrayContaining(["Song A", "Song B"]));
    });

    test("artist and album names come from history too", async () => {
        // Only the Spotify API used to populate these, so completion for
        // `target.artist` / `target.albumName` stayed empty after a load.
        writeHistory("history.json", [
            record("Song A", "Artist A", "Album A", "aaa"),
            record("Song B", "Artist A", "Album A", "bbb"),
        ]);
        await loadHistoryFile(
            fakeStorage(dir),
            path.join(dir, "history.json"),
            context,
        );
        const artists = getUserDataCompletions(
            context.userData.data,
            false,
            true,
        );
        expect(artists).toEqual(["Artist A"]); // deduped across both plays
        const albums = getUserDataCompletions(
            context.userData.data,
            false,
            false,
            true,
        );
        expect(albums).toEqual(["Album A"]);
    });

    test("invalidates the cached name index so new tracks validate", async () => {
        // addUserDataStrings caches nameMap; wildcard validation consults it.
        // Without invalidation everything just loaded looks unknown until
        // the next restart.
        addUserDataStrings(context.userData.data);
        expect(context.userData.data.nameMap!.size).toBe(0);

        writeHistory("history.json", [
            record("Song A", "Artist A", "Album A", "aaa"),
        ]);
        await loadHistoryFile(
            fakeStorage(dir),
            path.join(dir, "history.json"),
            context,
        );
        expect(context.userData.data.nameMap).toBeUndefined();
        expect(
            addUserDataStrings(context.userData.data).get("song a"),
        ).toBeDefined();
    });

    test("drops rows with no track uri instead of collapsing them", async () => {
        // getIdPart returns "" for podcast/local-file rows; merging them
        // would make every such row share one map entry.
        writeHistory("history.json", [
            record("Song A", "Artist A", "Album A", "aaa"),
            {
                ts: "2024-01-02T00:00:00Z",
                master_metadata_track_name: null,
                master_metadata_album_artist_name: null,
                master_metadata_album_album_name: null,
                spotify_track_uri: null,
            },
            {
                ts: "2024-01-03T00:00:00Z",
                master_metadata_track_name: "Episode",
                master_metadata_album_artist_name: null,
                master_metadata_album_album_name: null,
                spotify_track_uri: "spotify:episode:zzz",
            },
        ]);
        const result = await loadHistoryFile(
            fakeStorage(dir),
            path.join(dir, "history.json"),
            context,
        );
        expect(result.records).toBe(1);
        expect(context.userData.data.tracks.size).toBe(1);
        expect(context.userData.data.tracks.has("")).toBe(false);
    });

    test("a directory load reports which files were skipped", async () => {
        writeHistory("Streaming_History_Audio_2023.json", [
            record("Song A", "Artist A", "Album A", "aaa"),
        ]);
        fs.writeFileSync(
            path.join(dir, "SearchQueries.json"),
            JSON.stringify([{ search: "nope" }]),
        );
        const result = await loadHistoryFile(fakeStorage(dir), dir, context);
        expect(result.loaded.map((f) => path.basename(f))).toEqual([
            "Streaming_History_Audio_2023.json",
        ]);
        expect(result.skipped.map((f) => path.basename(f))).toEqual([
            "SearchQueries.json",
        ]);
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Quick script to count hallucinated action names
const fs = require("fs");
const path = require("path");

const blindSet = JSON.parse(
    fs.readFileSync(
        path.resolve(
            __dirname,
            "../../agents/player/dist/agent/playerWarmerBlindSet.json",
        ),
        "utf-8",
    ),
);
const trainingSet = JSON.parse(
    fs.readFileSync(
        path.resolve(
            __dirname,
            "../../agents/player/dist/agent/playerWarmerTestSet.json",
        ),
        "utf-8",
    ),
);

const validActions = new Set([
    "playRandom",
    "playTrack",
    "playFromCurrentTrackList",
    "playAlbum",
    "playArtist",
    "playGenre",
    "status",
    "pause",
    "resume",
    "next",
    "previous",
    "shuffle",
    "listDevices",
    "setDefaultDevice",
    "selectDevice",
    "showSelectedDevice",
    "setVolume",
    "setMaxVolume",
    "changeVolume",
    "searchTracks",
    "searchForPlaylists",
    "listPlaylists",
    "getPlaylist",
    "getFromCurrentPlaylistList",
    "getAlbum",
    "getFavorites",
    "createPlaylist",
    "deletePlaylist",
    "addCurrentTrackToPlaylist",
    "addToPlaylistFromCurrentTrackList",
    "addSongsToPlaylist",
    "getQueue",
    "playPlaylist",
]);

function analyze(set, label) {
    const invalidActions = {};
    let totalCommon = 0;
    let invalidCommon = 0;
    for (const tc of set) {
        if (tc.isCommon) {
            totalCommon++;
            if (!validActions.has(tc.actionName)) {
                invalidCommon++;
                invalidActions[tc.actionName] =
                    (invalidActions[tc.actionName] || 0) + 1;
            }
        }
    }
    console.log(`${label}:`);
    console.log(`  Total common: ${totalCommon}`);
    console.log(
        `  Invalid action names (common): ${invalidCommon} (${((invalidCommon / totalCommon) * 100).toFixed(1)}%)`,
    );
    const sorted = Object.entries(invalidActions).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted) {
        console.log(`    ${name}: ${count}`);
    }
    console.log();
}

analyze(trainingSet, "Training set");
analyze(blindSet, "Blind set");

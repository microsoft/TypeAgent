// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// Generated from recipe: createTopSongsPlaylist

import type { ActionContext, ActionResult } from "@typeagent/agent-sdk";
import { createActionResultFromTextDisplay } from "@typeagent/agent-sdk/helpers/action";
import { callAction, queryLLM } from "../taskFlowRunner.mjs";
import type { CreateTopSongsPlaylistAction } from "../schema/userActions.mjs";

export async function handleCreateTopSongsPlaylist(
    action: CreateTopSongsPlaylistAction,
    _context: ActionContext<any>,
): Promise<ActionResult> {
    const {
        genre,
        quantity = 10,
        timePeriod = "this month",
    } = action.parameters;
    console.log(
        `[createTopSongsPlaylist] Starting: genre=${genre}, quantity=${quantity}, timePeriod=${timePeriod}`,
    );

    // Step 1: search the web for top streaming songs in the genre
    console.log(`[createTopSongsPlaylist] Step 1: web search...`);
    const t1 = Date.now();
    const searchResults = await callAction("utility", "webSearch", {
        query: `top ${quantity} streaming ${genre} songs ${timePeriod}`,
        numResults: 5,
    });
    console.log(
        `[createTopSongsPlaylist] Step 1 done in ${Date.now() - t1}ms, got ${searchResults.length} chars`,
    );
    console.log(
        `[createTopSongsPlaylist] Search snippet: ${searchResults.slice(0, 200).replace(/\n/g, " ")}`,
    );

    // Step 2: parse song titles and artists out of the search results
    console.log(`[createTopSongsPlaylist] Step 2: LLM parse...`);
    const t2 = Date.now();
    const songListRaw = await queryLLM(
        `Extract a list of songs from the following web search results. ` +
            `Return ONLY a JSON array of objects with "trackName" and "artist" fields. ` +
            `Only include songs clearly identified with both a title and an artist. ` +
            `Limit to the top ${quantity} songs. Output the JSON array with no explanation.\n\n` +
            searchResults,
    );
    console.log(`[createTopSongsPlaylist] Step 2 done in ${Date.now() - t2}ms`);
    console.log(
        `[createTopSongsPlaylist] LLM raw: ${songListRaw.slice(0, 300).replace(/\n/g, " ")}`,
    );

    let songs: Array<{ trackName: string; artist?: string }> = [];
    try {
        const match = songListRaw.match(/\[[\s\S]*\]/);
        songs = match ? JSON.parse(match[0]) : [];
    } catch {
        songs = [];
    }
    console.log(`[createTopSongsPlaylist] Parsed ${songs.length} songs`);

    // Step 3: create the Spotify playlist with the found songs
    console.log(
        `[createTopSongsPlaylist] Step 3: createPlaylist "${`Top ${quantity} ${genre} – ${timePeriod}`}"...`,
    );
    const t3 = Date.now();
    const playlistName = `Top ${quantity} ${genre} – ${timePeriod}`;
    const playlistResult = await callAction("player", "createPlaylist", {
        name: playlistName,
        songs,
    });
    console.log(`[createTopSongsPlaylist] Step 3 done in ${Date.now() - t3}ms`);
    console.log(
        `[createTopSongsPlaylist] Playlist result: ${playlistResult.slice(0, 200).replace(/\n/g, " ")}`,
    );

    return createActionResultFromTextDisplay(
        `Created playlist "${playlistName}" with ${songs.length} songs.\n\n${playlistResult}`,
    );
}

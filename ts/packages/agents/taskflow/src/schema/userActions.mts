// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Lists all compiled task flows
export type ListTaskFlows = {
    actionName: "listTaskFlows";
};

// Find top streaming songs for a genre and create a Spotify playlist
export type CreateTopSongsPlaylistAction = {
    actionName: "createTopSongsPlaylist";
    parameters: {
        // Music genre (e.g. bluegrass, jazz, country, rock, hip-hop)
        genre: string;
        // Number of top songs to include
        quantity?: number;
        // Time period for the chart (e.g. 'this month', 'this week', '2024')
        timePeriod?: string;
    };
};

// Same as createTopSongsPlaylist but uses claudeTask for web research — for A/B comparison
export type CreateTopSongsPlaylistClaudeAction = {
    actionName: "createTopSongsPlaylistClaude";
    parameters: {
        // Music genre (e.g. bluegrass, jazz, country, rock, hip-hop)
        genre: string;
        // Number of top songs to include
        quantity?: number;
        // Time period for the chart (e.g. 'this month', 'this week', '2024')
        timePeriod?: string;
    };
};

// Fetch recent emails and send a digest summary to yourself
export type WeeklyEmailDigestAction = {
    actionName: "weeklyEmailDigest";
    parameters: {
        // Time period to summarize (e.g. 'this week', 'today', 'last 3 days')
        timePeriod?: string;
        // What to focus on or exclude in the digest
        focus?: string;
    };
};

export type TaskFlowActions =
    | ListTaskFlows
    | CreateTopSongsPlaylistAction
    | CreateTopSongsPlaylistClaudeAction
    | WeeklyEmailDigestAction;

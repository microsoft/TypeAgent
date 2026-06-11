// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type StudioActions =
    | GetStudioInfoAction
    | ListCollisionsAction
    | QueryEventsAction;

// Report Studio's environment: the repository root it is inspecting and the
// directories ("agent locations") it scans for agents, with how many agent
// packages each contains. Use this to confirm Studio is pointed at the right
// place. Read-only.
export type GetStudioInfoAction = {
    actionName: "getStudioInfo";
    parameters: {
        // Optional absolute path to the repository to inspect (its root or its
        // `ts/` directory). Defaults to the agent's configured/working
        // directory.
        repoRoot?: string;
    };
};

// List the cross-schema grammar collisions Studio currently knows about
// (newest first). These are populated by collision scans; the list is empty
// until a scan has run. Read-only.
export type ListCollisionsAction = {
    actionName: "listCollisions";
    parameters: {
        // Optional absolute path to the repository whose collisions to list.
        // Defaults to the agent's configured/working directory.
        repoRoot?: string;
    };
};

// Show the most recent entries from Studio's structured event stream
// (sandbox/collision/replay/feedback events), oldest-to-newest. Read-only.
export type QueryEventsAction = {
    actionName: "queryEvents";
    parameters: {
        // Maximum number of recent events to return (default 20).
        limit?: number;
        // Optional absolute path to the repository to inspect.
        repoRoot?: string;
    };
};

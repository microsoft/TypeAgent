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
    parameters: {};
};

// List the cross-schema grammar collisions Studio currently knows about
// (newest first). These are populated by collision scans; the list is empty
// until a scan has run. Read-only.
export type ListCollisionsAction = {
    actionName: "listCollisions";
    parameters: {};
};

// Show the most recent entries from Studio's structured event stream
// (sandbox/collision/replay/feedback events), oldest-to-newest. Read-only.
export type QueryEventsAction = {
    actionName: "queryEvents";
    parameters: {
        // Maximum number of recent events to return (default 20).
        limit?: number;
    };
};

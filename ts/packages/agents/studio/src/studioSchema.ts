// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type StudioActions =
    | ListAgentsAction
    | GetStudioInfoAction
    | ListCollisionsAction;

// List the TypeAgent agents that Studio can discover on disk (from
// `packages/agents` and any configured agent search paths), each with its
// manifest emoji when one is declared. Read-only.
export type ListAgentsAction = {
    actionName: "listAgents";
    parameters: {
        // Optional absolute path to the repository to inspect (its root or its
        // `ts/` directory). Supply this when driving Studio from outside the
        // target repo; otherwise the agent uses its configured/working
        // directory.
        repoRoot?: string;
    };
};

// Report Studio's resolved environment: the repository root it is inspecting,
// whether a `packages/agents` directory was found there, and how many agents
// were discovered. Use this to sanity-check that Studio is pointed at the right
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

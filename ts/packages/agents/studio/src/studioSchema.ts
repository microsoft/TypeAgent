// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type StudioActions =
    | ListAgentsAction
    | GetStudioInfoAction
    | ListCollisionsAction
    | DescribeAgentAction
    | GetSchemaAction
    | GetGrammarAction
    | SearchCorpusAction
    | QueryEventsAction;

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

// Give an at-a-glance overview of one agent: its emoji, health findings
// (manifest/schema/grammar/handler invariants), how many corpus utterances it
// has, the collisions it participates in, and recent feedback. Read-only.
export type DescribeAgentAction = {
    actionName: "describeAgent";
    parameters: {
        // The agent package name to describe (e.g. "player", "calendar").
        agent: string;
        // Optional absolute path to the repository to inspect.
        repoRoot?: string;
    };
};

// Show an agent's action schema source (`*Schema.ts`) text. Read-only.
export type GetSchemaAction = {
    actionName: "getSchema";
    parameters: {
        // The agent package name whose schema to show.
        agent: string;
        // Optional absolute path to the repository to inspect.
        repoRoot?: string;
    };
};

// Show an agent's grammar source (`*.agr`) text. Read-only.
export type GetGrammarAction = {
    actionName: "getGrammar";
    parameters: {
        // The agent package name whose grammar to show.
        agent: string;
        // Optional absolute path to the repository to inspect.
        repoRoot?: string;
    };
};

// List an agent's federated corpus utterances (in-repo seed, captures,
// external sources, feedback), optionally filtered by a substring. Read-only.
export type SearchCorpusAction = {
    actionName: "searchCorpus";
    parameters: {
        // The agent package name whose corpus to search.
        agent: string;
        // Optional case-insensitive substring to filter utterances by.
        query?: string;
        // Optional absolute path to the repository to inspect.
        repoRoot?: string;
    };
};

// Show the most recent entries from Studio's structured event stream
// (sandbox/collision/replay/feedback events), newest last. Read-only.
export type QueryEventsAction = {
    actionName: "queryEvents";
    parameters: {
        // Maximum number of recent events to return (default 20).
        limit?: number;
        // Optional absolute path to the repository to inspect.
        repoRoot?: string;
    };
};

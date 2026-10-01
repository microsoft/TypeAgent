// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type GitCommitStory = {
    schemaVersion: number;
    title: string;
    description: string;
    sessions: SessionStory[];
};

export type SessionStory = {
    sessionId: string;
    summary: SummaryEntry[];
    metadata: SessionMetadata;
};

export type SummaryEntry = {
    id: string;
    text: string;
    timestamp?: string;
    // Memory payload types and reference resolution will be integrated separately.
    memoryIds: string[];
};

export type SessionMetadata = {
    clientName: string;
    models: string[];
};

// A proposed commit, before Git assigns its final object ID.
export type CommitContext = {
    projectPath: string;
    // The diff for the exact candidate commit, not all workspace changes.
    diff: string;
    message: string;
};

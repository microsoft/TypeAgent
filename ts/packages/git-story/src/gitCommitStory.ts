// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface GitCommitStory<TMemory> {
    schemaVersion: number;
    title: string;
    description: string;
    sessions: SessionStory<TMemory>[];
}

export interface SessionStory<TMemory> {
    sessionId: string;
    summary: SummaryEntry[];
    metadata: SessionMetadata;
    memories: MemoryRecord<TMemory>[];
}

export interface SummaryEntry {
    id: string;
    text: string;
    timestamp?: string;
    // References memories in the enclosing SessionStory.
    memoryIds: string[];
}

export interface MemoryRecord<TMemory> {
    id: string;
    content: TMemory;
}

export interface SessionMetadata {
    clientName: string;
    models: string[];
}

// A proposed commit, before Git assigns its final object ID.
export interface CommitContext {
    projectPath: string;
    // The diff for the exact candidate commit, not all workspace changes.
    diff: string;
    message: string;
}

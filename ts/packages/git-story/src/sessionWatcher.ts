// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CommitContext,
    SessionMetadata,
    SessionStory,
} from "./gitCommitStory.js";

export interface SessionWatchRequest {
    projectPath: string;
    sessionId: string;
    transcriptPath: string;
    metadata: SessionMetadata;
}

export interface SessionWatcher<TMemory> {
    // Registers a local transcript for background processing.
    watch(request: SessionWatchRequest): Promise<void>;

    // Returns privacy-filtered summaries and memories mapped to this candidate commit.
    getSessionStories(commit: CommitContext): Promise<SessionStory<TMemory>[]>;

    // Stops this watcher's background work and releases its resources.
    stop(): Promise<void>;
}

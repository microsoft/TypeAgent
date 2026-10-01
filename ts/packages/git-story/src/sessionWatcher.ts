// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionMetadata } from "./gitCommitStory.js";

export interface SessionWatchRequest {
    projectPath: string;
    sessionId: string;
    transcriptPath: string;
    metadata: SessionMetadata;
}

export interface SessionWatcher {
    // Registers a local transcript for background processing.
    watch(request: SessionWatchRequest): Promise<void>;

    // Stops this watcher's background work and releases its resources.
    stop(): Promise<void>;
}

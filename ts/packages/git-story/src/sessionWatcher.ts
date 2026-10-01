// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionMetadata } from "./gitCommitStory.js";

export interface SessionWatchRequest {
    projectPath: string;
    sessionId: string;
    transcriptPath: string;
    metadata: SessionMetadata;
}

export class SessionWatcher {
    async watch(_request: SessionWatchRequest): Promise<void> {
        throw new Error("SessionWatcher.watch is not implemented");
    }

    async stop(): Promise<void> {
        throw new Error("SessionWatcher.stop is not implemented");
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CommitContext,
    GitCommitStory,
    SessionStory,
} from "./gitCommitStory.js";

export interface StoryBuildRequest {
    commit: CommitContext;
    sessions: SessionStory[];
}

export interface StoryBuildResult {
    story: GitCommitStory;
    commitMessage: string;
}

export class StoryBuilder {
    async build(_request: StoryBuildRequest): Promise<StoryBuildResult> {
        throw new Error("StoryBuilder.build is not implemented");
    }
}

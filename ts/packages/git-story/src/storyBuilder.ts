// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CommitContext,
    GitCommitStory,
    SessionStory,
} from "./gitCommitStory.js";

export interface IStoryBuildRequest {
    commit: CommitContext;
    sessions: SessionStory[];
}

export interface IStoryBuildResult {
    story: GitCommitStory;
    commitMessage: string;
}

export class StoryBuilder {
    async build(_request: IStoryBuildRequest): Promise<IStoryBuildResult> {
        throw new Error("StoryBuilder.build is not implemented");
    }
}

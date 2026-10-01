// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CommitContext,
    GitCommitStory,
    SessionStory,
} from "./gitCommitStory.js";

export interface StoryBuildRequest<TMemory> {
    commit: CommitContext;
    sessions: SessionStory<TMemory>[];
}

export interface StoryBuildResult<TMemory> {
    story: GitCommitStory<TMemory>;
    commitMessage: string;
}

export interface StoryBuilder<TMemory> {
    // Authors and renders the story without writing a commit or changing Git state.
    build(
        request: StoryBuildRequest<TMemory>,
    ): Promise<StoryBuildResult<TMemory>>;
}

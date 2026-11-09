// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type StoryAggregationRequest = {
    projectPath: string;
    revision: string;
};

export type StoryAggregationResult = {
    resolvedRevision: string;
    scannedCommits: number;
    commitsWithoutStory: number;
    commitsWithMalformedStory: number;
    commitsWithUnsupportedStory: number;
    // Accepted by the memory destination, not necessarily searchable yet.
    acceptedStories: number;
    // Previously accepted stories retired because their commits are no longer reachable.
    retiredStories: number;
};

export class StoryAggregator {
    async aggregate(
        _request: StoryAggregationRequest,
    ): Promise<StoryAggregationResult> {
        // Pseudocode:
        // Validate the repository and resolve the revision once.
        // Enumerate commits reachable from that resolved commit.
        // Read committed messages, never private session transcripts.
        // Parse stories using the shared codec once its contract is agreed.
        // Distinguish missing stories from malformed or unsupported stories.
        // Submit valid stories with repository and commit provenance.
        // Require repeat-safe submission through the memory adapter.
        // Retire indexed stories whose commits are no longer reachable.
        // Report destination acceptance separately from indexing completion.
        // Surface failures rather than reporting incomplete work as success.
        throw new Error("StoryAggregator.aggregate is not implemented");
    }
}

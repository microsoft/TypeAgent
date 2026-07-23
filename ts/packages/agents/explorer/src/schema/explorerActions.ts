// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ExplorerActions =
    | DiscoverRepositoryAction
    | RefineRepositoryAction
    | SubmitExplorationAction;

export type DiscoverRepositoryAction = {
    actionName: "discoverRepository";
    parameters: {
        // Complete async function execute(repo: RepositoryApi, params: ExploreParams).
        program: string;
    };
};

export type RefineRepositoryAction = {
    actionName: "refineRepository";
    parameters: {
        // Complete async function execute(repo: RepositoryApi, params: ExploreParams).
        program: string;
    };
};

export type SubmitExplorationAction = {
    actionName: "submitExploration";
    parameters: {
        locations: {
            path: string;
            // First exact line of the implementation block likely to change.
            startLine: number;
            // Last exact line of the complete behavior-bearing block.
            endLine: number;
        }[];
    };
};

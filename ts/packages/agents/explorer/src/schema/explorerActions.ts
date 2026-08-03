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
        program: string;
    };
};

export type SubmitExplorationAction = {
    actionName: "submitExploration";
    parameters: {
        // Complete highest-confidence set of independently evidenced
        // change-bearing blocks, including companion files.
        locations: ExploreLocation[];
    };
};

export type ExploreLocation = {
    path: string;
    startLine: number;
    endLine: number;
};

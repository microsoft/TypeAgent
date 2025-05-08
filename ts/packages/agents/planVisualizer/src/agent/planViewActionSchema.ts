// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PlanViewAction =
    | GoToPlanNode
    | AddNewNode
    | AddNewEdge
    | ZoomToFitPlanInView
    | RefreshPlanView;

// Sets focus to a particular node in the plan
export type GoToPlanNode = {
    actionName: "goToPlanNode";
    parameters: {
        // the name to of the node
        name: string;
    };
};

// add a node to the plan
export type AddNewNode = {
    actionName: "addNewNode";
    parameters: {
        // the name to use for the state
        name: string;
        nodeType: string;
        // base64 string with node screenshot
        screenshot?: string;
    };
};

export type AddNewEdge = {
    actionName: "addNewEdge";
    parameters: {
        // the name of the edge
        name: string;
        // the name of the source node
        source: string;
        // the name of the target node
        target?: string;
    };
};

export type ZoomToFitPlanInView = {
    actionName: "zoomToFitPlanInView";
};

export type RefreshPlanView = {
    actionName: "refreshPlanView";
};

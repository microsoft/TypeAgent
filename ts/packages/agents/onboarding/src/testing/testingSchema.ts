// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TestingActions =
    | GenerateTestsAction
    | RunTestsAction
    | GetTestResultsAction
    | ProposeRepairAction
    | ApproveRepairAction;

export type GenerateTestsAction = {
    actionName: "generateTests";
    parameters: {
        // Integration name to generate tests for
        integrationName: string;
    };
};

export type RunTestsAction = {
    actionName: "runTests";
    parameters: {
        // Integration name to run tests for
        integrationName: string;
        // Run only tests for these specific action names
        forActions?: string[];
        // Maximum number of tests to run (runs all if omitted)
        limit?: number;
    };
};

export type GetTestResultsAction = {
    actionName: "getTestResults";
    parameters: {
        // Integration name to get test results for
        integrationName: string;
        // Filter to show only passing or failing tests
        filter?: "passing" | "failing";
    };
};

export type ProposeRepairAction = {
    actionName: "proposeRepair";
    parameters: {
        // Integration name to propose repairs for
        integrationName: string;
        // If provided, propose repairs only for these specific failing action names
        forActions?: string[];
    };
};

export type ApproveRepairAction = {
    actionName: "approveRepair";
    parameters: {
        // Integration name to approve the proposed repair for
        integrationName: string;
    };
};

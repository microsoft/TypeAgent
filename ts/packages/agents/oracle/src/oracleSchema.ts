// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type OracleAction = QueryAction;

export type QueryAction = {
    actionName: "queryOracle";
    parameters: {
        query: string;
    };
};

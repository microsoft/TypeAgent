// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type OracleAction = QueryAction;

// Ask the oracle a question; it will give an oracular, pseudo-philosophical answer.
// Good for questions like "what is the meaning of life" or "does he love me". :-)
export type QueryAction = {
    actionName: "queryOracle";
    parameters: {
        query: string; // The question for the oracle
    };
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SchemaGenActions =
    | GenerateSchemaAction
    | RefineSchemaAction
    | ApproveSchemaAction;

export type GenerateSchemaAction = {
    actionName: "generateSchema";
    parameters: {
        // Integration name to generate schema for
        integrationName: string;
    };
};

export type RefineSchemaAction = {
    actionName: "refineSchema";
    parameters: {
        // Integration name
        integrationName: string;
        // Specific instructions for the LLM about what to change
        // e.g. "make the listName parameter optional" or "add a sortOrder parameter to sortAction"
        instructions: string;
    };
};

export type ApproveSchemaAction = {
    actionName: "approveSchema";
    parameters: {
        // Integration name to approve schema for
        integrationName: string;
    };
};

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface Recipe {
    version: 1;
    actionName: string;
    description: string;
    parameters: RecipeParameter[];
    steps: RecipeStep[];
    grammarPatterns: string[];
    source?: {
        type: "reasoning" | "browser" | "webtask" | "manual";
        sourceId?: string;
        timestamp: string;
    };
}

export interface RecipeParameter {
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
    default?: unknown;
    testValue?: unknown;
}

export interface RecipeStep {
    id: string;
    schemaName: string;
    actionName: string;
    parameters: Record<string, unknown>;
    observedOutputFormat?: string;
}

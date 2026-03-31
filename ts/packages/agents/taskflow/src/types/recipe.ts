// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface ScriptRecipe {
    name: string;
    description: string;
    parameters: RecipeParameter[];
    script: string;
    grammarPatterns: string[];
    source?: {
        type: "reasoning" | "manual" | "seed";
        timestamp: string;
    };
}

export interface RecipeParameter {
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
    default?: unknown;
}

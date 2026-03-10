// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Recipe } from "./types/recipe.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type FlowParameterDef = {
    type: "string" | "number" | "boolean";
    required?: boolean;
    default?: unknown;
    description?: string;
};

export type FlowStepDef = {
    id: string;
    schemaName: string;
    actionName: string;
    parameters: Record<string, unknown>;
};

export type FlowDefinition = {
    name: string;
    description: string;
    parameters: Record<string, FlowParameterDef>;
    steps: FlowStepDef[];
};

/**
 * Convert a Recipe to a FlowDefinition in memory (no file I/O).
 * Allows immediate execution via processFlow() without waiting for the
 * full compile pipeline.
 */
export function recipeToFlowDef(recipe: Recipe): FlowDefinition {
    const parameters: Record<string, FlowParameterDef> = {};
    for (const p of recipe.parameters) {
        parameters[p.name] = {
            type: p.type,
            required: p.required,
            default: p.default,
            description: p.description,
        };
    }

    return {
        name: recipe.actionName,
        description: recipe.description,
        parameters,
        steps: recipe.steps.map((s) => ({
            id: s.id,
            schemaName: s.schemaName,
            actionName: s.actionName,
            parameters: s.parameters,
        })),
    };
}

/**
 * Save a recipe to the pending directory for later compilation via compileRecipes.mjs.
 */
export async function saveRecipe(
    recipe: Recipe,
    pendingDir: string,
): Promise<string> {
    await fs.mkdir(pendingDir, { recursive: true });
    const filePath = path.join(pendingDir, `${recipe.actionName}.recipe.json`);
    await fs.writeFile(filePath, JSON.stringify(recipe, null, 2));
    return filePath;
}

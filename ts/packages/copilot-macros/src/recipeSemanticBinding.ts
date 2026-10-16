// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RecipeBindingScope } from "./recipeCore.js";
import { recipeSemanticContractIdentity } from "./recipeSemanticIdentity.js";

export interface RecipeSemanticBindingGuard {
    scope: RecipeBindingScope;
    structureDigest: string;
    dataVersion: string;
    functionId: string;
    functionRevision: string;
    modelPolicy: { id: string; revision: string };
    specification: { id: string; revision: string };
    selectedId: string;
    expectedRole: string;
    expectedType: string;
}

export interface RecipeSemanticBindingObservation {
    guard: RecipeSemanticBindingGuard;
    candidates: { id: string; role: string; type: string }[];
    roleVerification: "verified" | "unverifiable";
}

// This defines drift semantics only. No cache is enabled and no guard hit
// authorizes bypassing the noncached resolver or live host permissions.
export function inspectRecipeSemanticBindingGuard(
    saved: RecipeSemanticBindingGuard,
    current: RecipeSemanticBindingObservation,
): { status: "guard_hit" | "resolve_required"; cacheEnabled: false } {
    const compatible =
        recipeSemanticContractIdentity(saved) ===
            recipeSemanticContractIdentity(current.guard) &&
        current.roleVerification === "verified" &&
        [
            ...Object.values(saved.scope),
            saved.structureDigest,
            saved.dataVersion,
            saved.functionId,
            saved.functionRevision,
            saved.modelPolicy.id,
            saved.modelPolicy.revision,
            saved.specification.id,
            saved.specification.revision,
            saved.selectedId,
            saved.expectedRole,
            saved.expectedType,
        ].every((value) => !!value.trim()) &&
        current.candidates.filter(
            (candidate) => candidate.id === saved.selectedId,
        ).length === 1 &&
        current.candidates.filter(
            (candidate) =>
                candidate.role === saved.expectedRole &&
                candidate.type === saved.expectedType,
        ).length === 1 &&
        current.candidates.some(
            (candidate) =>
                candidate.id === saved.selectedId &&
                candidate.role === saved.expectedRole &&
                candidate.type === saved.expectedType,
        );
    return {
        status: compatible ? "guard_hit" : "resolve_required",
        cacheEnabled: false,
    };
}

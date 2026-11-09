// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    inspectRecipeSemanticBindingGuard,
    type RecipeSemanticBindingGuard,
    type RecipeSemanticBindingObservation,
} from "../src/recipeSemanticBinding.js";

const saved: RecipeSemanticBindingGuard = {
    scope: {
        workspaceId: "w",
        profileId: "p",
        providerId: "fixture",
        accountId: "a",
        sessionId: "s",
        generation: "1",
    },
    structureDigest: "schema:1",
    dataVersion: "1",
    functionId: "column-role",
    functionRevision: "1",
    modelPolicy: { id: "host", revision: "1" },
    specification: { id: "column-role", revision: "1" },
    selectedId: "column:1",
    expectedRole: "customer-email",
    expectedType: "string",
};

function observation(): RecipeSemanticBindingObservation {
    return {
        guard: structuredClone(saved),
        candidates: [
            { id: "column:1", role: "customer-email", type: "string" },
        ],
        roleVerification: "verified",
    };
}

describe("guarded structural-binding semantics only; cache remains disabled", () => {
    it("recognizes a verified unique binding without enabling reuse", () => {
        expect(inspectRecipeSemanticBindingGuard(saved, observation())).toEqual(
            {
                status: "guard_hit",
                cacheEnabled: false,
            },
        );
    });

    it.each([
        (current: RecipeSemanticBindingObservation) => {
            current.guard.scope.accountId = "other";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.guard.scope.generation = "2";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.guard.scope.workspaceId = "other";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.guard.structureDigest = "schema:2";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.guard.dataVersion = "2";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.guard.functionRevision = "2";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.guard.modelPolicy.revision = "2";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.guard.specification.revision = "2";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.candidates[0].role = "billing-email";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.candidates[0].type = "integer";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.roleVerification = "unverifiable";
        },
        (current: RecipeSemanticBindingObservation) => {
            current.candidates.push({
                id: "column:2",
                role: "customer-email",
                type: "string",
            });
        },
        (current: RecipeSemanticBindingObservation) => {
            current.candidates.push({
                id: "column:1",
                role: "other",
                type: "string",
            });
        },
        (current: RecipeSemanticBindingObservation) => {
            current.candidates = [];
        },
    ])(
        "requires the declared resolver on scope/version/role/type/uniqueness drift %#",
        (change) => {
            const current = observation();
            change(current);
            expect(inspectRecipeSemanticBindingGuard(saved, current)).toEqual({
                status: "resolve_required",
                cacheEnabled: false,
            });
        },
    );
});

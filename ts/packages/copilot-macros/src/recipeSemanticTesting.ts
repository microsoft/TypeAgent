// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ApprovedRecipeSemanticProvider,
    RecipeSemanticProviderRequest,
} from "./recipeSemantic.js";

// Synthetic evidence only: this never invokes a deployed model.
export class FakeRecipeSemanticProvider
    implements ApprovedRecipeSemanticProvider
{
    readonly id = "offline-semantic-fixture";
    readonly approval = {
        capabilityId: "offline-fixture-only",
        policyRevision: "1",
    };
    readonly evidenceKind = "synthetic" as const;
    readonly calls: RecipeSemanticProviderRequest[] = [];

    constructor(
        private readonly fixture: (
            request: RecipeSemanticProviderRequest,
        ) => unknown | Promise<unknown>,
    ) {}

    async complete(request: RecipeSemanticProviderRequest): Promise<unknown> {
        this.calls.push({
            ...request,
            definition: structuredClone(request.definition),
            input: structuredClone(request.input),
        });
        return this.fixture(request);
    }
}

export function recipeSemanticJsonFixture(
    output: unknown,
    overrides: Record<string, unknown> = {},
): unknown {
    return {
        kind: "json",
        text: JSON.stringify(output),
        resolvedModel: "synthetic:relevance-fixture-v1",
        inputTokens: 12,
        outputTokens: 8,
        cost: 0,
        currency: "synthetic",
        ...overrides,
    };
}

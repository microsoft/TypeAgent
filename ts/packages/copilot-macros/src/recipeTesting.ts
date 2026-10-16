// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    JsonValue,
    RecipeArtifact,
    RecipeBindingScope,
    RecipeCallContext,
    RecipeCallOutcome,
    RecipeCapability,
    RecipeHost,
    RecipeSemanticFunction,
    RecipeSemanticOutcome,
} from "./recipeContracts.js";
import {
    checkRecipeCapability,
    validateRecipeArtifact,
    validateRecipeValue,
} from "./recipeValidation.js";

export interface FakeRecipeCall {
    kind: "capability" | "semantic";
    id: string;
    input: JsonValue;
    runId: string;
    callId: string;
    parentCallId?: string;
}

type CapabilityFixture = (
    input: JsonValue,
    context: RecipeCallContext,
) => RecipeCallOutcome | Promise<RecipeCallOutcome>;
type SemanticFixture = (
    input: JsonValue,
    context: RecipeCallContext,
) => RecipeSemanticOutcome | Promise<RecipeSemanticOutcome>;

// Only injected fixtures run here. This is not a generated-code executor or a
// containment boundary, and never connects to a live tool or model provider.
export class FakeRecipeHost implements RecipeHost {
    readonly calls: FakeRecipeCall[] = [];
    private readonly capabilities = new Map<
        string,
        {
            definition: RecipeCapability;
            invoke: CapabilityFixture;
        }
    >();
    private readonly semantics = new Map<
        string,
        {
            definition: RecipeSemanticFunction;
            invoke: SemanticFixture;
        }
    >();

    registerCapability(
        definition: RecipeCapability,
        invoke: CapabilityFixture,
    ): void {
        this.capabilities.set(definition.id, {
            definition: structuredClone(definition),
            invoke,
        });
    }

    registerSemantic(
        definition: RecipeSemanticFunction,
        invoke: SemanticFixture,
    ): void {
        this.semantics.set(definition.id, {
            definition: structuredClone(definition),
            invoke,
        });
    }

    async inspectCapability(
        requirement: RecipeCapability,
        _binding: RecipeBindingScope,
    ) {
        const fixture = this.capabilities.get(requirement.id);
        if (!fixture)
            return {
                status: "unavailable" as const,
                message: "No fixture registered.",
            };
        if (checkRecipeCapability(requirement, fixture.definition).length)
            return {
                status: "unsupported" as const,
                message: "Fixture capability contract mismatch.",
            };
        return {
            status: "available" as const,
            capability: structuredClone(fixture.definition),
        };
    }

    private observe(
        kind: FakeRecipeCall["kind"],
        id: string,
        input: JsonValue,
        context: RecipeCallContext,
    ) {
        this.calls.push({
            kind,
            id,
            input: structuredClone(input),
            runId: context.runId,
            callId: context.callId,
            ...(context.parentCallId
                ? { parentCallId: context.parentCallId }
                : {}),
        });
    }

    async invokeCapability(
        definition: RecipeCapability,
        input: JsonValue,
        context: RecipeCallContext,
    ): Promise<RecipeCallOutcome> {
        if (context.signal.aborted)
            return {
                status: "cancelled",
                code: "cancelled",
                message: "Fixture call cancelled.",
            };
        const preflight = await this.inspectCapability(
            definition,
            context.binding,
        );
        if (preflight.status !== "available")
            return { ...preflight, code: preflight.status };
        if (validateRecipeValue(definition.inputSchema, input).length)
            return {
                status: "failed",
                code: "invalid_input",
                message: "Fixture input schema mismatch.",
            };
        if (context.signal.aborted)
            return {
                status: "cancelled",
                code: "cancelled",
                message: "Fixture call cancelled.",
            };
        this.observe("capability", definition.id, input, context);
        const result = await this.capabilities
            .get(definition.id)!
            .invoke(structuredClone(input), context);
        // Cancellation cannot erase a possible write or an interaction already
        // returned by the provider. The caller retains its effect checkpoint.
        if (
            result.status === "completed" &&
            definition.outputSchema &&
            validateRecipeValue(definition.outputSchema, result.value).length
        )
            return {
                status: "failed",
                code: "invalid_output",
                message: "Fixture output schema mismatch.",
            };
        return structuredClone(result);
    }

    async invokeSemantic(
        definition: RecipeSemanticFunction,
        input: JsonValue,
        context: RecipeCallContext,
    ): Promise<RecipeSemanticOutcome> {
        if (context.signal.aborted)
            return { status: "cancelled", message: "Fixture call cancelled." };
        const fixture = this.semantics.get(definition.id);
        if (!fixture || fixture.definition.revision !== definition.revision)
            return {
                status: "unsupported",
                message: "No matching semantic fixture registered.",
            };
        if (validateRecipeValue(definition.inputSchema, input).length)
            return {
                status: "invalid_input",
                message: "Fixture semantic input schema mismatch.",
            };
        this.observe("semantic", definition.id, input, context);
        const result = await fixture.invoke(structuredClone(input), context);
        if (context.signal.aborted)
            return {
                status: "cancelled",
                message: "Late fixture result suppressed.",
            };
        if (
            result.status === "completed" &&
            validateRecipeValue(definition.outputSchema, result.value).length
        )
            return {
                status: "invalid_output",
                message: "Fixture semantic output schema mismatch.",
            };
        return structuredClone(result);
    }
}

export type RecipeFixtureResult =
    | { status: "passed"; output: JsonValue; calls: FakeRecipeCall[] }
    | { status: "failed"; message: string; calls: FakeRecipeCall[] };

export async function runRecipeFixture(
    artifact: RecipeArtifact,
    input: JsonValue,
    host: FakeRecipeHost,
    context: RecipeCallContext,
    execute: (
        host: RecipeHost,
        input: JsonValue,
        context: RecipeCallContext,
    ) => Promise<JsonValue>,
): Promise<RecipeFixtureResult> {
    const start = host.calls.length;
    const calls = () => structuredClone(host.calls.slice(start));
    const issues = [
        ...validateRecipeArtifact(artifact),
        ...validateRecipeValue(artifact.inputSchema, input),
    ];
    if (issues.length)
        return { status: "failed", message: issues[0].message, calls: calls() };
    for (const capability of artifact.capabilities) {
        const result = await host.inspectCapability(
            capability,
            context.binding,
        );
        if (result.status !== "available")
            return {
                status: "failed",
                message: result.message,
                calls: calls(),
            };
    }
    try {
        context.signal.throwIfAborted();
        const output = await execute(host, structuredClone(input), context);
        context.signal.throwIfAborted();
        const invalid = validateRecipeValue(artifact.outputSchema, output);
        if (invalid.length)
            return {
                status: "failed",
                message: invalid[0].message,
                calls: calls(),
            };
        return {
            status: "passed",
            output: structuredClone(output),
            calls: calls(),
        };
    } catch (error) {
        return {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
            calls: calls(),
        };
    }
}

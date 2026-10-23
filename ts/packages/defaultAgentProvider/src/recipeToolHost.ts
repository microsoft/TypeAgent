// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MacroStep,
    ReplayToolDescriptor,
    ReplayToolHost,
} from "@typeagent/copilot-macros";
import {
    checkRecipeCapability,
    recipeSchemaDigest,
    validateRuntimeJsonSchema,
    type JsonValue,
    type RecipeArtifact,
    type RecipeCapability,
    type RecipeHost,
    type RuntimeJsonSchema,
} from "@typeagent/copilot-macros/recipeCore";
import {
    RecipeSemanticAdapter,
    type ApprovedRecipeSemanticProvider,
    type RecipeSemanticRegistration,
} from "@typeagent/copilot-macros/recipeSemantic";

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function convertSchema(value: unknown): RuntimeJsonSchema {
    if (!record(value) || typeof value.type !== "string")
        throw new Error("A concrete runtime input schema is required.");
    const metadata = new Set([
        "$schema",
        "title",
        "description",
        "default",
        "examples",
        "$comment",
    ]);
    const supported = new Set([
        "type",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "minItems",
        "maxItems",
        "minLength",
        "maxLength",
        "enum",
        "minimum",
        "maximum",
    ]);
    for (const key of Object.keys(value))
        if (!metadata.has(key) && !supported.has(key))
            throw new Error(`Unsupported recipe schema keyword: ${key}`);
    const schema: Record<string, unknown> = Object.fromEntries(
        Object.entries(value).filter(([key]) => supported.has(key)),
    );
    if (value.type === "object") {
        if (value.properties !== undefined && !record(value.properties))
            throw new Error("Object schema properties must be an object.");
        schema.properties = Object.fromEntries(
            Object.entries(value.properties ?? {}).map(([key, child]) => [
                key,
                convertSchema(child),
            ]),
        );
        if (record(value.additionalProperties))
            throw new Error(
                "Schema-valued additionalProperties is unsupported.",
            );
        // A recipe uses only declared fields, even if the tool accepts more.
        schema.additionalProperties = false;
    } else if (value.type === "array") {
        schema.items = convertSchema(value.items);
    }
    const invalid = validateRuntimeJsonSchema(schema);
    if (invalid.length)
        throw new Error(
            `Unsupported runtime schema: ${invalid.map((issue) => issue.message).join("; ")}`,
        );
    return schema as RuntimeJsonSchema;
}

export function recipeCapabilityFromTool(
    descriptor: ReplayToolDescriptor,
): RecipeCapability {
    if (!descriptor.mcpServerName || !descriptor.inputSchema)
        throw new Error(
            "TypeAgent recipes require an available MCP capability with an actual input schema; native tools need a session broker.",
        );
    const inputSchema = convertSchema(descriptor.inputSchema);
    return {
        id: `mcp:${encodeURIComponent(descriptor.mcpServerName)}/${encodeURIComponent(descriptor.toolName)}`,
        transport: "mcp",
        providerId: descriptor.mcpServerName,
        operation: descriptor.toolName,
        contractVersion: `mcp-tool-v1:${descriptor.schemaFingerprint}`,
        inputSchema,
        schemaDigest: recipeSchemaDigest(inputSchema),
        compatibility: "exact",
        effect: descriptor.readOnly === true ? "read" : "unknown",
    };
}

export function createRecipeCapabilityInspector(host: ReplayToolHost) {
    return async (step: MacroStep, cwd: string): Promise<RecipeCapability> => {
        const descriptor = await host.inspectTool(
            step.mcpServerName,
            step.toolName,
            { cwd },
        );
        if (!descriptor)
            throw new Error(`Recorded tool is unavailable: ${step.toolName}`);
        return recipeCapabilityFromTool(descriptor);
    };
}

export function createTypeAgentRecipeHost(
    artifact: RecipeArtifact,
    host: ReplayToolHost,
    cwd: string,
    provider?: ApprovedRecipeSemanticProvider,
    registrations: RecipeSemanticRegistration[] = [],
): RecipeHost {
    const inspected = new Map<string, RecipeCapability>();
    const semantics = new Map(
        artifact.semanticFunctions.map((definition) => {
            const registration = registrations.find(
                (entry) =>
                    entry.definition.id === definition.id &&
                    entry.definition.revision === definition.revision,
            ) ?? { definition };
            return [
                definition.id,
                new RecipeSemanticAdapter(registration, provider),
            ];
        }),
    );
    return {
        async inspectCapability(requirement) {
            const cached = inspected.get(requirement.id);
            if (cached) return { status: "available", capability: cached };
            if (
                requirement.transport !== "mcp" ||
                requirement.effect !== "read"
            )
                return {
                    status: "unsupported",
                    message:
                        "The TypeAgent recipe host supports read-only MCP tools; effects and native session tools are not enabled.",
                };
            const descriptor = await host.inspectTool(
                requirement.providerId,
                requirement.operation,
                { cwd },
            );
            if (!descriptor)
                return {
                    status: "unavailable",
                    message: `Tool is unavailable: ${requirement.id}`,
                };
            const actual = recipeCapabilityFromTool(descriptor);
            const invalid = checkRecipeCapability(requirement, actual);
            if (invalid.length)
                return {
                    status: "unsupported",
                    message: `Tool contract changed: ${invalid.map((issue) => issue.message).join("; ")}`,
                };
            inspected.set(requirement.id, actual);
            return { status: "available", capability: actual };
        },
        async invokeCapability(capability, input, context) {
            context.signal.throwIfAborted();
            if (!inspected.has(capability.id))
                return {
                    status: "unsupported",
                    code: "not_preflighted",
                    message: "Capability must pass current-host preflight.",
                };
            try {
                const value = await host.callTool(
                    capability.providerId,
                    capability.operation,
                    input,
                    context.signal,
                    { cwd },
                );
                const serialized = JSON.stringify(value);
                if (serialized === undefined)
                    throw new Error("Tool returned no JSON result.");
                const json: JsonValue = JSON.parse(serialized);
                return { status: "completed", value: json };
            } catch (error) {
                return {
                    status: "execution_uncertain",
                    operationId: context.callId,
                    message:
                        error instanceof Error ? error.message : String(error),
                };
            }
        },
        async invokeSemantic(definition, input, context) {
            const adapter = semantics.get(definition.id);
            if (!adapter)
                return {
                    status: "unsupported",
                    message: `Undeclared semantic function: ${definition.id}`,
                };
            return adapter.invokeSemantic(definition, input, context);
        },
    };
}

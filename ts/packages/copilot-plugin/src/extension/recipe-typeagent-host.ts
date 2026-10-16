// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type {
    ActionContract,
    StructuredActionResponse,
} from "@typeagent/dispatcher-types";
import type {
    MacroStep,
    RecordedInteractionTrace,
} from "@typeagent/copilot-macros";
import { getRecipeActionParametersSchema } from "@typeagent/copilot-macros/macroSchema";
import {
    checkRecipeCapability,
    recipeSchemaDigest,
    validateRecipeValue,
    type JsonValue,
    type RecipeBindingScope,
    type RecipeCallContext,
    type RecipeCallOutcome,
    type RecipeCapability,
    type RecipeHost,
} from "@typeagent/copilot-macros/recipeCore";
import {
    RecipeTypeAgentAdapter,
    createTypeAgentRecipeDependency,
    isTypeAgentWrapperAction,
    recipeTypeAgentTools,
    type RecipeTypeAgentTools,
} from "../shared/recipe-typeagent.js";
import {
    readTypeAgentDiscovery,
    readTypeAgentExecution,
    typeAgentJson,
} from "../shared/recipe-typeagent-protocol.js";
import {
    createNativeRecipeCapabilityInspector,
    createNativeRecipeHost,
    type NativeRecipeHostPolicy,
    type NativeRecipeSession,
    normalizeNativeRecipeResult,
} from "./recipe-native-host.js";

const prefix = "typeagent-action/";

export function typeAgentActionOperation(
    schemaName: string,
    actionName: string,
): string {
    return `${prefix}${encodeURIComponent(schemaName)}/${encodeURIComponent(actionName)}`;
}

function identity(operation: string) {
    if (!operation.startsWith(prefix)) return undefined;
    const parts = operation.slice(prefix.length).split("/");
    if (parts.length !== 2)
        throw new Error("Invalid TypeAgent action identity.");
    const [schemaName, actionName] = parts.map(decodeURIComponent);
    if (
        !schemaName ||
        !actionName ||
        typeAgentActionOperation(schemaName, actionName) !== operation
    )
        throw new Error("Noncanonical TypeAgent action identity.");
    return { schemaName, actionName };
}

export function typeAgentActionCapability(
    server: string,
    contract: ActionContract,
): RecipeCapability {
    if (isTypeAgentWrapperAction(contract))
        throw new Error(
            "Recursive TypeAgent action dependencies are unsupported.",
        );
    if (contract.policy.effects !== "read-only")
        throw new Error(
            "Plugin-owned programs currently support read-only TypeAgent actions only.",
        );
    const dependency = createTypeAgentRecipeDependency(contract);
    const inputSchema = getRecipeActionParametersSchema(
        contract.input.schemaText,
        contract.schemaName,
        contract.input.typeName,
        contract.actionName,
    );
    const operation = typeAgentActionOperation(
        contract.schemaName,
        contract.actionName,
    );
    return {
        id: `mcp:${encodeURIComponent(server)}/${operation}`,
        transport: "mcp",
        providerId: server,
        operation,
        contractVersion: `typeagent-action-v1:${dependency.contractDigest}`,
        inputSchema,
        schemaDigest: recipeSchemaDigest(inputSchema),
        compatibility: "exact",
        effect: "read",
    };
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stableTypeAgentResult(value: unknown): JsonValue {
    if (!object(value)) throw new Error("Missing structured action output.");
    const result = readTypeAgentExecution(value);
    if (result.status !== "completed")
        throw new Error(
            "Only completed actions may become recorded program steps.",
        );
    return typeAgentJson({ output: result.output, results: result.results });
}

/** Scoped identifiers are consumed only by the adapter, never published as code. */
export function prepareTypeAgentRecording(
    trace: RecordedInteractionTrace,
    knownDiscoveries: ReadonlyMap<
        string,
        ReturnType<typeof readTypeAgentDiscovery>
    > = new Map(),
): RecordedInteractionTrace {
    const discoveries = new Map(knownDiscoveries);
    let discovered = false;
    const toolCalls: RecordedInteractionTrace["toolCalls"] = [];
    const key = (server: string, scope: string) =>
        JSON.stringify([server, scope]);
    for (const call of trace.toolCalls) {
        const server = call.mcpServerName;
        if (
            !server ||
            !Object.values(recipeTypeAgentTools).some(
                (name) => name === call.name,
            )
        ) {
            toolCalls.push(call);
            continue;
        }
        if (call.status !== "completed" || !object(call.result))
            throw new Error(
                "An incomplete TypeAgent protocol call cannot be learned.",
            );
        if (call.name === recipeTypeAgentTools.search) {
            const found = readTypeAgentDiscovery(call.result);
            discoveries.set(key(server, found.scopeId), found);
            discovered = true;
            continue;
        }
        if (
            call.name !== recipeTypeAgentTools.execute ||
            !object(call.arguments)
        )
            throw new Error(
                "Recording interactive TypeAgent workflows is not yet supported.",
            );
        const args = call.arguments;
        const found = discoveries.get(key(server, String(args.scopeId)));
        const matches = found?.actions.filter(
            (entry) =>
                entry.schemaName === args.schemaName &&
                entry.actionName === args.actionName,
        );
        if (matches?.length !== 1)
            throw new Error(
                "Recorded action has no exact discovery contract in this scope.",
            );
        const capability = typeAgentActionCapability(server, matches[0]);
        const parameters = typeAgentJson(args.parameters ?? {});
        if (validateRecipeValue(capability.inputSchema, parameters).length)
            throw new Error(
                "Recorded TypeAgent parameters violate the action contract.",
            );
        const result = readTypeAgentExecution(call.result);
        if (result.scopeId !== args.scopeId)
            throw new Error("Recorded action reply belongs to another scope.");
        const stable = stableTypeAgentResult(call.result);
        toolCalls.push({
            ...call,
            name: capability.operation,
            arguments: parameters,
            result: stable,
            modelResult: stable,
        });
    }
    if (discovered && !toolCalls.some((call) => call.name.startsWith(prefix)))
        throw new Error(
            "Discovery-only TypeAgent recordings are not executable actions.",
        );
    return { ...trace, toolCalls };
}

/** Keep normal discovery reusable across turns, scoped to this owning session. */
export function createTypeAgentRecordingNormalizer() {
    const discoveries = new Map<
        string,
        ReturnType<typeof readTypeAgentDiscovery>
    >();
    return {
        normalizeToolResult(
            value: unknown,
            call?: { name: string; mcpServerName?: string },
        ) {
            const result = normalizeNativeRecipeResult(value);
            if (
                call?.mcpServerName &&
                call.name === recipeTypeAgentTools.search &&
                object(result) &&
                result.protocolVersion === 1
            ) {
                const found = readTypeAgentDiscovery(result);
                discoveries.set(
                    JSON.stringify([call.mcpServerName, found.scopeId]),
                    found,
                );
                if (discoveries.size > 128)
                    discoveries.delete(discoveries.keys().next().value!);
            }
            return result;
        },
        prepareTrace: (trace: RecordedInteractionTrace) =>
            prepareTypeAgentRecording(trace, discoveries),
        clear: () => discoveries.clear(),
    };
}

export interface TypeAgentRecipeInteraction {
    (
        prompt: string,
        context: RecipeCallContext,
    ): Promise<
        | { source: "user"; response: StructuredActionResponse }
        | { source: "user"; cancelled: true }
    >;
}

export function createNativeTypeAgentRecipeHost(
    session: NativeRecipeSession,
    binding: RecipeBindingScope,
    semantics: Pick<RecipeHost, "invokeSemantic">,
    policy: NativeRecipeHostPolicy = {},
    interact?: TypeAgentRecipeInteraction,
) {
    const base = createNativeRecipeHost(session, binding, semantics, policy);
    const adapters = new Map<string, Promise<RecipeTypeAgentAdapter>>();
    const context = (): RecipeCallContext => ({
        runId: "typeagent-contract-preflight",
        callId: randomUUID(),
        binding,
        signal: new AbortController().signal,
    });
    const adapter = (server: string) => {
        let pending = adapters.get(server);
        if (!pending) {
            pending = (async () => {
                const rules = { ...policy, structuredActionServer: server };
                const inspect = createNativeRecipeCapabilityInspector(
                    session,
                    binding,
                    rules,
                );
                const entries = await Promise.all(
                    Object.entries(recipeTypeAgentTools).map(
                        async ([key, toolName]) => {
                            const result = await inspect({
                                mcpServerName: server,
                                toolName,
                            });
                            if (result.status !== "available")
                                throw new Error(result.message);
                            return [key, result.capability] as const;
                        },
                    ),
                );
                const tools = Object.fromEntries(
                    entries,
                ) as RecipeTypeAgentTools;
                return new RecipeTypeAgentAdapter({
                    tools,
                    host: createNativeRecipeHost(
                        session,
                        binding,
                        semantics,
                        rules,
                    ),
                    resultFormat: "structured",
                });
            })();
            adapters.set(server, pending);
        }
        return pending;
    };
    const inspectTool = async (
        step: Pick<MacroStep, "mcpServerName" | "toolName">,
    ) => {
        try {
            const action = identity(step.toolName);
            if (!action)
                return createNativeRecipeCapabilityInspector(
                    session,
                    binding,
                    policy,
                )(step);
            if (!step.mcpServerName)
                throw new Error("A TypeAgent MCP server binding is required.");
            const current = await adapter(step.mcpServerName);
            const found = await current.discover(
                `${action.schemaName} ${action.actionName}`,
                context(),
            );
            if (found.status !== "available") throw new Error(found.message);
            const matches = found.actions.filter(
                ({ contract }) =>
                    contract.schemaName === action.schemaName &&
                    contract.actionName === action.actionName,
            );
            if (matches.length !== 1)
                throw new Error(
                    "Current TypeAgent action is absent or ambiguous.",
                );
            return {
                status: "available" as const,
                capability: typeAgentActionCapability(
                    step.mcpServerName,
                    matches[0].contract,
                ),
            };
        } catch (error) {
            return { status: "unavailable" as const, message: String(error) };
        }
    };
    const host: RecipeHost = {
        async inspectCapability(requirement, scope) {
            if (!requirement.operation.startsWith(prefix))
                return base.inspectCapability(requirement, scope);
            if (JSON.stringify(scope) !== JSON.stringify(binding))
                return {
                    status: "unsupported",
                    message: "TypeAgent host binding changed.",
                };
            const result = await inspectTool({
                toolName: requirement.operation,
                mcpServerName: requirement.providerId,
            });
            if (result.status !== "available") return result;
            return checkRecipeCapability(requirement, result.capability).length
                ? {
                      status: "unsupported",
                      message: "TypeAgent action contract changed.",
                  }
                : result;
        },
        async invokeCapability(capability, input, call) {
            if (!capability.operation.startsWith(prefix))
                return base.invokeCapability(capability, input, call);
            const checked = await host.inspectCapability(
                capability,
                call.binding,
            );
            if (checked.status !== "available")
                return {
                    status: checked.status,
                    code: "typeagent_dependency",
                    message: checked.message,
                };
            if (
                !object(input) ||
                validateRecipeValue(capability.inputSchema, input).length
            )
                return {
                    status: "unsupported",
                    code: "typeagent_input",
                    message: "Invalid action parameters.",
                };
            const action = identity(capability.operation)!;
            const current = await adapter(capability.providerId);
            let outcome: RecipeCallOutcome = await current.execute(
                {
                    ...action,
                    kind: "typeagent-action",
                    protocolVersion: 1,
                    contractDigest: capability.contractVersion.slice(
                        "typeagent-action-v1:".length,
                    ),
                },
                input as Record<string, JsonValue>,
                call,
            );
            let interactions = 0;
            while (outcome.status === "requires_interaction" && interact) {
                if (++interactions > 16)
                    return {
                        status: "unavailable",
                        code: "interaction_limit",
                        message:
                            "TypeAgent interaction limit reached; do not replay.",
                    };
                const user = await interact(outcome.prompt, call);
                const next = {
                    ...call,
                    callId: `${call.callId}:interaction:${interactions}`,
                };
                outcome =
                    "cancelled" in user
                        ? await current.cancelAction(
                              outcome.interactionId,
                              user,
                              next,
                          )
                        : await current.continueAction(
                              outcome.interactionId,
                              user,
                              next,
                          );
            }
            if (outcome.status !== "completed") return outcome;
            return { ...outcome, value: stableTypeAgentResult(outcome.value) };
        },
        invokeSemantic: base.invokeSemantic,
    };
    return {
        host,
        inspectTool,
        dispose: async () => {
            const settled = await Promise.allSettled(adapters.values());
            for (const entry of settled)
                if (entry.status === "fulfilled") entry.value.dispose();
            adapters.clear();
        },
    };
}

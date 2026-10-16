// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    JsonValue,
    RecipeCallContext,
    RecipeCallOutcome,
    RecipeHost,
} from "@typeagent/copilot-macros/recipeCore";
import type {
    ActionContract,
    StructuredActionExecutionResult,
    StructuredActionResponse,
} from "@typeagent/dispatcher-types";
import { randomUUID } from "node:crypto";
import {
    adapterFailure,
    bindingKey,
    createTypeAgentRecipeDependency,
    readTypeAgentDiscovery,
    readTypeAgentExecution,
    readTypeAgentMcpResult,
    readTypeAgentTransport,
    toolBindingsValid,
    typeAgentContractDigest,
    typeAgentJson,
    type RecipeTypeAgentDependency,
    type RecipeTypeAgentTools,
} from "./recipe-typeagent-protocol.js";

export {
    createTypeAgentRecipeDependency,
    recipeTypeAgentTools,
    typeAgentContractDigest,
    type RecipeTypeAgentDependency,
    type RecipeTypeAgentTools,
} from "./recipe-typeagent-protocol.js";

type Pending = {
    binding: string;
    runId: string;
    scopeId: string;
    operationId: string;
    interactionId: string;
    expiresAt: number;
};

export type RecipeTypeAgentOutcome = RecipeCallOutcome & {
    /** Exact MCP envelope, including structuredContent and isError. */
    mcpResult?: JsonValue;
};

export type RecipeTypeAgentDiscovery =
    | {
          status: "available";
          actions: {
              contract: ActionContract;
              dependency: RecipeTypeAgentDependency;
          }[];
      }
    | { status: "unavailable"; message: string };

export interface RecipeTypeAgentAdapterOptions {
    host: RecipeHost;
    tools: RecipeTypeAgentTools;
    /** Additional application-specific wrappers that must never recurse. */
    isWrapperAction?: (dependency: RecipeTypeAgentDependency) => boolean;
}

/**
 * Optional protocol adapter, not an action executor or backend connection.
 * The injected live host must return the MCP CallToolResult as its value.
 * Private client credentials stay in the existing MCP process.
 */
export class RecipeTypeAgentAdapter {
    private readonly pending = new Map<string, Pending>();
    private readonly active = new Set<string>();
    private readonly consumed = new Set<string>();
    private disposed = false;
    private requests = 0;
    private searching = false;

    constructor(private readonly options: RecipeTypeAgentAdapterOptions) {
        if (!toolBindingsValid(options.tools)) {
            throw new Error("Expected the four existing TypeAgent MCP tools.");
        }
    }

    private async call(
        tool: keyof RecipeTypeAgentTools,
        input: JsonValue,
        context: RecipeCallContext,
    ): Promise<RecipeCallOutcome> {
        const capability = this.options.tools[tool];
        if (++this.requests > 4096) {
            return adapterFailure(
                "unavailable",
                "request_limit",
                "The adapter session request limit was reached.",
            );
        }
        let request: JsonValue;
        try {
            request = typeAgentJson(input);
        } catch {
            return adapterFailure(
                "unavailable",
                "invalid_request",
                "Protocol input is invalid or exceeds the adapter limit. Nothing was dispatched.",
            );
        }
        if (this.disposed) {
            return adapterFailure(
                "unavailable",
                "disposed",
                "Adapter session ended.",
            );
        }
        try {
            const checked = await this.options.host.inspectCapability(
                capability,
                context.binding,
            );
            if (checked.status !== "available") {
                return adapterFailure(
                    "unavailable",
                    "missing_dependency",
                    checked.message,
                );
            }
            if (
                JSON.stringify(checked.capability) !==
                JSON.stringify(capability)
            ) {
                return adapterFailure(
                    "unavailable",
                    "changed_dependency",
                    "The current MCP capability differs from its binding.",
                );
            }
        } catch {
            return adapterFailure(
                "unavailable",
                "missing_dependency",
                "The MCP dependency could not be inspected.",
            );
        }
        if (context.signal.aborted || this.disposed) {
            return {
                status: "cancelled",
                code: "cancelled",
                message: "Cancelled before dispatch.",
            };
        }
        try {
            return await this.options.host.invokeCapability(
                capability,
                request,
                context,
            );
        } catch {
            return tool === "search"
                ? adapterFailure(
                      "unavailable",
                      "discovery_failed",
                      "No authoritative discovery reply was received.",
                  )
                : {
                      status: "execution_uncertain",
                      operationId: `host-call:${context.callId}`,
                      message:
                          "No authoritative reply after host dispatch. Effects may have occurred; do not replay. operationId is a local host-call reference, not a resumable backend id.",
                  };
        }
    }

    private boundedResult(value: JsonValue) {
        return readTypeAgentMcpResult(typeAgentJson(value));
    }

    private async search(query: string, context: RecipeCallContext) {
        if (this.searching || !query.trim() || query.length > 4096) {
            throw new Error("Nested, concurrent, or invalid discovery.");
        }
        this.searching = true;
        try {
            const outcome = await this.call("search", { query }, context);
            if (outcome.status !== "completed") {
                throw new Error("Discovery unavailable.");
            }
            const result = this.boundedResult(outcome.value);
            if (result.isError) throw new Error("Discovery rejected.");
            return readTypeAgentDiscovery(result.data);
        } finally {
            this.searching = false;
        }
    }

    async discover(
        query: string,
        context: RecipeCallContext,
    ): Promise<RecipeTypeAgentDiscovery> {
        if (!query.trim() || query.length > 4096) {
            return {
                status: "unavailable",
                message: "Invalid discovery query.",
            };
        }
        try {
            const found = await this.search(query, context);
            return {
                status: "available",
                actions: found.actions.map((contract) => ({
                    contract,
                    dependency: createTypeAgentRecipeDependency(contract),
                })),
            };
        } catch {
            return {
                status: "unavailable",
                message: "Current TypeAgent discovery is unavailable.",
            };
        }
    }

    private wrapper(dependency: RecipeTypeAgentDependency): boolean {
        return (
            /(?:recipe|macro|processcommand|executeaction|continueaction|cancelaction)/i.test(
                `${dependency.schemaName}.${dependency.actionName}`,
            ) || this.options.isWrapperAction?.(dependency) === true
        );
    }

    private async resolve(
        dependency: RecipeTypeAgentDependency,
        context: RecipeCallContext,
    ): Promise<string> {
        if (
            dependency.kind !== "typeagent-action" ||
            dependency.protocolVersion !== 1 ||
            this.wrapper(dependency)
        ) {
            throw new Error("Unsupported or recursive action dependency.");
        }
        const found = await this.search(
            `${dependency.schemaName} ${dependency.actionName}`,
            context,
        );
        const matches = found.actions.filter(
            (action) =>
                action.schemaName === dependency.schemaName &&
                action.actionName === dependency.actionName,
        );
        if (
            matches.length !== 1 ||
            typeAgentContractDigest(matches[0]) !== dependency.contractDigest
        ) {
            throw new Error("Action contract changed or is absent.");
        }
        return found.scopeId;
    }

    /** Call for every declared TypeAgent dependency before a mixed run's effects. */
    async preflight(
        dependencies: readonly RecipeTypeAgentDependency[],
        context: RecipeCallContext,
    ): Promise<RecipeCallOutcome> {
        if (dependencies.length > 128) {
            return adapterFailure(
                "unavailable",
                "dependency_limit",
                "Too many action dependencies.",
            );
        }
        try {
            for (const dependency of dependencies) {
                await this.resolve(dependency, context);
            }
            for (const capability of Object.values(this.options.tools)) {
                const checked = await this.options.host.inspectCapability(
                    capability,
                    context.binding,
                );
                if (
                    checked.status !== "available" ||
                    JSON.stringify(checked.capability) !==
                        JSON.stringify(capability)
                ) {
                    throw new Error("MCP dependency unavailable.");
                }
            }
            return { status: "completed", value: null };
        } catch {
            return adapterFailure(
                "unavailable",
                "missing_dependency",
                "A current TypeAgent dependency is missing or incompatible; no action was dispatched.",
            );
        }
    }

    private async once(
        context: RecipeCallContext,
        operation: () => Promise<RecipeCallOutcome>,
    ): Promise<RecipeCallOutcome> {
        const key = JSON.stringify([
            bindingKey(context.binding),
            context.runId,
            context.callId,
        ]);
        if (
            context.parentCallId === context.callId ||
            this.disposed ||
            this.active.size ||
            this.consumed.has(key)
        ) {
            return adapterFailure(
                "denied",
                "nested_or_duplicate_call",
                "Nested, concurrent wrapper, or duplicate calls are not allowed.",
            );
        }
        if (this.consumed.size >= 4096) {
            return adapterFailure(
                "unavailable",
                "call_limit",
                "Create a new adapter for a new host session.",
            );
        }
        this.active.add(key);
        this.consumed.add(key);
        try {
            if (context.signal.aborted) {
                return {
                    status: "cancelled",
                    code: "cancelled",
                    message: "Cancelled before dispatch.",
                };
            }
            return await operation();
        } finally {
            this.active.delete(key);
        }
    }

    async execute(
        dependency: RecipeTypeAgentDependency,
        parameters: Record<string, JsonValue> | undefined,
        context: RecipeCallContext,
    ): Promise<RecipeTypeAgentOutcome> {
        return this.once(context, async () => {
            if (this.pending.size >= 32) {
                return adapterFailure(
                    "unavailable",
                    "interaction_limit",
                    "Pending interaction limit reached.",
                );
            }
            let scopeId: string;
            try {
                scopeId = await this.resolve(dependency, context);
            } catch {
                return adapterFailure(
                    "unavailable",
                    "missing_dependency",
                    "The current action contract is absent, changed, or recursive. No action was dispatched.",
                );
            }
            return this.dispatch(
                "execute",
                {
                    protocolVersion: 1,
                    scopeId,
                    schemaName: dependency.schemaName,
                    actionName: dependency.actionName,
                    ...(parameters === undefined ? {} : { parameters }),
                },
                context,
            );
        });
    }

    private async dispatch(
        tool: "execute" | "continue" | "cancel",
        input: JsonValue,
        context: RecipeCallContext,
    ): Promise<RecipeTypeAgentOutcome> {
        const outcome = await this.call(tool, input, context);
        if (outcome.status !== "completed") return outcome;
        let envelope: JsonValue | undefined;
        try {
            const result = this.boundedResult(outcome.value);
            envelope = result.envelope;
            const transport = readTypeAgentTransport(
                result.data,
                context.callId,
            );
            if (transport) {
                return {
                    ...transport,
                    mcpResult: result.envelope,
                };
            }
            const data = readTypeAgentExecution(result.data);
            if (
                typeof input !== "object" ||
                input === null ||
                Array.isArray(input) ||
                data.scopeId !== input.scopeId
            ) {
                throw new Error("Mismatched execution scope.");
            }
            if (data.status === "completed" && result.isError) {
                throw new Error("Conflicting MCP completion.");
            }
            return {
                ...this.translate(data, result.envelope, context),
                mcpResult: result.envelope,
            };
        } catch {
            return {
                status: "execution_uncertain",
                operationId: `host-call:${context.callId}`,
                message:
                    "Malformed or conflicting MCP reply after dispatch. Do not replay. operationId is a local host-call reference, not a resumable backend id.",
                ...(envelope === undefined ? {} : { mcpResult: envelope }),
            };
        }
    }

    private translate(
        data: StructuredActionExecutionResult,
        envelope: JsonValue,
        context: RecipeCallContext,
    ): RecipeCallOutcome {
        if (data.status === "completed") {
            return {
                status: "completed",
                value: envelope,
                evidence: { raw: envelope },
            };
        }
        if (data.status === "requires_interaction") {
            const interactionId = randomUUID();
            this.pending.set(interactionId, {
                binding: bindingKey(context.binding),
                runId: context.runId,
                scopeId: data.scopeId,
                operationId: data.operationId,
                interactionId: data.interactionId,
                expiresAt: data.expiresAt,
            });
            return {
                status: "requires_interaction",
                interactionId,
                prompt: JSON.stringify(data.prompt),
            };
        }
        if (data.status === "execution_uncertain") {
            return {
                status: data.status,
                operationId: data.operationId,
                message: data.error.message,
            };
        }
        return {
            status: data.status,
            code: data.error.code,
            message: data.error.message,
        };
    }

    /** Host UI only: source is provenance, not authorization. Never expose this
     * method (or cancelAction) as a capability callable by recipe code. */
    async continueAction(
        interactionId: string,
        user: { source: "user"; response: StructuredActionResponse },
        context: RecipeCallContext,
    ): Promise<RecipeTypeAgentOutcome> {
        return this.resume("continue", interactionId, user, context);
    }

    async cancelAction(
        interactionId: string,
        user: { source: "user" },
        context: RecipeCallContext,
    ): Promise<RecipeTypeAgentOutcome> {
        return this.resume("cancel", interactionId, user, context);
    }

    private async resume(
        tool: "continue" | "cancel",
        interactionId: string,
        user: { source: "user"; response?: StructuredActionResponse },
        context: RecipeCallContext,
    ): Promise<RecipeTypeAgentOutcome> {
        return this.once(context, async () => {
            const pending = this.pending.get(interactionId);
            if (
                !pending ||
                pending.binding !== bindingKey(context.binding) ||
                pending.runId !== context.runId ||
                user?.source !== "user" ||
                (tool === "continue" && user.response === undefined)
            ) {
                return adapterFailure(
                    "denied",
                    "invalid_interaction",
                    "A current interaction and explicit actual user response or cancellation are required.",
                );
            }
            if (tool === "continue" && pending.expiresAt <= Date.now()) {
                return adapterFailure(
                    "unavailable",
                    "interaction_expired",
                    "The interaction expired. Do not replay the action.",
                );
            }
            let input: JsonValue;
            try {
                input = typeAgentJson({
                    protocolVersion: 1,
                    scopeId: pending.scopeId,
                    operationId: pending.operationId,
                    interactionId: pending.interactionId,
                    ...(tool === "continue" ? { response: user.response } : {}),
                });
            } catch {
                return adapterFailure(
                    "denied",
                    "invalid_user_response",
                    "The actual user response must be bounded protocol JSON.",
                );
            }
            // Consume before dispatch: a lost reply must never replay an answer.
            this.pending.delete(interactionId);
            return this.dispatch(tool, input, context);
        });
    }

    /** Drop in-memory references when the owning host session ends. */
    dispose(): void {
        this.disposed = true;
        this.pending.clear();
        this.consumed.clear();
    }
}

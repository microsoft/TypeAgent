// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotSession } from "@github/copilot-sdk";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { recipeTypeAgentTools } from "../shared/recipe-typeagent-protocol.js";
import path from "node:path";
import type { MacroStep } from "@typeagent/copilot-macros";
import {
    checkRecipeCapability,
    recipeSchemaDigest,
    validateRecipeValue,
    validateRuntimeJsonSchema,
    type JsonValue,
    type RecipeBindingScope,
    type RecipeCapability,
    type RecipeCallOutcome,
    type RecipeHost,
    type RuntimeJsonSchema,
} from "@typeagent/copilot-macros/recipeCore";

export type NativeRecipeSession = Pick<CopilotSession, "sessionId" | "on"> & {
    rpc: Pick<CopilotSession["rpc"], "tools" | "metadata" | "gitHubAuth">;
};

export interface NativeRecipeHostPolicy {
    /** Internal transport for the typed adapter only, never a guest capability. */
    structuredActionServer?: string;
    /** Explicit read classification, not permission approval. SDK metadata omits MCP annotations. */
    readOnlyMcpTools?: readonly {
        mcpServerName: string;
        toolName: string;
    }[];
    timeoutMs?: number;
    maxOutputBytes?: number;
}

export type NativeRecipeCapabilityInspection =
    | { status: "available"; capability: RecipeCapability }
    | { status: "unsupported" | "unavailable"; message: string };

const nativeReads = new Set(["view", "rg", "glob"]);
function structuredActionTool(
    step: Pick<MacroStep, "mcpServerName" | "toolName">,
    policy: NativeRecipeHostPolicy,
): boolean {
    return (
        step.mcpServerName !== undefined &&
        step.mcpServerName === policy.structuredActionServer &&
        Object.values(recipeTypeAgentTools).some(
            (name) => name === step.toolName,
        )
    );
}
const generations = new WeakMap<NativeRecipeSession, string>();
const invalidatingEvents = new Set([
    "session.context_changed",
    "session.permissions_changed",
    "session.shutdown",
    "session.resume",
    "session.tools_updated",
    "session.managed_settings_resolved",
    "mcp.tools.list_changed",
    "session.mcp_server_status_changed",
    "session.mcp_server_removed",
]);

function generation(session: NativeRecipeSession): string {
    let value = generations.get(session);
    if (!value) {
        value = randomUUID();
        generations.set(session, value);
        session.on((event) => {
            if (event.agentId && event.agentId !== session.sessionId) return;
            if (invalidatingEvents.has(event.type))
                generations.set(session, randomUUID());
        });
    }
    return value;
}

export async function captureNativeRecipeBinding(
    session: NativeRecipeSession,
    profileId = "copilot-native",
): Promise<RecipeBindingScope> {
    await session.rpc.tools.initializeAndValidate();
    const [metadata, auth] = await Promise.all([
        session.rpc.metadata.snapshot(),
        session.rpc.gitHubAuth.getStatus(),
    ]);
    if (metadata.sessionId !== session.sessionId || metadata.isRemote)
        throw new Error("A local root session binding is required.");
    if (auth.isAuthenticated && (!auth.host || !auth.login))
        throw new Error(
            "Native host did not expose the selected account identity.",
        );
    return {
        workspaceId:
            process.platform === "win32"
                ? path.resolve(metadata.workingDirectory).toLowerCase()
                : path.resolve(metadata.workingDirectory),
        profileId,
        providerId: "copilot-native",
        accountId: JSON.stringify([
            auth.isAuthenticated,
            auth.authType ?? null,
            auth.host ?? null,
            auth.login ?? null,
        ]),
        sessionId: session.sessionId,
        generation: `${metadata.startTime}:${generation(session)}`,
    };
}

export function sameNativeRecipeBinding(
    left: RecipeBindingScope,
    right: RecipeBindingScope,
): boolean {
    return (
        left.workspaceId === right.workspaceId &&
        left.profileId === right.profileId &&
        left.providerId === right.providerId &&
        left.accountId === right.accountId &&
        left.sessionId === right.sessionId &&
        left.generation === right.generation
    );
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

const metadataKeys = new Set([
    "$schema",
    "title",
    "description",
    "default",
    "examples",
    "$comment",
]);
const schemaKeys = new Set([
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

/** Normalize only the portable subset. Unknown constraints never silently disappear. */
export function normalizeNativeRecipeSchema(value: unknown): RuntimeJsonSchema {
    if (!record(value)) throw new Error("Tool has no concrete JSON schema.");
    const schema: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
        if (schemaKeys.has(key)) schema[key] = child;
        else if (!metadataKeys.has(key))
            throw new Error(`Unsupported tool schema keyword: ${key}`);
    }
    if (schema.type === "object") {
        if (value.properties !== undefined && !record(value.properties))
            throw new Error("Invalid object schema properties.");
        if (
            value.additionalProperties !== undefined &&
            value.additionalProperties !== false
        )
            throw new Error("Open object tool schemas are unsupported.");
        schema.properties = Object.fromEntries(
            Object.entries(value.properties ?? {}).map(([key, child]) => [
                key,
                normalizeNativeRecipeSchema(child),
            ]),
        );
        schema.additionalProperties = false;
        if (Array.isArray(schema.required))
            schema.required = [...schema.required].sort();
    }
    if (schema.type === "array")
        schema.items = normalizeNativeRecipeSchema(value.items);
    const issues = validateRuntimeJsonSchema(schema);
    if (issues.length)
        throw new Error(issues.map((issue) => issue.message).join("; "));
    return schema as RuntimeJsonSchema;
}

function recursiveTool(server: string | undefined, name: string): boolean {
    return /(?:typeagent|recipe|macro)/i.test(`${server ?? ""}/${name}`);
}

async function inspect(
    session: NativeRecipeSession,
    binding: RecipeBindingScope,
    step: Pick<MacroStep, "mcpServerName" | "toolName">,
    policy: NativeRecipeHostPolicy,
): Promise<
    | (NativeRecipeCapabilityInspection & { nativeName?: string })
    | { status: "available"; capability: RecipeCapability; nativeName: string }
> {
    if (
        !sameNativeRecipeBinding(
            binding,
            await captureNativeRecipeBinding(session, binding.profileId),
        )
    )
        return { status: "unsupported", message: "Native binding changed." };
    const structuredAction = structuredActionTool(step, policy);
    if (!structuredAction && recursiveTool(step.mcpServerName, step.toolName))
        return {
            status: "unsupported",
            message: "Recipe recursion is denied.",
        };
    await session.rpc.tools.initializeAndValidate();
    // SDK 1.0.13 has no session.tools.list. This is its actual session-local
    // listing API; server.tools.list would omit MCP and extension schemas.
    const { tools } = await session.rpc.tools.getCurrentMetadata();
    const matches = (tools ?? []).filter((tool) =>
        step.mcpServerName
            ? tool.mcpServerName === step.mcpServerName &&
              tool.mcpToolName === step.toolName
            : !tool.mcpServerName && tool.name === step.toolName,
    );
    const tool = matches[0];
    if (matches.length !== 1 || !tool)
        return {
            status: "unavailable",
            message: "Exact offered tool identity is unavailable or ambiguous.",
        };
    const readOnly = step.mcpServerName
        ? policy.readOnlyMcpTools?.some(
              (entry) =>
                  entry.mcpServerName === step.mcpServerName &&
                  entry.toolName === step.toolName,
          )
        : nativeReads.has(step.toolName);
    if (!readOnly && !structuredAction)
        return {
            status: "unsupported",
            message: "Tool has no explicit read-only classification.",
        };
    try {
        // The typed protocol adapter validates these requests. The backend owns
        // open parameters/response schemas, which are not portable guest schemas.
        const inputSchema = structuredAction
            ? {
                  type: "object" as const,
                  properties: {},
                  additionalProperties: false as const,
              }
            : normalizeNativeRecipeSchema(tool.input_schema);
        const providerId = step.mcpServerName ?? "copilot-native";
        const transport = step.mcpServerName ? "mcp" : "native";
        const schemaDigest = recipeSchemaDigest(inputSchema);
        return {
            status: "available",
            nativeName: tool.name,
            capability: {
                id: `${transport}:${encodeURIComponent(providerId)}/${encodeURIComponent(step.toolName)}`,
                transport,
                providerId,
                operation: step.toolName,
                contractVersion: structuredAction
                    ? `copilot-structured-tool-v1:${createHash("sha256").update(JSON.stringify(tool.input_schema)).digest("hex")}`
                    : `copilot-session-tool-v1:${schemaDigest}`,
                inputSchema,
                schemaDigest,
                compatibility: "exact",
                effect:
                    structuredAction &&
                    step.toolName !== recipeTypeAgentTools.search
                        ? "unknown"
                        : "read",
            },
        };
    } catch (error) {
        return { status: "unsupported", message: String(error) };
    }
}

export function createNativeRecipeCapabilityInspector(
    session: NativeRecipeSession,
    binding: RecipeBindingScope,
    policy: NativeRecipeHostPolicy = {},
) {
    const captured = structuredClone(binding);
    const rules = structuredClone(policy);
    return async (
        step: Pick<MacroStep, "mcpServerName" | "toolName">,
    ): Promise<NativeRecipeCapabilityInspection> => {
        try {
            const result = await withDeadline(
                inspect(session, captured, step, rules),
                rules.timeoutMs ?? 30_000,
            );
            return result.status === "available"
                ? { status: "available", capability: result.capability }
                : result;
        } catch (error) {
            return { status: "unavailable", message: String(error) };
        }
    };
}

function failure(
    status: "unsupported" | "denied" | "failed" | "cancelled",
    message: string,
): RecipeCallOutcome {
    return { status, code: `native_${status}`, message };
}

function toolResult(
    value: unknown,
    maxBytes: number,
    structuredAction = false,
): RecipeCallOutcome {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes)
        return failure("failed", "Native result exceeds the output bound.");
    if (typeof value === "string") return { status: "completed", value };
    if (!record(value)) return failure("failed", "Invalid native result.");
    if (structuredAction && value.resultType !== "denied") {
        const data = normalizeNativeRecipeResult(value);
        if (
            record(data) &&
            (data.protocolVersion === 1 || data.source === "copilot-transport")
        )
            return { status: "completed", value: data };
    }
    if (value.resultType !== "success")
        return failure(
            value.resultType === "denied" ||
                /denied|reject|permission/i.test(
                    String(value.error ?? value.textResultForLlm),
                )
                ? "denied"
                : "failed",
            String(value.error ?? value.textResultForLlm),
        );
    return { status: "completed", value: normalizeNativeRecipeResult(value) };
}

export function normalizeNativeRecipeResult(value: unknown): JsonValue {
    if (!record(value)) throw new Error("Invalid native result envelope.");
    const processed =
        value.structuredContent !== undefined
            ? value.structuredContent
            : (value.content ?? value.textResultForLlm);
    if (processed === undefined)
        throw new Error("Native success did not contain a processed result.");
    let result = processed;
    if (typeof processed === "string") {
        try {
            result = JSON.parse(processed);
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
    }
    // Match captured model-visible results, not the SDK transport envelope.
    return JSON.parse(JSON.stringify(result)) as JsonValue;
}

async function boundedToolExecution(
    session: NativeRecipeSession,
    name: string,
    input: JsonValue,
    context: Parameters<RecipeHost["invokeCapability"]>[2],
    policy: NativeRecipeHostPolicy,
    structuredAction = false,
): Promise<RecipeCallOutcome> {
    const toolCallId = `recipe-native-${randomUUID()}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    const stopped = new Promise<RecipeCallOutcome>((resolve) => {
        onAbort = () =>
            resolve({
                status: "execution_uncertain",
                operationId: toolCallId,
                message:
                    "Native dispatch may still be running; late results suppressed. SDK has no exact-tool cancellation API; parent session was not aborted.",
            });
        context.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(onAbort, policy.timeoutMs ?? 30_000);
    });
    try {
        if (context.signal.aborted)
            return failure("cancelled", "Cancelled before native dispatch.");
        const executing = session.rpc.tools
            .execute({ name, arguments: input, toolCallId })
            .then(
                (value) => {
                    try {
                        return toolResult(
                            value,
                            policy.maxOutputBytes ?? 1_048_576,
                            structuredAction,
                        );
                    } catch {
                        return failure(
                            "failed",
                            "Native result is not bounded JSON.",
                        );
                    }
                },
                () =>
                    ({
                        status: "execution_uncertain",
                        operationId: toolCallId,
                        message:
                            "Native dispatch failed without a definitive result; not retried.",
                    }) as RecipeCallOutcome,
            );
        return await Promise.race([executing, stopped]);
    } finally {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", onAbort);
    }
}

export function createNativeRecipeHost(
    session: NativeRecipeSession,
    binding: RecipeBindingScope,
    semanticAdapter: Pick<RecipeHost, "invokeSemantic">,
    policy: NativeRecipeHostPolicy = {},
): RecipeHost {
    const captured = structuredClone(binding);
    const rules = structuredClone(policy);
    const approved = new Map<string, RecipeCapability>();
    const current = () =>
        captureNativeRecipeBinding(session, captured.profileId);
    const host: RecipeHost = {
        async inspectCapability(requirement, scope) {
            if (!sameNativeRecipeBinding(scope, captured))
                return { status: "unsupported", message: "Binding mismatch." };
            const result = await inspect(
                session,
                captured,
                {
                    toolName: requirement.operation,
                    ...(requirement.transport === "mcp"
                        ? { mcpServerName: requirement.providerId }
                        : {}),
                },
                rules,
            );
            if (result.status !== "available") return result;
            if (checkRecipeCapability(requirement, result.capability).length)
                return {
                    status: "unsupported",
                    message: "Tool contract changed.",
                };
            approved.set(requirement.id, structuredClone(result.capability));
            return { status: "available", capability: result.capability };
        },
        async invokeCapability(capability, input, context) {
            if (context.signal.aborted)
                return failure("cancelled", "Cancelled before dispatch.");
            const preflight = approved.get(capability.id);
            if (
                !preflight ||
                checkRecipeCapability(capability, preflight).length ||
                !sameNativeRecipeBinding(context.binding, captured)
            )
                return failure("unsupported", "Missing exact bound preflight.");
            const result = await inspect(
                session,
                captured,
                {
                    toolName: capability.operation,
                    ...(capability.transport === "mcp"
                        ? { mcpServerName: capability.providerId }
                        : {}),
                },
                rules,
            );
            if (
                result.status !== "available" ||
                !result.nativeName ||
                checkRecipeCapability(capability, result.capability).length ||
                !sameNativeRecipeBinding(captured, await current())
            )
                return failure(
                    "unsupported",
                    "Binding or tool contract changed.",
                );
            if (
                !structuredActionTool(
                    {
                        toolName: capability.operation,
                        mcpServerName: capability.providerId,
                    },
                    rules,
                ) &&
                validateRecipeValue(capability.inputSchema, input).length
            )
                return failure(
                    "unsupported",
                    "Input violates the tool schema.",
                );
            const outcome = await boundedToolExecution(
                session,
                result.nativeName,
                input,
                context,
                rules,
                structuredActionTool(
                    {
                        toolName: capability.operation,
                        mcpServerName: capability.providerId,
                    },
                    rules,
                ),
            );
            return sameNativeRecipeBinding(captured, await current())
                ? outcome
                : failure("unsupported", "Binding changed during execution.");
        },
        async invokeSemantic(definition, input, context) {
            if (
                !sameNativeRecipeBinding(context.binding, captured) ||
                !sameNativeRecipeBinding(captured, await current())
            )
                return { status: "unsupported", message: "Binding changed." };
            return semanticAdapter.invokeSemantic(definition, input, context);
        },
    };
    return {
        inspectCapability: async (requirement, scope) => {
            try {
                return await withDeadline(
                    host.inspectCapability(requirement, scope),
                    rules.timeoutMs ?? 30_000,
                );
            } catch (error) {
                return { status: "unavailable", message: String(error) };
            }
        },
        invokeCapability: async (capability, input, context) => {
            const controller = new AbortController();
            const abort = () => controller.abort();
            context.signal.addEventListener("abort", abort, { once: true });
            if (context.signal.aborted) controller.abort();
            try {
                return await withDeadline(
                    host.invokeCapability(capability, input, {
                        ...context,
                        signal: controller.signal,
                    }),
                    rules.timeoutMs ?? 30_000,
                    abort,
                    context.signal,
                );
            } catch {
                return {
                    status: "execution_uncertain",
                    operationId: context.callId,
                    message:
                        "Native call deadline or binding observation failed; not retried.",
                };
            } finally {
                context.signal.removeEventListener("abort", abort);
            }
        },
        invokeSemantic: host.invokeSemantic,
    };
}

async function withDeadline<T>(
    work: Promise<T>,
    timeoutMs: number,
    onTimeout?: () => void,
    signal?: AbortSignal,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                onAbort = () =>
                    reject(new Error("Native operation cancelled."));
                signal?.addEventListener("abort", onAbort, { once: true });
                if (signal?.aborted) onAbort();
                timer = setTimeout(() => {
                    onTimeout?.();
                    reject(new Error("Native operation deadline exceeded."));
                }, timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    JsonValue,
    RecipeBindingScope,
    RecipeCallOutcome,
    RecipeCapability,
} from "@typeagent/copilot-macros/recipeCore";
import type {
    ActionContract,
    ActionIdentity,
    ActionSearchResult,
    StructuredActionExecutionResult,
} from "@typeagent/dispatcher-types";
import { createHash } from "node:crypto";
import { z } from "zod";

export const recipeTypeAgentTools = {
    search: "typeagent-searchActions",
    execute: "typeagent-executeAction",
    continue: "typeagent-continueAction",
    cancel: "typeagent-cancelAction",
} as const;

/** Persist only this stable contract dependency, never a discovery scope. */
export interface RecipeTypeAgentDependency extends ActionIdentity {
    kind: "typeagent-action";
    protocolVersion: 1;
    contractDigest: string;
}

export type RecipeTypeAgentTools = {
    [K in keyof typeof recipeTypeAgentTools]: RecipeCapability;
};

const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
        z.null(),
        z.boolean(),
        z.number().finite(),
        z.string(),
        z.array(jsonSchema),
        z.record(jsonSchema),
    ]),
);

export function typeAgentJson(value: unknown): JsonValue {
    const parsed = jsonSchema.parse(value);
    if (JSON.stringify(parsed).length > 1_048_576) {
        throw new Error("Invalid or oversized protocol JSON.");
    }
    return parsed;
}

export function typeAgentContractDigest(contract: ActionContract): string {
    const stable = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(stable);
        if (!object(value)) return value;
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, stable(value[key])]),
        );
    };
    return createHash("sha256")
        .update(
            JSON.stringify(
                stable([
                    contract.schemaName,
                    contract.actionName,
                    contract.input,
                    contract.policy,
                    contract.output,
                    contract.interactions,
                ]),
            ),
        )
        .digest("hex");
}

export function createTypeAgentRecipeDependency(
    contract: ActionContract,
): RecipeTypeAgentDependency {
    return {
        kind: "typeagent-action",
        protocolVersion: 1,
        schemaName: contract.schemaName,
        actionName: contract.actionName,
        contractDigest: typeAgentContractDigest(contract),
    };
}

export function bindingKey(binding: RecipeBindingScope): string {
    return JSON.stringify([
        binding.workspaceId,
        binding.profileId,
        binding.providerId,
        binding.accountId,
        binding.sessionId,
        binding.generation,
    ]);
}

export function adapterFailure(
    status: "unavailable" | "unsupported" | "denied",
    code: string,
    message: string,
): RecipeCallOutcome {
    return { status, code, message };
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

const actionContractSchema = z.object({
    schemaName: z.string().min(1),
    actionName: z.string().min(1),
    description: z.string(),
    input: z.object({
        format: z.literal("typescript"),
        typeName: z.string().min(1),
        schemaText: z.string().min(1),
    }),
    policy: z.object({
        effects: z.enum(["read-only", "state-changing", "unknown"]),
        confirmation: z.enum(["required", "not-required"]),
    }),
    output: z.object({
        envelope: z.literal("ActionResult"),
        optional: z.literal(true),
        resultValue: z.object({
            type: z.literal("unknown"),
            optional: z.literal(true),
        }),
        resultEntity: z.object({
            type: z.literal("Entity"),
            optional: z.literal(true),
        }),
        entities: z.object({
            type: z.literal("Entity[]"),
            optional: z.literal(true),
        }),
    }),
    interactions: z.object({
        mode: z.literal("may-require-interaction"),
        kinds: z.array(
            z.enum(["question", "choice", "form", "action-proposal"]),
        ),
    }),
});

// Text content is not a fallback structured result. In particular, isError does
// not replace the authoritative structured status.
export function readTypeAgentMcpResult(value: JsonValue): {
    envelope: JsonValue;
    data: Record<string, unknown>;
    isError: boolean;
} {
    if (!object(value) || !object(value.structuredContent)) {
        throw new Error("Missing MCP structuredContent.");
    }
    if (value.isError !== undefined && typeof value.isError !== "boolean") {
        throw new Error("Invalid MCP isError.");
    }
    return {
        envelope: value,
        data: value.structuredContent,
        isError: value.isError === true,
    };
}

export function readTypeAgentDiscovery(
    data: Record<string, unknown>,
): ActionSearchResult {
    if (
        data.protocolVersion !== 1 ||
        typeof data.scopeId !== "string" ||
        !data.scopeId ||
        !Array.isArray(data.actions) ||
        data.actions.length > 128
    ) {
        throw new Error("Invalid or oversized discovery.");
    }
    const actions: ActionContract[] = data.actions.map((action) =>
        actionContractSchema.parse(action),
    );
    return { protocolVersion: 1, scopeId: data.scopeId, actions };
}

export function readTypeAgentExecution(
    data: Record<string, unknown>,
): StructuredActionExecutionResult {
    if (
        data.protocolVersion !== 1 ||
        typeof data.scopeId !== "string" ||
        !data.scopeId ||
        typeof data.operationId !== "string" ||
        !data.operationId ||
        !Array.isArray(data.output) ||
        !data.output.every((line) => typeof line === "string") ||
        !Array.isArray(data.results) ||
        !data.results.every(
            (entry) =>
                object(entry) &&
                object(entry.action) &&
                typeof entry.action.schemaName === "string" &&
                typeof entry.action.actionName === "string" &&
                object(entry.result),
        )
    ) {
        throw new Error("Invalid execution envelope.");
    }
    switch (data.status) {
        case "completed":
            break;
        case "requires_interaction":
            if (
                typeof data.interactionId !== "string" ||
                !data.interactionId ||
                typeof data.expiresAt !== "number" ||
                !Number.isFinite(data.expiresAt) ||
                !object(data.prompt)
            ) {
                throw new Error("Invalid interaction.");
            }
            break;
        case "failed":
        case "cancelled":
        case "unavailable":
        case "execution_uncertain":
            if (
                !object(data.error) ||
                typeof data.error.code !== "string" ||
                typeof data.error.message !== "string"
            ) {
                throw new Error("Invalid structured error.");
            }
            break;
        default:
            throw new Error("Unknown structured status.");
    }
    return data as StructuredActionExecutionResult;
}

export function readTypeAgentTransport(
    data: Record<string, unknown>,
    callId: string,
): RecipeCallOutcome | undefined {
    if (data.source !== "copilot-transport") return undefined;
    const parsed = z
        .object({
            status: z.enum(["unavailable", "execution_uncertain"]),
            error: z.object({ code: z.string(), message: z.string() }),
        })
        .parse(data);
    return parsed.status === "unavailable"
        ? {
              status: "unavailable",
              code: parsed.error.code,
              message: parsed.error.message,
          }
        : {
              status: "execution_uncertain",
              operationId: `host-call:${callId}`,
              message:
                  parsed.error.message +
                  " operationId is a local host-call reference, not a resumable backend id.",
          };
}

export function toolBindingsValid(tools: RecipeTypeAgentTools): boolean {
    const providerId = tools.search.providerId;
    return Object.entries(recipeTypeAgentTools).every(([key, operation]) => {
        const capability = tools[key as keyof RecipeTypeAgentTools];
        return (
            capability.transport === "mcp" &&
            capability.operation === operation &&
            capability.providerId === providerId
        );
    });
}

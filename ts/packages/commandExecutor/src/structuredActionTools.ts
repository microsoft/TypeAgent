// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    StructuredActionClientError,
    type StructuredActionClient as SharedStructuredActionClient,
} from "@typeagent/agent-server-client";
import type {
    ActionSearchResult,
    CancelActionRequest,
    ContinueActionRequest,
    ExecuteActionRequest,
    StructuredActionExecutionResult,
} from "@typeagent/dispatcher-types";
import { z } from "zod/v4";

export type StructuredActionClient = Pick<
    SharedStructuredActionClient,
    | "binding"
    | "searchActions"
    | "executeAction"
    | "continueAction"
    | "cancelAction"
    | "close"
>;

type StructuredActionResult =
    | ActionSearchResult
    | StructuredActionExecutionResult;

type StructuredOperation = (
    client: StructuredActionClient,
    signal?: AbortSignal,
) => Promise<StructuredActionResult>;

const identity = {
    schemaName: z.string(),
    actionName: z.string(),
};

const envelope = {
    protocolVersion: z.literal(1),
    scopeId: z.string(),
};

const fieldAnswer = z.discriminatedUnion("kind", [
    z
        .object({
            kind: z.literal("pick"),
            selected: z.number().int(),
            text: z.string().optional(),
        })
        .strict(),
    z
        .object({
            kind: z.literal("multiChoice"),
            selected: z.array(z.number().int()),
            text: z.string().optional(),
        })
        .strict(),
    z.object({ kind: z.literal("yesNo"), value: z.boolean() }).strict(),
]);

const response = z.discriminatedUnion("type", [
    z
        .object({ type: z.literal("confirmation"), approved: z.boolean() })
        .strict(),
    z
        .object({ type: z.literal("question"), selected: z.number().int() })
        .strict(),
    z.object({ type: z.literal("yesNo"), value: z.boolean() }).strict(),
    z
        .object({
            type: z.literal("multiChoice"),
            selected: z.array(z.number().int()),
        })
        .strict(),
    z
        .object({
            type: z.literal("pickRemember"),
            selected: z.number().int(),
            remember: z.boolean(),
        })
        .strict(),
    z
        .object({
            type: z.literal("form"),
            value: z
                .object({
                    answers: z.record(z.string(), fieldAnswer),
                    cancelled: z.boolean().optional(),
                })
                .strict(),
        })
        .strict(),
    z
        .object({
            type: z.literal("proposal"),
            accepted: z.boolean(),
            data: z.unknown().optional(),
        })
        .strict(),
]);

export function structuredToolResult(
    result: StructuredActionResult | Record<string, unknown>,
    isError = hasErrorStatus(result),
): CallToolResult {
    return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { ...result },
        ...(isError ? { isError: true } : {}),
    };
}

function hasErrorStatus(result: Record<string, unknown>): boolean {
    if (!("status" in result)) {
        return false;
    }
    return !["completed", "requires_interaction"].includes(
        String(result.status),
    );
}

export async function invokeStructuredAction(
    client: StructuredActionClient,
    operation: StructuredOperation,
    effect: boolean,
    signal?: AbortSignal,
): Promise<CallToolResult> {
    let submitted = false;
    try {
        if (signal?.aborted) {
            throw new Error("Cancelled before dispatch.");
        }
        const action = operation(client, signal);
        submitted = true;
        const result = await action;
        return structuredToolResult(result);
    } catch (error) {
        // A missing RPC response cannot prove whether an effect happened.
        const dispatched =
            error instanceof StructuredActionClientError
                ? error.dispatched
                : submitted;
        const status =
            effect && dispatched ? "execution_uncertain" : "unavailable";
        return structuredToolResult(
            {
                status,
                error: {
                    code:
                        error instanceof StructuredActionClientError
                            ? error.reason
                            : "transport_error",
                    message:
                        error instanceof StructuredActionClientError
                            ? error.message
                            : status === "execution_uncertain"
                              ? "No authoritative result was received. Effects may have occurred. Do not replay this call."
                              : "No authoritative result was received. Check the TypeAgent connection and binding; no call was retried.",
                },
                source: "command-executor-transport",
                ...(client.binding.conversationId === undefined
                    ? {}
                    : { conversationId: client.binding.conversationId }),
            },
            true,
        );
    }
}

export function registerStructuredActionTools(
    server: McpServer,
    client: StructuredActionClient,
): void {
    server.registerTool(
        "discover_agents",
        {
            inputSchema: z
                .object({
                    query: z.string().trim().min(1),
                })
                .strict(),
            description:
                "Search TypeAgent actions with a required nonempty free-text query and return complete candidate contracts. The service uses semantic ranking when available or literal matching otherwise. Select an exact schemaName/actionName from the results when discovering an action. Discovery does not enable agents or authorize execution.",
        },
        (request, extra) =>
            invokeStructuredAction(
                client,
                (structuredClient, signal) =>
                    structuredClient.searchActions(request, signal),
                false,
                extra.signal,
            ),
    );

    server.registerTool(
        "execute_action",
        {
            inputSchema: z
                .object({
                    ...envelope,
                    ...identity,
                    parameters: z.record(z.string(), z.unknown()).optional(),
                })
                .strict(),
            description:
                "Execute one known action with its exact schemaName/actionName identity, scope, and concrete structured parameters. No natural-language translation, cache training, alias remapping, default bindings, or replay. The current contract is resolved at execution and execution does not depend on search ranking. Copilot selecting an action is not user consent. On requires_interaction show the full prompt and ask the USER, then continue_action with their exact response or cancel_action. Never auto-answer. Do not replay after timeout, disconnect, or execution_uncertain. Returns the complete service status and ActionResult data.",
        },
        (request, extra) =>
            invokeStructuredAction(
                client,
                (structuredClient, signal) =>
                    structuredClient.executeAction(
                        request as ExecuteActionRequest,
                        signal,
                    ),
                true,
                extra.signal,
            ),
    );

    server.registerTool(
        "continue_action",
        {
            inputSchema: z
                .object({
                    ...envelope,
                    operationId: z.string(),
                    interactionId: z.string(),
                    response,
                })
                .strict(),
            description:
                "Submit the actual USER response to the full pending prompt in this binding. Preserve scopeId, operationId, and interactionId exactly. Never invent approval, accept a default, or replay execute_action. A further prompt requires another user response.",
        },
        (request, extra) =>
            invokeStructuredAction(
                client,
                (structuredClient, signal) =>
                    structuredClient.continueAction(
                        request as ContinueActionRequest,
                        signal,
                    ),
                true,
                extra.signal,
            ),
    );

    server.registerTool(
        "cancel_action",
        {
            inputSchema: z
                .object({
                    ...envelope,
                    operationId: z.string(),
                    interactionId: z.string().optional(),
                })
                .strict(),
            description:
                "Cancel a structured operation at the USER's request. Cancellation is not rollback; execution_uncertain means effects may have occurred. Never replay automatically.",
        },
        (request, extra) =>
            invokeStructuredAction(
                client,
                (structuredClient, signal) =>
                    structuredClient.cancelAction(
                        request as CancelActionRequest,
                        signal,
                    ),
                true,
                extra.signal,
            ),
    );
}

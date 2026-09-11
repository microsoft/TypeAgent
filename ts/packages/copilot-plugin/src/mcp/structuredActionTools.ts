// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
    ActionSearchRequest,
    ExecuteActionRequest,
    ContinueActionRequest,
    CancelActionRequest,
} from "@typeagent/dispatcher-types";
import { getMode, type Mode } from "../shared/plugin-config.js";
import {
    StructuredActionClientError,
    type StructuredActionClient,
} from "@typeagent/agent-server-client";

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
            selected: z.number(),
            text: z.string().optional(),
        })
        .strict(),
    z
        .object({
            kind: z.literal("multiChoice"),
            selected: z.array(z.number()),
            text: z.string().optional(),
        })
        .strict(),
    z.object({ kind: z.literal("yesNo"), value: z.boolean() }).strict(),
]);
const response = z.discriminatedUnion("type", [
    z
        .object({ type: z.literal("confirmation"), approved: z.boolean() })
        .strict(),
    z.object({ type: z.literal("question"), selected: z.number() }).strict(),
    z.object({ type: z.literal("yesNo"), value: z.boolean() }).strict(),
    z
        .object({
            type: z.literal("multiChoice"),
            selected: z.array(z.number()),
        })
        .strict(),
    z
        .object({
            type: z.literal("pickRemember"),
            selected: z.number(),
            remember: z.boolean(),
        })
        .strict(),
    z
        .object({
            type: z.literal("form"),
            value: z
                .object({
                    answers: z.record(fieldAnswer),
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

function result(data: Record<string, unknown>): CallToolResult {
    return {
        structuredContent: data,
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        ...(data.status !== undefined &&
        data.status !== "completed" &&
        data.status !== "requires_interaction" &&
        data.status !== "found"
            ? { isError: true }
            : {}),
    };
}

/**
 * A transport-only mapping. Contracts, effects, validation and user interaction
 * state all belong to Dispatcher, not to this tool catalog.
 *
 * These same tools are the structured caller in Direct mode: unlike a one-shot
 * prompt hook, the MCP process can retain the private binding across user turns.
 */
export function registerStructuredActionTools(
    server: McpServer,
    client: StructuredActionClient,
    mode: () => Mode = getMode,
): void {
    // MCP arguments are JSON: optional properties are absent, never undefined.
    // Zod 3 adds undefined to optional inferred types, so the calls below narrow
    // only that type-level difference. Dispatcher validates the actual contract.
    async function invoke(
        operation: (
            client: StructuredActionClient,
        ) => Promise<Record<string, unknown>>,
        effect: boolean,
    ): Promise<CallToolResult> {
        if (mode() !== "direct" && mode() !== "mcp") {
            return {
                ...result({
                    error: "Structured action tools require Direct or MCP mode.",
                }),
                isError: true,
            };
        }
        try {
            const data = await operation(client);
            return result({ ...data, binding: client.binding });
        } catch (error) {
            const submitted =
                error instanceof StructuredActionClientError
                    ? error.dispatched
                    : true;
            // Never infer completion, rollback, or retry safety from a lost RPC
            // reply. Do not echo transport exceptions or connection capabilities.
            return {
                ...result({
                    status:
                        effect && submitted
                            ? "execution_uncertain"
                            : "unavailable",
                    error: {
                        code:
                            error instanceof StructuredActionClientError
                                ? error.reason
                                : "transport_error",
                        message:
                            error instanceof StructuredActionClientError
                                ? error.message
                                : effect && submitted
                                  ? "No authoritative result was received. Effects may have occurred. Do not replay this call. Use a known operation/interaction id to continue or cancel only after checking with the user."
                                  : submitted
                                    ? "No authoritative discovery result was received. Check the connection and request inputs; no call was retried."
                                    : "The structured request was not dispatched. Check the binding, connection, and caller cancellation.",
                    },
                    source: "copilot-transport",
                    ...(client.binding.conversationId === undefined
                        ? {}
                        : { conversationId: client.binding.conversationId }),
                }),
                isError: true,
            };
        }
    }

    server.registerTool(
        "typeagent-searchActions",
        {
            description:
                "Search compact TypeAgent action summaries and availability. Then get the selected action contract. Skip search if the identity is known; no status/schema-list stage is required. Unresolved references belong on the natural-language path.",
            inputSchema: z
                .object({
                    query: z.string().optional(),
                    agentName: z.string().optional(),
                    schemaName: z.string().optional(),
                    offset: z.number().optional(),
                    limit: z.number().optional(),
                })
                .strict(),
        },
        (request, extra) =>
            invoke(
                (dispatcher) =>
                    dispatcher.searchActions(
                        request as ActionSearchRequest,
                        extra.signal,
                    ),
                false,
            ),
    );

    server.registerTool(
        "typeagent-getActionContract",
        {
            description:
                "Get one closed TypeAgent action contract including nested types, effects, availability and interactions. Use exact separate schemaName/actionName. Reuse its fingerprint and scopeId only in the same binding. Refresh contract_stale, but never automatically replay.",
            inputSchema: z.object(identity).strict(),
        },
        (request, extra) =>
            invoke(
                (dispatcher) =>
                    dispatcher.getActionContract(request, extra.signal),
                false,
            ),
    );

    server.registerTool(
        "typeagent-executeAction",
        {
            description:
                "Execute one Copilot-selected typed action through Dispatcher using its exact current fingerprint, scopeId and concrete parameters. No command strings or NL translation. Unknown/state-changing effects require USER confirmation; selection is not consent. Preserve all seven result statuses and true nested results. For requires_interaction show the full prompt/form and ask the USER, then continue or cancel. Never invent/default/autoapprove a response or replay an uncertain call. Recording directives stay on processCommand with exact prefixes.",
            inputSchema: z
                .object({
                    ...identity,
                    ...envelope,
                    fingerprint: z.string(),
                    parameters: z.record(z.unknown()).optional(),
                })
                .strict(),
        },
        (request, extra) =>
            invoke(
                (dispatcher) =>
                    dispatcher.executeAction(
                        request as ExecuteActionRequest,
                        extra.signal,
                    ),
                true,
            ),
    );

    server.registerTool(
        "typeagent-continueAction",
        {
            description:
                "Submit the actual USER response to a pending TypeAgent prompt using its exact operationId, interactionId and scopeId. Show all choices/form fields to the user first. Never choose a default or approve on the user's behalf. A new requires_interaction needs another user response; pending interaction is not completion or a tool error.",
            inputSchema: z
                .object({
                    ...envelope,
                    operationId: z.string(),
                    interactionId: z.string(),
                    response,
                })
                .strict(),
        },
        (request, extra) =>
            invoke(
                (dispatcher) =>
                    dispatcher.continueAction(
                        request as ContinueActionRequest,
                        extra.signal,
                    ),
                true,
            ),
    );

    server.registerTool(
        "typeagent-cancelAction",
        {
            description:
                "Cancel a pending TypeAgent operation at the USER's request with its exact scopeId/operationId and interactionId when supplied. Return the authoritative service status; cancellation or disconnect is not proof effects were rolled back.",
            inputSchema: z
                .object({
                    ...envelope,
                    operationId: z.string(),
                    interactionId: z.string().optional(),
                })
                .strict(),
        },
        (request, extra) =>
            invoke(
                (dispatcher) =>
                    dispatcher.cancelAction(
                        request as CancelActionRequest,
                        extra.signal,
                    ),
                true,
            ),
    );
}

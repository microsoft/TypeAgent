// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import type { RecordTurnRequest, RecordTurnResult } from "./services/index.js";

export const serviceName = "agent-memory-mcp";
export const serviceVersion = "0.0.1";

export type MemoryStatus = {
    service: string;
    version: string;
    schemaVersion: number;
    database: "not-initialized" | "ready";
};

export interface MemoryStatusProvider {
    getSchemaVersion(): number;
}

export interface RecordTurnProvider {
    record(request: RecordTurnRequest): RecordTurnResult;
}

export type MemoryServerServices = {
    status?: MemoryStatusProvider;
    recordTurn?: RecordTurnProvider;
};

export function createMemoryServer(
    services: MemoryServerServices = {},
): McpServer {
    const server = new McpServer({
        name: serviceName,
        version: serviceVersion,
    });

    server.registerTool(
        "memory_status",
        {
            description:
                "Report the agent-memory service and storage schema status.",
            inputSchema: {},
        },
        async () => {
            const status: MemoryStatus = {
                service: serviceName,
                version: serviceVersion,
                schemaVersion: services.status?.getSchemaVersion() ?? 0,
                database:
                    services.status === undefined ? "not-initialized" : "ready",
            };

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(status),
                    },
                ],
                structuredContent: status,
            };
        },
    );

    server.registerTool(
        "memory_record_turn",
        {
            description:
                "Atomically record one completed agent turn and its memory facets.",
            inputSchema: recordTurnInputShape,
        },
        async (input) => {
            if (services.recordTurn === undefined) {
                throw new Error("Turn recording is not initialized");
            }
            const result = services.recordTurn.record(
                input as unknown as RecordTurnRequest,
            );
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(result),
                    },
                ],
                structuredContent: result,
            };
        },
    );

    return server;
}

export async function startMemoryServer(
    services: MemoryServerServices = {},
): Promise<McpServer> {
    const server = createMemoryServer(services);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return server;
}

const scopeShape = {
    scopeId: z.string(),
    userId: z.string(),
    agentId: z.string().optional(),
    workspaceId: z.string().optional(),
    sessionId: z.string().optional(),
};

const provenanceShape = {
    sourceType: z.enum(["user", "agent", "tool", "import", "derived"]),
    actorId: z.string(),
    observedAt: z.string(),
    sourceTurnIds: z.array(z.string()).optional(),
    sourceEntityIds: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
};

const recordTurnInputShape = {
    turnId: z.string(),
    idempotencyKey: z.string(),
    scope: z.object(scopeShape),
    conversationId: z.string(),
    sequence: z.number().int().nonnegative(),
    primaryTopicPath: z.string(),
    secondaryTopicPaths: z.array(z.string()).optional(),
    requestSummary: z.string(),
    outcomeSummary: z.string(),
    occurredAt: z.string(),
    provenance: z.object(provenanceShape),
    terms: z
        .array(
            z.object({
                text: z.string(),
                role: z
                    .enum(["subject", "method", "artifact", "person", "place"])
                    .optional(),
            }),
        )
        .optional(),
    actions: z
        .array(
            z.object({
                actionId: z.string().optional(),
                sequence: z.number().int().nonnegative(),
                name: z.string(),
                summary: z.string(),
                status: z.enum(["completed", "failed", "skipped"]),
                toolName: z.string().optional(),
                affectedGoalIds: z.array(z.string()).optional(),
                affectedArtifactIds: z.array(z.string()).optional(),
                affectedOutputIds: z.array(z.string()).optional(),
                designNoteIds: z.array(z.string()).optional(),
            }),
        )
        .optional(),
    artifactChanges: z
        .array(
            z.object({
                artifactId: z.string(),
                change: z.enum(["created", "updated", "deleted"]),
                summary: z.string(),
                kind: z.string().optional(),
                name: z.string().optional(),
                uri: z.string().optional(),
            }),
        )
        .optional(),
    goals: z
        .array(
            z.object({
                goalId: z.string().optional(),
                topicPath: z.string().optional(),
                desiredState: z.string(),
                state: z.enum(["active", "achieved", "abandoned"]).optional(),
                revision: z.number().int().positive().optional(),
            }),
        )
        .optional(),
    designNotes: z
        .array(
            z.object({
                designNoteId: z.string().optional(),
                topicPath: z.string().optional(),
                title: z.string(),
                body: z.string(),
                addressedGoalIds: z.array(z.string()).optional(),
                state: z.enum(["draft", "accepted", "superseded"]).optional(),
                revision: z.number().int().positive().optional(),
            }),
        )
        .optional(),
    outputs: z
        .array(
            z.object({
                outputId: z.string().optional(),
                topicPath: z.string().optional(),
                artifactId: z.string(),
                state: z.enum(["current", "superseded", "deleted"]).optional(),
                designNotes: z
                    .array(
                        z.object({
                            designNoteId: z.string(),
                            revision: z.number().int().positive().optional(),
                        }),
                    )
                    .optional(),
                revision: z.number().int().positive().optional(),
            }),
        )
        .optional(),
    properties: z
        .array(
            z.object({
                definitionId: z.string().optional(),
                topicPath: z.string().optional(),
                name: z.string().optional(),
                valueType: z
                    .enum(["string", "number", "boolean", "string-list"])
                    .optional(),
                required: z.boolean().optional(),
                allowedValues: z.array(z.string()).optional(),
                value: z.union([
                    z.string(),
                    z.number(),
                    z.boolean(),
                    z.array(z.string()),
                ]),
            }),
        )
        .optional(),
};

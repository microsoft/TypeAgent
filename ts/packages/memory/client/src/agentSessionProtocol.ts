// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import { identifierSchema } from "./protocol.js";

export const AGENT_SESSION_MAX_CHUNK_BYTES = 512 * 1024;
export const AGENT_SESSION_MAX_CHUNK_LINES = 1000;

export const agentSessionToolNames = {
    importAgentSession: "memory_agent_session_import",
    getAgentSessionImport: "memory_agent_session_get",
    cancelAgentSessionImport: "memory_agent_session_cancel",
    searchAgentMemories: "memory_agent_memory_search",
} as const;

const count = z.number().int().nonnegative();
export const agentSessionScopeSchema = z.strictObject({
    repository: z.string().optional(),
    commit: z.string().optional(),
    environment: z.string().optional(),
});
export const agentSessionImportTypeSchema = z.enum([
    "agent-session-jsonl",
    "copilot-session-jsonl",
]);
export const agentSessionReadRequestSchema = z.strictObject({
    corpusId: identifierSchema,
    sessionId: identifierSchema,
});
export const agentSessionImportRequestSchema =
    agentSessionReadRequestSchema.extend({
        ...agentSessionScopeSchema.shape,
        importType: agentSessionImportTypeSchema,
        idempotencyKey: z.string().min(1).max(200),
        expectedCursor: count,
        jsonl: z
            .string()
            .max(AGENT_SESSION_MAX_CHUNK_BYTES)
            .refine(
                (value) =>
                    new TextEncoder().encode(value).byteLength <=
                    AGENT_SESSION_MAX_CHUNK_BYTES,
                "JSONL exceeds the 512 KiB chunk limit",
            )
            .refine((value) => {
                const lines = value.split("\n");
                return (
                    lines.length -
                        (value.endsWith("\n") || value === "" ? 1 : 0) <=
                    AGENT_SESSION_MAX_CHUNK_LINES
                );
            }, "JSONL exceeds the 1000 line chunk limit"),
        final: z.boolean().optional(),
    });
export const agentSessionImportReceiptSchema =
    agentSessionReadRequestSchema.extend({
        schemaVersion: z.literal(1),
        importType: agentSessionImportTypeSchema,
        state: z.enum([
            "running",
            "complete",
            "partial",
            "failed",
            "cancelled",
        ]),
        cursor: count,
        final: z.boolean(),
        sourceCount: count,
        memoryCount: count,
        duplicates: count,
        losses: z.strictObject({ line: count, reason: z.string() }).array(),
        updatedAt: z.string(),
        error: z.string().optional(),
    });
export const agentMemoryEvidenceSchema = z.strictObject({
    eventId: z.string(),
    sourceId: z.string(),
    revisionId: z.string(),
    locator: z.string(),
    excerpt: z.string(),
});
export const agentMemoryArtifactSchema = z.strictObject({
    memoryId: z.string(),
    kind: z.enum(["semantic", "procedure"]),
    title: z.string(),
    body: z.string(),
    state: z.enum(["diagnostic-only", "observed"]),
    scope: agentSessionScopeSchema,
    evidence: agentMemoryEvidenceSchema.array(),
    influenceSourceIds: z.string().array(),
    supersedes: z.string().array(),
    conflicted: z.boolean(),
});
export const agentMemorySearchRequestSchema = agentSessionScopeSchema.extend({
    corpusId: identifierSchema,
    query: z.string().min(1),
    limit: z.number().int().min(1).optional(),
});
export const agentMemorySearchResultSchema = z.strictObject({
    memories: agentMemoryArtifactSchema.array(),
    warnings: z.string().array(),
});

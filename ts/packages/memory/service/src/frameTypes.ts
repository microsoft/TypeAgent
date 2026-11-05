// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { dataFrame as df } from "@typeagent/knowpro";
import type { MemorySource } from "./types.js";
export type FrameSchema = df.FrameSchema;
export interface FrameQueryTranslator {
    identity: string;
    translate(
        schema: df.FrameSchema,
        query: string,
    ): Promise<df.FramePredicate>;
}
export function validateFrameQueryTranslator(
    translator: FrameQueryTranslator | undefined,
): void {
    if (
        translator &&
        (typeof translator.identity !== "string" ||
            !translator.identity.trim() ||
            translator.identity.length > 2000 ||
            typeof translator.translate !== "function")
    )
        throw new Error(
            "Frame translator requires identity and translation function",
        );
}

export interface FrameSourceProvider {
    providerId: string;
    version: string;
    sourceTypes: MemorySource["sourceType"][];
    projections: df.FrameProjectionDescriptor[];
    authorize(source: MemorySource): Promise<boolean>;
}
export interface FrameQueryRequest {
    corpusId: string;
    schemaId: string;
    schemaRevision: number;
    predicate?: df.FramePredicate | undefined;
    query?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
    includeUnconfirmed?: boolean | undefined;
    sourceIds?: string[] | undefined;
    repository?: string | undefined;
    commit?: string | undefined;
    environment?: string | undefined;
}
export interface FrameProjectionStatus {
    version: 1;
    snapshot: string;
    owners: df.FrameProjectionReceipt[];
    coverage: {
        ready: number;
        pending: number;
        failed: number;
        unavailableValues: number;
    };
}
export interface FrameQueryResult extends FrameProjectionStatus {
    schema: df.FrameSchema;
    predicate: df.FramePredicate;
    rows: Array<df.FrameMatch & { sourceIds: string[] }>;
    nextCursor?: string | undefined;
}
export function framePredicateTypeScript(schema: df.FrameSchema): string {
    df.assertFrameSchema(schema);
    const fields = Object.keys(schema.fields)
        .map((id) => JSON.stringify(id))
        .join(" | ");
    return `export type Scalar = string | number | boolean | {kind: "calendar" | "instant"; raw: string};
export type Comparison = {fieldId: ${fields}; op: "eq"|"neq"|"lt"|"lte"|"gt"|"gte"; value: Scalar; unit?: string};
export type FramePredicate = {and: Comparison[]} | {or: Comparison[]};`;
}
export function validateFrameSourceProviders(
    providers: readonly FrameSourceProvider[] = [],
): void {
    if (providers.length > 64)
        throw new Error("Frame provider registration bound exceeded");
    const ids = new Set<string>();
    for (const provider of providers) {
        if (
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(provider.providerId) ||
            ["source", "question", "project"].includes(provider.providerId) ||
            ids.has(provider.providerId) ||
            typeof provider.version !== "string" ||
            !provider.version.trim() ||
            provider.version.length > 200 ||
            typeof provider.authorize !== "function"
        )
            throw new Error("Invalid or duplicate source frame provider");
        ids.add(provider.providerId);
        if (
            !Array.isArray(provider.sourceTypes) ||
            !provider.sourceTypes.length ||
            provider.sourceTypes.some(
                (type) =>
                    !["web", "markdown", "text", "html", "vtt"].includes(type),
            ) ||
            !Array.isArray(provider.projections) ||
            !provider.projections.length ||
            provider.projections.length > 64
        )
            throw new Error("Invalid source frame provider inventory");
        df.assertFrameDescriptorInventory(
            provider.projections,
            provider.providerId,
            "source",
        );
    }
}

export function validateFrameQueryRequest(request: FrameQueryRequest): void {
    if (
        !request ||
        typeof request !== "object" ||
        Object.keys(request).some(
            (key) =>
                ![
                    "corpusId",
                    "schemaId",
                    "schemaRevision",
                    "predicate",
                    "query",
                    "limit",
                    "cursor",
                    "includeUnconfirmed",
                    "sourceIds",
                    "repository",
                    "commit",
                    "environment",
                ].includes(key),
        )
    )
        throw new Error("Invalid frame query");
    for (const id of [request.corpusId, request.schemaId])
        if (
            typeof id !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)
        )
            throw new Error("Invalid frame query identifier");
    if (
        !Number.isSafeInteger(request.schemaRevision) ||
        request.schemaRevision < 1 ||
        (request.limit !== undefined &&
            (!Number.isSafeInteger(request.limit) ||
                request.limit < 1 ||
                request.limit > 1000)) ||
        (request.query !== undefined && request.predicate !== undefined) ||
        (request.includeUnconfirmed !== undefined &&
            typeof request.includeUnconfirmed !== "boolean")
    )
        throw new Error("Invalid frame query");
    validateFrameQueryScope(request);
}
function validateFrameQueryScope(request: FrameQueryRequest): void {
    for (const key of [
        "query",
        "cursor",
        "repository",
        "commit",
        "environment",
    ] as const) {
        const value = request[key];
        const max = key === "query" ? 120000 : key === "cursor" ? 8000 : 2000;
        if (
            value !== undefined &&
            (typeof value !== "string" || !value.trim() || value.length > max)
        )
            throw new Error(`Invalid frame query ${key}`);
    }
    if (
        request.sourceIds !== undefined &&
        (!Array.isArray(request.sourceIds) ||
            request.sourceIds.length > 4096 ||
            request.sourceIds.some(
                (id) =>
                    typeof id !== "string" ||
                    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id),
            ))
    )
        throw new Error("Invalid frame source scope");
}
export interface MemoryFrameService {
    listFrameSchemas(corpusId: string): Promise<df.FrameSchema[]>;
    queryFrame(request: FrameQueryRequest): Promise<FrameQueryResult>;
    getFrameProjectionStatus(corpusId: string): Promise<FrameProjectionStatus>;
}

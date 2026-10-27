// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ChatModel, TextEmbeddingModel } from "@typeagent/aiclient";

/** Counts, flags, opaque IDs and fixed access/index enums only; never search or source text. */
export type SearchTimingAttributes = Readonly<
    Record<string, string | number | boolean | undefined>
>;

type SearchTimingContext = {
    traceId: string;
    scope: string;
    attributes: SearchTimingAttributes | undefined;
};

const searchTiming = new AsyncLocalStorage<SearchTimingContext>();

const curationTimingEnums: Readonly<Record<string, readonly string[]>> = {
    callKind: ["normal", "contract-repair", "omission-repair"],
    tokenizer: ["o200k_base"],
    constraintAccounting: ["utf8-byte-upper-bound"],
    providerAttemptBreakdown: ["unavailable"],
    reason: ["packet-or-expansion-changed"],
};

function curationTimingAttribute(key: string, value: string): boolean {
    if (["requestHash", "fingerprint"].includes(key))
        return /^[0-9a-f]{64}$/.test(value);
    return curationTimingEnums[key]?.includes(value) ?? false;
}

export function isSearchTimingEnabled(): boolean {
    return process.env.TYPEAGENT_MEMORY_SEARCH_TRACE === "1";
}

export function currentSearchTraceId(): string | undefined {
    return isSearchTimingEnabled()
        ? searchTiming.getStore()?.traceId
        : undefined;
}

export function runWithSearchTiming<T>(
    traceId: string | undefined,
    scope: string,
    work: () => T,
    attributes?: SearchTimingAttributes,
): T {
    if (!isSearchTimingEnabled()) return work();
    return searchTiming.run(
        {
            traceId:
                traceId ?? searchTiming.getStore()?.traceId ?? randomUUID(),
            scope,
            attributes: {
                batchId: searchTiming.getStore()?.attributes?.batchId,
                ...attributes,
            },
        },
        work,
    );
}

function emitTiming(
    context: SearchTimingContext,
    stage: string,
    elapsedMs: number,
    status: "success" | "error",
    attributes?: SearchTimingAttributes,
): void {
    const metadata = Object.fromEntries(
        Object.entries({ ...context.attributes, ...attributes }).filter(
            ([key, value]) =>
                typeof value === "boolean" ||
                (typeof value === "number" && Number.isFinite(value)) ||
                (typeof value === "string" &&
                    ([
                        "corpusId",
                        "sourceId",
                        "revisionId",
                        "groupId",
                        "batchId",
                        "indexGeneration",
                    ].includes(key) ||
                        (key === "access" &&
                            ["read", "write"].includes(value)) ||
                        (key === "indexKind" &&
                            [
                                "document",
                                "documents",
                                "procedure",
                                "procedures",
                            ].includes(value)) ||
                        curationTimingAttribute(key, value))),
        ),
    );
    try {
        console.warn(
            `[memory-search-timing] ${JSON.stringify({
                timestamp: new Date().toISOString(),
                traceId: context.traceId,
                scope: context.scope,
                stage,
                elapsedMs,
                endEpochMs: Date.now(),
                status,
                metadata,
            })}`,
        );
    } catch {
        // A diagnostic sink must never change search results or failures.
    }
}

/** Model method attempts, not hidden HTTP/SDK retries. Arguments are never recorded. */
export function instrumentExtractionModel(model: ChatModel): ChatModel {
    return new Proxy(model, {
        get(target, property) {
            if (property === "complete") {
                return (...args: Parameters<ChatModel["complete"]>) =>
                    timeSearchStage(
                        "ingestion.extraction.attempt",
                        () => target.complete(...args),
                        { attempts: 1 },
                    );
            }
            return Reflect.get(target, property, target);
        },
    });
}

/** Apply after role selection, so provider role/identity/batch limits are unchanged. */
export function instrumentEmbeddingModel(
    model: TextEmbeddingModel,
): TextEmbeddingModel {
    return new Proxy(model, {
        get(target, property) {
            if (property === "generateEmbedding") {
                return (input: string) =>
                    timeSearchStage(
                        "ingestion.embedding.attempt",
                        () => target.generateEmbedding(input),
                        { attempts: 1, items: 1 },
                    );
            }
            if (
                property === "generateEmbeddingBatch" &&
                target.generateEmbeddingBatch
            ) {
                return (inputs: string[]) =>
                    timeSearchStage(
                        "ingestion.embedding.attempt",
                        () => target.generateEmbeddingBatch!(inputs),
                        { attempts: 1, items: inputs.length },
                    );
            }
            return Reflect.get(target, property, target);
        },
    });
}
function resultStatus(value: unknown): "success" | "error" {
    return value !== null &&
        typeof value === "object" &&
        "success" in value &&
        value.success === false
        ? "error"
        : "success";
}

export function recordSearchTiming(
    stage: string,
    elapsedMs: number,
    attributes?: SearchTimingAttributes,
    status: "success" | "error" = "success",
): void {
    if (!isSearchTimingEnabled()) return;
    const context = searchTiming.getStore();
    if (context) emitTiming(context, stage, elapsedMs, status, attributes);
}

/** Preserves both synchronous return values and asynchronous rejection reasons. */
export function timeSearchStage<T>(
    stage: string,
    work: () => T,
    attributes?: SearchTimingAttributes,
): T {
    if (!isSearchTimingEnabled()) return work();
    const context = searchTiming.getStore();
    if (!context) return work();
    const startedAt = performance.now();
    const finish = (status: "success" | "error") =>
        emitTiming(
            context,
            stage,
            performance.now() - startedAt,
            status,
            attributes,
        );
    try {
        const result = work();
        if (
            result !== null &&
            typeof result === "object" &&
            "then" in result &&
            typeof result.then === "function"
        ) {
            return Promise.resolve(result).then(
                (value) => {
                    finish(resultStatus(value));
                    return value;
                },
                (error: unknown) => {
                    finish("error");
                    throw error;
                },
            ) as T;
        }
        finish(resultStatus(result));
        return result;
    } catch (error) {
        finish("error");
        throw error;
    }
}

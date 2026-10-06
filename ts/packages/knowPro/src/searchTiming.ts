// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

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
            attributes,
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
                    (["corpusId", "sourceId", "revisionId"].includes(key) ||
                        (key === "access" &&
                            ["read", "write"].includes(value)) ||
                        (key === "indexKind" &&
                            [
                                "document",
                                "documents",
                                "procedure",
                                "procedures",
                            ].includes(value)))),
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
                status,
                metadata,
            })}`,
        );
    } catch {
        // A diagnostic sink must never change search results or failures.
    }
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
): void {
    if (!isSearchTimingEnabled()) return;
    const context = searchTiming.getStore();
    if (context) emitTiming(context, stage, elapsedMs, "success", attributes);
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

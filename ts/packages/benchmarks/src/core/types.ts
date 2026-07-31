// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Single translated / expected action. */
export interface Action {
    schemaName: string;
    actionName: string;
    parameters: unknown;
}

/** How multi-action expectations are ordered. */
export type Order = "strict" | "any";

/** One eval row (dataset case). */
export interface EvalCase {
    id: string;
    utterance: string;
    expectedActions: Action[];
    order: Order;
    /** Optional prior turns; shape filled in when the runner lands. */
    history?: unknown;
}

/** Token cost rates (USD per 1M tokens). */
export interface Prices {
    inUsdPer1M: number;
    cachedUsdPer1M: number;
    outUsdPer1M: number;
}

/** Accumulated usage for one request or run. */
export interface CostRecord {
    prompt: number;
    completion: number;
    cached: number | undefined;
    reasoning: number | undefined;
    model: string;
    usageCalls: number;
    estimatedCostUsd: number | undefined;
}

/** One action in the pinned catalog. */
export interface CatalogEntry {
    schemaName: string;
    actionName: string;
    parameters: string;
    paramSpec?: unknown;
    description?: string;
}

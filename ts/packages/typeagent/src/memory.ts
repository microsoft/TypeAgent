// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Name value pair
 * @template T type of value. Default is string
 * @template N type of name. Default is string
 */
export type NameValue<T = string, N = string> = {
    name: N;
    value: T;
};

/**
 * An item and its associated score. Used for search functions
 */
export type ScoredItem<T = number> = {
    item: T;
    score: number;
};

/**
 * Typical search options
 */
export interface SearchOptions {
    maxMatches: number;
    minScore?: number | undefined;
}

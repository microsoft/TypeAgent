// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Base restaurant interface with flexible key structure
 */
export interface BaseRestaurant {
    [key: string]: any;
}

/**
 * Restaurant interface for the dedupe command
 */
export interface DedupeRestaurant extends BaseRestaurant {
    url: string;
}

/**
 * Restaurant interface for filter command
 */
export interface FilterRestaurant extends BaseRestaurant {
    "@id"?: string;
    "@source"?: string;
    name?: string;
    source?: string;
    sameAs?: string | string[];
    item?: Partial<FilterRestaurant> | undefined;
}

/**
 * Restaurant interface for parse command
 */
export interface Triple {
    subject: string;
    predicate: string;
    object: string;
    graph?: string;
    isObjectBlankNode?: boolean;
}

/**
 * Options for file operations
 */
export interface FileOptions {
    encoding?: string;
    flag?: string;
}

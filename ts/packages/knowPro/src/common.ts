// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Common types and methods INTERNAL to the library.
 * Should not be exposed via index.ts
 */
export interface Scored<T = any> {
    item: T;
    score: number;
}

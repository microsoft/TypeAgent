// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Canonical utterance key: NFKC-fold, collapse whitespace, lowercase. */
export function normalizeUtterance(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

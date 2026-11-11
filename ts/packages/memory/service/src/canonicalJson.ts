// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type KeyOrder = (left: string, right: string) => number;

export function codePointOrder(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

// A fixed "en" collator instead of the process default locale, so canonical
// text and the hashes stored from it do not depend on the host's LANG.
// Existing stored hashes were produced with en-locale localeCompare, which this
// matches. Code-point order breaks ties between keys that collate as equal
// (for example, the same text in different Unicode normalization forms).
const enCollator = new Intl.Collator("en");

export function collatedOrder(left: string, right: string): number {
    return enCollator.compare(left, right) || codePointOrder(left, right);
}

export interface CanonicalJsonOptions {
    keyOrder?: KeyOrder;
    // Rewrites each key after sorting by the original key.
    mapKey?: (key: string) => string;
    // "overwrite" reproduces Object.fromEntries: a later key that maps to the
    // same text replaces the earlier value. Only for recomputing old digests.
    keyCollision?: "suffix" | "overwrite";
}

/**
 * Distinct keys can map to the same text (two redacted secrets). Suffix the
 * later one instead of silently dropping its value.
 */
export function uniqueKey(used: Set<string>, key: string): string {
    let unique = key;
    for (let n = 2; used.has(unique); n++) unique = `${key} (${n})`;
    used.add(unique);
    return unique;
}

/** Recursively sorts object keys so equal values serialize identically. */
export function canonicalJsonValue(
    value: unknown,
    options: CanonicalJsonOptions = {},
): unknown {
    if (Array.isArray(value))
        return value.map((item) => canonicalJsonValue(item, options));
    if (value === null || typeof value !== "object") return value;
    const { keyOrder = collatedOrder, mapKey, keyCollision } = options;
    const used = new Set<string>();
    const entries = Object.entries(value)
        .sort(([left], [right]) => keyOrder(left, right))
        .map(([key, child]): [string, unknown] => {
            const mapped = mapKey ? mapKey(key) : key;
            return [
                keyCollision === "overwrite" ? mapped : uniqueKey(used, mapped),
                canonicalJsonValue(child, options),
            ];
        });
    return Object.fromEntries(entries);
}

export function canonicalJson(
    value: unknown,
    options?: CanonicalJsonOptions,
): string {
    return JSON.stringify(canonicalJsonValue(value, options));
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** @param {string | Uint8Array} value */
export const sha256 = (value) =>
    createHash("sha256").update(value).digest("hex");

/** @param {unknown} value */
export const identity = (value) => sha256(JSON.stringify(value));

/** @template T @param {T} value @returns {T} */
export const clone = (value) => structuredClone(value);

export const check = (condition, message) => assert.ok(condition, message);

export function text(value, name) {
    check(
        typeof value === "string" && value.trim().length > 0,
        `${name}: required text`,
    );
    return value;
}

export function hash(value, name) {
    check(
        typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
        `${name}: SHA-256 required`,
    );
    return value;
}

/** @template T @param {T[]} rows @param {keyof T} key @param {string} name @returns {Map<string, T>} */
export function unique(rows, key, name) {
    check(Array.isArray(rows), `${name}: array required`);
    const result = new Map();
    for (const row of rows) {
        const id = text(row[key], `${name}.${key}`);
        check(!result.has(id), `${name}: duplicate ${id}`);
        result.set(id, row);
    }
    return result;
}

export const ratio = (numerator, denominator) => ({
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
});

export function officialTime(value) {
    text(value, "official date");
    const normalized = value
        .replace(/\s*\([A-Za-z]{3}\)/, "")
        .replaceAll("/", "-")
        .replace(" ", "T");
    const date = Date.parse(
        /[Zz]$|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`,
    );
    check(Number.isFinite(date), "Invalid official timestamp");
    return date;
}

/** @template T @param {T[]} rows @param {string} seed @param {keyof T} idKey */
export function ranked(rows, seed, idKey) {
    return [...rows].sort((a, b) =>
        identity([seed, a[idKey]]).localeCompare(identity([seed, b[idKey]])),
    );
}

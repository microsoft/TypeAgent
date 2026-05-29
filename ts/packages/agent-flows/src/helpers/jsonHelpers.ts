// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// JSON-array parse helpers for fields that may arrive as either an array or
// a JSON-encoded string (a common pattern when the LLM translator stringifies
// nested structures so they fit a flat parameter slot).
//
// Two flavors:
//   - tryParseJsonArray  — STRICT. Distinguishes "missing" (ok+undefined)
//                          from "malformed" (ok=false + diagnostic). Use for
//                          load-bearing fields where silent failure produces
//                          a flow that succeeds at create but crashes at
//                          runtime.
//   - parseOptionalJsonArray — PERMISSIVE. Returns parsed array or undefined;
//                              malformed input is silently dropped. Use for
//                              cosmetic fields (tags, etc.) where silent
//                              drop is OK.

// Permissive parse: array → as-is, JSON string → parsed, else → undefined.
export function parseOptionalJsonArray<T = unknown>(
    raw: unknown,
): T[] | undefined {
    if (raw === undefined) return undefined;
    if (Array.isArray(raw)) return raw as T[];
    if (typeof raw !== "string") return undefined;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as T[]) : undefined;
    } catch {
        return undefined;
    }
}

export type ParseResult<T> =
    | { ok: true; value: T[] | undefined }
    | { ok: false; error: string };

// Strict parse: distinguishes "missing" (ok+undefined) from "malformed"
// (ok=false with diagnostic). `fieldName` is embedded in error messages.
export function tryParseJsonArray<T = unknown>(
    raw: unknown,
    fieldName: string,
): ParseResult<T> {
    if (raw === undefined) return { ok: true, value: undefined };
    if (Array.isArray(raw)) return { ok: true, value: raw as T[] };
    if (typeof raw !== "string") {
        return {
            ok: false,
            error: `${fieldName} must be an array or JSON-encoded string, got ${typeof raw}`,
        };
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return {
                ok: false,
                error: `${fieldName} must be a JSON array (got ${parsed === null ? "null" : typeof parsed})`,
            };
        }
        return { ok: true, value: parsed as T[] };
    } catch (e) {
        return {
            ok: false,
            error: `${fieldName}: invalid JSON — ${(e as Error).message}`,
        };
    }
}

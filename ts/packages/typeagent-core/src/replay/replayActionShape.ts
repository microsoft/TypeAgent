// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared action-shape normalization for the replay resolvers.
 *
 * Both the grammar resolver (L1) and the construction-cache layer (L2) pull a
 * raw action object out of a matcher result (`{ schemaName?, actionName,
 * parameters? }`) and must canonicalize it the same way before the engine's
 * strict structural `actionsEqual` compares the two sides:
 *  - re-stamp `schemaName` so the action mirrors the configured target schema
 *    regardless of what the matcher stamped;
 *  - drop an empty `parameters` object: matchers may emit `{}` while others omit
 *    the field, and `actionsEqual` is strict on key counts, so `{}` must be
 *    treated as omitted.
 *
 * Returns `undefined` when the value is not an action object (the caller treats
 * that as a miss).
 */
export function normalizeAction(
    schemaName: string,
    raw: unknown,
): Record<string, unknown> | undefined {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.actionName !== "string") {
        return undefined;
    }
    const action: Record<string, unknown> = {
        schemaName,
        actionName: r.actionName,
    };
    const params = r.parameters;
    if (
        params !== undefined &&
        params !== null &&
        typeof params === "object" &&
        !Array.isArray(params) &&
        Object.keys(params as Record<string, unknown>).length > 0
    ) {
        action.parameters = params;
    }
    return action;
}

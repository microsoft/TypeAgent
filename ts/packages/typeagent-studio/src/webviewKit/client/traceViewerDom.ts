// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Trace Viewer DOM helpers. The shared element/clear primitives now live in
 * {@link ./domHelpers.js}; this module re-exports them so the existing Trace
 * Viewer render modules keep importing from one place, and adds the
 * trace-specific {@link capitalize} helper.
 */

export { el, clear } from "./domHelpers.js";

/** Upper-case the first character, leaving the rest as-is (empty stays empty). */
export function capitalize(value: string): string {
    return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

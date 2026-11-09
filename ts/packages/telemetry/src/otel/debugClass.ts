// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { LocalTelemetryProfile } from "./localTelemetryState.js";

/**
 * Classification attached to a bridged `debug` log record. It controls which
 * @log profile surfaces the record locally; it never affects stderr output or
 * the producer-side @trace/DEBUG namespace enablement.
 *
 * The class is encoded as the trailing `:`-delimited segment of the debug
 * namespace (`...:error`, `...:warn`, `...:info`). A namespace without a
 * recognized class suffix - or one ending in `:verbose` - is `verbose`: the
 * most detailed class, surfaced only by the `verbose` profile.
 */
export type DebugLogClass = "error" | "warn" | "info" | "verbose";

/** OTel log attribute that carries the resolved {@link DebugLogClass}. */
export const DEBUG_CLASS_ATTRIBUTE = "debug.class";

/** OTel log attribute that carries the originating debug namespace. */
export const DEBUG_NAMESPACE_ATTRIBUTE = "debug.namespace";

const DEBUG_LOG_CLASSES: readonly DebugLogClass[] = [
    "error",
    "warn",
    "info",
    "verbose",
];

function isDebugLogClass(value: unknown): value is DebugLogClass {
    return (
        typeof value === "string" &&
        (DEBUG_LOG_CLASSES as readonly string[]).includes(value)
    );
}

/**
 * Resolve the {@link DebugLogClass} for a debug namespace from its trailing
 * `:`-delimited segment. Unrecognized or missing suffixes default to
 * `verbose`, so any pre-existing (unclassified) debug namespace is treated as
 * the most detailed class.
 */
export function classifyDebugNamespace(namespace: string): DebugLogClass {
    const lastColon = namespace.lastIndexOf(":");
    if (lastColon >= 0) {
        const suffix = namespace.slice(lastColon + 1);
        if (isDebugLogClass(suffix)) {
            return suffix;
        }
    }
    return "verbose";
}

/**
 * Resolve the {@link DebugLogClass} recorded on a bridged debug log record.
 * Prefers the explicit {@link DEBUG_CLASS_ATTRIBUTE}; falls back to the
 * namespace suffix, then to `verbose`.
 */
export function readDebugClass(
    attributes: Readonly<Record<string, unknown>> | undefined,
): DebugLogClass {
    const explicit = attributes?.[DEBUG_CLASS_ATTRIBUTE];
    if (isDebugLogClass(explicit)) {
        return explicit;
    }
    const namespace = attributes?.[DEBUG_NAMESPACE_ATTRIBUTE];
    if (typeof namespace === "string") {
        return classifyDebugNamespace(namespace);
    }
    return "verbose";
}

/**
 * Debug classes each profile surfaces locally. Structured (non-`debug`) events
 * are always emitted and are not governed by this function.
 * - `off`: local sink disabled (rejected before this is consulted).
 * - `focused`: no debug logs - structured events only.
 * - `diagnostic`: `error`, `warn`, `info`.
 * - `verbose`: every class.
 */
export function debugClassAllowedByProfile(
    profile: LocalTelemetryProfile,
    cls: DebugLogClass,
): boolean {
    switch (profile) {
        case "verbose":
            return true;
        case "diagnostic":
            return cls === "error" || cls === "warn" || cls === "info";
        case "focused":
        case "off":
        default:
            return false;
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Local telemetry state — the sink-side control surface for the OpenTelemetry
 * pipeline that is embedded in a TypeAgent host process.
 *
 * Producers vs sinks
 * ------------------
 * The `@trace` command is the ONLY control for debug producers (Node `debug`
 * namespace patterns, stderr output, `process.env.DEBUG`, and cross-process
 * agent propagation). The `@log` command controls ONLY local OTel capture and
 * sinks (this file), never `@trace`.
 *
 * Profiles
 * --------
 * The `focused` (default), `diagnostic`, and `verbose` profiles all enable the
 * local OTel logger export; they are placeholders for future span policy and do
 * NOT differ in Phase 1 behavior beyond that. The `off` profile disables the
 * local OTel logger sink (and, when easily gated, the JSONL log exporter).
 * Profiles never modify DEBUG or `@trace` patterns.
 *
 * Debug copy
 * ----------
 * `debug-copy on|off` is orthogonal to profile. When on, debug messages that
 * are ALREADY enabled by DEBUG/@trace are copied into OTel logs. It never
 * enables namespaces on its own. Default is OFF.
 */

export type LocalTelemetryProfile =
    | "focused"
    | "diagnostic"
    | "verbose"
    | "off";

export const LOCAL_TELEMETRY_PROFILES: readonly LocalTelemetryProfile[] = [
    "focused",
    "diagnostic",
    "verbose",
    "off",
] as const;

/**
 * Trace preset expansions. Each preset maps to a set of Node `debug` namespace
 * patterns. Values are best-effort matches against namespaces that exist today
 * in the codebase (see the various `registerDebug("typeagent:...")` call sites)
 * and may be expanded in future revisions.
 */
export const TRACE_PRESETS: Readonly<Record<string, readonly string[]>> =
    Object.freeze({
        request: Object.freeze([
            "typeagent:request*",
            "typeagent:requestQueue*",
            "typeagent:dispatcher:command*",
            "typeagent:command:*",
        ]) as readonly string[],
        translation: Object.freeze([
            "typeagent:translate*",
            "typeagent:dispatcher:schema*",
            "typeagent:const*",
            "typeagent:interpret",
        ]) as readonly string[],
        reasoning: Object.freeze([
            "typeagent:dispatcher:reasoning*",
            "typeagent:reasoning:*",
        ]) as readonly string[],
        actions: Object.freeze([
            "typeagent:dispatcher:action*",
            "typeagent:action:*",
            "typeagent:agent:*",
        ]) as readonly string[],
        rpc: Object.freeze([
            "typeagent:rpc:*",
            "typeagent:*:rpc:*",
            "typeagent:transport:*",
            "typeagent:websockets",
        ]) as readonly string[],
        cache: Object.freeze([
            "typeagent:dispatcher:schema:cache*",
            "typeagent:cache*",
        ]) as readonly string[],
        agents: Object.freeze([
            "typeagent:dispatcher:agents*",
            "typeagent:agent:*",
        ]) as readonly string[],
        startup: Object.freeze([
            "typeagent:dispatcher:init*",
            "typeagent:telemetry:*",
            "typeagent:session*",
            "agent-server:startup",
        ]) as readonly string[],
    }) as Readonly<Record<string, readonly string[]>>;

export type TracePresetName = keyof typeof TRACE_PRESETS;

/**
 * Expand a list of preset names into their concatenated debug namespace
 * patterns. Duplicate names and duplicate patterns are removed while preserving
 * first-seen order. Unknown names are reported separately so callers can
 * refuse the request without partially updating any state.
 */
export function expandTracePresets(names: readonly string[]): {
    patterns: string[];
    unknown: string[];
} {
    const patterns: string[] = [];
    const unknown: string[] = [];
    const seenNames = new Set<string>();
    const seenPatterns = new Set<string>();
    for (const raw of names) {
        for (const part of raw.split(",")) {
            const name = part.trim();
            if (name.length === 0 || seenNames.has(name)) {
                continue;
            }
            seenNames.add(name);
            const expansion = (
                TRACE_PRESETS as Record<string, readonly string[]>
            )[name];
            if (expansion === undefined) {
                unknown.push(name);
                continue;
            }
            for (const pattern of expansion) {
                if (!seenPatterns.has(pattern)) {
                    seenPatterns.add(pattern);
                    patterns.push(pattern);
                }
            }
        }
    }
    return { patterns, unknown };
}

export interface LocalTelemetrySnapshot {
    readonly profile: LocalTelemetryProfile;
    readonly debugCopy: boolean;
    readonly debugBridgeAvailable: boolean;
    readonly localLogAvailable: boolean;
    readonly revision: number;
}

export interface LocalTelemetryState {
    getSnapshot(): LocalTelemetrySnapshot;
    setProfile(profile: LocalTelemetryProfile): LocalTelemetrySnapshot;
    setDebugCopy(on: boolean): LocalTelemetrySnapshot;
    /** Reset to `focused` profile and `debugCopy` off in a single atomic update. */
    clear(): LocalTelemetrySnapshot;
}

export interface CreateLocalTelemetryStateOptions {
    readonly initialProfile?: LocalTelemetryProfile;
    readonly initialDebugCopy?: boolean;
    readonly debugBridgeAvailable?: boolean;
    readonly localLogAvailable?: boolean;
    /**
     * Invoked synchronously after each state change, outside the snapshot swap,
     * with the new immutable snapshot. Exceptions from `onChange` are caught
     * and reported to `process.emitWarning` so the state stays consistent.
     */
    readonly onChange?: (snapshot: LocalTelemetrySnapshot) => void;
}

function freezeSnapshot(
    profile: LocalTelemetryProfile,
    debugCopy: boolean,
    debugBridgeAvailable: boolean,
    localLogAvailable: boolean,
    revision: number,
): LocalTelemetrySnapshot {
    return Object.freeze({
        profile,
        debugCopy,
        debugBridgeAvailable,
        localLogAvailable,
        revision,
    });
}

function reportOnChangeError(error: unknown): void {
    try {
        const message =
            error instanceof Error
                ? `LocalTelemetryState onChange threw: ${error.message}`
                : `LocalTelemetryState onChange threw: ${String(error)}`;
        // process.emitWarning is best-effort; failure to emit is not fatal.
        process.emitWarning(message);
    } catch {
        // Swallow — never let a listener defect propagate through state calls.
    }
}

export function createLocalTelemetryState(
    options: CreateLocalTelemetryStateOptions = {},
): LocalTelemetryState {
    let snapshot = freezeSnapshot(
        options.initialProfile ?? "focused",
        options.initialDebugCopy ?? false,
        options.debugBridgeAvailable ?? false,
        options.localLogAvailable ?? false,
        0,
    );
    const onChange = options.onChange;

    function commit(next: LocalTelemetrySnapshot): LocalTelemetrySnapshot {
        snapshot = next;
        if (onChange !== undefined) {
            try {
                onChange(next);
            } catch (error) {
                reportOnChangeError(error);
            }
        }
        return next;
    }

    return {
        getSnapshot(): LocalTelemetrySnapshot {
            return snapshot;
        },
        setProfile(profile: LocalTelemetryProfile): LocalTelemetrySnapshot {
            if (!LOCAL_TELEMETRY_PROFILES.includes(profile)) {
                throw new Error(
                    `Unknown local telemetry profile: ${String(profile)}`,
                );
            }
            if (profile === snapshot.profile) {
                return snapshot;
            }
            return commit(
                freezeSnapshot(
                    profile,
                    snapshot.debugCopy,
                    snapshot.debugBridgeAvailable,
                    snapshot.localLogAvailable,
                    snapshot.revision + 1,
                ),
            );
        },
        setDebugCopy(on: boolean): LocalTelemetrySnapshot {
            const next = on === true;
            if (next === snapshot.debugCopy) {
                return snapshot;
            }
            return commit(
                freezeSnapshot(
                    snapshot.profile,
                    next,
                    snapshot.debugBridgeAvailable,
                    snapshot.localLogAvailable,
                    snapshot.revision + 1,
                ),
            );
        },
        clear(): LocalTelemetrySnapshot {
            if (
                snapshot.profile === "focused" &&
                snapshot.debugCopy === false
            ) {
                return snapshot;
            }
            return commit(
                freezeSnapshot(
                    "focused",
                    false,
                    snapshot.debugBridgeAvailable,
                    snapshot.localLogAvailable,
                    snapshot.revision + 1,
                ),
            );
        },
    };
}

// ---------------------------------------------------------------------------
// Process-shared default instance
// ---------------------------------------------------------------------------

let processState: LocalTelemetryState | undefined;

/**
 * Return the process-shared `LocalTelemetryState`. Hosts install a real
 * instance during telemetry bootstrap; libraries that read state before a host
 * has installed one see a permissive no-op default (focused profile, debug-copy
 * off) that never notifies listeners.
 */
export function getLocalTelemetryState(): LocalTelemetryState {
    if (processState === undefined) {
        processState = createLocalTelemetryState();
    }
    return processState;
}

/**
 * Replace the process-shared instance. Hosts call this after successful
 * `initTelemetry` so subsequent library reads observe the host's configured
 * defaults and listener wiring. Passing `undefined` restores the lazy default.
 */
export function setLocalTelemetryState(
    state: LocalTelemetryState | undefined,
): void {
    processState = state;
}

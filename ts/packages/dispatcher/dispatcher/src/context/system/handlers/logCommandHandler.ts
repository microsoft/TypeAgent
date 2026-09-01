// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * `@log` — sink-side control surface for local OpenTelemetry capture.
 *
 * This handler is the ONLY place where users configure local OTel sinks: the
 * active profile (`focused`/`diagnostic`/`verbose`/`off`). The profile decides
 * which classes of bridged `debug` log reach the local JSONL sink; structured
 * events are always captured (except the `off` profile, which disables the sink
 * entirely). It never touches `@trace`, DEBUG, or namespace enablement.
 *
 * Phase 2 note: the grammar `@log next-request` is reserved for a future
 * per-request capture feature and is intentionally NOT implemented here.
 */

import registerDebug from "debug";
import open from "open";

import type {
    ActionContext,
    CompletionGroups,
    ParsedCommandParams,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import type {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayError,
    displayResult,
    displaySuccess,
} from "@typeagent/agent-sdk/helpers/display";
import { otel } from "@typeagent/telemetry";
import { metrics as otelMetrics, trace as otelTrace } from "@opentelemetry/api";
import type { CommandHandlerContext } from "../../commandHandlerContext.js";

const KNOWN_PROFILES = otel.LOCAL_TELEMETRY_PROFILES;

class LogStatusCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Show local OTel sink profile and current @trace patterns";
    public async run(context: ActionContext<unknown>) {
        showLogStatus(context);
    }
}

export function showLogStatus(context: ActionContext<unknown>): void {
    const snapshot = otel.getLocalTelemetryState().getSnapshot();

    // Read current @trace namespaces without changing them: `disable()`
    // returns the settings string and clears them, so we re-enable
    // immediately with the same value.
    const currentTrace = registerDebug.disable();
    registerDebug.enable(currentTrace);
    const envDebug = process.env.DEBUG ?? "";
    const provenance =
        currentTrace.length > 0 && currentTrace === envDebug
            ? "env DEBUG"
            : currentTrace.length > 0
              ? "runtime"
              : "none";

    let logFilePath: string | undefined;
    try {
        logFilePath = otel.resolveTelemetryConfig().logs?.logFile;
    } catch {
        logFilePath = undefined;
    }

    const providers = {
        trace: describeProvider(otelTrace.getTracerProvider()),
        metrics: describeProvider(otelMetrics.getMeterProvider()),
    };

    const lines: string[] = [];
    lines.push(`Local OTel profile: ${snapshot.profile}`);
    lines.push(
        `debug bridge:       ${snapshot.debugBridgeAvailable ? "available" : "not configured"}`,
    );
    lines.push(
        `local JSONL:        ${snapshot.localLogAvailable ? "configured" : "not configured"}`,
    );
    lines.push(`process scope:      pid ${process.pid}`);
    lines.push(`state revision:     ${snapshot.revision}`);
    const profileBehavior: Record<otel.LocalTelemetryProfile, string> = {
        focused: "structured events only (no debug logs)",
        diagnostic: "structured events + error/warn/info debug logs",
        verbose: "structured events + all debug logs",
        off: "local OTel sink disabled",
    };
    lines.push(`profile behavior:   ${profileBehavior[snapshot.profile]}`);
    lines.push("");
    lines.push(`@trace patterns (${provenance}):`);
    lines.push(`  ${currentTrace.length === 0 ? "(none)" : currentTrace}`);
    lines.push("");
    lines.push("Trace preset registry:");
    for (const name of Object.keys(otel.TRACE_PRESETS).sort()) {
        const patterns = otel.TRACE_PRESETS[name];
        lines.push(`  ${name}: ${patterns.join(", ")}`);
    }
    lines.push("");
    lines.push("Provider availability:");
    lines.push(`  traces:  ${providers.trace}`);
    lines.push(`  metrics: ${providers.metrics}`);
    if (logFilePath !== undefined) {
        lines.push("");
        lines.push(`Local JSONL log file: ${logFilePath}`);
    }

    displayResult(lines.join("\n"), context);
}

class LogProfileCommandHandler implements CommandHandler {
    public readonly description =
        "Set the local OTel profile: focused (default), diagnostic, verbose, or off";
    public readonly parameters = {
        args: {
            profile: {
                description:
                    "focused | diagnostic | verbose | off. Never modifies @trace patterns.",
                type: "string",
            },
        },
    } as const;
    public async run(
        context: ActionContext<unknown>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        setLogProfile(params.args.profile, context);
    }
}

export function setLogProfile(
    profile: string,
    context: ActionContext<unknown>,
): void {
    const raw = profile.trim().toLowerCase();
    if (!isProfileName(raw)) {
        displayError(
            `Unknown profile '${profile}'. Valid: ${KNOWN_PROFILES.join(", ")}.`,
            context,
        );
        return;
    }
    const state = otel.getLocalTelemetryState();
    const snapshot = state.setProfile(raw);
    displaySuccess(`Local OTel profile set to '${snapshot.profile}'.`, context);
    if (raw === "off") {
        displayResult(
            "Note: '@log profile off' does not clear @trace. Use '@trace --clear' if you also want to silence debug output.",
            context,
        );
    }
}

class LogClearCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Reset local OTel sinks to defaults: profile=focused. Leaves @trace unchanged.";
    public async run(context: ActionContext<unknown>) {
        clearLogSettings(context);
    }
}

export function clearLogSettings(context: ActionContext<unknown>): void {
    otel.getLocalTelemetryState().clear();
    displaySuccess(
        "Local OTel sinks reset: profile=focused. @trace patterns unchanged.",
        context,
    );
}

function isProfileName(value: string): value is otel.LocalTelemetryProfile {
    return (KNOWN_PROFILES as readonly string[]).includes(value);
}

function describeProvider(provider: unknown): string {
    if (provider === null || provider === undefined) {
        return "no-op";
    }
    const delegate = (
        provider as {
            getDelegate?: () => unknown;
        }
    ).getDelegate?.();
    if (delegate !== undefined && delegate !== provider) {
        return `active (${getConstructorName(delegate)})`;
    }
    const name = getConstructorName(provider);
    const isNoop =
        name.startsWith("Proxy") ||
        name.startsWith("NoOp") ||
        name === "Object";
    return isNoop ? `no-op (${name})` : `active (${name})`;
}

function getConstructorName(value: unknown): string {
    const ctor = (value as { constructor?: { name?: string } }).constructor;
    return ctor?.name ?? "unknown";
}

export const LOCAL_GRAFANA_BASE_URL = "http://127.0.0.1:24319";

const LOCAL_GRAFANA_HEALTH_URL = `${LOCAL_GRAFANA_BASE_URL}/api/health`;
const LOCAL_GRAFANA_HEALTH_TIMEOUT_MS = 1500;
const LOCAL_TEMPO_TRACE_WAIT_ATTEMPTS = 20;
const LOCAL_TEMPO_TRACE_WAIT_INTERVAL_MS = 500;
const TRACE_ID_HEX_RE = /^[0-9a-f]{32}$/;

export type OpenLogTraceDependencies = {
    fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
    openUrl: (url: string) => Promise<unknown>;
    wait?: (milliseconds: number) => Promise<void>;
};

const defaultDependencies: OpenLogTraceDependencies = {
    fetch: globalThis.fetch,
    openUrl: open,
};

/**
 * Build a Grafana 13 Explore URL using Tempo's direct trace lookup query.
 */
export function buildLocalGrafanaTraceUrl(traceId: string): string {
    const panes = {
        tap: {
            datasource: "tempo",
            queries: [
                {
                    refId: "A",
                    datasource: { type: "tempo", uid: "tempo" },
                    queryType: "traceql",
                    query: traceId,
                    filters: [],
                },
            ],
            range: { from: "now-1h", to: "now" },
        },
    };
    const url = new URL("/explore", LOCAL_GRAFANA_BASE_URL);
    const params = new URLSearchParams();
    params.set("schemaVersion", "1");
    params.set("orgId", "1");
    params.set("panes", JSON.stringify(panes));
    url.search = params.toString();
    return url.toString();
}

function resolveTraceId(
    rawTraceId: string,
    systemContext: CommandHandlerContext,
): { traceId: string } | { error: string } {
    const trimmed = rawTraceId.trim();
    if (trimmed.length === 0) {
        return {
            error: "Trace id is required. Provide a 32 hex character trace id or 'last'.",
        };
    }
    const lower = trimmed.toLowerCase();
    if (lower === "last") {
        const stored = systemContext.lastCommandResultTraceId;
        if (stored === undefined) {
            const tracing = describeProvider(otelTrace.getTracerProvider());
            if (tracing.startsWith("no-op")) {
                return {
                    error: "Tracing is not active in this TypeAgent process. Start the local stack with 'pnpm run telemetry:grafana', then restart TypeAgent before running a request.",
                };
            }
            return {
                error: "No previous completed request's trace id is available yet. Run a request first, then use '@log open last'.",
            };
        }
        return { traceId: stored };
    }
    if (!TRACE_ID_HEX_RE.test(lower)) {
        return {
            error: `Invalid trace id '${rawTraceId}'. Provide a 32 hex character trace id or 'last'.`,
        };
    }
    return { traceId: lower };
}

async function isLocalGrafanaReady(
    dependencies: OpenLogTraceDependencies,
    abortSignal: AbortSignal | undefined,
): Promise<boolean> {
    try {
        abortSignal?.throwIfAborted();
        const response = await dependencies.fetch(LOCAL_GRAFANA_HEALTH_URL, {
            signal: combineAbortSignals(abortSignal),
        });
        return response.ok;
    } catch {
        abortSignal?.throwIfAborted();
        return false;
    }
}

type TraceAvailability = "ready" | "not-found" | "unavailable";

async function waitForLocalTempoTrace(
    traceId: string,
    dependencies: OpenLogTraceDependencies,
    abortSignal: AbortSignal | undefined,
): Promise<TraceAvailability> {
    const traceUrl = `${LOCAL_GRAFANA_BASE_URL}/api/datasources/proxy/uid/tempo/api/traces/${traceId}`;
    let backendUnavailable = false;
    for (
        let attempt = 0;
        attempt < LOCAL_TEMPO_TRACE_WAIT_ATTEMPTS;
        attempt++
    ) {
        abortSignal?.throwIfAborted();
        try {
            const response = await dependencies.fetch(traceUrl, {
                signal: combineAbortSignals(abortSignal),
            });
            if (response.ok) {
                if (await containsTypeAgentRootSpan(response)) {
                    return "ready";
                }
            } else if (
                response.status !== 404 &&
                response.status !== 429 &&
                response.status < 500
            ) {
                return "unavailable";
            } else if (response.status !== 404) {
                backendUnavailable = true;
            }
        } catch {
            abortSignal?.throwIfAborted();
            backendUnavailable = true;
        }
        if (attempt + 1 < LOCAL_TEMPO_TRACE_WAIT_ATTEMPTS) {
            await waitForRetry(dependencies, abortSignal);
        }
    }
    return backendUnavailable ? "unavailable" : "not-found";
}

function combineAbortSignals(
    abortSignal: AbortSignal | undefined,
): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(LOCAL_GRAFANA_HEALTH_TIMEOUT_MS);
    return abortSignal === undefined
        ? timeoutSignal
        : AbortSignal.any([abortSignal, timeoutSignal]);
}

async function waitForRetry(
    dependencies: OpenLogTraceDependencies,
    abortSignal: AbortSignal | undefined,
): Promise<void> {
    abortSignal?.throwIfAborted();
    if (dependencies.wait !== undefined) {
        await dependencies.wait(LOCAL_TEMPO_TRACE_WAIT_INTERVAL_MS);
        abortSignal?.throwIfAborted();
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timeout);
            reject(abortSignal?.reason);
        };
        const timeout = setTimeout(() => {
            abortSignal?.removeEventListener("abort", onAbort);
            resolve();
        }, LOCAL_TEMPO_TRACE_WAIT_INTERVAL_MS);
        abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
}

async function containsTypeAgentRootSpan(response: Response): Promise<boolean> {
    try {
        const payload = (await response.json()) as {
            batches?: {
                scopeSpans?: {
                    spans?: { name?: string }[];
                }[];
            }[];
        };
        return (
            payload.batches?.some((batch) =>
                batch.scopeSpans?.some((scope) =>
                    scope.spans?.some(
                        (span) => span.name === "typeagent.request",
                    ),
                ),
            ) === true
        );
    } catch {
        return false;
    }
}

// The command and natural-language action share validation, health checking,
// URL construction, browser launch, and user-facing errors here.
export async function openLogTrace(
    rawTraceId: string,
    context: ActionContext<CommandHandlerContext>,
    dependencies: OpenLogTraceDependencies = defaultDependencies,
): Promise<void> {
    const systemContext = context.sessionContext.agentContext;
    systemContext.rememberCurrentRequestTrace = false;
    const resolved = resolveTraceId(rawTraceId, systemContext);
    if ("error" in resolved) {
        displayError(resolved.error, context);
        return;
    }
    const { traceId } = resolved;

    if (!(await isLocalGrafanaReady(dependencies, context.abortSignal))) {
        displayError(
            `Local Grafana at ${LOCAL_GRAFANA_BASE_URL} is not reachable. Start it with 'pnpm run telemetry:grafana' from the ts directory, then retry.`,
            context,
        );
        return;
    }

    const availability = await waitForLocalTempoTrace(
        traceId,
        dependencies,
        context.abortSignal,
    );
    if (availability === "not-found") {
        displayError(
            `Trace ${traceId} is not available in local Tempo. It may still be exporting or may not have been captured. Confirm local telemetry is enabled and restart TypeAgent if its configuration changed.`,
            context,
        );
        return;
    }
    if (availability === "unavailable") {
        displayError(
            "Local Grafana is running, but its Tempo data source is not responding. Wait for the telemetry stack to finish starting, then retry.",
            context,
        );
        return;
    }

    const url = buildLocalGrafanaTraceUrl(traceId);
    try {
        context.abortSignal?.throwIfAborted();
        await dependencies.openUrl(url);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        displayError(
            `Failed to open Grafana in your browser: ${message}`,
            context,
        );
        return;
    }
    displaySuccess(`Opened trace ${traceId} in local Grafana: ${url}`, context);
}

class LogOpenCommandHandler implements CommandHandler {
    public constructor(
        private readonly dependencies: OpenLogTraceDependencies = defaultDependencies,
    ) {}

    public readonly description =
        "Open a captured trace by id (or 'last') in the local Grafana Explore view";
    public readonly parameters = {
        args: {
            traceId: {
                description:
                    "32 hex character trace id, or 'last' for the previous completed request's trace",
                type: "string",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        await openLogTrace(params.args.traceId, context, this.dependencies);
    }
    public async getCompletion(
        _context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<CompletionGroups> {
        if (!names.includes("traceId")) {
            return { groups: [] };
        }
        return {
            groups: [
                {
                    name: "traceId",
                    completions: ["last"],
                },
            ],
        };
    }
}

export function getLogCommandHandlers(
    openTraceDependencies: OpenLogTraceDependencies = defaultDependencies,
): CommandHandlerTable {
    return {
        description:
            "Local OpenTelemetry sink controls (independent of @trace)",
        defaultSubCommand: new LogStatusCommandHandler(),
        commands: {
            status: new LogStatusCommandHandler(),
            profile: new LogProfileCommandHandler(),
            clear: new LogClearCommandHandler(),
            open: new LogOpenCommandHandler(openTraceDependencies),
        },
    };
}

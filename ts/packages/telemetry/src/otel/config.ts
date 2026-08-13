// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Public configuration types and the synchronous resolver for
 * `@typeagent/telemetry`'s OTel integration.
 *
 * The resolver reads a layered YAML configuration via `@typeagent/config` and
 * overlays `OTEL_*` / `TYPEAGENT_OTEL_*` environment variables. It never
 * mutates `process.env`, never initializes any OTel provider, exporter, or
 * instrumentation, and never performs any network or filesystem side effects
 * beyond what `loadConfigSync` already does to read the YAML files.
 */

import * as os from "node:os";
import { loadConfigSync } from "@typeagent/config";

/* -------------------------------------------------------------------------- */
/* Public configuration types                                                 */
/* -------------------------------------------------------------------------- */

/**
 * OTLP exporter endpoint and headers for a single signal.
 */
export interface OtlpExporterConfig {
    /** OTLP endpoint, e.g. `"http://localhost:4318"`. */
    readonly endpoint: string;
    /** Additional headers sent with every OTLP export request. */
    readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Trace sampler names supported by the standard OTel SDK
 * (`OTEL_TRACES_SAMPLER`).
 */
export type TraceSampler =
    | "always_on"
    | "always_off"
    | "traceidratio"
    | "parentbased_always_on"
    | "parentbased_always_off"
    | "parentbased_traceidratio";

/** Configuration for the traces signal. Omit to disable trace export. */
export interface TraceConfig {
    /** OTLP exporter used for trace export. */
    readonly otlp?: OtlpExporterConfig;
    /** Sampler name. Defaults to `always_on` when trace export is enabled. */
    readonly sampler?: TraceSampler;
    /** Ratio argument for ratio-based samplers (`0.0` - `1.0`). */
    readonly samplerArg?: number;
}

/** Configuration for the metrics signal. Omit to disable metric export. */
export interface MetricConfig {
    /** OTLP exporter used for metric export. */
    readonly otlp?: OtlpExporterConfig;
}

/**
 * Configuration for the logs signal. OTLP export and the local JSONL file are
 * independent and may be enabled together.
 */
export interface LogConfig {
    /** OTLP exporter used for log export. */
    readonly otlp?: OtlpExporterConfig;
    /**
     * Local file path for OTel log records, e.g.
     * `"~/.typeagent/logs/typeagent-{service}-{process}-{pid}.jsonl"`.
     * Template placeholders such as `{service}`, `{process}`, and `{pid}` are
     * preserved verbatim by the resolver; only a leading `~`, `~/`, or `~\`
     * is expanded to the user's home directory.
     */
    readonly logFile?: string;
}

/**
 * Top-level TypeAgent telemetry configuration. Every signal is opt-in: a
 * signal that is omitted (or whose value is `undefined`) is disabled.
 */
export interface TelemetryConfig {
    readonly traces?: TraceConfig;
    readonly metrics?: MetricConfig;
    readonly logs?: LogConfig;
    /** Copy enabled TypeAgent debug output into the OTel logs pipeline. */
    readonly debugBridge?: boolean;
    /** Export structured dispatcher events into the OTel logs pipeline. */
    readonly structuredLogs?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Resolver                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Options for {@link resolveTelemetryConfig}. All fields are optional.
 *
 * The four file-path fields are forwarded verbatim to `@typeagent/config`'s
 * `loadConfigSync`, so they follow the same defaults as the rest of the
 * TypeAgent config stack.
 */
export interface ResolveTelemetryConfigOptions {
    /** Passed through to `loadConfigSync` — the TypeAgent workspace root. */
    readonly workspaceRoot?: string;
    /** Passed through to `loadConfigSync` — `config.defaults.yaml` path. */
    readonly defaultsPath?: string;
    /** Passed through to `loadConfigSync` — `config.local.yaml` path. */
    readonly localPath?: string;
    /** Passed through to `loadConfigSync` — legacy `.env` fallback path. */
    readonly dotEnvPath?: string;

    /**
     * Environment used for `OTEL_*` / `TYPEAGENT_OTEL_*` overrides. Defaults
     * to `process.env` when omitted. The map is only read; the resolver never
     * mutates it or `process.env`.
     */
    readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolve the effective {@link TelemetryConfig} from the layered YAML
 * configuration and any `OTEL_*` / `TYPEAGENT_OTEL_*` environment variables.
 *
 * Precedence (low to high):
 *   1. YAML `telemetry.otlpEndpoint` (global fallback endpoint).
 *   2. `OTEL_EXPORTER_OTLP_ENDPOINT` (global env endpoint; overrides YAML).
 *   3. `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` (signal-specific).
 *
 * The `OTEL_{TRACES,METRICS,LOGS}_EXPORTER=none` selector disables OTLP for
 * that signal; only `otlp` and `none` are accepted for these selectors.
 *
 * A configured log file (env `TYPEAGENT_OTEL_LOG_FILE` overrides YAML
 * `telemetry.logFile`) independently requests the logs signal — it does not
 * require an OTLP endpoint and is not disabled by `OTEL_LOGS_EXPORTER=none`.
 *
 * This function performs pure configuration resolution: it initializes no
 * providers, no exporters, and no instrumentation, and never mutates
 * `process.env`.
 */
export function resolveTelemetryConfig(
    options: ResolveTelemetryConfigOptions = {},
): TelemetryConfig {
    // Layered YAML: never touch process.env. Build the options object
    // property-by-property so `exactOptionalPropertyTypes` does not reject
    // `undefined` for optional fields.
    const loadOptions: {
        workspaceRoot?: string;
        defaultsPath?: string;
        localPath?: string;
        dotEnvPath?: string;
        populateProcessEnv: false;
    } = { populateProcessEnv: false };
    if (options.workspaceRoot !== undefined)
        loadOptions.workspaceRoot = options.workspaceRoot;
    if (options.defaultsPath !== undefined)
        loadOptions.defaultsPath = options.defaultsPath;
    if (options.localPath !== undefined)
        loadOptions.localPath = options.localPath;
    if (options.dotEnvPath !== undefined)
        loadOptions.dotEnvPath = options.dotEnvPath;
    const { env: yaml } = loadConfigSync(loadOptions);

    // Env overrides. Default to a snapshot of `process.env`; tests inject an
    // isolated map. The resolver only reads from this map.
    const env: Readonly<Record<string, string | undefined>> =
        options.env ?? process.env;

    // ---- YAML values (flattened by @typeagent/config; keys are uppercase).
    const yamlEndpoint = requireNonEmpty(
        yaml.TELEMETRY_OTLPENDPOINT,
        "telemetry.otlpEndpoint",
    );
    const yamlLogFile = requireNonEmpty(
        yaml.TELEMETRY_LOGFILE,
        "telemetry.logFile",
    );
    const yamlSampler = requireNonEmpty(
        yaml.TELEMETRY_TRACESSAMPLER,
        "telemetry.tracesSampler",
    );
    const yamlSamplerArg = requireNonEmpty(
        yaml.TELEMETRY_TRACESSAMPLERARG,
        "telemetry.tracesSamplerArg",
    );
    const yamlDebugBridge = parseBoolean(
        yaml.TELEMETRY_DEBUGBRIDGE,
        "telemetry.debugBridge",
    );
    const yamlStructuredLogs = parseBoolean(
        yaml.TELEMETRY_STRUCTUREDLOGS,
        "telemetry.structuredLogs",
    );

    // ---- Env values.
    const envGlobalEndpoint = requireNonEmpty(
        env.OTEL_EXPORTER_OTLP_ENDPOINT,
        "OTEL_EXPORTER_OTLP_ENDPOINT",
    );
    const envGlobalHeaders = normalizeEnv(env.OTEL_EXPORTER_OTLP_HEADERS);
    const envSampler = requireNonEmpty(
        env.OTEL_TRACES_SAMPLER,
        "OTEL_TRACES_SAMPLER",
    );
    const envSamplerArg = requireNonEmpty(
        env.OTEL_TRACES_SAMPLER_ARG,
        "OTEL_TRACES_SAMPLER_ARG",
    );
    const envLogFile = requireNonEmpty(
        env.TYPEAGENT_OTEL_LOG_FILE,
        "TYPEAGENT_OTEL_LOG_FILE",
    );
    const envDebugBridge = parseBoolean(
        env.TYPEAGENT_OTEL_DEBUG_BRIDGE,
        "TYPEAGENT_OTEL_DEBUG_BRIDGE",
    );
    const envStructuredLogs = parseBoolean(
        env.TYPEAGENT_OTEL_STRUCTURED_LOGS,
        "TYPEAGENT_OTEL_STRUCTURED_LOGS",
    );

    const signalEndpoints: Record<Signal, string | undefined> = {
        traces: requireNonEmpty(
            env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        ),
        metrics: requireNonEmpty(
            env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
            "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
        ),
        logs: requireNonEmpty(
            env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
            "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
        ),
    };
    const signalHeaders: Record<Signal, string | undefined> = {
        traces: normalizeEnv(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
        metrics: normalizeEnv(env.OTEL_EXPORTER_OTLP_METRICS_HEADERS),
        logs: normalizeEnv(env.OTEL_EXPORTER_OTLP_LOGS_HEADERS),
    };
    const exporters: Record<Signal, ExporterSelector | undefined> = {
        traces: parseExporterSelector(
            env.OTEL_TRACES_EXPORTER,
            "OTEL_TRACES_EXPORTER",
        ),
        metrics: parseExporterSelector(
            env.OTEL_METRICS_EXPORTER,
            "OTEL_METRICS_EXPORTER",
        ),
        logs: parseExporterSelector(
            env.OTEL_LOGS_EXPORTER,
            "OTEL_LOGS_EXPORTER",
        ),
    };

    // ---- Compute effective global endpoint: env overrides YAML.
    const globalEndpoint = envGlobalEndpoint ?? yamlEndpoint;

    // Parse the global headers once so signal-level results share the same
    // frozen record when no signal-specific override is present.
    const globalHeaders = parseHeaders(
        envGlobalHeaders,
        "OTEL_EXPORTER_OTLP_HEADERS",
    );

    // ---- Per-signal OTLP config.
    const tracesOtlp = buildOtlp(
        "traces",
        signalEndpoints.traces,
        globalEndpoint,
        signalHeaders.traces,
        globalHeaders,
        exporters.traces,
        "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
    );
    const metricsOtlp = buildOtlp(
        "metrics",
        signalEndpoints.metrics,
        globalEndpoint,
        signalHeaders.metrics,
        globalHeaders,
        exporters.metrics,
        "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
    );
    const logsOtlp = buildOtlp(
        "logs",
        signalEndpoints.logs,
        globalEndpoint,
        signalHeaders.logs,
        globalHeaders,
        exporters.logs,
        "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
    );

    // ---- Log file: env overrides YAML; expanded independent of OTLP.
    const rawLogFile = envLogFile ?? yamlLogFile;
    const logFile =
        rawLogFile !== undefined ? expandTilde(rawLogFile) : undefined;

    // ---- Sampler / arg: env overrides YAML. Validate always so bad
    // values surface even if traces are not (yet) requested.
    const { sampler: rawSampler, arg: samplerArg } = validateSamplerAndArg(
        envSampler ?? yamlSampler,
        envSamplerArg ?? yamlSamplerArg,
    );

    // ---- Assemble result. Any signal without a reason to be present is
    // omitted, so JSONL-only setups return `{ logs: { logFile } }` with no
    // trace or metric providers requested.
    const result: {
        traces?: TraceConfig;
        metrics?: MetricConfig;
        logs?: LogConfig;
        debugBridge?: boolean;
        structuredLogs?: boolean;
    } = {};

    if (tracesOtlp !== undefined) {
        const sampler: TraceSampler = rawSampler ?? "always_on";
        const traces: {
            otlp: OtlpExporterConfig;
            sampler: TraceSampler;
            samplerArg?: number;
        } = { otlp: tracesOtlp, sampler };
        if (samplerArg !== undefined) {
            traces.samplerArg = samplerArg;
        }
        result.traces = traces;
    }

    if (metricsOtlp !== undefined) {
        result.metrics = { otlp: metricsOtlp };
    }

    if (logsOtlp !== undefined || logFile !== undefined) {
        const logs: { otlp?: OtlpExporterConfig; logFile?: string } = {};
        if (logsOtlp !== undefined) {
            logs.otlp = logsOtlp;
        }
        if (logFile !== undefined) {
            logs.logFile = logFile;
        }
        result.logs = logs;
    }
    const debugBridge = envDebugBridge ?? yamlDebugBridge;
    if (debugBridge !== undefined) {
        result.debugBridge = debugBridge;
    }
    const structuredLogs = envStructuredLogs ?? yamlStructuredLogs;
    if (structuredLogs !== undefined) {
        result.structuredLogs = structuredLogs;
    }

    return result;
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

type Signal = "traces" | "metrics" | "logs";
type ExporterSelector = "otlp" | "none";

const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const VALID_SAMPLERS: ReadonlySet<TraceSampler> = new Set<TraceSampler>([
    "always_on",
    "always_off",
    "traceidratio",
    "parentbased_always_on",
    "parentbased_always_off",
    "parentbased_traceidratio",
]);

const RATIO_SAMPLERS: ReadonlySet<TraceSampler> = new Set<TraceSampler>([
    "traceidratio",
    "parentbased_traceidratio",
]);

const SUPPORTED_EXPORTERS: ReadonlySet<ExporterSelector> =
    new Set<ExporterSelector>(["otlp", "none"]);

/** Treat `undefined` and the empty string as "unset". */
function normalizeEnv(value: string | undefined): string | undefined {
    if (value === undefined || value === "") {
        return undefined;
    }
    return value;
}

/**
 * Normalize a raw value: treat `undefined` / `""` as unset, and reject a
 * value that is present but consists only of whitespace. Used for anything
 * whose empty form is unambiguously an authoring error (endpoints, log file
 * paths, sampler / arg strings).
 */
function requireNonEmpty(
    value: string | undefined,
    name: string,
): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value.trim() === "") {
        throw new Error(`${name} must not be blank.`);
    }
    return value;
}

function parseBoolean(
    value: string | undefined,
    name: string,
): boolean | undefined {
    if (value === undefined || value === "") {
        return undefined;
    }
    switch (value.trim().toLowerCase()) {
        case "true":
        case "on":
        case "1":
            return true;
        case "false":
        case "off":
        case "0":
            return false;
        default:
            throw new Error(
                `${name}="${value}" is invalid; expected true/false, on/off, or 1/0.`,
            );
    }
}

/**
 * Parse the `OTEL_{TRACES,METRICS,LOGS}_EXPORTER` selector. Only `otlp` and
 * `none` are supported; any other value throws a clear error so users are
 * not silently opted out of unsupported exporters.
 */
function parseExporterSelector(
    value: string | undefined,
    name: string,
): ExporterSelector | undefined {
    const normalized = normalizeEnv(value);
    if (normalized === undefined) {
        return undefined;
    }
    const candidate = normalized.trim();
    if (!SUPPORTED_EXPORTERS.has(candidate as ExporterSelector)) {
        throw new Error(
            `${name}="${value}" is not supported; only "otlp" and "none" are accepted.`,
        );
    }
    return candidate as ExporterSelector;
}

/**
 * Compute the OTLP exporter config for one signal. Returns `undefined` when
 * the signal has no OTLP export (either because no endpoint is available or
 * because the exporter selector is `none`).
 */
function buildOtlp(
    signal: Signal,
    signalEndpoint: string | undefined,
    globalEndpoint: string | undefined,
    signalHeadersRaw: string | undefined,
    globalHeaders: Readonly<Record<string, string>> | undefined,
    exporter: ExporterSelector | undefined,
    signalHeadersEnvName: string,
): OtlpExporterConfig | undefined {
    if (exporter === "none") {
        return undefined;
    }
    const effectiveEndpoint =
        signalEndpoint ??
        (globalEndpoint !== undefined
            ? appendSignalPath(globalEndpoint, signal)
            : undefined);
    if (effectiveEndpoint === undefined) {
        return undefined;
    }
    // Signal-specific headers replace, not merge, the global.
    const headers =
        signalHeadersRaw !== undefined
            ? parseHeaders(signalHeadersRaw, signalHeadersEnvName)
            : globalHeaders;
    const otlp: {
        endpoint: string;
        headers?: Readonly<Record<string, string>>;
    } = {
        endpoint: effectiveEndpoint,
    };
    if (headers !== undefined) {
        otlp.headers = headers;
    }
    return otlp;
}

/**
 * Standard global OTLP/HTTP endpoints are base URLs. Exporter constructors
 * receive explicit URLs, so resolve the signal path before constructing them.
 * Signal-specific endpoint variables already contain the complete URL and are
 * preserved by {@link buildOtlp}.
 */
function appendSignalPath(endpoint: string, signal: Signal): string {
    let parsed: URL;
    try {
        parsed = new URL(endpoint);
    } catch {
        throw new Error(
            `OTLP endpoint "${endpoint}" must be an absolute URL when used as a global endpoint.`,
        );
    }
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/v1/${signal}`;
    return parsed.toString();
}

/**
 * Parse a W3C-Baggage-encoded `key=value,key=value` header string as used by
 * `OTEL_EXPORTER_OTLP_HEADERS` and the per-signal variants. Keys and values
 * are percent-decoded; malformed pairs or bad percent escapes throw a
 * descriptive error.
 */
function parseHeaders(
    raw: string | undefined,
    name: string,
): Readonly<Record<string, string>> | undefined {
    if (raw === undefined) {
        return undefined;
    }
    const record: Record<string, string> = {};
    for (const rawPair of raw.split(",")) {
        const pair = rawPair.trim();
        if (pair === "") {
            throw new Error(
                `${name} contains an empty entry; expected "key=value".`,
            );
        }
        const eqIdx = pair.indexOf("=");
        if (eqIdx < 0) {
            throw new Error(
                `${name} entry "${pair}" is malformed; expected "key=value".`,
            );
        }
        const rawKey = pair.slice(0, eqIdx).trim();
        const rawValue = pair.slice(eqIdx + 1).trim();
        if (rawKey === "") {
            throw new Error(`${name} entry "${pair}" has an empty key.`);
        }
        let key: string;
        try {
            key = decodeURIComponent(rawKey);
        } catch {
            throw new Error(
                `${name} entry "${pair}" has an invalid percent-encoded key.`,
            );
        }
        if (!HTTP_HEADER_NAME.test(key)) {
            throw new Error(
                `${name} entry "${pair}" decodes to an invalid HTTP header name.`,
            );
        }
        let value: string;
        try {
            value = decodeURIComponent(rawValue);
        } catch {
            throw new Error(
                `${name} entry "${pair}" has an invalid percent-encoded value.`,
            );
        }
        record[key] = value;
    }
    return Object.freeze(record);
}

/**
 * Validate the sampler name and its argument. The two inputs are the merged
 * `env-over-yaml` values.
 */
function validateSamplerAndArg(
    rawSampler: string | undefined,
    rawArg: string | undefined,
): { sampler: TraceSampler | undefined; arg: number | undefined } {
    let sampler: TraceSampler | undefined;
    if (rawSampler !== undefined) {
        const trimmed = rawSampler.trim();
        if (!VALID_SAMPLERS.has(trimmed as TraceSampler)) {
            throw new Error(
                `Invalid trace sampler "${rawSampler}"; expected one of ${[
                    ...VALID_SAMPLERS,
                ].join(", ")}.`,
            );
        }
        sampler = trimmed as TraceSampler;
    }

    let arg: number | undefined;
    if (rawArg !== undefined) {
        const parsed = Number(rawArg);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
            throw new Error(
                `Invalid trace sampler arg "${rawArg}"; expected a finite number in [0, 1].`,
            );
        }
        arg = parsed;
    }

    if (
        sampler !== undefined &&
        RATIO_SAMPLERS.has(sampler) &&
        arg === undefined
    ) {
        throw new Error(
            `Trace sampler "${sampler}" requires a sampler arg in [0, 1] via OTEL_TRACES_SAMPLER_ARG or telemetry.tracesSamplerArg.`,
        );
    }
    if (
        arg !== undefined &&
        (sampler === undefined || !RATIO_SAMPLERS.has(sampler))
    ) {
        throw new Error(
            `Trace sampler arg is only valid for ratio samplers (traceidratio, parentbased_traceidratio).`,
        );
    }

    return { sampler, arg };
}

/**
 * Expand a leading `~`, `~/`, or `~\` to the current user's home directory.
 * Anything else — including a tilde in the middle of the path — is returned
 * verbatim so template placeholders like `{service}` are preserved.
 */
function expandTilde(value: string): string {
    if (value === "~") {
        return os.homedir();
    }
    if (value.startsWith("~/") || value.startsWith("~\\")) {
        return os.homedir() + value.slice(1);
    }
    return value;
}

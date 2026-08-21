// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    resolveTelemetryConfig,
    type ResolveTelemetryConfigOptions,
    type TelemetryConfig,
} from "../src/otel/config.js";

/**
 * Helpers.
 *
 * Every test uses a fresh temp workspace so `@typeagent/config`'s
 * `loadConfigSync` cannot accidentally pick up the real repository's
 * `config.defaults.yaml` / `config.local.yaml`. Env-only tests still get an
 * empty workspace and an explicit `env: {}` map.
 */

function makeTempWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-otelcfg-test-"));
}

function writeYaml(
    workspaceRoot: string,
    filename: string,
    body: string,
): void {
    fs.writeFileSync(path.join(workspaceRoot, filename), body, "utf8");
}

function resolve(
    root: string,
    overrides: Partial<ResolveTelemetryConfigOptions> = {},
): TelemetryConfig {
    return resolveTelemetryConfig({
        workspaceRoot: root,
        env: {},
        ...overrides,
    });
}

function withTempWorkspace<T>(fn: (root: string) => T): T {
    const root = makeTempWorkspace();
    try {
        return fn(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe("resolveTelemetryConfig", () => {
    /* ------------------------------------------------------------------ */
    /* No configuration                                                    */
    /* ------------------------------------------------------------------ */

    it("returns an empty config when no YAML or env is provided", () => {
        withTempWorkspace((root) => {
            expect(resolve(root)).toEqual({});
        });
    });

    it("resolves the debug bridge from YAML and environment", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                "telemetry:\n  debugBridge: true\n",
            );
            expect(resolve(root).debugBridge).toBe(true);
            expect(
                resolve(root, {
                    env: { TYPEAGENT_OTEL_DEBUG_BRIDGE: "off" },
                }).debugBridge,
            ).toBe(false);
            expect(() =>
                resolve(root, {
                    env: { TYPEAGENT_OTEL_DEBUG_BRIDGE: "sometimes" },
                }),
            ).toThrow(/expected true\/false/);
        });
    });

    it("resolves structured logs from YAML and environment", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                "telemetry:\n  structuredLogs: true\n",
            );
            expect(resolve(root).structuredLogs).toBe(true);
            expect(
                resolve(root, {
                    env: { TYPEAGENT_OTEL_STRUCTURED_LOGS: "off" },
                }).structuredLogs,
            ).toBe(false);
            expect(() =>
                resolve(root, {
                    env: { TYPEAGENT_OTEL_STRUCTURED_LOGS: "sometimes" },
                }),
            ).toThrow(/expected true\/false/);
        });
    });

    /* ------------------------------------------------------------------ */
    /* YAML endpoint                                                       */
    /* ------------------------------------------------------------------ */

    it("YAML otlpEndpoint requests OTLP for traces, metrics, and logs", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                "telemetry:\n  otlpEndpoint: http://localhost:4318\n",
            );
            const cfg = resolve(root);
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://localhost:4318/v1/traces",
            );
            expect(cfg.metrics?.otlp?.endpoint).toBe(
                "http://localhost:4318/v1/metrics",
            );
            expect(cfg.logs?.otlp?.endpoint).toBe(
                "http://localhost:4318/v1/logs",
            );
        });
    });

    it("defaults the trace sampler to always_on when trace export is enabled", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                "telemetry:\n  otlpEndpoint: http://localhost:4318\n",
            );
            const cfg = resolve(root);
            expect(cfg.traces?.sampler).toBe("always_on");
            expect(cfg.traces?.samplerArg).toBeUndefined();
        });
    });

    /* ------------------------------------------------------------------ */
    /* Env global vs YAML                                                 */
    /* ------------------------------------------------------------------ */

    it("env OTEL_EXPORTER_OTLP_ENDPOINT overrides YAML otlpEndpoint", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                "telemetry:\n  otlpEndpoint: http://yaml.example:4318\n",
            );
            const cfg = resolve(root, {
                env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://env.example:4318" },
            });
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://env.example:4318/v1/traces",
            );
            expect(cfg.metrics?.otlp?.endpoint).toBe(
                "http://env.example:4318/v1/metrics",
            );
            expect(cfg.logs?.otlp?.endpoint).toBe(
                "http://env.example:4318/v1/logs",
            );
        });
    });

    /* ------------------------------------------------------------------ */
    /* Signal-specific endpoints                                          */
    /* ------------------------------------------------------------------ */

    it("a signal endpoint requests only that signal (no global present)", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:
                        "http://traces.example:4318",
                },
            });
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://traces.example:4318",
            );
            expect(cfg.metrics).toBeUndefined();
            expect(cfg.logs).toBeUndefined();
        });
    });

    it("a signal endpoint overrides the global endpoint for that signal only", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    OTEL_EXPORTER_OTLP_ENDPOINT: "http://global.example:4318",
                    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:
                        "http://logs.example:4318",
                },
            });
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://global.example:4318/v1/traces",
            );
            expect(cfg.metrics?.otlp?.endpoint).toBe(
                "http://global.example:4318/v1/metrics",
            );
            expect(cfg.logs?.otlp?.endpoint).toBe("http://logs.example:4318");
        });
    });

    /* ------------------------------------------------------------------ */
    /* Exporter selector = none                                           */
    /* ------------------------------------------------------------------ */

    it("OTEL_TRACES_EXPORTER=none disables traces even with a global endpoint", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    OTEL_EXPORTER_OTLP_ENDPOINT: "http://global.example:4318",
                    OTEL_TRACES_EXPORTER: "none",
                },
            });
            expect(cfg.traces).toBeUndefined();
            expect(cfg.metrics?.otlp?.endpoint).toBe(
                "http://global.example:4318/v1/metrics",
            );
            expect(cfg.logs?.otlp?.endpoint).toBe(
                "http://global.example:4318/v1/logs",
            );
        });
    });

    it("OTEL_LOGS_EXPORTER=none disables only OTLP for logs; a log file still requests logs", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    OTEL_EXPORTER_OTLP_ENDPOINT: "http://global.example:4318",
                    OTEL_LOGS_EXPORTER: "none",
                    TYPEAGENT_OTEL_LOG_FILE: "/tmp/log.jsonl",
                },
            });
            expect(cfg.logs?.otlp).toBeUndefined();
            expect(cfg.logs?.logFile).toBe("/tmp/log.jsonl");
        });
    });

    it("rejects unsupported exporter selectors with a clear error", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, { env: { OTEL_TRACES_EXPORTER: "jaeger" } }),
            ).toThrow(/OTEL_TRACES_EXPORTER=.*jaeger.*only "otlp" and "none"/);
        });
    });

    it("accepts OTEL_TRACES_EXPORTER=otlp explicitly (no-op with an endpoint)", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    OTEL_EXPORTER_OTLP_ENDPOINT: "http://global.example:4318",
                    OTEL_TRACES_EXPORTER: "otlp",
                },
            });
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://global.example:4318/v1/traces",
            );
        });
    });

    /* ------------------------------------------------------------------ */
    /* Log file                                                           */
    /* ------------------------------------------------------------------ */

    it("YAML logFile alone requests only the logs signal (JSONL-only)", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                "telemetry:\n  logFile: /tmp/typeagent.jsonl\n",
            );
            const cfg = resolve(root);
            expect(cfg.traces).toBeUndefined();
            expect(cfg.metrics).toBeUndefined();
            expect(cfg.logs).toEqual({
                logFile: "/tmp/typeagent.jsonl",
                retentionBytes: 524_288_000,
            });
        });
    });

    it("TYPEAGENT_OTEL_LOG_FILE overrides YAML logFile", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                "telemetry:\n  logFile: /tmp/yaml.jsonl\n",
            );
            const cfg = resolve(root, {
                env: { TYPEAGENT_OTEL_LOG_FILE: "/tmp/env.jsonl" },
            });
            expect(cfg.logs?.logFile).toBe("/tmp/env.jsonl");
        });
    });

    it("expands leading ~ / ~/ / ~\\ in log file paths", () => {
        withTempWorkspace((root) => {
            const home = os.homedir();
            const posix = resolve(root, {
                env: { TYPEAGENT_OTEL_LOG_FILE: "~/.typeagent/log.jsonl" },
            });
            expect(posix.logs?.logFile).toBe(`${home}/.typeagent/log.jsonl`);

            const win = resolve(root, {
                env: { TYPEAGENT_OTEL_LOG_FILE: "~\\logs\\log.jsonl" },
            });
            expect(win.logs?.logFile).toBe(`${home}\\logs\\log.jsonl`);

            const bare = resolve(root, {
                env: { TYPEAGENT_OTEL_LOG_FILE: "~" },
            });
            expect(bare.logs?.logFile).toBe(home);
        });
    });

    it("preserves interior tildes and template placeholders", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    TYPEAGENT_OTEL_LOG_FILE:
                        "/var/logs/typeagent-{service}-{pid}-~snap.jsonl",
                },
            });
            expect(cfg.logs?.logFile).toBe(
                "/var/logs/typeagent-{service}-{pid}-~snap.jsonl",
            );
        });
    });

    it("rejects an empty (whitespace-only) log file value", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, { env: { TYPEAGENT_OTEL_LOG_FILE: "   " } }),
            ).toThrow(/TYPEAGENT_OTEL_LOG_FILE .* not be blank/);
        });
    });

    it("rejects an empty log file value", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, { env: { TYPEAGENT_OTEL_LOG_FILE: "" } }),
            ).toThrow(/TYPEAGENT_OTEL_LOG_FILE .* not be blank/);
        });
    });

    /* ------------------------------------------------------------------ */
    /* Endpoint validation                                                */
    /* ------------------------------------------------------------------ */

    it("rejects a whitespace-only OTEL_EXPORTER_OTLP_ENDPOINT", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, { env: { OTEL_EXPORTER_OTLP_ENDPOINT: "   " } }),
            ).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT .* not be blank/);
        });
    });

    it("rejects an empty OTEL_EXPORTER_OTLP_ENDPOINT", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, { env: { OTEL_EXPORTER_OTLP_ENDPOINT: "" } }),
            ).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT .* not be blank/);
        });
    });

    it("does not expand a leading tilde in an OTLP endpoint", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "~/v1/traces" },
            });
            expect(cfg.traces?.otlp?.endpoint).toBe("~/v1/traces");
        });
    });

    it("rejects a whitespace-only YAML telemetry.otlpEndpoint", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                'telemetry:\n  otlpEndpoint: "   "\n',
            );
            expect(() => resolve(root)).toThrow(
                /telemetry.otlpEndpoint .* not be blank/,
            );
        });
    });

    /* ------------------------------------------------------------------ */
    /* Headers                                                            */
    /* ------------------------------------------------------------------ */

    it("parses OTEL_EXPORTER_OTLP_HEADERS and applies them to every signal", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    OTEL_EXPORTER_OTLP_ENDPOINT: "http://global.example:4318",
                    OTEL_EXPORTER_OTLP_HEADERS:
                        "authorization=Bearer%20token,x%2Dapp=typeagent",
                },
            });
            expect(cfg.traces?.otlp?.headers).toEqual({
                authorization: "Bearer token",
                "x-app": "typeagent",
            });
            expect(cfg.metrics?.otlp?.headers).toEqual({
                authorization: "Bearer token",
                "x-app": "typeagent",
            });
            expect(cfg.logs?.otlp?.headers).toEqual({
                authorization: "Bearer token",
                "x-app": "typeagent",
            });
        });
    });

    it("signal-specific headers replace, not merge, the global headers", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    OTEL_EXPORTER_OTLP_ENDPOINT: "http://global.example:4318",
                    OTEL_EXPORTER_OTLP_HEADERS:
                        "authorization=global,x-app=typeagent",
                    OTEL_EXPORTER_OTLP_TRACES_HEADERS:
                        "authorization=traces-only",
                },
            });
            expect(cfg.traces?.otlp?.headers).toEqual({
                authorization: "traces-only",
            });
            expect(cfg.metrics?.otlp?.headers).toEqual({
                authorization: "global",
                "x-app": "typeagent",
            });
        });
    });

    it("rejects headers missing '='", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        OTEL_EXPORTER_OTLP_ENDPOINT:
                            "http://global.example:4318",
                        OTEL_EXPORTER_OTLP_HEADERS: "authorization",
                    },
                }),
            ).toThrow(/OTEL_EXPORTER_OTLP_HEADERS.*malformed/);
        });
    });

    it("rejects headers with an empty key", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        OTEL_EXPORTER_OTLP_ENDPOINT:
                            "http://global.example:4318",
                        OTEL_EXPORTER_OTLP_HEADERS: "=value",
                    },
                }),
            ).toThrow(/empty key/);
        });
    });

    it("rejects a header with bad percent-encoding in the value", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        OTEL_EXPORTER_OTLP_ENDPOINT:
                            "http://global.example:4318",
                        OTEL_EXPORTER_OTLP_HEADERS: "authorization=%ZZ",
                    },
                }),
            ).toThrow(/percent-encoded/);
        });
    });

    it("rejects a header with bad percent-encoding in the key", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        OTEL_EXPORTER_OTLP_ENDPOINT:
                            "http://global.example:4318",
                        OTEL_EXPORTER_OTLP_HEADERS: "%ZZ=value",
                    },
                }),
            ).toThrow(/percent-encoded key/);
        });
    });

    it("rejects empty header entries and invalid decoded header names", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        OTEL_EXPORTER_OTLP_ENDPOINT:
                            "http://global.example:4318",
                        OTEL_EXPORTER_OTLP_HEADERS: "x=1,,y=2",
                    },
                }),
            ).toThrow(/empty entry/);

            expect(() =>
                resolve(root, {
                    env: {
                        OTEL_EXPORTER_OTLP_ENDPOINT:
                            "http://global.example:4318",
                        OTEL_EXPORTER_OTLP_HEADERS: "bad%20key=value",
                    },
                }),
            ).toThrow(/invalid HTTP header name/);
        });
    });

    it("returns a frozen headers record", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    OTEL_EXPORTER_OTLP_ENDPOINT: "http://global.example:4318",
                    OTEL_EXPORTER_OTLP_HEADERS: "x=1",
                },
            });
            const headers = cfg.traces?.otlp?.headers as Record<string, string>;
            expect(Object.isFrozen(headers)).toBe(true);
        });
    });

    /* ------------------------------------------------------------------ */
    /* Sampler                                                            */
    /* ------------------------------------------------------------------ */

    it("YAML tracesSampler is used when trace export is requested", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  otlpEndpoint: http://localhost:4318",
                    "  tracesSampler: parentbased_always_off",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg.traces?.sampler).toBe("parentbased_always_off");
        });
    });

    it("env OTEL_TRACES_SAMPLER overrides YAML tracesSampler", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  otlpEndpoint: http://localhost:4318",
                    "  tracesSampler: always_off",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root, {
                env: { OTEL_TRACES_SAMPLER: "always_on" },
            });
            expect(cfg.traces?.sampler).toBe("always_on");
        });
    });

    it("accepts a ratio sampler with a valid arg from YAML", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  otlpEndpoint: http://localhost:4318",
                    "  tracesSampler: parentbased_traceidratio",
                    "  tracesSamplerArg: 0.25",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg.traces?.sampler).toBe("parentbased_traceidratio");
            expect(cfg.traces?.samplerArg).toBe(0.25);
        });
    });

    it("env OTEL_TRACES_SAMPLER_ARG overrides YAML tracesSamplerArg", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  otlpEndpoint: http://localhost:4318",
                    "  tracesSampler: traceidratio",
                    "  tracesSamplerArg: 0.1",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root, {
                env: { OTEL_TRACES_SAMPLER_ARG: "0.9" },
            });
            expect(cfg.traces?.samplerArg).toBe(0.9);
        });
    });

    it("rejects an unknown sampler name (env)", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: { OTEL_TRACES_SAMPLER: "bogus" },
                }),
            ).toThrow(/Invalid trace sampler "bogus"/);
        });
    });

    it("rejects a ratio sampler without an arg", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: { OTEL_TRACES_SAMPLER: "traceidratio" },
                }),
            ).toThrow(/requires a sampler arg/);
        });
    });

    it("rejects an arg attached to a non-ratio sampler", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        OTEL_TRACES_SAMPLER: "always_on",
                        OTEL_TRACES_SAMPLER_ARG: "0.5",
                    },
                }),
            ).toThrow(/only valid for ratio samplers/);
        });
    });

    it("rejects an arg with no sampler at all (default sampler is non-ratio)", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: { OTEL_TRACES_SAMPLER_ARG: "0.5" },
                }),
            ).toThrow(/only valid for ratio samplers/);
        });
    });

    it("rejects an out-of-range sampler arg", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        OTEL_TRACES_SAMPLER: "traceidratio",
                        OTEL_TRACES_SAMPLER_ARG: "1.5",
                    },
                }),
            ).toThrow(/expected a finite number in \[0, 1\]/);
        });
    });

    it("rejects a non-numeric sampler arg", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        OTEL_TRACES_SAMPLER: "traceidratio",
                        OTEL_TRACES_SAMPLER_ARG: "half",
                    },
                }),
            ).toThrow(/expected a finite number/);
        });
    });

    it("sampler alone does not request the traces signal", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: { OTEL_TRACES_SAMPLER: "always_off" },
            });
            expect(cfg.traces).toBeUndefined();
        });
    });

    /* ------------------------------------------------------------------ */
    /* JSONL-only                                                         */
    /* ------------------------------------------------------------------ */

    it("JSONL-only returns { logs: { logFile } } with no traces/metrics", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: { TYPEAGENT_OTEL_LOG_FILE: "/tmp/only.jsonl" },
            });
            expect(cfg).toEqual({
                logs: {
                    logFile: "/tmp/only.jsonl",
                    // Default 500 MiB retention is applied whenever a log
                    // file is configured and nothing overrides it.
                    retentionBytes: 524_288_000,
                },
            });
        });
    });

    /* ------------------------------------------------------------------ */
    /* No process.env mutation                                            */
    /* ------------------------------------------------------------------ */

    it("does not mutate process.env or the caller-supplied env map", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                "telemetry:\n  otlpEndpoint: http://localhost:4318\n",
            );

            // Snapshot every process.env key we might touch and the map we
            // pass in.
            const trackedKeys = [
                "TELEMETRY_OTLPENDPOINT",
                "TELEMETRY_LOGFILE",
                "TELEMETRY_TRACESSAMPLER",
                "TELEMETRY_TRACESSAMPLERARG",
                "OTEL_EXPORTER_OTLP_ENDPOINT",
                "OTEL_EXPORTER_OTLP_HEADERS",
                "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
                "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
                "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
                "OTEL_TRACES_SAMPLER",
                "OTEL_TRACES_SAMPLER_ARG",
                "OTEL_TRACES_EXPORTER",
                "OTEL_METRICS_EXPORTER",
                "OTEL_LOGS_EXPORTER",
                "TYPEAGENT_OTEL_LOG_FILE",
                "TYPEAGENT_OTEL_LOG_RETENTION_BYTES",
            ];
            const before: Record<string, string | undefined> = {};
            for (const k of trackedKeys) {
                before[k] = process.env[k];
            }
            const originalEnvMap = {
                OTEL_EXPORTER_OTLP_ENDPOINT: "http://env.example:4318",
                OTEL_EXPORTER_OTLP_HEADERS: "x=1",
                OTEL_TRACES_SAMPLER: "traceidratio",
                OTEL_TRACES_SAMPLER_ARG: "0.5",
                TYPEAGENT_OTEL_LOG_FILE: "~/log.jsonl",
            } as const;
            const envMapCopy = { ...originalEnvMap };

            resolveTelemetryConfig({
                workspaceRoot: root,
                env: envMapCopy,
            });

            // process.env unchanged.
            for (const k of trackedKeys) {
                expect(process.env[k]).toBe(before[k]);
            }
            // Caller's env map unchanged.
            expect(envMapCopy).toEqual(originalEnvMap);
        });
    });

    /* ------------------------------------------------------------------ */
    /* @typeagent/config layering                                         */
    /* ------------------------------------------------------------------ */

    it("layers defaults + local YAML: local wins per key", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.defaults.yaml",
                [
                    "telemetry:",
                    "  otlpEndpoint: http://defaults.example:4318",
                    "  tracesSampler: always_off",
                    "",
                ].join("\n"),
            );
            writeYaml(
                root,
                "config.local.yaml",
                ["telemetry:", "  tracesSampler: always_on", ""].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://defaults.example:4318/v1/traces",
            );
            expect(cfg.traces?.sampler).toBe("always_on");
        });
    });

    /* ------------------------------------------------------------------ */
    /* Local (Grafana LGTM) sink                                          */
    /* ------------------------------------------------------------------ */

    it("promotes the local sink to primary when only telemetry.local is configured", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  local:",
                    '    enabled: "true"',
                    "    otlpEndpoint: http://localhost:4318",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://localhost:4318/v1/traces",
            );
            expect(cfg.metrics?.otlp?.endpoint).toBe(
                "http://localhost:4318/v1/metrics",
            );
            expect(cfg.logs?.otlp?.endpoint).toBe(
                "http://localhost:4318/v1/logs",
            );
            expect(cfg.traces?.additionalOtlp).toBeUndefined();
            expect(cfg.metrics?.additionalOtlp).toBeUndefined();
            expect(cfg.logs?.additionalOtlp).toBeUndefined();
        });
    });

    it("supplies default local otlpEndpoint / logFile / debugBridge / structuredLogs when enabled", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                ["telemetry:", "  local:", '    enabled: "true"', ""].join(
                    "\n",
                ),
            );
            const cfg = resolve(root);
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://localhost:4318/v1/traces",
            );
            expect(cfg.logs?.logFile).toContain(
                "/.typeagent/logs/{process}-{timestamp}-p{pid}.jsonl",
            );
            expect(cfg.debugBridge).toBe(true);
            expect(cfg.structuredLogs).toBe(true);
        });
    });

    it("keeps the standard backend as primary and adds the local sink as additional when both are configured", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  otlpEndpoint: http://backend.example:4318",
                    "  local:",
                    '    enabled: "true"',
                    "    otlpEndpoint: http://localhost:4318",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://backend.example:4318/v1/traces",
            );
            expect(cfg.traces?.additionalOtlp).toEqual([
                { endpoint: "http://localhost:4318/v1/traces" },
            ]);
            expect(cfg.metrics?.additionalOtlp).toEqual([
                { endpoint: "http://localhost:4318/v1/metrics" },
            ]);
            expect(cfg.logs?.additionalOtlp).toEqual([
                { endpoint: "http://localhost:4318/v1/logs" },
            ]);
        });
    });

    it("deduplicates the local sink when its endpoint matches the standard backend", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  otlpEndpoint: http://localhost:4318",
                    "  local:",
                    '    enabled: "true"',
                    "    otlpEndpoint: http://localhost:4318",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg.traces?.additionalOtlp).toBeUndefined();
            expect(cfg.metrics?.additionalOtlp).toBeUndefined();
            expect(cfg.logs?.additionalOtlp).toBeUndefined();
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://localhost:4318/v1/traces",
            );
        });
    });

    it('has no effect when telemetry.local.enabled is "false"', () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  otlpEndpoint: http://backend.example:4318",
                    "  local:",
                    '    enabled: "false"',
                    "    otlpEndpoint: http://localhost:4318",
                    "    debugBridge: true",
                    "    structuredLogs: true",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg.traces?.otlp?.endpoint).toBe(
                "http://backend.example:4318/v1/traces",
            );
            expect(cfg.traces?.additionalOtlp).toBeUndefined();
            expect(cfg.debugBridge).toBeUndefined();
            expect(cfg.structuredLogs).toBeUndefined();
            expect(cfg.logs?.logFile).toBeUndefined();
        });
    });

    it("has no effect when telemetry.local block is present but enabled is missing", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  local:",
                    "    otlpEndpoint: http://localhost:4318",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg).toEqual({});
        });
    });

    it("does not override an explicit standard debugBridge / structuredLogs setting", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                ["telemetry:", "  local:", '    enabled: "true"', ""].join(
                    "\n",
                ),
            );
            // Environment overrides must win over the local sink's defaults.
            const cfg = resolve(root, {
                env: {
                    TYPEAGENT_OTEL_DEBUG_BRIDGE: "off",
                    TYPEAGENT_OTEL_STRUCTURED_LOGS: "off",
                },
            });
            expect(cfg.debugBridge).toBe(false);
            expect(cfg.structuredLogs).toBe(false);
        });
    });

    it("does not override explicit standard YAML false values", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  debugBridge: false",
                    "  structuredLogs: false",
                    "  local:",
                    '    enabled: "true"',
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg.debugBridge).toBe(false);
            expect(cfg.structuredLogs).toBe(false);
        });
    });

    it("does not override an explicit standard logFile when local is enabled", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  logFile: /tmp/standard.jsonl",
                    "  local:",
                    '    enabled: "true"',
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root);
            expect(cfg.logs?.logFile).toBe("/tmp/standard.jsonl");
        });
    });

    it("OTEL_TRACES_EXPORTER=none disables the entire traces signal even when local is enabled", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  otlpEndpoint: http://backend.example:4318",
                    "  local:",
                    '    enabled: "true"',
                    "    otlpEndpoint: http://localhost:4318",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root, {
                env: { OTEL_TRACES_EXPORTER: "none" },
            });
            expect(cfg.traces).toBeUndefined();
            expect(cfg.metrics?.otlp?.endpoint).toBe(
                "http://backend.example:4318/v1/metrics",
            );
            expect(cfg.metrics?.additionalOtlp).toEqual([
                { endpoint: "http://localhost:4318/v1/metrics" },
            ]);
        });
    });

    it("rejects an unrecognized telemetry.local.enabled value", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                ["telemetry:", "  local:", "    enabled: sometimes", ""].join(
                    "\n",
                ),
            );
            expect(() => resolve(root)).toThrow(
                /telemetry.local.enabled.*expected true\/false/,
            );
        });
    });

    /* ------------------------------------------------------------------ */
    /* Log retention                                                      */
    /* ------------------------------------------------------------------ */

    it("does not set retentionBytes when no log file is configured", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                "telemetry:\n  otlpEndpoint: http://localhost:4318\n",
            );
            const cfg = resolve(root);
            expect(cfg.logs?.logFile).toBeUndefined();
            expect(cfg.logs?.retentionBytes).toBeUndefined();
        });
    });

    it("applies the 500 MiB default retention when a log file is configured", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: { TYPEAGENT_OTEL_LOG_FILE: "/tmp/a.jsonl" },
            });
            expect(cfg.logs?.retentionBytes).toBe(524_288_000);
        });
    });

    it("YAML telemetry.logRetentionBytes overrides the default", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  logFile: /tmp/a.jsonl",
                    "  logRetentionBytes: 1048576",
                    "",
                ].join("\n"),
            );
            expect(resolve(root).logs?.retentionBytes).toBe(1_048_576);
        });
    });

    it("env TYPEAGENT_OTEL_LOG_RETENTION_BYTES overrides YAML", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  logFile: /tmp/a.jsonl",
                    "  logRetentionBytes: 1048576",
                    "",
                ].join("\n"),
            );
            const cfg = resolve(root, {
                env: { TYPEAGENT_OTEL_LOG_RETENTION_BYTES: "42" },
            });
            expect(cfg.logs?.retentionBytes).toBe(42);
        });
    });

    it("telemetry.local.logRetentionBytes supplies a default only when local is enabled", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  local:",
                    '    enabled: "true"',
                    "    otlpEndpoint: http://localhost:4318",
                    "    logRetentionBytes: 200",
                    "",
                ].join("\n"),
            );
            expect(resolve(root).logs?.retentionBytes).toBe(200);
        });
    });

    it("telemetry.logRetentionBytes wins over telemetry.local.logRetentionBytes", () => {
        withTempWorkspace((root) => {
            writeYaml(
                root,
                "config.local.yaml",
                [
                    "telemetry:",
                    "  logFile: /tmp/a.jsonl",
                    "  logRetentionBytes: 300",
                    "  local:",
                    '    enabled: "true"',
                    "    otlpEndpoint: http://localhost:4318",
                    "    logRetentionBytes: 200",
                    "",
                ].join("\n"),
            );
            expect(resolve(root).logs?.retentionBytes).toBe(300);
        });
    });

    it("accepts 0 as an explicit 'cleanup disabled' value", () => {
        withTempWorkspace((root) => {
            const cfg = resolve(root, {
                env: {
                    TYPEAGENT_OTEL_LOG_FILE: "/tmp/a.jsonl",
                    TYPEAGENT_OTEL_LOG_RETENTION_BYTES: "0",
                },
            });
            expect(cfg.logs?.retentionBytes).toBe(0);
        });
    });

    it("rejects a negative retention value", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        TYPEAGENT_OTEL_LOG_FILE: "/tmp/a.jsonl",
                        TYPEAGENT_OTEL_LOG_RETENTION_BYTES: "-1",
                    },
                }),
            ).toThrow(
                /TYPEAGENT_OTEL_LOG_RETENTION_BYTES.*non-negative integer/,
            );
        });
    });

    it("rejects a non-integer retention value", () => {
        withTempWorkspace((root) => {
            expect(() =>
                resolve(root, {
                    env: {
                        TYPEAGENT_OTEL_LOG_FILE: "/tmp/a.jsonl",
                        TYPEAGENT_OTEL_LOG_RETENTION_BYTES: "1.5",
                    },
                }),
            ).toThrow(
                /TYPEAGENT_OTEL_LOG_RETENTION_BYTES.*non-negative integer/,
            );
        });
    });

    it("rejects an out-of-range retention value", () => {
        withTempWorkspace((root) => {
            // 2^53 exceeds Number.MAX_SAFE_INTEGER (2^53 - 1).
            expect(() =>
                resolve(root, {
                    env: {
                        TYPEAGENT_OTEL_LOG_FILE: "/tmp/a.jsonl",
                        TYPEAGENT_OTEL_LOG_RETENTION_BYTES: "9007199254740992",
                    },
                }),
            ).toThrow(/TYPEAGENT_OTEL_LOG_RETENTION_BYTES.*out of range/);
        });
    });

    it("does not mutate the caller's env for retention overrides", () => {
        withTempWorkspace((root) => {
            const originalEnv = {
                TYPEAGENT_OTEL_LOG_FILE: "/tmp/a.jsonl",
                TYPEAGENT_OTEL_LOG_RETENTION_BYTES: "42",
            };
            const env = { ...originalEnv };
            resolveTelemetryConfig({ workspaceRoot: root, env });
            expect(env).toEqual(originalEnv);
        });
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    metrics,
    propagation,
    trace,
    type AttributeValue,
    type MeterProvider as ApiMeterProvider,
    type TracerProvider,
} from "@opentelemetry/api";
import {
    logs,
    type LoggerProvider as ApiLoggerProvider,
} from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
    CompositePropagator,
    W3CBaggagePropagator,
    W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { Resource } from "@opentelemetry/resources";
import {
    BatchLogRecordProcessor,
    LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
    MeterProvider,
    PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
    AlwaysOffSampler,
    AlwaysOnSampler,
    BatchSpanProcessor,
    NodeTracerProvider,
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
    type Sampler,
} from "@opentelemetry/sdk-trace-node";

import {
    resolveTelemetryConfig,
    type LogConfig,
    type MetricConfig,
    type ResolveTelemetryConfigOptions,
    type TelemetryConfig,
    type TraceConfig,
    type TraceSampler,
} from "./config.js";
import {
    createTelemetryLifecycle,
    TelemetryShutdownTimeoutError,
    type TelemetryLifecycle,
    type TelemetryLifecycleOptions,
} from "./lifecycle.js";
import { createProcessResource } from "./resources.js";

export type TelemetrySignal = "traces" | "metrics" | "logs";

export interface TelemetryProvider {
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
}

export interface TelemetryOwnedComponent {
    readonly name: string;
    forceFlush?(): void | Promise<void>;
    shutdown(): void | Promise<void>;
}

export interface TelemetryProviderBundle<TProvider> {
    readonly provider: TProvider;
    /**
     * Components not shut down by the provider itself, such as a custom JSONL
     * writer. The provider flushes into them before they are shut down.
     */
    readonly components?: readonly TelemetryOwnedComponent[];
}

export interface TelemetryProviderFactories {
    createTraceProvider(
        config: TraceConfig,
        resource: Resource,
    ):
        | TelemetryProviderBundle<TracerProvider & TelemetryProvider>
        | Promise<TelemetryProviderBundle<TracerProvider & TelemetryProvider>>;
    createMetricProvider(
        config: MetricConfig,
        resource: Resource,
    ):
        | TelemetryProviderBundle<ApiMeterProvider & TelemetryProvider>
        | Promise<
              TelemetryProviderBundle<ApiMeterProvider & TelemetryProvider>
          >;
    createLogProvider(
        config: LogConfig,
        resource: Resource,
    ):
        | TelemetryProviderBundle<ApiLoggerProvider & TelemetryProvider>
        | Promise<
              TelemetryProviderBundle<ApiLoggerProvider & TelemetryProvider>
          >;
}

export interface InitTelemetryOptions {
    /** Effective configuration. When omitted, it is resolved once on init. */
    readonly config?: TelemetryConfig;
    /** Configuration resolver options used only when `config` is omitted. */
    readonly configOptions?: ResolveTelemetryConfigOptions;
    /** Shared resource supplied to every requested signal provider. */
    readonly resource?: Resource;
    readonly serviceName?: string;
    readonly serviceVersion?: string;
    readonly serviceInstanceId?: string;
    readonly deploymentEnvironment?: string;
    readonly resourceAttributes?: Readonly<Record<string, AttributeValue>>;
    /** Provider factories for tests or host-specific pipelines. */
    readonly factories?: Partial<TelemetryProviderFactories>;
    readonly lifecycle?: TelemetryLifecycleOptions;
}

export interface TelemetryCoordinator {
    init(options?: InitTelemetryOptions): Promise<void>;
    shutdown(): Promise<void>;
}

interface InstalledGlobals {
    traces: boolean;
    metrics: boolean;
    logs: boolean;
    context: boolean;
    propagation: boolean;
}

export class TelemetryProviderOwnershipError extends Error {
    constructor(signal: TelemetrySignal) {
        super(
            `Cannot initialize OpenTelemetry ${signal}: another owner has already installed the global provider.`,
        );
        this.name = "TelemetryProviderOwnershipError";
    }
}

const DEFAULT_FACTORIES: TelemetryProviderFactories = {
    createTraceProvider(config, resource) {
        const spanProcessors =
            config.otlp === undefined
                ? []
                : [
                      new BatchSpanProcessor(
                          new OTLPTraceExporter(toExporterOptions(config.otlp)),
                      ),
                  ];
        const provider = new NodeTracerProvider({
            resource,
            sampler: createSampler(config.sampler, config.samplerArg),
            spanProcessors,
        });
        return { provider };
    },

    createMetricProvider(config, resource) {
        const readers =
            config.otlp === undefined
                ? []
                : [
                      new PeriodicExportingMetricReader({
                          exporter: new OTLPMetricExporter(
                              toExporterOptions(config.otlp),
                          ),
                      }),
                  ];
        return {
            provider: new MeterProvider({
                resource,
                readers,
            }),
        };
    },

    createLogProvider(config, resource) {
        if (config.logFile !== undefined) {
            throw new Error(
                "Local OpenTelemetry JSONL output is not implemented by the default log provider. Supply a createLogProvider factory with a writer component.",
            );
        }
        const processors =
            config.otlp === undefined
                ? []
                : [
                      new BatchLogRecordProcessor({
                          exporter: new OTLPLogExporter(
                              toExporterOptions(config.otlp),
                          ),
                      }),
                  ];
        return {
            provider: new LoggerProvider({ resource, processors }),
        };
    },
};

export function createTelemetryCoordinator(): TelemetryCoordinator {
    let initPromise: Promise<void> | undefined;
    let shutdownPromise: Promise<void> | undefined;
    let lifecycle: TelemetryLifecycle | undefined;
    let shutdownRequested = false;
    let shutdownTimeoutMs = 10_000;
    const installedGlobals = {
        traces: false,
        metrics: false,
        logs: false,
        context: false,
        propagation: false,
    };

    async function initialize(options: InitTelemetryOptions): Promise<void> {
        if (shutdownRequested) {
            return;
        }
        const config =
            options.config ?? resolveTelemetryConfig(options.configOptions);
        if (!isConfigured(config)) {
            return;
        }

        lifecycle = createTelemetryLifecycle(options.lifecycle);
        const resource =
            options.resource ??
            createProcessResource({
                serviceName:
                    options.serviceName ??
                    (options.configOptions?.env ?? process.env)
                        .OTEL_SERVICE_NAME ??
                    "typeagent",
                ...(options.serviceVersion === undefined
                    ? {}
                    : { serviceVersion: options.serviceVersion }),
                ...(options.serviceInstanceId === undefined
                    ? {}
                    : { serviceInstanceId: options.serviceInstanceId }),
                ...(options.deploymentEnvironment === undefined
                    ? {}
                    : {
                          deploymentEnvironment: options.deploymentEnvironment,
                      }),
                ...(options.resourceAttributes === undefined
                    ? {}
                    : { attributes: options.resourceAttributes }),
            });
        const factories = {
            ...DEFAULT_FACTORIES,
            ...options.factories,
        };

        try {
            if (config.traces !== undefined) {
                const bundle = await factories.createTraceProvider(
                    config.traces,
                    resource,
                );
                if (shutdownRequested) {
                    await disposeBundle("traces", bundle, options.lifecycle);
                    return;
                }
                retainBundle(lifecycle, "traces", bundle);
                registerTraceProvider(bundle.provider, installedGlobals);
            }
            if (config.metrics !== undefined) {
                const bundle = await factories.createMetricProvider(
                    config.metrics,
                    resource,
                );
                if (shutdownRequested) {
                    await disposeBundle("metrics", bundle, options.lifecycle);
                    return;
                }
                retainBundle(lifecycle, "metrics", bundle);
                registerMetricProvider(bundle.provider);
                installedGlobals.metrics = true;
            }
            if (config.logs !== undefined) {
                const bundle = await factories.createLogProvider(
                    config.logs,
                    resource,
                );
                if (shutdownRequested) {
                    await disposeBundle("logs", bundle, options.lifecycle);
                    return;
                }
                retainBundle(lifecycle, "logs", bundle);
                registerLogProvider(bundle.provider);
                installedGlobals.logs = true;
            }
        } catch (error) {
            rollbackGlobals(installedGlobals);
            try {
                await lifecycle.shutdown();
            } catch (shutdownError) {
                throw new AggregateError(
                    [error, shutdownError],
                    "Telemetry initialization failed and created components did not shut down cleanly.",
                );
            }
            throw error;
        }
    }

    return {
        init(options: InitTelemetryOptions = {}): Promise<void> {
            if (initPromise === undefined) {
                shutdownTimeoutMs = options.lifecycle?.totalTimeoutMs ?? 10_000;
                initPromise = shutdownRequested
                    ? Promise.resolve()
                    : initialize(options);
            }
            return initPromise;
        },

        shutdown(): Promise<void> {
            shutdownRequested = true;
            if (initPromise === undefined) {
                shutdownPromise ??= Promise.resolve();
                return shutdownPromise;
            }
            const lifecycleShutdown =
                lifecycle?.shutdown() ?? Promise.resolve();
            shutdownPromise ??= waitForInitializationAndLifecycle(
                withTimeout(
                    initPromise.catch(() => undefined),
                    shutdownTimeoutMs,
                ),
                lifecycleShutdown,
            );
            return shutdownPromise;
        },
    };
}

const processTelemetry = createTelemetryCoordinator();

export function initTelemetry(
    options: InitTelemetryOptions = {},
): Promise<void> {
    return processTelemetry.init(options);
}

export function shutdownTelemetry(): Promise<void> {
    return processTelemetry.shutdown();
}

function isConfigured(config: TelemetryConfig): boolean {
    return (
        config.traces !== undefined ||
        config.metrics !== undefined ||
        config.logs !== undefined
    );
}

function retainBundle<TProvider extends TelemetryProvider>(
    lifecycle: TelemetryLifecycle,
    signal: TelemetrySignal,
    bundle: TelemetryProviderBundle<TProvider>,
): void {
    lifecycle.register(`${signal} provider shutdown`, () =>
        bundle.provider.shutdown(),
    );
    for (const component of bundle.components ?? []) {
        lifecycle.register(`${component.name} shutdown`, () =>
            component.shutdown(),
        );
        if (component.forceFlush !== undefined) {
            lifecycle.register(`${component.name} flush`, () =>
                component.forceFlush?.(),
            );
        }
    }
    lifecycle.register(`${signal} provider flush`, () =>
        bundle.provider.forceFlush(),
    );
}

async function disposeBundle<TProvider extends TelemetryProvider>(
    signal: TelemetrySignal,
    bundle: TelemetryProviderBundle<TProvider>,
    lifecycleOptions: TelemetryLifecycleOptions | undefined,
): Promise<void> {
    const lifecycle = createTelemetryLifecycle(lifecycleOptions);
    retainBundle(lifecycle, signal, bundle);
    await lifecycle.shutdown();
}

function registerTraceProvider(
    provider: TracerProvider & TelemetryProvider,
    installedGlobals: InstalledGlobals,
): void {
    if (!trace.setGlobalTracerProvider(provider)) {
        throw new TelemetryProviderOwnershipError("traces");
    }
    installedGlobals.traces = true;
    const contextManager = new AsyncLocalStorageContextManager();
    if (!context.setGlobalContextManager(contextManager.enable())) {
        rollbackGlobals(installedGlobals);
        throw new Error(
            "Cannot initialize OpenTelemetry traces: another owner has already installed the global context manager.",
        );
    }
    installedGlobals.context = true;
    if (
        !propagation.setGlobalPropagator(
            new CompositePropagator({
                propagators: [
                    new W3CTraceContextPropagator(),
                    new W3CBaggagePropagator(),
                ],
            }),
        )
    ) {
        rollbackGlobals(installedGlobals);
        throw new Error(
            "Cannot initialize OpenTelemetry traces: another owner has already installed the global propagator.",
        );
    }
    installedGlobals.propagation = true;
}

function registerMetricProvider(
    provider: ApiMeterProvider & TelemetryProvider,
): void {
    if (!metrics.setGlobalMeterProvider(provider)) {
        throw new TelemetryProviderOwnershipError("metrics");
    }
}

function registerLogProvider(
    provider: ApiLoggerProvider & TelemetryProvider,
): void {
    if (logs.setGlobalLoggerProvider(provider) !== provider) {
        throw new TelemetryProviderOwnershipError("logs");
    }
}

function rollbackGlobals(installedGlobals: InstalledGlobals): void {
    if (installedGlobals.logs) {
        logs.disable();
        installedGlobals.logs = false;
    }
    if (installedGlobals.metrics) {
        metrics.disable();
        installedGlobals.metrics = false;
    }
    if (installedGlobals.propagation) {
        propagation.disable();
        installedGlobals.propagation = false;
    }
    if (installedGlobals.context) {
        context.disable();
        installedGlobals.context = false;
    }
    if (installedGlobals.traces) {
        trace.disable();
        installedGlobals.traces = false;
    }
}

async function withTimeout(
    operation: Promise<void>,
    timeoutMs: number,
): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(
                        new TelemetryShutdownTimeoutError(
                            "telemetry initialization and shutdown",
                            timeoutMs,
                        ),
                    );
                }, timeoutMs);
                timeout.unref();
            }),
        ]);
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }
}

async function waitForInitializationAndLifecycle(
    initialization: Promise<void>,
    lifecycleShutdown: Promise<void>,
): Promise<void> {
    const results = await Promise.allSettled([
        initialization,
        lifecycleShutdown,
    ]);
    const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length === 1) {
        throw failures[0];
    }
    if (failures.length > 1) {
        throw new AggregateError(
            failures,
            "Telemetry initialization wait and lifecycle shutdown failed.",
        );
    }
}

function toExporterOptions(config: {
    readonly endpoint: string;
    readonly headers?: Readonly<Record<string, string>>;
}): { url: string; headers?: Record<string, string> } {
    return {
        url: config.endpoint,
        ...(config.headers === undefined
            ? {}
            : { headers: { ...config.headers } }),
    };
}

function createSampler(
    sampler: TraceSampler | undefined,
    samplerArg: number | undefined,
): Sampler {
    switch (sampler) {
        case "always_off":
            return new AlwaysOffSampler();
        case "traceidratio":
            return new TraceIdRatioBasedSampler(samplerArg);
        case "parentbased_always_off":
            return new ParentBasedSampler({
                root: new AlwaysOffSampler(),
            });
        case "parentbased_traceidratio":
            return new ParentBasedSampler({
                root: new TraceIdRatioBasedSampler(samplerArg),
            });
        case "parentbased_always_on":
            return new ParentBasedSampler({
                root: new AlwaysOnSampler(),
            });
        case "always_on":
        default:
            return new AlwaysOnSampler();
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import {
    resourceFromAttributes,
    type Resource,
} from "@opentelemetry/resources";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import {
    createTelemetryCoordinator,
    TelemetryProviderOwnershipError,
    type TelemetryCoordinator,
    type TelemetryOwnedComponent,
    type TelemetryProvider,
} from "../src/otel/bootstrap.js";

const OTLP = { endpoint: "http://localhost:4318/v1/test" };

class TestTraceProvider
    extends NodeTracerProvider
    implements TelemetryProvider
{
    public readonly calls: string[] = [];

    public override async forceFlush(): Promise<void> {
        this.calls.push("flush traces");
    }

    public override async shutdown(): Promise<void> {
        this.calls.push("shutdown traces");
    }
}

class TestMetricProvider extends MeterProvider implements TelemetryProvider {
    public readonly calls: string[] = [];

    public override async forceFlush(): Promise<void> {
        this.calls.push("flush metrics");
    }

    public override async shutdown(): Promise<void> {
        this.calls.push("shutdown metrics");
    }
}

class TestLogProvider extends LoggerProvider implements TelemetryProvider {
    public readonly calls: string[] = [];

    public override async forceFlush(): Promise<void> {
        this.calls.push("flush logs");
    }

    public override async shutdown(): Promise<void> {
        this.calls.push("shutdown logs");
    }
}

describe("telemetry bootstrap", () => {
    const coordinators: TelemetryCoordinator[] = [];

    function createCoordinator(): TelemetryCoordinator {
        const coordinator = createTelemetryCoordinator();
        coordinators.push(coordinator);
        return coordinator;
    }

    afterEach(async () => {
        await Promise.allSettled(
            coordinators.splice(0).map((coordinator) => coordinator.shutdown()),
        );
        trace.disable();
        metrics.disable();
        logs.disable();
        context.disable();
        propagation.disable();
    });

    it("is an idempotent no-op when unconfigured", async () => {
        const coordinator = createCoordinator();
        let configReads = 0;
        const options = {
            get config() {
                configReads++;
                return {};
            },
            factories: {
                createTraceProvider() {
                    throw new Error("trace factory should not run");
                },
                createMetricProvider() {
                    throw new Error("metric factory should not run");
                },
                createLogProvider() {
                    throw new Error("log factory should not run");
                },
            },
        };

        const first = coordinator.init(options);
        const second = coordinator.init({
            config: { traces: { otlp: OTLP } },
        });

        expect(first).toBe(second);
        await first;
        await coordinator.shutdown();
        await coordinator.shutdown();

        expect(configReads).toBe(1);
    });

    it("creates only requested signals and shares one resource", async () => {
        const coordinator = createCoordinator();
        const resources: Resource[] = [];
        const traceProvider = new TestTraceProvider();
        const logProvider = new TestLogProvider();
        let metricFactoryCalls = 0;

        await coordinator.init({
            config: {
                traces: { otlp: OTLP },
                logs: { logFile: "telemetry.jsonl" },
            },
            serviceName: "bootstrap-test",
            serviceVersion: "1.2.3",
            serviceInstanceId: "bootstrap-instance",
            deploymentEnvironment: "test",
            factories: {
                createTraceProvider(_config, resource) {
                    resources.push(resource);
                    return { provider: traceProvider };
                },
                createMetricProvider() {
                    metricFactoryCalls++;
                    return { provider: new TestMetricProvider() };
                },
                createLogProvider(_config, resource) {
                    resources.push(resource);
                    return { provider: logProvider };
                },
            },
        });

        expect(metricFactoryCalls).toBe(0);
        expect(resources).toHaveLength(2);
        expect(resources[0]).toBe(resources[1]);
        expect(resources[0].attributes["service.name"]).toBe("bootstrap-test");
        expect(resources[0].attributes["service.version"]).toBe("1.2.3");
        expect(resources[0].attributes["service.instance.id"]).toBe(
            "bootstrap-instance",
        );
        expect(resources[0].attributes["deployment.environment.name"]).toBe(
            "test",
        );
        expect(resources[0].attributes["host.name"]).toBeDefined();
        expect(resources[0].attributes["process.pid"]).toBe(process.pid);
        expect(resources[0].attributes["process.runtime.name"]).toBe("nodejs");
        expect(resources[0].attributes["process.runtime.version"]).toBe(
            process.versions.node,
        );
        expect(logs.getLoggerProvider()).toBe(logProvider);
    });

    it("flushes and shuts down each provider and custom writer once", async () => {
        const coordinator = createCoordinator();
        const calls: string[] = [];
        const traceProvider = new TestTraceProvider();
        const metricProvider = new TestMetricProvider();
        const logProvider = new (class extends TestLogProvider {
            public override async forceFlush(): Promise<void> {
                calls.push("flush logs");
                await super.forceFlush();
            }

            public override async shutdown(): Promise<void> {
                calls.push("shutdown logs");
                await super.shutdown();
            }
        })();
        const writer: TelemetryOwnedComponent = {
            name: "JSONL writer",
            forceFlush() {
                calls.push("flush writer");
            },
            shutdown() {
                calls.push("shutdown writer");
            },
        };

        await coordinator.init({
            config: {
                traces: { otlp: OTLP },
                metrics: { otlp: OTLP },
                logs: { logFile: "telemetry.jsonl" },
            },
            resource: resourceFromAttributes({}),
            factories: {
                createTraceProvider() {
                    return { provider: traceProvider };
                },
                createMetricProvider() {
                    return { provider: metricProvider };
                },
                createLogProvider() {
                    return { provider: logProvider, components: [writer] };
                },
            },
        });

        const first = coordinator.shutdown();
        const second = coordinator.shutdown();
        expect(first).toBe(second);
        await first;

        expect(traceProvider.calls).toEqual([
            "flush traces",
            "shutdown traces",
        ]);
        expect(metricProvider.calls).toEqual([
            "flush metrics",
            "shutdown metrics",
        ]);
        expect(logProvider.calls).toEqual(["flush logs", "shutdown logs"]);
        expect(calls).toEqual([
            "flush logs",
            "flush writer",
            "shutdown writer",
            "shutdown logs",
        ]);
    });

    it("refuses to replace a provider installed by another owner", async () => {
        const externalProvider = new MeterProvider();
        expect(metrics.setGlobalMeterProvider(externalProvider)).toBe(true);
        const coordinator = createCoordinator();
        const ownedProvider = new TestMetricProvider();

        await expect(
            coordinator.init({
                config: { metrics: { otlp: OTLP } },
                resource: resourceFromAttributes({}),
                factories: {
                    createMetricProvider() {
                        return { provider: ownedProvider };
                    },
                },
            }),
        ).rejects.toBeInstanceOf(TelemetryProviderOwnershipError);

        expect(metrics.getMeterProvider()).toBe(externalProvider);
        expect(ownedProvider.calls).toEqual([
            "flush metrics",
            "shutdown metrics",
        ]);
        await externalProvider.shutdown();
    });

    it("is safe to shut down before initialization", async () => {
        const coordinator = createCoordinator();
        let factoryCalls = 0;

        await coordinator.shutdown();
        await coordinator.init({
            config: { traces: { otlp: OTLP } },
            factories: {
                createTraceProvider() {
                    factoryCalls++;
                    return { provider: new TestTraceProvider() };
                },
            },
        });
        await coordinator.shutdown();

        expect(factoryCalls).toBe(0);
    });

    it("bounds shutdown of a hung custom component", async () => {
        const coordinator = createCoordinator();
        let writerShutdown = false;
        const writer: TelemetryOwnedComponent = {
            name: "hung JSONL writer",
            forceFlush: () => new Promise<void>(() => undefined),
            shutdown() {
                writerShutdown = true;
            },
        };

        await coordinator.init({
            config: { logs: { logFile: "telemetry.jsonl" } },
            resource: resourceFromAttributes({}),
            lifecycle: {
                totalTimeoutMs: 100,
                componentTimeoutMs: 10,
            },
            factories: {
                createLogProvider() {
                    return {
                        provider: new TestLogProvider(),
                        components: [writer],
                    };
                },
            },
        });

        await expect(coordinator.shutdown()).rejects.toThrow(AggregateError);
        expect(writerShutdown).toBe(true);
    });

    it("rolls back globals when a later signal conflicts", async () => {
        const externalMetricProvider = new MeterProvider();
        expect(metrics.setGlobalMeterProvider(externalMetricProvider)).toBe(
            true,
        );
        const coordinator = createCoordinator();
        const traceProvider = new TestTraceProvider();

        await expect(
            coordinator.init({
                config: {
                    traces: { otlp: OTLP },
                    metrics: { otlp: OTLP },
                },
                resource: resourceFromAttributes({}),
                factories: {
                    createTraceProvider() {
                        return { provider: traceProvider };
                    },
                    createMetricProvider() {
                        return { provider: new TestMetricProvider() };
                    },
                },
            }),
        ).rejects.toBeInstanceOf(TelemetryProviderOwnershipError);

        const replacement = new TestTraceProvider();
        expect(trace.setGlobalTracerProvider(replacement)).toBe(true);
        expect(traceProvider.calls).toEqual([
            "flush traces",
            "shutdown traces",
        ]);
        await replacement.shutdown();
        await externalMetricProvider.shutdown();
    });

    it("bounds shutdown while an async factory is stalled", async () => {
        const coordinator = createCoordinator();
        void coordinator.init({
            config: { traces: { otlp: OTLP } },
            lifecycle: {
                totalTimeoutMs: 20,
                componentTimeoutMs: 10,
            },
            factories: {
                createTraceProvider: () =>
                    new Promise(() => {
                        // Simulate a factory that never completes.
                    }),
            },
        });

        await expect(coordinator.shutdown()).rejects.toThrow(
            /did not shut down within 20 ms/,
        );
    });

    it("cleans created providers while a later factory is stalled", async () => {
        const coordinator = createCoordinator();
        const traceProvider = new TestTraceProvider();
        void coordinator.init({
            config: {
                traces: { otlp: OTLP },
                metrics: { otlp: OTLP },
            },
            lifecycle: {
                totalTimeoutMs: 20,
                componentTimeoutMs: 10,
            },
            resource: resourceFromAttributes({}),
            factories: {
                createTraceProvider() {
                    return { provider: traceProvider };
                },
                createMetricProvider: () =>
                    new Promise(() => {
                        // Simulate a later factory that never completes.
                    }),
            },
        });
        await Promise.resolve();

        await expect(coordinator.shutdown()).rejects.toThrow(
            /did not shut down within 20 ms/,
        );
        expect(traceProvider.calls).toEqual([
            "flush traces",
            "shutdown traces",
        ]);
    });

    it("uses an injected environment without ambient fallback", async () => {
        const coordinator = createCoordinator();
        let resource: Resource | undefined;
        const originalServiceName = process.env.OTEL_SERVICE_NAME;
        process.env.OTEL_SERVICE_NAME = "ambient-service";

        try {
            await coordinator.init({
                config: { traces: { otlp: OTLP } },
                configOptions: { env: {} },
                factories: {
                    createTraceProvider(_config, providerResource) {
                        resource = providerResource;
                        return { provider: new TestTraceProvider() };
                    },
                },
            });
        } finally {
            if (originalServiceName === undefined) {
                delete process.env.OTEL_SERVICE_NAME;
            } else {
                process.env.OTEL_SERVICE_NAME = originalServiceName;
            }
        }

        expect(resource?.attributes["service.name"]).toBe("typeagent");
    });

    it("rejects the unsupported default JSONL writer path", async () => {
        const coordinator = createCoordinator();

        await expect(
            coordinator.init({
                config: { logs: { logFile: "telemetry.jsonl" } },
                resource: resourceFromAttributes({}),
            }),
        ).rejects.toThrow(/JSONL output is not implemented/);
    });

    it("refuses trace and log providers installed by other owners", async () => {
        const externalTraceProvider = new TestTraceProvider();
        const externalLogProvider = new TestLogProvider();
        expect(trace.setGlobalTracerProvider(externalTraceProvider)).toBe(true);
        expect(logs.setGlobalLoggerProvider(externalLogProvider)).toBe(
            externalLogProvider,
        );

        const traceCoordinator = createCoordinator();
        await expect(
            traceCoordinator.init({
                config: { traces: { otlp: OTLP } },
                resource: resourceFromAttributes({}),
                factories: {
                    createTraceProvider() {
                        return { provider: new TestTraceProvider() };
                    },
                },
            }),
        ).rejects.toBeInstanceOf(TelemetryProviderOwnershipError);

        const logCoordinator = createCoordinator();
        await expect(
            logCoordinator.init({
                config: { logs: { otlp: OTLP } },
                resource: resourceFromAttributes({}),
                factories: {
                    createLogProvider() {
                        return { provider: new TestLogProvider() };
                    },
                },
            }),
        ).rejects.toBeInstanceOf(TelemetryProviderOwnershipError);

        expect(logs.getLoggerProvider()).toBe(externalLogProvider);
        await externalTraceProvider.shutdown();
        await externalLogProvider.shutdown();
    });
});

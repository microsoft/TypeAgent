// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { context, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ExportResultCode } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
    InMemoryLogRecordExporter,
    LoggerProvider,
    SimpleLogRecordProcessor,
    type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import registerDebug from "debug";

import { createOtelLoggerSink } from "../src/logger/otelLoggerSink.js";
import { installDebugBridge } from "../src/otel/debugBridge.js";
import type { DebugModule } from "../src/otel/debugBridge.js";
import {
    JsonlLogExporter,
    resolveJsonlLogPath,
} from "../src/otel/jsonlLogExporter.js";
import {
    createLocalTelemetryState,
    setLocalTelemetryState,
} from "../src/otel/localTelemetryState.js";
import { LocalLogRecordProcessor } from "../src/otel/localLogRecordProcessor.js";

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-otel-local-"));
}

function createRecord(body: string, eventName?: string): ReadableLogRecord {
    return {
        hrTime: [1_700_000_000, 0],
        hrTimeObserved: [1_700_000_001, 0],
        severityText: "INFO",
        body,
        ...(eventName === undefined ? {} : { eventName }),
        resource: resourceFromAttributes({ "service.name": "test" }),
        instrumentationScope: { name: "test", version: "1" },
        attributes: {},
        droppedAttributesCount: 0,
    };
}

function exportRecords(
    exporter: JsonlLogExporter,
    records: ReadableLogRecord[],
): Promise<ExportResultCode> {
    return new Promise((resolve) => {
        exporter.export(records, (result) => resolve(result.code));
    });
}

function createDebugModule(
    output: Array<{ namespace: string | undefined; args: unknown[] }>,
): DebugModule {
    return {
        log(this: { namespace?: string }, ...args: unknown[]): void {
            output.push({ namespace: this?.namespace, args });
        },
    };
}

describe("JsonlLogExporter", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        setLocalTelemetryState(undefined);
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("resolves a sanitized per-process path", () => {
        const resolved = resolveJsonlLogPath(
            path.join("logs", "typeagent-{service}.jsonl"),
            "agent/server",
            1234,
            "agent-player",
            new Date("2026-08-17T08:38:59.123Z"),
        );
        expect(resolved).toBe(
            path.resolve(
                "logs",
                "typeagent-agent_server-agent-player-20260817T083859Z-1234.jsonl",
            ),
        );
    });

    it("adds the process role to legacy templates containing only a pid", () => {
        const resolved = resolveJsonlLogPath(
            path.join("logs", "typeagent-{service}-{pid}.jsonl"),
            "typeagent-local",
            1234,
            "agent-server",
            new Date("2026-08-17T08:38:59.123Z"),
        );
        expect(resolved).toBe(
            path.resolve(
                "logs",
                "typeagent-typeagent-local-agent-server-20260817T083859Z-1234.jsonl",
            ),
        );
    });

    it("supports the process-first default template", () => {
        const resolved = resolveJsonlLogPath(
            path.join("logs", "{process}-{timestamp}-p{pid}.jsonl"),
            "typeagent-local",
            1234,
            "agent-server",
            new Date("2026-08-17T08:38:59.123Z"),
        );
        expect(resolved).toBe(
            path.resolve("logs", "agent-server-20260817T083859Z-p1234.jsonl"),
        );
    });

    it("writes independently valid JSON lines in accepted order", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        const exporter = new JsonlLogExporter({
            filePath: path.join(dir, "logs-{pid}.jsonl"),
            serviceName: "test",
            pid: 1001,
            diagnostic: () => undefined,
        });

        expect(
            await exportRecords(exporter, [
                createRecord("first"),
                createRecord("second"),
            ]),
        ).toBe(ExportResultCode.SUCCESS);
        await exporter.shutdown();

        const lines = fs
            .readFileSync(exporter.filePath, "utf8")
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line) as { body: string });
        expect(lines.map((line) => line.body)).toEqual(["first", "second"]);
    });

    it("writes the reduced local envelope", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        const exporter = new JsonlLogExporter({
            filePath: path.join(dir, "compact-{pid}.jsonl"),
            serviceName: "test",
            pid: 1008,
            diagnostic: () => undefined,
        });
        const record: ReadableLogRecord = {
            ...createRecord("compact", "dispatcher:request:completed"),
            body: {
                message: "Request completed: handled",
                status: "handled",
            },
            attributes: {
                "typeagent.session.id": "session",
                "typeagent.activation.id": "activation",
                "typeagent.request.id": "request",
                "typeagent.trace.id": "legacy-trace",
                custom: "value",
            },
            spanContext: {
                traceId: "1".repeat(32),
                spanId: "2".repeat(16),
                traceFlags: 1,
            },
        };

        await exportRecords(exporter, [record]);
        await exporter.shutdown();

        const parsed = JSON.parse(
            fs.readFileSync(exporter.filePath, "utf8").trimEnd(),
        );
        expect(parsed).toEqual({
            timestamp: "2023-11-14T22:13:20.000Z",
            severity: "INFO",
            event: "dispatcher:request:completed",
            sessionId: "session",
            activationId: "activation",
            requestId: "request",
            correlationId: "legacy-trace",
            traceId: "1".repeat(32),
            spanId: "2".repeat(16),
            message: "Request completed: handled",
            body: { status: "handled" },
            attributes: { custom: "value" },
        });
        expect(parsed).not.toHaveProperty("observedTimestamp");
        expect(parsed).not.toHaveProperty("resource");
        expect(parsed).not.toHaveProperty("instrumentationScope");
        expect(parsed).not.toHaveProperty("severityNumber");
        expect(parsed).not.toHaveProperty("traceFlags");
        expect(parsed).not.toHaveProperty("droppedAttributesCount");
    });

    it("preserves legacy correlation without an active span", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        const exporter = new JsonlLogExporter({
            filePath: path.join(dir, "correlation-{pid}.jsonl"),
            serviceName: "test",
            pid: 1009,
            diagnostic: () => undefined,
        });
        const record: ReadableLogRecord = {
            ...createRecord("logs only", "custom:event"),
            attributes: {
                "typeagent.trace.id": "legacy-trace",
            },
        };

        await exportRecords(exporter, [record]);
        await exporter.shutdown();

        const parsed = JSON.parse(
            fs.readFileSync(exporter.filePath, "utf8").trimEnd(),
        );
        expect(parsed.correlationId).toBe("legacy-trace");
        expect(parsed).not.toHaveProperty("traceId");
    });

    it("exports every record admitted by its local processor", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        const exporter = new JsonlLogExporter({
            filePath: path.join(dir, "filtered-{pid}.jsonl"),
            serviceName: "test",
            pid: 1007,
            diagnostic: () => undefined,
        });
        expect(
            await exportRecords(exporter, [
                createRecord("structured-one", "request.received"),
                createRecord("debug-one", "debug"),
            ]),
        ).toBe(ExportResultCode.SUCCESS);
        await exporter.shutdown();

        const records = fs
            .readFileSync(exporter.filePath, "utf8")
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line) as { body: string });
        expect(records.map((record) => record.body)).toEqual([
            "structured-one",
            "debug-one",
        ]);
    });

    it("creates private directories and files", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        const exporter = new JsonlLogExporter({
            filePath: path.join(dir, "private", "logs-{pid}.jsonl"),
            serviceName: "test",
            pid: 1006,
            diagnostic: () => undefined,
        });

        await exportRecords(exporter, [createRecord("private")]);
        await exporter.shutdown();

        if (process.platform === "win32") {
            const directoryAcl = execFileSync(
                "icacls.exe",
                [path.dirname(exporter.filePath)],
                { encoding: "utf8" },
            );
            const fileAcl = execFileSync("icacls.exe", [exporter.filePath], {
                encoding: "utf8",
            });
            expect(directoryAcl).not.toContain("(I)");
            expect(fileAcl).not.toContain("(I)");
        } else {
            expect(
                fs.statSync(path.dirname(exporter.filePath)).mode & 0o777,
            ).toBe(0o700);
            expect(fs.statSync(exporter.filePath).mode & 0o777).toBe(0o600);
        }
    });

    it("bounds pending records and accounts for drops", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        const exporter = new JsonlLogExporter({
            filePath: path.join(dir, "bounded-{pid}.jsonl"),
            serviceName: "test",
            pid: 1002,
            maxPendingRecords: 2,
            diagnostic: () => undefined,
        });

        await exportRecords(exporter, [
            createRecord("one"),
            createRecord("two"),
            createRecord("three"),
        ]);
        await exporter.shutdown();

        expect(exporter.getDroppedRecordCount()).toBe(1);
        expect(
            fs.readFileSync(exporter.filePath, "utf8").trimEnd().split("\n"),
        ).toHaveLength(2);
    });

    it("isolates write failures and releases path ownership on shutdown", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        const blockingFile = path.join(dir, "not-a-directory");
        fs.writeFileSync(blockingFile, "x");
        const template = path.join(blockingFile, "logs-{pid}.jsonl");
        // Pin startedAt so the injected {timestamp} placeholder resolves to the
        // same path across constructions; otherwise each new Date() can cross a
        // second boundary and the ownership conflict would not be detected.
        const startedAt = new Date("2026-08-17T08:38:59.123Z");
        const exporter = new JsonlLogExporter({
            filePath: template,
            serviceName: "test",
            pid: 1003,
            startedAt,
            diagnostic: () => undefined,
        });
        expect(
            () =>
                new JsonlLogExporter({
                    filePath: template,
                    serviceName: "test",
                    pid: 1003,
                    startedAt,
                    diagnostic: () => undefined,
                }),
        ).toThrow(/already owns/);

        expect(await exportRecords(exporter, [createRecord("lost")])).toBe(
            ExportResultCode.FAILED,
        );
        expect(exporter.getDroppedRecordCount()).toBe(1);
        await exporter.shutdown();

        const replacement = new JsonlLogExporter({
            filePath: template,
            serviceName: "test",
            pid: 1003,
            startedAt,
            diagnostic: () => undefined,
        });
        await replacement.shutdown();
    });

    it("isolates diagnostic callback failures without leaking ownership", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        const template = path.join(dir, "diagnostic-{pid}.jsonl");
        const startedAt = new Date("2026-08-17T08:38:59.123Z");
        const exporter = new JsonlLogExporter({
            filePath: template,
            serviceName: "test",
            pid: 1004,
            startedAt,
            diagnostic: () => {
                throw new Error("diagnostic failed");
            },
        });
        await exporter.shutdown();

        const replacement = new JsonlLogExporter({
            filePath: template,
            serviceName: "test",
            pid: 1004,
            startedAt,
            diagnostic: () => undefined,
        });
        await replacement.shutdown();
    });
});

describe("debug bridge", () => {
    let provider: LoggerProvider | undefined;

    afterEach(async () => {
        await provider?.shutdown();
        provider = undefined;
        logs.disable();
        setLocalTelemetryState(undefined);
    });

    it("applies local policy when each record is emitted", () => {
        const exporter = new InMemoryLogRecordExporter();
        provider = new LoggerProvider({
            processors: [
                new LocalLogRecordProcessor(
                    new SimpleLogRecordProcessor({ exporter }),
                ),
            ],
        });
        logs.setGlobalLoggerProvider(provider);
        const state = createLocalTelemetryState();
        setLocalTelemetryState(state);
        const logger = logs.getLogger("local-policy");

        logger.emit({ eventName: "structured-one", body: "structured-one" });
        logger.emit({
            eventName: "dispatcher:command",
            body: "legacy-command",
        });
        logger.emit({ eventName: "debug", body: "debug-hidden" });
        logger.emit({
            eventName: "aiclient:llm:started",
            body: { scope: "background" },
        });
        logger.emit({
            eventName: "aiclient:llm:completed",
            body: { scope: "background", success: true },
        });
        logger.emit({
            eventName: "aiclient:llm:completed",
            body: { scope: "background", success: false },
        });
        state.setProfile("verbose");
        logger.emit({ eventName: "debug", body: "debug-visible" });
        state.setProfile("off");
        logger.emit({ eventName: "structured-hidden", body: "hidden" });

        expect(
            exporter
                .getFinishedLogRecords()
                .map((record) => [record.eventName, record.body]),
        ).toEqual([
            ["structured-one", "structured-one"],
            ["aiclient:llm:completed", { scope: "background", success: false }],
            ["debug", "debug-visible"],
        ]);
    });

    it("classifies bridged debug records and filters them by profile", () => {
        const exporter = new InMemoryLogRecordExporter();
        provider = new LoggerProvider({
            processors: [
                new LocalLogRecordProcessor(
                    new SimpleLogRecordProcessor({ exporter }),
                ),
            ],
        });
        logs.setGlobalLoggerProvider(provider);
        const state = createLocalTelemetryState();
        setLocalTelemetryState(state);
        const output: Array<{
            namespace: string | undefined;
            args: unknown[];
        }> = [];
        const debugModule = createDebugModule(output);
        const bridge = installDebugBridge([debugModule]);

        state.setProfile("diagnostic");
        debugModule.log.call({ namespace: "typeagent:test:error" }, "error");
        debugModule.log.call({ namespace: "typeagent:test:warn" }, "warn");
        debugModule.log.call({ namespace: "typeagent:test:info" }, "info");
        debugModule.log.call(
            { namespace: "typeagent:test:details" },
            "diagnostic-hidden",
        );

        state.setProfile("verbose");
        debugModule.log.call(
            { namespace: "typeagent:test:details" },
            "verbose-visible",
        );

        const records = exporter.getFinishedLogRecords();
        expect(records.map((record) => record.body)).toEqual([
            "error",
            "warn",
            "info",
            "verbose-visible",
        ]);
        expect(
            records.map((record) => record.attributes["debug.class"]),
        ).toEqual(["error", "warn", "info", "verbose"]);
        expect(
            records.map((record) => record.attributes["debug.namespace"]),
        ).toEqual([
            "typeagent:test:error",
            "typeagent:test:warn",
            "typeagent:test:info",
            "typeagent:test:details",
        ]);

        bridge.shutdown();
    });

    it("retains successful background LLM events outside focused mode", () => {
        const exporter = new InMemoryLogRecordExporter();
        provider = new LoggerProvider({
            processors: [
                new LocalLogRecordProcessor(
                    new SimpleLogRecordProcessor({ exporter }),
                ),
            ],
        });
        logs.setGlobalLoggerProvider(provider);
        const state = createLocalTelemetryState();
        state.setProfile("diagnostic");
        setLocalTelemetryState(state);
        const logger = logs.getLogger("local-policy-diagnostic");

        logger.emit({
            eventName: "aiclient:llm:started",
            body: { scope: "background" },
        });
        logger.emit({
            eventName: "aiclient:llm:completed",
            body: { scope: "background", success: true },
        });

        expect(exporter.getFinishedLogRecords()).toHaveLength(2);
    });

    it("tees distinct debug modules exactly once and restores prior output", () => {
        const exporter = new InMemoryLogRecordExporter();
        provider = new LoggerProvider({
            processors: [new SimpleLogRecordProcessor({ exporter })],
        });
        logs.setGlobalLoggerProvider(provider);
        const firstOutput: Array<{
            namespace: string | undefined;
            args: unknown[];
        }> = [];
        const secondOutput: Array<{
            namespace: string | undefined;
            args: unknown[];
        }> = [];
        const first = createDebugModule(firstOutput);
        const second = createDebugModule(secondOutput);
        const firstPrior = first.log;
        const secondPrior = second.log;
        const bridge = installDebugBridge([first, second, first]);

        first.log.call(
            { namespace: "typeagent:first" },
            "\u001b[31mfirst\u001b[0m",
        );
        second.log.call({ namespace: "typeagent:second" }, "second");
        first.log.call({ namespace: "other:first" }, "ignored");
        second.log.call({ namespace: "typeagent:logger:db" }, "excluded");

        expect(firstOutput).toHaveLength(2);
        expect(secondOutput).toHaveLength(2);
        const records = exporter.getFinishedLogRecords();
        expect(records).toHaveLength(2);
        expect(records.map((record) => record.body)).toEqual([
            "first",
            "second",
        ]);
        expect(
            records.map((record) => record.attributes["debug.namespace"]),
        ).toEqual(["typeagent:first", "typeagent:second"]);

        bridge.shutdown();
        bridge.shutdown();
        expect(first.log).toBe(firstPrior);
        expect(second.log).toBe(secondPrior);
    });

    it("can include host-owned legacy debug namespace prefixes", () => {
        const exporter = new InMemoryLogRecordExporter();
        provider = new LoggerProvider({
            processors: [new SimpleLogRecordProcessor({ exporter })],
        });
        logs.setGlobalLoggerProvider(provider);
        const output: Array<{
            namespace: string | undefined;
            args: unknown[];
        }> = [];
        const debugModule = createDebugModule(output);
        const bridge = installDebugBridge([debugModule], {
            includedNamespacePrefixes: ["typeagent:", "agent-server:"],
        });

        debugModule.log.call({ namespace: "agent-server:startup" }, "ready");
        debugModule.log.call({ namespace: "other:startup" }, "ignored");
        debugModule.log.call(
            { namespace: "typeagent:telemetry:promptLogger" },
            "prompt",
        );

        expect(exporter.getFinishedLogRecords()).toHaveLength(1);
        expect(
            exporter.getFinishedLogRecords()[0].attributes["debug.namespace"],
        ).toBe("agent-server:startup");
        bridge.shutdown();
    });

    it("captures real debug instances created before and after installation", () => {
        const exporter = new InMemoryLogRecordExporter();
        provider = new LoggerProvider({
            processors: [new SimpleLogRecordProcessor({ exporter })],
        });
        logs.setGlobalLoggerProvider(provider);
        const priorNamespaces = registerDebug.disable();
        const priorLog = registerDebug.log;
        registerDebug.log = () => undefined;
        const before = registerDebug("typeagent:test:before");
        const bridge = installDebugBridge([registerDebug]);

        try {
            registerDebug.enable("typeagent:test:*");
            const after = registerDebug("typeagent:test:after");
            before("created before installation");
            after("created after installation");

            const records = exporter.getFinishedLogRecords();
            expect(records.map((record) => record.body)).toEqual([
                "created before installation",
                "created after installation",
            ]);
            expect(
                records.map((record) => record.attributes["debug.namespace"]),
            ).toEqual(["typeagent:test:before", "typeagent:test:after"]);
        } finally {
            bridge.shutdown();
            registerDebug.log = priorLog;
            registerDebug.enable(priorNamespaces);
        }
    });

    it("does not overwrite a later owner during restoration", () => {
        const debugModule = createDebugModule([]);
        const bridge = installDebugBridge([debugModule]);
        const replacement = () => undefined;
        debugModule.log = replacement;

        bridge.shutdown();

        expect(debugModule.log).toBe(replacement);
    });

    it("keeps the bridge installed until every installation shuts down", () => {
        const debugModule = createDebugModule([]);
        const prior = debugModule.log;
        const first = installDebugBridge([debugModule]);
        const wrapped = debugModule.log;
        const second = installDebugBridge([debugModule]);

        first.shutdown();
        expect(debugModule.log).toBe(wrapped);
        second.shutdown();
        expect(debugModule.log).toBe(prior);
    });

    it("rejects conflicting options on an already bridged module", () => {
        const debugModule = createDebugModule([]);
        const first = installDebugBridge([debugModule]);
        const wrapped = debugModule.log;

        expect(() =>
            installDebugBridge([debugModule], {
                includedNamespacePrefixes: ["agent-server:"],
            }),
        ).toThrow(/different options/);
        expect(debugModule.log).toBe(wrapped);

        first.shutdown();
    });

    it("suppresses reentrant debug output from the OTel logger path", () => {
        const output: Array<{
            namespace: string | undefined;
            args: unknown[];
        }> = [];
        const debugModule = createDebugModule(output);
        const bridge = installDebugBridge([debugModule]);
        let emitCalls = 0;
        logs.setGlobalLoggerProvider({
            getLogger() {
                return {
                    enabled() {
                        debugModule.log.call(
                            { namespace: "typeagent:otel-internal" },
                            "inner",
                        );
                        return true;
                    },
                    emit() {
                        emitCalls++;
                    },
                };
            },
        });

        debugModule.log.call({ namespace: "typeagent:outer" }, "outer");

        expect(output.map((entry) => entry.args[0])).toEqual([
            "outer",
            "inner",
        ]);
        expect(emitCalls).toBe(1);
        bridge.shutdown();
    });
});

describe("local diagnostics correlation", () => {
    it("writes structured and debug records with the same active span", async () => {
        setLocalTelemetryState(
            createLocalTelemetryState({ initialProfile: "verbose" }),
        );
        const dir = makeTempDir();
        const jsonlExporter = new JsonlLogExporter({
            filePath: path.join(dir, "correlated-{pid}.jsonl"),
            serviceName: "test",
            pid: 1005,
            diagnostic: () => undefined,
        });
        const logProvider = new LoggerProvider({
            processors: [
                new SimpleLogRecordProcessor({ exporter: jsonlExporter }),
            ],
        });
        const traceProvider = new NodeTracerProvider();
        const contextManager = new AsyncLocalStorageContextManager().enable();
        logs.setGlobalLoggerProvider(logProvider);
        trace.setGlobalTracerProvider(traceProvider);
        context.setGlobalContextManager(contextManager);
        const debugModule = createDebugModule([]);
        const bridge = installDebugBridge([debugModule]);
        const sink = createOtelLoggerSink({ diagnostic: () => undefined });

        let expectedTraceId = "";
        let expectedSpanId = "";
        try {
            trace
                .getTracer("local-diagnostics")
                .startActiveSpan("correlated", (span) => {
                    expectedTraceId = span.spanContext().traceId;
                    expectedSpanId = span.spanContext().spanId;
                    sink.logEvent({
                        eventName: "structured",
                        timestamp: new Date().toISOString(),
                        event: { sessionId: "session" },
                    });
                    debugModule.log.call(
                        { namespace: "typeagent:correlated" },
                        "debug",
                    );
                    span.end();
                });
            await logProvider.forceFlush();
            await logProvider.shutdown();

            const records = fs
                .readFileSync(jsonlExporter.filePath, "utf8")
                .trimEnd()
                .split("\n")
                .map(
                    (line) =>
                        JSON.parse(line) as {
                            event: string;
                            traceId: string;
                            spanId: string;
                        },
                );
            expect(records.map((record) => record.event)).toEqual([
                "structured",
                "debug",
            ]);
            for (const record of records) {
                expect(record.traceId).toBe(expectedTraceId);
                expect(record.spanId).toBe(expectedSpanId);
            }
        } finally {
            bridge.shutdown();
            await Promise.allSettled([
                logProvider.shutdown(),
                traceProvider.shutdown(),
            ]);
            logs.disable();
            trace.disable();
            context.disable();
            setLocalTelemetryState(undefined);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

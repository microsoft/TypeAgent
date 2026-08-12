// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-otel-local-"));
}

function createRecord(body: string): ReadableLogRecord {
    return {
        hrTime: [1_700_000_000, 0],
        hrTimeObserved: [1_700_000_001, 0],
        severityText: "INFO",
        body,
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
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("resolves a sanitized per-process path", () => {
        const resolved = resolveJsonlLogPath(
            path.join("logs", "typeagent-{service}.jsonl"),
            "agent/server",
            1234,
        );
        expect(resolved).toBe(
            path.resolve("logs", "typeagent-agent_server-1234.jsonl"),
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
        const exporter = new JsonlLogExporter({
            filePath: template,
            serviceName: "test",
            pid: 1003,
            diagnostic: () => undefined,
        });
        expect(
            () =>
                new JsonlLogExporter({
                    filePath: template,
                    serviceName: "test",
                    pid: 1003,
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
            diagnostic: () => undefined,
        });
        await replacement.shutdown();
    });

    it("isolates diagnostic callback failures without leaking ownership", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        const template = path.join(dir, "diagnostic-{pid}.jsonl");
        const exporter = new JsonlLogExporter({
            filePath: template,
            serviceName: "test",
            pid: 1004,
            diagnostic: () => {
                throw new Error("diagnostic failed");
            },
        });
        await exporter.shutdown();

        const replacement = new JsonlLogExporter({
            filePath: template,
            serviceName: "test",
            pid: 1004,
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
                            eventName: string;
                            traceId: string;
                            spanId: string;
                        },
                );
            expect(records.map((record) => record.eventName)).toEqual([
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
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

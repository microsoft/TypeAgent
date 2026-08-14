// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    propagation,
    SpanKind,
    SpanStatusCode,
    trace,
    type Span,
} from "@opentelemetry/api";
import type {
    ActionContext,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { otel } from "@typeagent/telemetry";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";

import { createAgentProcess } from "../src/agentProvider/process/agentProcessShim.js";

interface ProtobufField {
    readonly number: number;
    readonly wireType: number;
    readonly value: bigint | Buffer;
}

interface ExportedSpan {
    readonly name: string;
    readonly traceId: string;
    readonly spanId: string;
    readonly parentSpanId: string;
    readonly kind: number;
    readonly statusCode: number;
    readonly attributes: ReadonlyMap<string, string>;
    readonly processName: string;
}

const ACTION_NAMES = ["succeed", "fail", "cancel"] as const;
const AGENT_NAME = "telemetry-fixture";
const SESSION_ID = "session-rpc-test";
const ACTIVATION_ID = "activation-rpc-test";
const LEGACY_TRACE_ID = "legacy-rpc-test";

describe("agent subprocess OpenTelemetry propagation", () => {
    afterEach(() => {
        trace.disable();
        context.disable();
        propagation.disable();
    });

    it("preserves trace and parent continuity for success, failure, and cancellation", async () => {
        const payloads: Buffer[] = [];
        const receiver = createServer(async (request, response) => {
            expect(request.url).toBe("/v1/traces");
            payloads.push(await readRequestBody(request));
            response.writeHead(200, {
                "content-type": "application/x-protobuf",
            });
            response.end();
        });
        receiver.listen(0, "127.0.0.1");
        await once(receiver, "listening");

        const address = receiver.address();
        if (address === null || typeof address === "string") {
            throw new Error("Expected a TCP receiver address");
        }
        const endpoint = `http://127.0.0.1:${address.port}/v1/traces`;
        const previousEnv = captureEnv([
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
            "OTEL_TRACES_EXPORTER",
            "OTEL_METRICS_EXPORTER",
            "OTEL_LOGS_EXPORTER",
            "OTEL_TRACES_SAMPLER",
            "OTEL_TRACES_SAMPLER_ARG",
        ]);
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = endpoint;
        process.env.OTEL_TRACES_EXPORTER = "otlp";
        process.env.OTEL_METRICS_EXPORTER = "none";
        process.env.OTEL_LOGS_EXPORTER = "none";
        process.env.OTEL_TRACES_SAMPLER = "always_on";
        delete process.env.OTEL_TRACES_SAMPLER_ARG;

        const coordinator = otel.createTelemetryCoordinator();
        let agentProcess:
            | Awaited<ReturnType<typeof createAgentProcess>>
            | undefined;
        try {
            await coordinator.init({
                config: {
                    traces: {
                        otlp: { endpoint },
                    },
                },
                serviceName: "typeagent-agent-server-test",
                processName: "agent-server-test",
            });
            agentProcess = await createAgentProcess(
                AGENT_NAME,
                new URL("./fixtures/telemetryAgent.js", import.meta.url).href,
            );

            await runOptionsCallback(agentProcess.appAgent);
            await runAction(agentProcess.appAgent, "succeed");
            await expect(
                runAction(agentProcess.appAgent, "fail"),
            ).rejects.toThrow("fixture failure");
            await expect(
                runAction(agentProcess.appAgent, "cancel"),
            ).rejects.toMatchObject({ name: "AbortError" });
            await new Promise((resolve) => setTimeout(resolve, 50));

            await agentProcess.close?.();
            agentProcess = undefined;
            await coordinator.shutdown();
        } finally {
            await agentProcess?.close?.();
            await coordinator.shutdown();
            restoreEnv(previousEnv);
            receiver.close();
            await once(receiver, "close");
        }

        const spans = payloads.flatMap(decodeSpans);
        assertOptionsCallbackChain(spans);
        for (const actionName of ACTION_NAMES) {
            assertActionRpcChain(spans, actionName);
        }
    });
});

async function runAction(
    appAgent: Awaited<ReturnType<typeof createAgentProcess>>["appAgent"],
    actionName: (typeof ACTION_NAMES)[number],
): Promise<void> {
    const executeAction = appAgent.executeAction;
    if (executeAction === undefined) {
        throw new Error("Fixture agent must implement executeAction");
    }
    const abortController = new AbortController();
    const action = {
        schemaName: AGENT_NAME,
        actionName,
        parameters: { privateValue: "must-not-be-telemetry" },
    } as TypeAgentAction;
    const actionContext = createActionContext(abortController.signal);
    const tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );

    await tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.ACTION,
        {
            kind: SpanKind.INTERNAL,
        },
        async (span: Span) => {
            const attributes = {
                agentName: AGENT_NAME,
                actionName,
                sessionId: SESSION_ID,
                activationId: ACTIVATION_ID,
                traceId: LEGACY_TRACE_ID,
            };
            otel.setTypeAgentSpanAttributes(span, attributes);
            try {
                await context.with(
                    otel.setActiveTypeAgentSpanAttributes(
                        context.active(),
                        attributes,
                    ),
                    async () => {
                        const result = executeAction(action, actionContext);
                        if (actionName === "cancel") {
                            setTimeout(() => abortController.abort(), 25);
                        }
                        await result;
                    },
                );
            } catch (error) {
                const cancelled =
                    error !== null &&
                    typeof error === "object" &&
                    (error as { name?: unknown }).name === "AbortError";
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: cancelled ? "cancelled" : "action failed",
                });
                throw error;
            } finally {
                span.end();
            }
        },
    );
}

async function runOptionsCallback(
    appAgent: Awaited<ReturnType<typeof createAgentProcess>>["appAgent"],
): Promise<void> {
    const initializeAgentContext = appAgent.initializeAgentContext;
    if (initializeAgentContext === undefined) {
        throw new Error("Fixture agent must implement initializeAgentContext");
    }
    const attributes = {
        agentName: AGENT_NAME,
        actionName: "initialize",
        sessionId: SESSION_ID,
        activationId: ACTIVATION_ID,
        traceId: LEGACY_TRACE_ID,
    };
    const tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    await tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.ACTION,
        async (span) => {
            otel.setTypeAgentSpanAttributes(span, attributes);
            try {
                await context.with(
                    otel.setActiveTypeAgentSpanAttributes(
                        context.active(),
                        attributes,
                    ),
                    () =>
                        initializeAgentContext({
                            options: {
                                callback: async () => {},
                            },
                        }),
                );
            } finally {
                span.end();
            }
        },
    );
}

function createActionContext(signal: AbortSignal): ActionContext {
    const sessionContext = {
        agentContext: undefined,
        sessionContextId: "rpc-internal-context-must-not-be-telemetry",
    } as unknown as SessionContext<void>;
    return {
        streamingContext: undefined,
        activityContext: undefined,
        actionIO: {
            setDisplay: () => {},
            appendDisplay: () => {},
            takeAction: () => {},
            appendDiagnosticData: () => {},
        },
        sessionContext,
        abortSignal: signal,
        isFromReasoningLoop: false,
        queueToggleTransientAgent: async () => {},
    };
}

function assertActionRpcChain(
    spans: readonly ExportedSpan[],
    actionName: string,
): void {
    const matching = spans.filter(
        (span) => span.attributes.get("typeagent.action.name") === actionName,
    );
    const action = matching.find(
        (span) =>
            span.name === otel.TYPEAGENT_SPAN_NAMES.ACTION &&
            span.processName === "agent-server-test",
    );
    const client = matching.find(
        (span) =>
            span.name === "typeagent.rpc.invoke" &&
            span.kind === SpanKind.CLIENT &&
            span.processName === "agent-server-test",
    );
    const server = matching.find(
        (span) =>
            span.name === "typeagent.rpc.invoke" &&
            span.kind === SpanKind.SERVER &&
            span.processName === `agent-${AGENT_NAME}`,
    );
    expect(action).toBeDefined();
    expect(client).toBeDefined();
    expect(server).toBeDefined();
    expect(client!.traceId).toBe(action!.traceId);
    expect(client!.parentSpanId).toBe(action!.spanId);
    expect(server!.traceId).toBe(action!.traceId);
    expect(server!.parentSpanId).toBe(client!.spanId);

    for (const span of [client!, server!]) {
        expect(span.attributes.get("typeagent.agent.name")).toBe(AGENT_NAME);
        expect(span.attributes.get("typeagent.session.id")).toBe(SESSION_ID);
        expect(span.attributes.get("typeagent.activation.id")).toBe(
            ACTIVATION_ID,
        );
        expect(span.attributes.get("typeagent.trace.id")).toBe(LEGACY_TRACE_ID);
        expect(
            [...span.attributes.keys()].some(
                (key) =>
                    key.includes("parameter") ||
                    key.includes("context.id") ||
                    key.includes("private"),
            ),
        ).toBe(false);
        expect([...span.attributes.values()]).not.toContain(
            "must-not-be-telemetry",
        );
        expect([...span.attributes.values()]).not.toContain(
            "rpc-internal-context-must-not-be-telemetry",
        );
    }
    if (actionName !== "succeed") {
        expect(client!.statusCode).toBe(SpanStatusCode.ERROR);
        expect(server!.statusCode).toBe(SpanStatusCode.ERROR);
    }
}

function assertOptionsCallbackChain(spans: readonly ExportedSpan[]): void {
    const matching = spans.filter(
        (span) => span.attributes.get("typeagent.action.name") === "initialize",
    );
    const action = matching.find(
        (span) =>
            span.name === otel.TYPEAGENT_SPAN_NAMES.ACTION &&
            span.processName === "agent-server-test",
    );
    const mainClient = matching.find(
        (span) =>
            span.attributes.get("rpc.method") === "initializeAgentContext" &&
            span.kind === SpanKind.CLIENT,
    );
    const mainServer = matching.find(
        (span) =>
            span.attributes.get("rpc.method") === "initializeAgentContext" &&
            span.kind === SpanKind.SERVER,
    );
    const callbackClient = matching.find(
        (span) =>
            span.attributes.get("rpc.method") === "callback" &&
            span.kind === SpanKind.CLIENT,
    );
    const callbackServer = matching.find(
        (span) =>
            span.attributes.get("rpc.method") === "callback" &&
            span.kind === SpanKind.SERVER,
    );
    for (const span of [
        action,
        mainClient,
        mainServer,
        callbackClient,
        callbackServer,
    ]) {
        expect(span).toBeDefined();
        expect(span!.traceId).toBe(action!.traceId);
    }
    expect(mainClient!.parentSpanId).toBe(action!.spanId);
    expect(mainServer!.parentSpanId).toBe(mainClient!.spanId);
    expect(callbackClient!.parentSpanId).toBe(mainServer!.spanId);
    expect(callbackServer!.parentSpanId).toBe(callbackClient!.spanId);
}

function readVarint(
    buffer: Buffer,
    start: number,
): { value: bigint; next: number } {
    let value = 0n;
    let shift = 0n;
    let offset = start;
    while (offset < buffer.length) {
        const byte = buffer[offset++]!;
        value |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) {
            return { value, next: offset };
        }
        shift += 7n;
    }
    throw new Error("Truncated protobuf varint");
}

function parseMessage(buffer: Buffer): ProtobufField[] {
    const fields: ProtobufField[] = [];
    let offset = 0;
    while (offset < buffer.length) {
        const tag = readVarint(buffer, offset);
        offset = tag.next;
        const number = Number(tag.value >> 3n);
        const wireType = Number(tag.value & 7n);
        if (wireType === 0) {
            const item = readVarint(buffer, offset);
            fields.push({ number, wireType, value: item.value });
            offset = item.next;
        } else if (wireType === 1) {
            fields.push({
                number,
                wireType,
                value: buffer.subarray(offset, offset + 8),
            });
            offset += 8;
        } else if (wireType === 2) {
            const length = readVarint(buffer, offset);
            offset = length.next;
            const end = offset + Number(length.value);
            fields.push({
                number,
                wireType,
                value: buffer.subarray(offset, end),
            });
            offset = end;
        } else if (wireType === 5) {
            fields.push({
                number,
                wireType,
                value: buffer.subarray(offset, offset + 4),
            });
            offset += 4;
        } else {
            throw new Error(`Unsupported protobuf wire type ${wireType}`);
        }
    }
    return fields;
}

function getBuffers(fields: ProtobufField[], number: number): Buffer[] {
    return fields
        .filter(
            (field) => field.number === number && Buffer.isBuffer(field.value),
        )
        .map((field) => field.value as Buffer);
}

function getVarint(fields: ProtobufField[], number: number): number {
    const field = fields.find(
        (candidate) =>
            candidate.number === number && typeof candidate.value === "bigint",
    );
    return field === undefined ? 0 : Number(field.value);
}

function getString(fields: ProtobufField[], number: number): string {
    return getBuffers(fields, number)[0]?.toString("utf8") ?? "";
}

function decodeSpans(request: Buffer): ExportedSpan[] {
    const spans: ExportedSpan[] = [];
    for (const resourceSpans of getBuffers(parseMessage(request), 1)) {
        const resourceFields = parseMessage(resourceSpans);
        const resource = getBuffers(resourceFields, 1)[0];
        const resourceAttributes =
            resource === undefined
                ? new Map<string, string>()
                : decodeAttributes(parseMessage(resource), 1);
        const processName =
            resourceAttributes.get("typeagent.process.name") ?? "";
        for (const scopeSpans of getBuffers(resourceFields, 2)) {
            for (const encodedSpan of getBuffers(parseMessage(scopeSpans), 2)) {
                const fields = parseMessage(encodedSpan);
                const status = getBuffers(fields, 15)[0];
                spans.push({
                    name: getString(fields, 5),
                    traceId: getBuffers(fields, 1)[0]?.toString("hex") ?? "",
                    spanId: getBuffers(fields, 2)[0]?.toString("hex") ?? "",
                    parentSpanId:
                        getBuffers(fields, 4)[0]?.toString("hex") ?? "",
                    kind: getVarint(fields, 6) - 1,
                    statusCode:
                        status === undefined
                            ? 0
                            : getVarint(parseMessage(status), 3),
                    attributes: decodeAttributes(fields, 9),
                    processName,
                });
            }
        }
    }
    return spans;
}

function decodeAttributes(
    fields: ProtobufField[],
    fieldNumber: number,
): Map<string, string> {
    const attributes = new Map<string, string>();
    for (const keyValue of getBuffers(fields, fieldNumber)) {
        const keyValueFields = parseMessage(keyValue);
        const key = getString(keyValueFields, 1);
        const anyValue = getBuffers(keyValueFields, 2)[0];
        if (key !== "" && anyValue !== undefined) {
            attributes.set(key, getString(parseMessage(anyValue), 1));
        }
    }
    return attributes;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function captureEnv(
    names: readonly string[],
): ReadonlyMap<string, string | undefined> {
    return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(values: ReadonlyMap<string, string | undefined>): void {
    for (const [name, value] of values) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
}

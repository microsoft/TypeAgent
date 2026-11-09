// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { context, propagation, trace, type Span } from "@opentelemetry/api";
import { otel } from "@typeagent/telemetry";
import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { wrapRootRequestSpan } from "../src/otel/rootRequestSpan.js";
import { wrapTranslationSpan } from "../src/otel/translationSpan.js";

const describeOtlpSmoke =
    process.env.TYPEAGENT_OTEL_OTLP_SMOKE === "1" ? describe : describe.skip;

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
        switch (wireType) {
            case 0: {
                const item = readVarint(buffer, offset);
                fields.push({ number, wireType, value: item.value });
                offset = item.next;
                break;
            }
            case 1:
                fields.push({
                    number,
                    wireType,
                    value: buffer.subarray(offset, offset + 8),
                });
                offset += 8;
                break;
            case 2: {
                const length = readVarint(buffer, offset);
                offset = length.next;
                const end = offset + Number(length.value);
                fields.push({
                    number,
                    wireType,
                    value: buffer.subarray(offset, end),
                });
                offset = end;
                break;
            }
            case 5:
                fields.push({
                    number,
                    wireType,
                    value: buffer.subarray(offset, offset + 4),
                });
                offset += 4;
                break;
            default:
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

function getString(fields: ProtobufField[], number: number): string {
    return getBuffers(fields, number)[0]?.toString("utf8") ?? "";
}

function decodeResourceAttributes(request: Buffer): Map<string, string> {
    const attributes = new Map<string, string>();
    for (const resourceSpans of getBuffers(parseMessage(request), 1)) {
        const resource = getBuffers(parseMessage(resourceSpans), 1)[0];
        if (resource === undefined) {
            continue;
        }
        for (const keyValue of getBuffers(parseMessage(resource), 1)) {
            const keyValueFields = parseMessage(keyValue);
            const key = getString(keyValueFields, 1);
            const anyValue = getBuffers(keyValueFields, 2)[0];
            if (key !== "" && anyValue !== undefined) {
                attributes.set(key, getString(parseMessage(anyValue), 1));
            }
        }
    }
    return attributes;
}

function decodeSpans(request: Buffer): ExportedSpan[] {
    const spans: ExportedSpan[] = [];
    for (const resourceSpans of getBuffers(parseMessage(request), 1)) {
        for (const scopeSpans of getBuffers(parseMessage(resourceSpans), 2)) {
            for (const span of getBuffers(parseMessage(scopeSpans), 2)) {
                const fields = parseMessage(span);
                spans.push({
                    name: getString(fields, 5),
                    traceId: getBuffers(fields, 1)[0]?.toString("hex") ?? "",
                    spanId: getBuffers(fields, 2)[0]?.toString("hex") ?? "",
                    parentSpanId:
                        getBuffers(fields, 4)[0]?.toString("hex") ?? "",
                });
            }
        }
    }
    return spans;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function runRepresentativeLlmCall(): Promise<void> {
    const tracer = trace.getTracer(
        otel.INSTRUMENTATION_SCOPE_NAME,
        otel.INSTRUMENTATION_SCOPE_VERSION,
    );
    await tracer.startActiveSpan(
        otel.TYPEAGENT_SPAN_NAMES.LLM,
        async (span: Span) => {
            span.end();
        },
    );
}

describeOtlpSmoke("OTLP trace exporter smoke path", () => {
    afterEach(() => {
        trace.disable();
        context.disable();
        propagation.disable();
    });

    it("exports resource attributes and parented spans to an OTLP receiver", async () => {
        let resolvePayload!: (payload: Buffer) => void;
        const payloadPromise = new Promise<Buffer>((resolve) => {
            resolvePayload = resolve;
        });
        const receiver = createServer(async (request, response) => {
            expect(request.url).toBe("/v1/traces");
            expect(request.headers["content-type"]).toContain(
                "application/x-protobuf",
            );
            resolvePayload(await readRequestBody(request));
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

        const coordinator = otel.createTelemetryCoordinator();
        try {
            await coordinator.init({
                config: {
                    traces: {
                        otlp: {
                            endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
                        },
                    },
                },
                serviceName: "typeagent-otlp-smoke",
                serviceVersion: "1.0.0-test",
                serviceInstanceId: "otlp-smoke-instance",
                deploymentEnvironment: "test",
            });

            await wrapRootRequestSpan({}, async () => {
                await wrapTranslationSpan({}, async () => {
                    await runRepresentativeLlmCall();
                });
                return {};
            });
            await coordinator.shutdown();

            const payload = await payloadPromise;
            const resources = decodeResourceAttributes(payload);
            expect(resources.get("service.name")).toBe("typeagent-otlp-smoke");
            expect(resources.get("service.version")).toBe("1.0.0-test");
            expect(resources.get("service.instance.id")).toBe(
                "otlp-smoke-instance",
            );
            expect(resources.get("deployment.environment.name")).toBe("test");

            const spans = decodeSpans(payload);
            const requestSpan = spans.find(
                (span) => span.name === "typeagent.request",
            );
            const translationSpan = spans.find(
                (span) => span.name === "typeagent.translation",
            );
            const llmSpan = spans.find((span) => span.name === "typeagent.llm");
            expect(requestSpan).toBeDefined();
            expect(translationSpan).toBeDefined();
            expect(llmSpan).toBeDefined();
            expect(translationSpan!.traceId).toBe(requestSpan!.traceId);
            expect(translationSpan!.parentSpanId).toBe(requestSpan!.spanId);
            expect(llmSpan!.traceId).toBe(requestSpan!.traceId);
            expect(llmSpan!.parentSpanId).toBe(translationSpan!.spanId);
        } finally {
            await coordinator.shutdown();
            receiver.close();
            await once(receiver, "close");
        }
    });
});

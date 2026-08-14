// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    context,
    propagation,
    SpanKind,
    SpanStatusCode,
    trace,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
    InMemorySpanExporter,
    SimpleSpanProcessor,
    type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

import {
    createRpc,
    RPC_METADATA_VERSION,
    type RpcOptions,
} from "../src/rpc.js";
import type { RpcChannel } from "../src/common.js";

type FakeChannel = RpcChannel & {
    deliver(message: any): void;
    fireDisconnect(): void;
    setPeer(peer: FakeChannel): void;
    sent: any[];
};

function remove<T>(arr: T[], item: T) {
    const i = arr.indexOf(item);
    if (i >= 0) {
        arr.splice(i, 1);
    }
}

function createFakeChannel(): FakeChannel {
    const messageHandlers: ((m: any) => void)[] = [];
    const onceMessage: ((m: any) => void)[] = [];
    const disconnectHandlers: (() => void)[] = [];
    const onceDisconnect: (() => void)[] = [];
    let peer: FakeChannel | undefined;
    const sent: any[] = [];

    const channel: FakeChannel = {
        on(event: "message" | "disconnect", cb: any) {
            (event === "message" ? messageHandlers : disconnectHandlers).push(
                cb,
            );
        },
        once(event: "message" | "disconnect", cb: any) {
            (event === "message" ? onceMessage : onceDisconnect).push(cb);
        },
        off(event: "message" | "disconnect", cb: any) {
            if (event === "message") {
                remove(messageHandlers, cb);
                remove(onceMessage, cb);
            } else {
                remove(disconnectHandlers, cb);
                remove(onceDisconnect, cb);
            }
        },
        send(message: any, cb?: (err: Error | null) => void) {
            sent.push(message);
            if (peer) {
                queueMicrotask(() => peer!.deliver(message));
            }
            cb?.(null);
        },
        deliver(message: any) {
            for (const h of [...messageHandlers]) {
                h(message);
            }
            const onces = onceMessage.splice(0);
            for (const h of onces) {
                h(message);
            }
        },
        fireDisconnect() {
            for (const h of [...disconnectHandlers]) {
                h();
            }
            const onces = onceDisconnect.splice(0);
            for (const h of onces) {
                h();
            }
        },
        setPeer(p: FakeChannel) {
            peer = p;
        },
        sent,
    };
    return channel;
}

function connect(a: FakeChannel, b: FakeChannel) {
    a.setPeer(b);
    b.setPeer(a);
}

type EchoInvoke = { echo: (x: number) => Promise<number> };
type Notify = { notify: (x: number) => void };

// options is the 5th positional arg of createRpc; this keeps the rebindable
// client calls below readable and avoids passing the wrong positional slot.
function createRebindableClient<
    I extends Record<string, (...args: any[]) => any> = {},
    C extends Record<string, (...args: any[]) => any> = {},
>(name: string, channel: RpcChannel) {
    return createRpc<I, C>(name, channel, undefined, undefined, {
        rebindable: true,
    });
}

function createEchoServer(name: string, channel: RpcChannel, offset = 0) {
    return createRpc<{}, {}, EchoInvoke>(name, channel, {
        echo: async (x: number) => x + offset,
    });
}

function flushMicrotasks() {
    return new Promise((r) => queueMicrotask(() => r(undefined)));
}

type TraceFixture = {
    exporter: InMemorySpanExporter;
    provider: NodeTracerProvider;
};

function installTraceFixture(): TraceFixture {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register({
        propagator: new W3CTraceContextPropagator(),
    });
    return { exporter, provider };
}

async function disposeTraceFixture(
    fixture: TraceFixture | undefined,
): Promise<void> {
    if (fixture === undefined) {
        return;
    }
    await fixture.provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
}

function findSpan(spans: ReadableSpan[], kind: SpanKind): ReadableSpan {
    const matching = spans.filter((span) => span.kind === kind);
    if (matching.length !== 1) {
        throw new Error(
            `Expected one ${SpanKind[kind]} span, got ${matching.length}`,
        );
    }
    return matching[0]!;
}

function getParentSpanId(span: ReadableSpan): string | undefined {
    return span.parentSpanContext?.spanId;
}

describe("createRpc default (non-rebindable)", () => {
    it("round-trips invoke results", async () => {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);

        const clientRpc = createRpc<EchoInvoke>("client", client);
        createRpc<{}, {}, EchoInvoke>("server", server, {
            echo: async (x: number) => x * 2,
        });

        await expect(clientRpc.invoke("echo", 21)).resolves.toBe(42);
    });

    it("rejects in-flight invokes on disconnect", async () => {
        const client = createFakeChannel();
        const clientRpc = createRpc<EchoInvoke>("client", client);

        const inflight = clientRpc.invoke("echo", 1);
        client.fireDisconnect();

        await expect(inflight).rejects.toThrow("Agent channel disconnected");
    });

    it("poisons invoke and send after disconnect", () => {
        const client = createFakeChannel();
        const clientRpc = createRpc<EchoInvoke, Notify>("client", client);

        client.fireDisconnect();

        expect(() => clientRpc.invoke("echo", 1)).toThrow(
            "Agent channel disconnected",
        );
        expect(() => clientRpc.send("notify", 1)).toThrow(
            "Agent channel disconnected",
        );
    });

    it("throws when rebind is called on a non-rebindable rpc", () => {
        const client = createFakeChannel();
        const next = createFakeChannel();
        const clientRpc = createRpc<EchoInvoke>("client", client);

        expect(() => clientRpc.rebind(next)).toThrow(
            "rpc was not created as rebindable",
        );
    });

    it("carries an error's markdown display across the channel", async () => {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);

        const clientRpc = createRpc<EchoInvoke>("client", client);
        createRpc<{}, {}, EchoInvoke>("server", server, {
            echo: async () => {
                const e: Error & { markdown?: string } = new Error("nope");
                e.markdown = "**nope**";
                throw e;
            },
        });

        const e = await clientRpc.invoke("echo", 1).then(
            () => undefined,
            (e: any) => e,
        );
        expect(e.message).toBe("nope");
        expect(e.markdown).toBe("**nope**");
    });

    it("leaves markdown undefined for a plain error", async () => {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);

        const clientRpc = createRpc<EchoInvoke>("client", client);
        createRpc<{}, {}, EchoInvoke>("server", server, {
            echo: async () => {
                throw new Error("plain");
            },
        });

        const e = await clientRpc.invoke("echo", 1).then(
            () => undefined,
            (e: any) => e,
        );
        expect(e.message).toBe("plain");
        expect(e.markdown).toBeUndefined();
    });
});

describe("createRpc rebindable", () => {
    it("fails fast while disconnected and recovers after rebind", async () => {
        const client1 = createFakeChannel();
        const clientRpc = createRebindableClient<EchoInvoke, Notify>(
            "client",
            client1,
        );

        const inflight = clientRpc.invoke("echo", 1);
        client1.fireDisconnect();
        await expect(inflight).rejects.toThrow("Agent channel disconnected");

        // New calls during the disconnected window fail fast rather than hang,
        // and the rpc is not poisoned (it recovers after rebind).
        await expect(clientRpc.invoke("echo", 2)).rejects.toThrow(
            "Agent channel disconnected",
        );
        expect(() => clientRpc.send("notify", 1)).toThrow(
            "Agent channel disconnected",
        );

        const client2 = createFakeChannel();
        const server2 = createFakeChannel();
        connect(client2, server2);
        createEchoServer("server", server2);
        clientRpc.rebind(client2);

        await expect(clientRpc.invoke("echo", 9)).resolves.toBe(9);
        expect(() => clientRpc.send("notify", 1)).not.toThrow();
    });

    it("round-trips invokes on a new channel after rebind", async () => {
        const client1 = createFakeChannel();
        const clientRpc = createRebindableClient<EchoInvoke>("client", client1);

        client1.fireDisconnect();

        const client2 = createFakeChannel();
        const server2 = createFakeChannel();
        connect(client2, server2);
        createEchoServer("server", server2, 100);

        clientRpc.rebind(client2);

        await expect(clientRpc.invoke("echo", 5)).resolves.toBe(105);
    });

    it("round-trips sends on a new channel after rebind", async () => {
        const client1 = createFakeChannel();
        const clientRpc = createRebindableClient<{}, Notify>("client", client1);

        const client2 = createFakeChannel();
        const server2 = createFakeChannel();
        connect(client2, server2);
        const received: number[] = [];
        createRpc<{}, {}, {}, Notify>("server", server2, undefined, {
            notify: (x: number) => {
                received.push(x);
            },
        });

        clientRpc.rebind(client2);
        clientRpc.send("notify", 7);

        await flushMicrotasks();
        expect(received).toEqual([7]);
    });

    it("rejects in-flight invokes on the old channel when rebinding", async () => {
        const client1 = createFakeChannel();
        // No peer: the server never answers, so the call stays in-flight.
        const clientRpc = createRebindableClient<EchoInvoke>("client", client1);

        const inflight = clientRpc.invoke("echo", 1);
        const client2 = createFakeChannel();
        clientRpc.rebind(client2);

        await expect(inflight).rejects.toThrow("Agent channel rebound");
    });

    it("ignores a stale channel disconnect after rebind", async () => {
        const client1 = createFakeChannel();
        const clientRpc = createRebindableClient<EchoInvoke, Notify>(
            "client",
            client1,
        );

        const client2 = createFakeChannel();
        const server2 = createFakeChannel();
        connect(client2, server2);
        createEchoServer("server", server2);

        clientRpc.rebind(client2);
        // The abandoned channel fires disconnect; the live channel must be
        // unaffected (no poison, no rejection of its calls).
        client1.fireDisconnect();

        await expect(clientRpc.invoke("echo", 9)).resolves.toBe(9);
        expect(() => clientRpc.send("notify", 1)).not.toThrow();
    });

    it("survives multiple sequential rebinds", async () => {
        const client1 = createFakeChannel();
        const clientRpc = createRebindableClient<EchoInvoke>("client", client1);

        for (let i = 0; i < 3; i++) {
            const c = createFakeChannel();
            const s = createFakeChannel();
            connect(c, s);
            createEchoServer(`server${i}`, s, i);
            clientRpc.rebind(c);
            await expect(clientRpc.invoke("echo", 10)).resolves.toBe(10 + i);
        }
    });
});

describe("createRpc OpenTelemetry propagation", () => {
    let fixture: TraceFixture | undefined;

    beforeEach(() => {
        fixture = installTraceFixture();
    });

    afterEach(async () => {
        await disposeTraceFixture(fixture);
        fixture = undefined;
    });

    function createTracingPair(
        serverOptions?: RpcOptions,
        clientOptions?: RpcOptions,
        handler: (value: number) => Promise<number> = async (value) => value,
    ) {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);
        const clientRpc = createRpc<EchoInvoke>(
            "client",
            client,
            undefined,
            undefined,
            clientOptions,
        );
        createRpc<{}, {}, EchoInvoke>(
            "server",
            server,
            { echo: handler },
            undefined,
            serverOptions,
        );
        return { client, server, clientRpc };
    }

    it("creates one CLIENT span and one parented SERVER span on a trusted channel", async () => {
        const { client, clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            {
                tracing: {
                    propagateContext: true,
                    getCorrelationFields: () => ({
                        traceId: "legacy-trace",
                        sessionId: "session-1",
                        activationId: "activation-1",
                    }),
                },
            },
        );

        await expect(clientRpc.invoke("echo", 42)).resolves.toBe(42);

        const spans = fixture!.exporter.getFinishedSpans();
        expect(spans).toHaveLength(2);
        const clientSpan = findSpan(spans, SpanKind.CLIENT);
        const serverSpan = findSpan(spans, SpanKind.SERVER);
        expect(serverSpan.spanContext().traceId).toBe(
            clientSpan.spanContext().traceId,
        );
        expect(getParentSpanId(serverSpan)).toBe(
            clientSpan.spanContext().spanId,
        );
        expect(clientSpan.status.code).toBe(SpanStatusCode.UNSET);
        expect(serverSpan.status.code).toBe(SpanStatusCode.UNSET);
        expect(serverSpan.attributes).toMatchObject({
            "typeagent.trace.id": "legacy-trace",
            "typeagent.session.id": "session-1",
            "typeagent.activation.id": "activation-1",
        });
        expect(client.sent[0].metadata).toMatchObject({
            version: RPC_METADATA_VERSION,
            typeagent: {
                traceId: "legacy-trace",
                sessionId: "session-1",
                activationId: "activation-1",
            },
        });
    });

    it("does not extract valid remote context unless the channel opts into trust", async () => {
        const { clientRpc } = createTracingPair(undefined, {
            tracing: { propagateContext: true },
        });

        await clientRpc.invoke("echo", 1);

        const spans = fixture!.exporter.getFinishedSpans();
        const clientSpan = findSpan(spans, SpanKind.CLIENT);
        const serverSpan = findSpan(spans, SpanKind.SERVER);
        expect(serverSpan.spanContext().traceId).not.toBe(
            clientSpan.spanContext().traceId,
        );
        expect(getParentSpanId(serverSpan)).toBeUndefined();
    });

    it("does not disclose propagation metadata without outbound opt-in", async () => {
        const { client, clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            {
                tracing: {
                    getCorrelationFields: () => ({
                        sessionId: "must-not-leave",
                    }),
                },
            },
        );

        await clientRpc.invoke("echo", 1);

        expect(client.sent[0].metadata).toBeUndefined();
        const spans = fixture!.exporter.getFinishedSpans();
        const clientSpan = findSpan(spans, SpanKind.CLIENT);
        const serverSpan = findSpan(spans, SpanKind.SERVER);
        expect(serverSpan.spanContext().traceId).not.toBe(
            clientSpan.spanContext().traceId,
        );
        expect(clientSpan.attributes["typeagent.session.id"]).toBeUndefined();
    });

    it("ignores malformed propagated context without failing the RPC", async () => {
        const { client, clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            { tracing: { propagateContext: true } },
        );

        const result = clientRpc.invoke("echo", 7);
        client.sent[0].metadata.traceparent = "malformed";
        await expect(result).resolves.toBe(7);

        const spans = fixture!.exporter.getFinishedSpans();
        const clientSpan = findSpan(spans, SpanKind.CLIENT);
        const serverSpan = findSpan(spans, SpanKind.SERVER);
        expect(serverSpan.spanContext().traceId).not.toBe(
            clientSpan.spanContext().traceId,
        );
        expect(getParentSpanId(serverSpan)).toBeUndefined();
    });

    it("accepts bounded W3C tracestate on a trusted channel", async () => {
        const { client, clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            { tracing: { propagateContext: true } },
        );

        const result = clientRpc.invoke("echo", 7);
        client.sent[0].metadata.tracestate =
            "vendor=value, tenant@system=other";
        await expect(result).resolves.toBe(7);

        const spans = fixture!.exporter.getFinishedSpans();
        const clientSpan = findSpan(spans, SpanKind.CLIENT);
        const serverSpan = findSpan(spans, SpanKind.SERVER);
        expect(serverSpan.spanContext().traceId).toBe(
            clientSpan.spanContext().traceId,
        );
        expect(getParentSpanId(serverSpan)).toBe(
            clientSpan.spanContext().spanId,
        );
    });

    it.each([
        [
            "an unsupported envelope version",
            (metadata: any) => {
                metadata.version = RPC_METADATA_VERSION + 1;
            },
        ],
        [
            "an oversized traceparent",
            (metadata: any) => {
                metadata.traceparent = "0".repeat(513);
            },
        ],
    ])("ignores %s without failing the RPC", async (_name, mutateMetadata) => {
        const { client, clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            { tracing: { propagateContext: true } },
        );

        const result = clientRpc.invoke("echo", 7);
        mutateMetadata(client.sent[0].metadata);
        await expect(result).resolves.toBe(7);

        const spans = fixture!.exporter.getFinishedSpans();
        const clientSpan = findSpan(spans, SpanKind.CLIENT);
        const serverSpan = findSpan(spans, SpanKind.SERVER);
        expect(serverSpan.spanContext().traceId).not.toBe(
            clientSpan.spanContext().traceId,
        );
        expect(getParentSpanId(serverSpan)).toBeUndefined();
    });

    it("drops malformed tracestate without discarding a valid traceparent", async () => {
        const { client, clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            { tracing: { propagateContext: true } },
        );

        const result = clientRpc.invoke("echo", 7);
        client.sent[0].metadata.tracestate = `key=${"x".repeat(509)}`;
        await expect(result).resolves.toBe(7);

        const spans = fixture!.exporter.getFinishedSpans();
        const clientSpan = findSpan(spans, SpanKind.CLIENT);
        const serverSpan = findSpan(spans, SpanKind.SERVER);
        expect(serverSpan.spanContext().traceId).toBe(
            clientSpan.spanContext().traceId,
        );
        expect(getParentSpanId(serverSpan)).toBe(
            clientSpan.spanContext().spanId,
        );
    });

    it("omits unknown, malformed, and oversized correlation fields", async () => {
        const { client, clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            {
                tracing: {
                    propagateContext: true,
                    getCorrelationFields: () =>
                        ({
                            sessionId: "session-valid",
                            traceId: "contains spaces",
                            activationId: "x".repeat(257),
                            userText: "must-not-propagate",
                        }) as any,
                },
            },
        );

        await clientRpc.invoke("echo", 1);

        expect(client.sent[0].metadata.typeagent).toEqual({
            sessionId: "session-valid",
        });
        const serverSpan = findSpan(
            fixture!.exporter.getFinishedSpans(),
            SpanKind.SERVER,
        );
        expect(serverSpan.attributes["typeagent.session.id"]).toBe(
            "session-valid",
        );
        expect(serverSpan.attributes["typeagent.trace.id"]).toBeUndefined();
        expect(
            serverSpan.attributes["typeagent.activation.id"],
        ).toBeUndefined();
    });

    it("resolves correlation fields from each invocation", async () => {
        const invocations: { method: string; args: readonly unknown[] }[] = [];
        const { client, clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            {
                tracing: {
                    propagateContext: true,
                    getCorrelationFields: (invocation) => {
                        invocations.push(invocation);
                        return { sessionId: `session-${invocation.args[0]}` };
                    },
                },
            },
        );

        await clientRpc.invoke("echo", 3);
        await clientRpc.invoke("echo", 4);

        expect(invocations).toEqual([
            { method: "echo", args: [3] },
            { method: "echo", args: [4] },
        ]);
        expect(client.sent[0].metadata.typeagent.sessionId).toBe("session-3");
        expect(client.sent[1].metadata.typeagent.sessionId).toBe("session-4");
    });

    it("does not create spans for one-way notifications", async () => {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);
        const clientRpc = createRpc<{}, Notify>("client", client);
        createRpc<{}, {}, {}, Notify>("server", server, undefined, {
            notify: () => {},
        });

        clientRpc.send("notify", 1);
        await flushMicrotasks();

        expect(fixture!.exporter.getFinishedSpans()).toHaveLength(0);
    });

    it("rejects malformed invoke messages with a usable callId", async () => {
        const server = createFakeChannel();
        createRpc<{}, {}, EchoInvoke>("server", server, {
            echo: async (value) => value,
        });

        server.deliver({
            type: "invoke",
            callId: 17,
            name: null,
            args: [1],
        });
        await flushMicrotasks();

        expect(server.sent).toEqual([
            {
                type: "invokeError",
                callId: 17,
                error: "Invalid invoke message",
            },
        ]);
        expect(fixture!.exporter.getFinishedSpans()).toHaveLength(0);
    });

    it("does not orphan an active span when a callId is duplicated", async () => {
        const server = createFakeChannel();
        createRpc<{}, {}, EchoInvoke>("server", server, {
            echo: () => new Promise<number>(() => {}),
        });
        const message = {
            type: "invoke",
            callId: 5,
            name: "echo",
            args: [1],
        };

        server.deliver(message);
        server.deliver({ ...message, args: [2] });
        await flushMicrotasks();
        expect(fixture!.exporter.getFinishedSpans()).toHaveLength(0);

        server.fireDisconnect();
        await flushMicrotasks();

        const serverSpans = fixture!.exporter
            .getFinishedSpans()
            .filter((span) => span.kind === SpanKind.SERVER);
        expect(serverSpans).toHaveLength(1);
        expect(serverSpans[0]!.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "rpc failed",
        });
    });

    it("marks both spans as cancelled when existing application cancellation aborts the handler", async () => {
        type Cancel = { cancel: () => void };
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);
        const controller = new AbortController();
        const clientRpc = createRpc<EchoInvoke, Cancel>(
            "client",
            client,
            undefined,
            undefined,
            { tracing: { propagateContext: true } },
        );
        createRpc<{}, {}, EchoInvoke, Cancel>(
            "server",
            server,
            {
                echo: () =>
                    new Promise<number>((_resolve, reject) => {
                        controller.signal.addEventListener(
                            "abort",
                            () =>
                                reject(
                                    new DOMException(
                                        "cancelled by caller",
                                        "AbortError",
                                    ),
                                ),
                            { once: true },
                        );
                    }),
            },
            {
                cancel: () => controller.abort(),
            },
            { tracing: { trustRemoteContext: true } },
        );

        const result = clientRpc.invoke("echo", 1);
        await flushMicrotasks();
        clientRpc.send("cancel");
        await expect(result).rejects.toMatchObject({ name: "AbortError" });

        const spans = fixture!.exporter.getFinishedSpans();
        expect(spans).toHaveLength(2);
        for (const span of spans) {
            expect(span.status).toEqual({
                code: SpanStatusCode.ERROR,
                message: "cancelled",
            });
        }
    });

    it("preserves server cancellation and ends both spans", async () => {
        const { clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            { tracing: { propagateContext: true } },
            async () => {
                throw new DOMException("cancelled by server", "AbortError");
            },
        );

        await expect(clientRpc.invoke("echo", 1)).rejects.toMatchObject({
            name: "AbortError",
        });

        const spans = fixture!.exporter.getFinishedSpans();
        expect(spans).toHaveLength(2);
        for (const span of spans) {
            expect(span.status).toEqual({
                code: SpanStatusCode.ERROR,
                message: "cancelled",
            });
        }
    });

    it("records stable statuses for remote errors and ends both spans", async () => {
        const { clientRpc } = createTracingPair(
            { tracing: { trustRemoteContext: true } },
            { tracing: { propagateContext: true } },
            async () => {
                throw new Error("private server detail");
            },
        );

        await expect(clientRpc.invoke("echo", 1)).rejects.toThrow(
            "private server detail",
        );

        const spans = fixture!.exporter.getFinishedSpans();
        const clientSpan = findSpan(spans, SpanKind.CLIENT);
        const serverSpan = findSpan(spans, SpanKind.SERVER);
        expect(clientSpan.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "remote error",
        });
        expect(serverSpan.status).toEqual({
            code: SpanStatusCode.ERROR,
            message: "request failed",
        });
    });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createRpc,
    RPC_STRUCTURED_EVENTS,
    type RpcStructuredLogger,
} from "../src/rpc.js";
import type { RpcChannel } from "../src/common.js";

type CapturedEvent = {
    eventName: string;
    entry: Record<string, unknown>;
    severity: "info" | "warning" | "error" | undefined;
};

function createRecordingLogger(): {
    logger: RpcStructuredLogger;
    events: CapturedEvent[];
} {
    const events: CapturedEvent[] = [];
    return {
        events,
        logger: {
            logEvent(eventName, entry, severity) {
                events.push({ eventName, entry, severity });
            },
        },
    };
}

// Trimmed fake channel: enough to round-trip messages between two rpcs.
type FakeChannel = RpcChannel & {
    deliver(message: any): void;
    fireDisconnect(): void;
    setPeer(peer: FakeChannel): void;
};

function createFakeChannel(): FakeChannel {
    const messageHandlers: ((m: any) => void)[] = [];
    const disconnectHandlers: (() => void)[] = [];
    let peer: FakeChannel | undefined;

    const channel: FakeChannel = {
        on(event: "message" | "disconnect", cb: any) {
            (event === "message" ? messageHandlers : disconnectHandlers).push(
                cb,
            );
        },
        once() {
            // Sufficient for these tests; disconnect subscribers use `once`
            // but we do not exercise disconnect here.
        },
        off(event: "message" | "disconnect", cb: any) {
            const list =
                event === "message" ? messageHandlers : disconnectHandlers;
            const i = list.indexOf(cb);
            if (i >= 0) {
                list.splice(i, 1);
            }
        },
        send(message: any, cb?: (err: Error | null) => void) {
            if (peer) {
                queueMicrotask(() => peer!.deliver(message));
            }
            cb?.(null);
        },
        deliver(message: any) {
            for (const h of [...messageHandlers]) {
                h(message);
            }
        },
        fireDisconnect() {
            for (const h of [...disconnectHandlers]) {
                h();
            }
        },
        setPeer(p: FakeChannel) {
            peer = p;
        },
    };
    return channel;
}

function connect(a: FakeChannel, b: FakeChannel) {
    a.setPeer(b);
    b.setPeer(a);
}

function flushMicrotasks(): Promise<void> {
    return new Promise((r) => queueMicrotask(() => r()));
}

type EchoInvoke = { echo: (x: number) => Promise<number> };

/**
 * These tests exercise the `rpc:started` / `rpc:completed` events emitted by
 * `createRpc`. The invariants they lock in:
 *
 * - Both client and server invoke boundaries emit `started` on arrival and
 *   `completed` on settlement.
 * - `completed` carries a `status` union (`succeeded`/`failed`/`cancelled`)
 *   and only real failures carry classification fields.
 * - The events never contain rpc arguments, results, or raw error text.
 * - The logger is optional and behavior-safe: a logger that throws must not
 *   break the rpc; omitting the logger leaves invoke behavior unchanged.
 */
describe("rpc structured lifecycle events", () => {
    function assertNoSensitiveText(entry: Record<string, unknown>) {
        for (const key of Object.keys(entry)) {
            // Whitelist the exact set of fields the event contract permits.
            expect(
                [
                    "role",
                    "channel",
                    "method",
                    "callId",
                    "status",
                    "success",
                    "cancelled",
                    "elapsedMs",
                    "errorCategory",
                    "errorCode",
                    "httpStatus",
                    "retryable",
                ].includes(key),
            ).toBe(true);
        }
        // Belt-and-suspenders: none of the produced string values should
        // look like an error message or an arg payload.
        for (const value of Object.values(entry)) {
            if (typeof value === "string") {
                expect(value).not.toMatch(/secret|password|prompt|args/i);
            }
        }
    }

    it("emits started+completed on both client and server on success", async () => {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);

        const clientLogger = createRecordingLogger();
        const serverLogger = createRecordingLogger();

        const clientRpc = createRpc<EchoInvoke>(
            "client-a",
            client,
            undefined,
            undefined,
            { logger: clientLogger.logger },
        );
        createRpc<{}, {}, EchoInvoke>(
            "server-a",
            server,
            { echo: async (x: number) => x * 2 },
            undefined,
            { logger: serverLogger.logger },
        );

        await expect(clientRpc.invoke("echo", 21)).resolves.toBe(42);
        await flushMicrotasks();

        const clientStart = clientLogger.events.find(
            (e) => e.eventName === RPC_STRUCTURED_EVENTS.started,
        );
        const clientEnd = clientLogger.events.find(
            (e) => e.eventName === RPC_STRUCTURED_EVENTS.completed,
        );
        const serverStart = serverLogger.events.find(
            (e) => e.eventName === RPC_STRUCTURED_EVENTS.started,
        );
        const serverEnd = serverLogger.events.find(
            (e) => e.eventName === RPC_STRUCTURED_EVENTS.completed,
        );

        expect(clientStart).toBeDefined();
        expect(clientStart!.entry).toEqual({
            role: "client",
            channel: "client-a",
            method: "echo",
            callId: 0,
        });
        expect(clientEnd).toBeDefined();
        expect(clientEnd!.entry).toMatchObject({
            role: "client",
            channel: "client-a",
            method: "echo",
            callId: 0,
            status: "succeeded",
            success: true,
        });
        expect(clientEnd!.entry).not.toHaveProperty("errorCategory");
        expect(clientEnd!.entry).not.toHaveProperty("cancelled");
        expect(typeof clientEnd!.entry.elapsedMs).toBe("number");
        expect(clientEnd!.severity).toBe("info");

        expect(serverStart).toBeDefined();
        expect(serverStart!.entry).toMatchObject({
            role: "server",
            channel: "server-a",
            method: "echo",
            callId: 0,
        });
        expect(serverEnd).toBeDefined();
        expect(serverEnd!.entry).toMatchObject({
            role: "server",
            channel: "server-a",
            method: "echo",
            callId: 0,
            status: "succeeded",
            success: true,
        });
        expect(serverEnd!.entry).not.toHaveProperty("errorCategory");
        expect(typeof serverEnd!.entry.elapsedMs).toBe("number");

        // No sensitive text was smuggled through any event.
        for (const e of [...clientLogger.events, ...serverLogger.events]) {
            assertNoSensitiveText(e.entry);
        }
    });

    it("classifies a real handler failure via the shared classifier", async () => {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);

        const clientLogger = createRecordingLogger();
        const serverLogger = createRecordingLogger();

        const clientRpc = createRpc<EchoInvoke>(
            "client-b",
            client,
            undefined,
            undefined,
            { logger: clientLogger.logger },
        );
        // Handler throws a shape the shared classifier recognizes as
        // `network` (ECONNREFUSED), so both spans and events derive the
        // same category from the same value.
        createRpc<{}, {}, EchoInvoke>(
            "server-b",
            server,
            {
                echo: async () => {
                    const err: any = new Error("connection refused");
                    err.code = "ECONNREFUSED";
                    throw err;
                },
            },
            undefined,
            { logger: serverLogger.logger },
        );

        await expect(clientRpc.invoke("echo", 1)).rejects.toBeDefined();
        await flushMicrotasks();

        const serverEnd = serverLogger.events.find(
            (e) => e.eventName === RPC_STRUCTURED_EVENTS.completed,
        );
        expect(serverEnd!.entry).toMatchObject({
            role: "server",
            status: "failed",
            success: false,
            errorCategory: "network",
            errorCode: "ECONNREFUSED",
            retryable: true,
        });
        expect(serverEnd!.severity).toBe("error");
        expect(serverEnd!.entry).not.toHaveProperty("cancelled");

        const clientEnd = clientLogger.events.find(
            (e) => e.eventName === RPC_STRUCTURED_EVENTS.completed,
        );
        // The client side does not see the server's original error object.
        // It sees a synthesized `Error` with the transmitted message, which
        // the classifier reports as `internal` (no shape signals). This is
        // the correct behaviour: the wire strips the classifier's inputs.
        expect(clientEnd!.entry).toMatchObject({
            role: "client",
            status: "failed",
            success: false,
        });
        expect(clientEnd!.entry.errorCategory).toBeDefined();

        for (const e of [...clientLogger.events, ...serverLogger.events]) {
            assertNoSensitiveText(e.entry);
        }
    });

    it("reports a wrapped AbortError as cancelled without classification", async () => {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);

        const clientLogger = createRecordingLogger();
        const serverLogger = createRecordingLogger();

        const clientRpc = createRpc<EchoInvoke>(
            "client-c",
            client,
            undefined,
            undefined,
            { logger: clientLogger.logger },
        );
        // A phase-style wrapper around an AbortError. A name-only check
        // would report this as a plain failure; the shared classifier walks
        // the cause chain and reports `cancelled`.
        createRpc<{}, {}, EchoInvoke>(
            "server-c",
            server,
            {
                echo: async () => {
                    const cause = new Error("aborted");
                    cause.name = "AbortError";
                    const wrapper: any = new Error("phase failed");
                    wrapper.cause = cause;
                    throw wrapper;
                },
            },
            undefined,
            { logger: serverLogger.logger },
        );

        await expect(clientRpc.invoke("echo", 1)).rejects.toMatchObject({
            name: "AbortError",
        });
        await flushMicrotasks();

        const serverEnd = serverLogger.events.find(
            (e) => e.eventName === RPC_STRUCTURED_EVENTS.completed,
        );
        expect(serverEnd!.entry).toMatchObject({
            role: "server",
            status: "cancelled",
            success: false,
            cancelled: true,
        });
        // Cancellation is a disposition, not a failure to classify.
        expect(serverEnd!.entry).not.toHaveProperty("errorCategory");
        expect(serverEnd!.severity).toBe("warning");

        const clientEnd = clientLogger.events.find(
            (e) => e.eventName === RPC_STRUCTURED_EVENTS.completed,
        );
        expect(clientEnd!.entry).toMatchObject({
            role: "client",
            status: "cancelled",
            success: false,
            cancelled: true,
        });
        expect(clientEnd!.entry).not.toHaveProperty("errorCategory");

        for (const e of [...clientLogger.events, ...serverLogger.events]) {
            assertNoSensitiveText(e.entry);
        }
    });

    it("survives a logger that throws without failing the rpc", async () => {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);

        const brokenLogger: RpcStructuredLogger = {
            logEvent() {
                throw new Error("logger broken");
            },
        };

        const clientRpc = createRpc<EchoInvoke>(
            "client-d",
            client,
            undefined,
            undefined,
            { logger: brokenLogger },
        );
        createRpc<{}, {}, EchoInvoke>(
            "server-d",
            server,
            { echo: async (x: number) => x + 1 },
            undefined,
            { logger: brokenLogger },
        );

        await expect(clientRpc.invoke("echo", 41)).resolves.toBe(42);
    });

    it("emits no events when no logger is provided", async () => {
        const client = createFakeChannel();
        const server = createFakeChannel();
        connect(client, server);

        // Neither side supplies a logger; behavior must be identical to the
        // pre-events code path.
        const clientRpc = createRpc<EchoInvoke>("client-e", client);
        createRpc<{}, {}, EchoInvoke>("server-e", server, {
            echo: async (x: number) => x - 1,
        });

        await expect(clientRpc.invoke("echo", 43)).resolves.toBe(42);
    });
});

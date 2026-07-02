// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "../src/rpc.js";
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

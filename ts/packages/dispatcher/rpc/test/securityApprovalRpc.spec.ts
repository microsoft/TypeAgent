// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelAdapter } from "@typeagent/agent-rpc/channel";
import type { ClientIO } from "@typeagent/dispatcher-types";
import { createClientIORpcClient } from "../src/clientIOClient.js";
import { createClientIORpcServer } from "../src/clientIOServer.js";

const request = {
    message: "Run local code?",
    choices: ["Run", "Cancel"],
    defaultId: 1,
};

function fixture(approval: NonNullable<ClientIO["requestSecurityApproval"]>) {
    const server = createChannelAdapter((message, callback) => {
        client.notifyMessage(structuredClone(message));
        callback?.(null);
    });
    const client = createChannelAdapter((message, callback) => {
        server.notifyMessage(structuredClone(message));
        callback?.(null);
    });
    createClientIORpcServer(
        { requestSecurityApproval: approval } as ClientIO,
        server.channel,
    );
    const io = createClientIORpcClient(client.channel);
    return {
        request: (signal?: AbortSignal) =>
            io.requestSecurityApproval!(
                { requestId: "request" },
                request,
                "powershell",
                signal,
            ),
        disconnect() {
            client.notifyDisconnected();
            server.notifyDisconnected();
        },
    };
}

describe("security approval cancellation over serialized ClientIO RPC", () => {
    test("Stop aborts only its own prompt, finishes RPC, and ignores a late answer", async () => {
        const signals: AbortSignal[] = [];
        const answers: ((choice: number) => void)[] = [];
        const rpc = fixture(async (_id, _request, _source, signal) => {
            if (!signal) throw new Error("Missing prompt signal");
            signals.push(signal);
            return new Promise<number>((resolve) => answers.push(resolve));
        });
        const controller = new AbortController();
        const first = rpc.request(controller.signal);
        const second = rpc.request();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(signals).toHaveLength(2);
        const rejected = expect(first).rejects.toThrow();
        controller.abort();
        await rejected;
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
        answers[0](0);
        answers[1](1);
        await expect(second).resolves.toBe(1);
        rpc.disconnect();
    });

    test("disconnect aborts the UI even if it has not answered", async () => {
        let signal: AbortSignal | undefined;
        const rpc = fixture(async (_id, _request, _source, promptSignal) => {
            signal = promptSignal;
            return new Promise<number>(() => {});
        });
        const controller = new AbortController();
        const rejected = expect(
            rpc.request(controller.signal),
        ).rejects.toThrow();
        await new Promise<void>((resolve) => setImmediate(resolve));
        rpc.disconnect();
        await rejected;
        expect(signal?.aborted).toBe(true);
        // Request cancellation after transport closure must not attempt a send.
        controller.abort();
    });

    test("cancellation immediately after sending cannot overtake approval registration", async () => {
        let signal: AbortSignal | undefined;
        const rpc = fixture(async (_id, _request, _source, promptSignal) => {
            signal = promptSignal;
            return new Promise<number>(() => {});
        });
        const controller = new AbortController();
        const rejected = expect(
            rpc.request(controller.signal),
        ).rejects.toThrow();
        controller.abort();
        await rejected;
        expect(signal?.aborted).toBe(true);
        rpc.disconnect();
    });

    test("disconnect before handler dispatch cannot open a new prompt", async () => {
        let calls = 0;
        const rpc = fixture(async () => {
            calls++;
            return 0;
        });
        const rejected = expect(rpc.request()).rejects.toThrow();
        rpc.disconnect();
        await rejected;
        expect(calls).toBe(0);
    });

    test("already cancelled requests never reach the UI", async () => {
        let calls = 0;
        const rpc = fixture(async () => {
            calls++;
            return 0;
        });
        const controller = new AbortController();
        controller.abort();
        await expect(rpc.request(controller.signal)).rejects.toThrow();
        expect(calls).toBe(0);
        rpc.disconnect();
    });

    test("a completed review cannot cancel the following prompt", async () => {
        let secondSignal: AbortSignal | undefined;
        let calls = 0;
        const rpc = fixture(async (_id, _request, _source, signal) => {
            calls++;
            if (calls === 2) secondSignal = signal;
            return 1;
        });
        const first = new AbortController();
        await expect(rpc.request(first.signal)).resolves.toBe(1);
        const second = rpc.request();
        first.abort();
        await expect(second).resolves.toBe(1);
        expect(secondSignal?.aborted).toBe(false);
        rpc.disconnect();
    });
});

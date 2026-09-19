// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CancellationControlTarget,
    cancellationControlCallCount,
    clearCancellationControlCalls,
    forwardCancellationControlRequest,
    handleCancellationControlDisconnect,
    resolveCancellationControlResponse,
} from "../src/cancellationControl.js";

type SentMessage = { clientId: string; payload: any };

class FakeServer implements CancellationControlTarget {
    public sent: SentMessage[] = [];
    private unreachable = new Set<string>();

    public disconnect(clientId: string) {
        this.unreachable.add(clientId);
    }

    public sendToClient(clientId: string, message: string): boolean {
        if (this.unreachable.has(clientId)) {
            return false;
        }
        this.sent.push({ clientId, payload: JSON.parse(message) });
        return true;
    }

    public to(clientId: string): SentMessage[] {
        return this.sent.filter((message) => message.clientId === clientId);
    }
}

const requester = "control-client";
const target = "coda-client";

function forward(
    server: FakeServer,
    callId = 1,
    responseId: unknown = "exec-1",
) {
    forwardCancellationControlRequest(server, {
        callId,
        clientId: requester,
        targetClientId: target,
        responseId,
        executionId: "exec-1",
        method: "code/cancelWorkspaceCommand",
        params: { executionId: "exec-1" },
    });
}

function failureSentTo(server: FakeServer, clientId: string) {
    const messages = server.to(clientId);
    expect(messages).toHaveLength(1);
    return JSON.parse(messages[0].payload.result);
}

describe("cancellation control routing", () => {
    afterEach(() => {
        clearCancellationControlCalls();
    });

    test("forwards to the target and maps the response back to the requester id", () => {
        const server = new FakeServer();
        forward(server, 7, "caller-supplied-id");

        // The target sees the internal call id, not the requester's id.
        expect(server.to(target)[0].payload).toMatchObject({
            id: 7,
            method: "code/cancelWorkspaceCommand",
            params: { executionId: "exec-1", allowPendingCancellation: true },
        });
        expect(cancellationControlCallCount()).toBe(1);

        const routed = resolveCancellationControlResponse(server, {
            id: 7,
            result: JSON.stringify({ success: true }),
        });

        expect(routed).toBe(true);
        expect(server.to(requester)[0].payload).toMatchObject({
            id: "caller-supplied-id",
        });
        expect(cancellationControlCallCount()).toBe(0);
    });

    test("ignores a response that does not belong to the control table", () => {
        const server = new FakeServer();
        expect(
            resolveCancellationControlResponse(server, {
                id: 99,
                result: "{}",
            }),
        ).toBe(false);
        expect(server.sent).toHaveLength(0);
    });

    test("answers the requester when the target disconnects", () => {
        const server = new FakeServer();
        forward(server);
        server.sent = [];

        handleCancellationControlDisconnect(server, target);

        expect(failureSentTo(server, requester)).toMatchObject({
            success: false,
            cancelled: false,
            executionId: "exec-1",
            error: "The Coda workspace disconnected before responding to the cancellation request.",
        });
        expect(cancellationControlCallCount()).toBe(0);
    });

    test("drops the entry silently when the requester disconnects", () => {
        const server = new FakeServer();
        forward(server);
        server.sent = [];

        handleCancellationControlDisconnect(server, requester);

        expect(server.sent).toHaveLength(0);
        expect(cancellationControlCallCount()).toBe(0);
    });

    test("answers the requester when the forward cannot be delivered", () => {
        const server = new FakeServer();
        server.disconnect(target);

        forward(server);

        expect(failureSentTo(server, requester)).toMatchObject({
            success: false,
            error: "The Coda workspace disconnected before the cancellation request could be delivered.",
        });
        expect(cancellationControlCallCount()).toBe(0);
    });

    test("answers the requester when the target never responds", async () => {
        const server = new FakeServer();
        forwardCancellationControlRequest(server, {
            callId: 1,
            clientId: requester,
            targetClientId: target,
            responseId: "exec-1",
            executionId: "exec-1",
            method: "code/cancelWorkspaceCommand",
            params: { executionId: "exec-1" },
            timeoutMs: 10,
        });
        server.sent = [];

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(failureSentTo(server, requester)).toMatchObject({
            success: false,
            error: "The Coda workspace did not respond to the cancellation request.",
        });
        expect(cancellationControlCallCount()).toBe(0);
    });

    test("clears every entry on teardown", () => {
        const server = new FakeServer();
        forward(server, 1, "a");
        forward(server, 2, "b");
        expect(cancellationControlCallCount()).toBe(2);

        clearCancellationControlCalls();

        expect(cancellationControlCallCount()).toBe(0);
    });
});

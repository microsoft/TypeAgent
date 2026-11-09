// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Routing table for cancellation requests that arrive from a control client
// (the Command Executor) and must be forwarded to a Coda workspace client.
// The forwarded message carries an internally allocated call id so responses
// can be matched, then mapped back to the id the requester used.
//
// Every entry must be removed exactly once, on one of: a response, the target
// disconnecting, the requester disconnecting, a delivery failure, the timeout,
// or server teardown. A leaked entry hangs the requester until its own
// timeout, so the invariant worth testing is that the table returns to empty.

// How long a forwarded cancellation may sit unanswered by the Coda workspace
// before the requester is told it failed. Unrelated to the runner's
// STOP_FALLBACK_MS in the Coda extension.
export const CANCELLATION_CONTROL_TIMEOUT_MS = 5_000;

// Only the piece of CodeAgentWebSocketServer this table needs, so the routing
// can be exercised without a live websocket server.
export interface CancellationControlTarget {
    sendToClient(clientId: string, message: string): boolean;
}

type CancellationControlCall = {
    clientId: string;
    targetClientId: string;
    responseId: unknown;
    executionId: string;
    timeout: NodeJS.Timeout;
};

const cancellationControlCalls = new Map<number, CancellationControlCall>();

export function cancellationControlCallCount(): number {
    return cancellationControlCalls.size;
}

function deleteCancellationControlCall(
    callId: number,
): CancellationControlCall | undefined {
    const call = cancellationControlCalls.get(callId);
    if (call !== undefined) {
        clearTimeout(call.timeout);
        cancellationControlCalls.delete(callId);
    }
    return call;
}

export function sendCancellationControlFailure(
    server: CancellationControlTarget,
    call: { clientId: string; responseId: unknown; executionId: string },
    error: string,
): void {
    server.sendToClient(
        call.clientId,
        JSON.stringify({
            id: call.responseId,
            result: JSON.stringify({
                success: false,
                error,
                cancelled: false,
                pendingCancellation: false,
                executionId: call.executionId,
            }),
        }),
    );
}

// Drops entries without answering the requester. Only correct when the server
// is going away, since the requester's connection is going away with it.
export function clearCancellationControlCalls(): void {
    for (const callId of [...cancellationControlCalls.keys()]) {
        deleteCancellationControlCall(callId);
    }
}

export function forwardCancellationControlRequest(
    server: CancellationControlTarget,
    request: {
        callId: number;
        clientId: string;
        targetClientId: string;
        responseId: unknown;
        executionId: string;
        method: string;
        params: Record<string, unknown>;
        // Overridable so tests can exercise the timeout without waiting.
        timeoutMs?: number;
    },
): void {
    const { callId } = request;
    const timeout = setTimeout(() => {
        const call = deleteCancellationControlCall(callId);
        if (call !== undefined) {
            sendCancellationControlFailure(
                server,
                call,
                "The Coda workspace did not respond to the cancellation request.",
            );
        }
    }, request.timeoutMs ?? CANCELLATION_CONTROL_TIMEOUT_MS);
    timeout.unref();
    cancellationControlCalls.set(callId, {
        clientId: request.clientId,
        targetClientId: request.targetClientId,
        responseId: request.responseId,
        executionId: request.executionId,
        timeout,
    });
    if (
        !server.sendToClient(
            request.targetClientId,
            JSON.stringify({
                id: callId,
                method: request.method,
                params: { ...request.params, allowPendingCancellation: true },
            }),
        )
    ) {
        const call = deleteCancellationControlCall(callId);
        if (call !== undefined) {
            sendCancellationControlFailure(
                server,
                call,
                "The Coda workspace disconnected before the cancellation request could be delivered.",
            );
        }
    }
}

// Returns true when the message was a forwarded cancellation response and has
// been routed back to the requester under its original id.
export function resolveCancellationControlResponse(
    server: CancellationControlTarget,
    data: { id?: unknown; result?: unknown },
): boolean {
    const call = deleteCancellationControlCall(Number(data.id));
    if (call === undefined) {
        return false;
    }
    server.sendToClient(
        call.clientId,
        JSON.stringify({ ...data, id: call.responseId }),
    );
    return true;
}

export function handleCancellationControlDisconnect(
    server: CancellationControlTarget,
    clientId: string,
): void {
    for (const [callId, call] of [...cancellationControlCalls]) {
        if (call.clientId !== clientId && call.targetClientId !== clientId) {
            continue;
        }
        deleteCancellationControlCall(callId);
        // Only the requester is still around to hear about it.
        if (call.targetClientId === clientId && call.clientId !== clientId) {
            sendCancellationControlFailure(
                server,
                call,
                "The Coda workspace disconnected before responding to the cancellation request.",
            );
        }
    }
}

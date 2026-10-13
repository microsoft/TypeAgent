// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import type { ClientIO } from "@typeagent/dispatcher-types";
import type {
    ClientIOCallFunctions,
    ClientIOInvokeFunctions,
} from "./clientIOTypes.js";

export function createClientIORpcServer(
    clientIO: ClientIO,
    channel: RpcChannel,
) {
    const approvals = new Map<number, AbortController>();
    let connected = true;
    channel.once("disconnect", () => {
        connected = false;
        for (const controller of approvals.values()) controller.abort();
        approvals.clear();
    });
    const clientIOInvokeFunctions: ClientIOInvokeFunctions = {
        cancelSecurityApproval: async (approvalId) => {
            approvals.get(approvalId)?.abort();
        },
        question: async (...args) => {
            return clientIO.question(...args);
        },
        requestSecurityApproval: async (
            requestId,
            request,
            source,
            approvalId,
        ) => {
            if (!connected)
                throw new Error("Security approval channel disconnected.");
            if (!clientIO.requestSecurityApproval) {
                throw new Error(
                    "Security approval is unavailable in this client. Use the interactive TypeAgent Shell or CLI.",
                );
            }
            if (
                !Number.isSafeInteger(approvalId) ||
                approvalId < 0 ||
                approvals.has(approvalId)
            ) {
                throw new Error("Invalid security approval request identity.");
            }
            const controller = new AbortController();
            approvals.set(approvalId, controller);
            const { signal } = controller;
            let onAbort: () => void = () => {};
            const cancelled = new Promise<never>((_resolve, reject) => {
                onAbort = () => reject(signal.reason);
                signal.addEventListener("abort", onAbort, { once: true });
            });
            try {
                const result = await Promise.race([
                    clientIO.requestSecurityApproval(
                        requestId,
                        request,
                        source,
                        signal,
                    ),
                    cancelled,
                ]);
                signal.throwIfAborted();
                return result;
            } finally {
                signal.removeEventListener("abort", onAbort);
                approvals.delete(approvalId);
            }
        },
        proposeAction: async (...args) => {
            return clientIO.proposeAction(...args);
        },
        openLocalView: async (...args) => {
            return clientIO.openLocalView(...args);
        },
        closeLocalView: async (...args) => {
            return clientIO.closeLocalView(...args);
        },
        getUserContext: async (...args) => {
            return clientIO.getUserContext?.(...args);
        },
    };

    const clientIOCallFunctions: ClientIOCallFunctions = {
        clear: (...args) => clientIO.clear(...args),
        exit: (...args) => clientIO.exit(...args),
        shutdown: (...args) => clientIO.shutdown(...args),
        setUserRequest: (...args) => clientIO.setUserRequest(...args),
        setDisplayInfo: (...args) => clientIO.setDisplayInfo(...args),
        setDisplay: (...args) => clientIO.setDisplay(...args),
        appendDisplay: (...args) => clientIO.appendDisplay(...args),
        appendDiagnosticData: (...args) => {
            clientIO.appendDiagnosticData(...args);
        },
        setDynamicDisplay: (...args) => clientIO.setDynamicDisplay(...args),
        notify: (...args) => clientIO.notify(...args),
        requestChoice: (...args) => clientIO.requestChoice(...args),
        requestForm: (...args) => clientIO.requestForm(...args),
        requestInteraction: (...args) => clientIO.requestInteraction(...args),
        interactionResolved: (...args) => clientIO.interactionResolved(...args),
        interactionCancelled: (...args) =>
            clientIO.interactionCancelled(...args),
        takeAction: (...args) => clientIO.takeAction(...args),
        onUserFeedback: (...args) => clientIO.onUserFeedback?.(...args),
        onUserHide: (...args) => clientIO.onUserHide?.(...args),
        // Queue lifecycle events are OPTIONAL on the ClientIO contract;
        // optional chaining tolerates clients that omit them.
        requestQueued: (...args) => clientIO.requestQueued?.(...args),
        requestStarted: (...args) => clientIO.requestStarted?.(...args),
        requestCancelled: (...args) => clientIO.requestCancelled?.(...args),
        queueStateChanged: (...args) => clientIO.queueStateChanged?.(...args),
    };
    createRpc(
        "clientio",
        channel,
        clientIOInvokeFunctions,
        clientIOCallFunctions,
    );
}

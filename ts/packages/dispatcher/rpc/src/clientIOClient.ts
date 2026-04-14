// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { ClientIO } from "@typeagent/dispatcher-types";
import type {
    ClientIOCallFunctions,
    ClientIOInvokeFunctions,
} from "./clientIOTypes.js";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";

export function createClientIORpcClient(channel: RpcChannel): ClientIO {
    const rpc = createRpc<ClientIOInvokeFunctions, ClientIOCallFunctions>(
        "clientio",
        channel,
    );
    return {
        clear(...args): void {
            return rpc.send("clear", ...args);
        },
        exit(...args): void {
            return rpc.send("exit", ...args);
        },
        setUserRequest(...args): void {
            return rpc.send("setUserRequest", ...args);
        },
        setDisplayInfo(...args): void {
            return rpc.send("setDisplayInfo", ...args);
        },
        setDisplay(...args): void {
            return rpc.send("setDisplay", ...args);
        },
        appendDisplay(...args): void {
            return rpc.send("appendDisplay", ...args);
        },
        appendDiagnosticData(...args) {
            return rpc.send("appendDiagnosticData", ...args);
        },
        setDynamicDisplay(...args): void {
            return rpc.send("setDynamicDisplay", ...args);
        },

        // Input
        question(...args): Promise<number> {
            return rpc.invoke("question", ...args);
        },
        proposeAction(...args): Promise<unknown> {
            return rpc.invoke("proposeAction", ...args);
        },
        notify(...args): void {
            return rpc.send("notify", ...args);
        },
        openLocalView(...args): Promise<void> {
            return rpc.invoke("openLocalView", ...args);
        },
        closeLocalView(...args): Promise<void> {
            return rpc.invoke("closeLocalView", ...args);
        },
        requestChoice(...args): void {
            return rpc.send("requestChoice", ...args);
        },
        requestInteraction(...args): void {
            return rpc.send("requestInteraction", ...args);
        },
        interactionResolved(...args): void {
            return rpc.send("interactionResolved", ...args);
        },
        interactionCancelled(...args): void {
            return rpc.send("interactionCancelled", ...args);
        },
        takeAction(...args): void {
            return rpc.send("takeAction", ...args);
        },
    };
}

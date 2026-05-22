// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import type { ConnectionId, Dispatcher } from "@typeagent/dispatcher-types";
import type {
    DispatcherCallFunctions,
    DispatcherInvokeFunctions,
} from "./dispatcherTypes.js";

export function createDispatcherRpcClient(
    channel: RpcChannel,
    connectionId?: ConnectionId,
): Dispatcher {
    const rpc = createRpc<DispatcherInvokeFunctions, DispatcherCallFunctions>(
        "dispatcher",
        channel,
    );

    return {
        get connectionId() {
            return connectionId;
        },
        // RPC clients always go through SharedDispatcher (connected-mode
        // only — the CLI/Shell never use the in-process fallback over RPC),
        // so they always have a real queue.
        supportsQueueing: true,
        async processCommand(...args) {
            return rpc.invoke("processCommand", ...args);
        },
        async submitCommand(...args) {
            return rpc.invoke("submitCommand", ...args);
        },
        async interrupt(...args) {
            return rpc.invoke("interrupt", ...args);
        },
        async getQueueSnapshot() {
            return rpc.invoke("getQueueSnapshot");
        },
        async getDynamicDisplay(...args) {
            return rpc.invoke("getDynamicDisplay", ...args);
        },
        async getTemplateSchema(...args) {
            return rpc.invoke("getTemplateSchema", ...args);
        },
        async getTemplateCompletion(...args) {
            return rpc.invoke("getTemplateCompletion", ...args);
        },
        async getCommandCompletion(...args) {
            return rpc.invoke("getCommandCompletion", ...args);
        },
        async checkCache(...args) {
            return rpc.invoke("checkCache", ...args);
        },
        async close() {
            return rpc.invoke("close");
        },
        async getStatus() {
            return rpc.invoke("getStatus");
        },
        async getAgentSchemas(...args) {
            return rpc.invoke("getAgentSchemas", ...args);
        },
        async respondToChoice(...args) {
            return rpc.invoke("respondToChoice", ...args);
        },
        getDisplayHistory(...args) {
            return rpc.invoke("getDisplayHistory", ...args);
        },
        async respondToInteraction(...args) {
            return rpc.invoke("respondToInteraction", ...args);
        },
        cancelInteraction(...args) {
            return rpc.send("cancelInteraction", ...args);
        },
        async cancelCommand(...args) {
            return rpc.invoke("cancelCommand", ...args);
        },
        cancelCommandByClientId(...args) {
            return rpc.send("cancelCommandByClientId", ...args);
        },
        async recordUserFeedback(...args) {
            return rpc.invoke("recordUserFeedback", ...args);
        },
        async recordUserHide(...args) {
            return rpc.invoke("recordUserHide", ...args);
        },
        async restoreAllHidden() {
            return rpc.invoke("restoreAllHidden");
        },
        async flushHidden() {
            return rpc.invoke("flushHidden");
        },
    };
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import type { Dispatcher } from "@typeagent/dispatcher-types";
import type { DispatcherInvokeFunctions } from "./dispatcherTypes.js";

export function createDispatcherRpcClient(channel: RpcChannel): Dispatcher {
    const rpc = createRpc<DispatcherInvokeFunctions>("dispatcher", channel);

    return {
        async processCommand(...args) {
            return rpc.invoke("processCommand", ...args);
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
        async close() {
            return rpc.invoke("close");
        },
        async getStatus() {
            return rpc.invoke("getStatus");
        },
    };
}

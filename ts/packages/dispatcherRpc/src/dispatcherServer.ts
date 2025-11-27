// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import type { Dispatcher } from "@typeagent/dispatcher-types";
import type { DispatcherInvokeFunctions } from "./dispatcherTypes.js";

export function createDispatcherRpcServer(
    dispatcher: Dispatcher,
    channel: RpcChannel,
) {
    const dispatcherInvokeHandler: DispatcherInvokeFunctions = {
        processCommand: async (...args) => {
            return dispatcher.processCommand(...args);
        },
        getDynamicDisplay: async (...args) => {
            return dispatcher.getDynamicDisplay(...args);
        },
        getTemplateSchema: async (...args) => {
            return dispatcher.getTemplateSchema(...args);
        },
        getTemplateCompletion: async (...args) => {
            return dispatcher.getTemplateCompletion(...args);
        },
        getCommandCompletion: async (...args) => {
            return dispatcher.getCommandCompletion(...args);
        },
        close: async () => {
            await dispatcher.close();
        },
    };

    createRpc("dispatcher", channel, dispatcherInvokeHandler);
}

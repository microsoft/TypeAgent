// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import type { Dispatcher } from "@typeagent/dispatcher-types";
import type {
    DispatcherCallFunctions,
    DispatcherInvokeFunctions,
} from "./dispatcherTypes.js";

export function createDispatcherRpcServer(
    dispatcher: Dispatcher,
    channel: RpcChannel,
) {
    const dispatcherCallHandler: DispatcherCallFunctions = {
        cancelCommand(...args) {
            dispatcher.cancelCommand(...args);
        },
    };

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
        checkCache: async (...args) => {
            return dispatcher.checkCache(...args);
        },
        close: async () => {
            await dispatcher.close();
        },
        getStatus: async () => {
            return dispatcher.getStatus();
        },
        getAgentSchemas: async (...args) => {
            return dispatcher.getAgentSchemas(...args);
        },
        respondToChoice: async (...args) => {
            return dispatcher.respondToChoice(...args);
        },
        getDisplayHistory: async (...args) => {
            return dispatcher.getDisplayHistory(...args);
        },
        respondToInteraction: async (...args) => {
            return dispatcher.respondToInteraction(...args);
        },
    };

    createRpc(
        "dispatcher",
        channel,
        dispatcherInvokeHandler,
        dispatcherCallHandler,
    );
}

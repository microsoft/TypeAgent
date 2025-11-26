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
        processCommand: async (params) => {
            return dispatcher.processCommand(
                params.command,
                params.requestId,
                params.attachments,
            );
        },
        getDynamicDisplay: async (params) => {
            return dispatcher.getDynamicDisplay(
                params.appAgentName,
                params.type,
                params.id,
            );
        },
        getTemplateSchema: async (params) => {
            return dispatcher.getTemplateSchema(
                params.templateAgentName,
                params.templateName,
                params.data,
            );
        },
        getTemplateCompletion: async (params) => {
            return dispatcher.getTemplateCompletion(
                params.templateAgentName,
                params.templateName,
                params.data,
                params.propertyName,
            );
        },
        getCommandCompletion: async (params) => {
            return dispatcher.getCommandCompletion(params.prefix);
        },
        close: async () => {
            await dispatcher.close();
        },
    };

    createRpc("dispatcher", channel, dispatcherInvokeHandler);
}

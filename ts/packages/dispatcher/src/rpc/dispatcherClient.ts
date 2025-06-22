// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RpcChannel } from "agent-rpc/channel";
import { createRpc } from "agent-rpc/rpc";
import { DispatcherInvokeFunctions } from "./dispatcherTypes.js";
import { Dispatcher } from "../dispatcher.js";

function remoteCallNotSupported(): never {
    throw new Error("Remote call not supported");
}

export function createDispatcherRpcClient(channel: RpcChannel): Dispatcher {
    const rpc = createRpc<DispatcherInvokeFunctions>("dispatcher", channel);

    return {
        async processCommand(command, requestId, attachments) {
            return rpc.invoke("processCommand", {
                command,
                requestId,
                attachments,
            });
        },
        async getDynamicDisplay(appAgentName, type, id) {
            return rpc.invoke("getDynamicDisplay", { appAgentName, type, id });
        },
        async getTemplateSchema(templateAgentName, templateName, data) {
            return rpc.invoke("getTemplateSchema", {
                templateAgentName,
                templateName,
                data,
            });
        },
        async getTemplateCompletion(
            templateAgentName,
            templateName,
            data,
            propertyName,
        ) {
            return rpc.invoke("getTemplateCompletion", {
                templateAgentName,
                templateName,
                data,
                propertyName,
            });
        },
        async getCommandCompletion(prefix) {
            return rpc.invoke("getCommandCompletion", { prefix });
        },
        async close() {
            return rpc.invoke("close");
        },
        getPrompt: remoteCallNotSupported,
        getSettingSummary: remoteCallNotSupported,
        getTranslatorNameToEmojiMap: remoteCallNotSupported,
    };
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createRpc } from "@typeagent/agent-rpc/rpc";
import type { RpcChannel } from "@typeagent/agent-rpc/channel";
import type { Dispatcher, SubmitResult } from "@typeagent/dispatcher-types";
import type {
    DispatcherCallFunctions,
    DispatcherInvokeFunctions,
    WireSubmitResult,
} from "./dispatcherTypes.js";

/**
 * Drop the in-process-only `completion` promise from a `SubmitResult` so it
 * can cross the RPC boundary. The client wrapper re-attaches a synthesized
 * completion promise on the other side.
 */
function toWire(result: SubmitResult): WireSubmitResult {
    if (result.ok) {
        const { completion: _c, ...entry } = result.entry;
        return { ok: true, entry };
    }
    return result;
}

export function createDispatcherRpcServer(
    dispatcher: Dispatcher,
    channel: RpcChannel,
) {
    const dispatcherCallHandler: DispatcherCallFunctions = {
        cancelCommandByClientId(...args) {
            dispatcher.cancelCommandByClientId(...args);
        },
        cancelInteraction(...args) {
            dispatcher.cancelInteraction(...args);
        },
    };

    const dispatcherInvokeHandler: DispatcherInvokeFunctions = {
        submitCommand: async (...args) => {
            return toWire(await dispatcher.submitCommand(...args));
        },
        interrupt: async (...args) => {
            return toWire(await dispatcher.interrupt(...args));
        },
        cancelCommand: async (...args) => {
            return dispatcher.cancelCommand(...args);
        },
        promoteCommand: async (...args) => {
            return dispatcher.promoteCommand(...args);
        },
        getQueueSnapshot: async () => {
            return dispatcher.getQueueSnapshot();
        },
        getDeveloperMode: async () => {
            return dispatcher.getDeveloperMode();
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
        recordUserFeedback: async (...args) => {
            return dispatcher.recordUserFeedback(...args);
        },
        recordUserHide: async (...args) => {
            return dispatcher.recordUserHide(...args);
        },
        restoreAllHidden: async () => {
            return dispatcher.restoreAllHidden();
        },
        flushHidden: async () => {
            return dispatcher.flushHidden();
        },
    };

    createRpc(
        "dispatcher",
        channel,
        dispatcherInvokeHandler,
        dispatcherCallHandler,
    );
}

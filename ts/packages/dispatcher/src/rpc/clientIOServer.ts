// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RpcChannel } from "agent-rpc/channel";
import { createRpc } from "agent-rpc/rpc";
import { ClientIO } from "../context/interactiveIO.js";
import {
    ClientIOCallFunctions,
    ClientIOInvokeFunctions,
} from "./clientIOTypes.js";

export function createClientIORpcServer(
    clientIO: ClientIO,
    channel: RpcChannel,
) {
    const clientIOInvokeFunctions: ClientIOInvokeFunctions = {
        askYesNo: async (params) => {
            return clientIO.askYesNo(
                params.message,
                params.requestId,
                params.defaultValue,
            );
        },
        proposeAction: async (params) => {
            return clientIO.proposeAction(
                params.actionTemplates,
                params.requestId,
                params.source,
            );
        },
        openLocalView: async (params) => {
            return clientIO.openLocalView(params.port);
        },
    };

    const clientIOCallFunctions: ClientIOCallFunctions = {
        clear: () => clientIO.clear(),
        exit: () => clientIO.exit(),
        setDisplayInfo: (params) =>
            clientIO.setDisplayInfo(
                params.source,
                params.requestId,
                params.actionIndex,
                params.action,
            ),
        setDisplay: (params) => clientIO.setDisplay(params.message),
        appendDisplay: (params) =>
            clientIO.appendDisplay(params.message, params.mode),
        appendDiagnosticData: (params) => {
            clientIO.appendDiagnosticData(params.requestId, params.data);
        },
        setDynamicDisplay: (params) =>
            clientIO.setDynamicDisplay(
                params.source,
                params.requestId,
                params.actionIndex,
                params.displayId,
                params.nextRefreshMs,
            ),
        notify: (params) =>
            clientIO.notify(
                params.event,
                params.requestId,
                params.data,
                params.source,
            ),
        takeAction: (params) => clientIO.takeAction(params.action, params.data),
    };
    createRpc(channel, clientIOInvokeFunctions, clientIOCallFunctions);
}

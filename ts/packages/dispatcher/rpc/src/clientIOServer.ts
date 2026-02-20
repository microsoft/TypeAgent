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
    const clientIOInvokeFunctions: ClientIOInvokeFunctions = {
        askYesNo: async (...args) => {
            return clientIO.askYesNo(...args);
        },
        proposeAction: async (...args) => {
            return clientIO.proposeAction(...args);
        },
        popupQuestion: async (...args) => {
            return clientIO.popupQuestion(...args);
        },
        openLocalView: async (...args) => {
            return clientIO.openLocalView(...args);
        },
        closeLocalView: async (...args) => {
            return clientIO.closeLocalView(...args);
        },
    };

    const clientIOCallFunctions: ClientIOCallFunctions = {
        clear: (...args) => clientIO.clear(...args),
        exit: (...args) => clientIO.exit(...args),
        setDisplayInfo: (...args) => clientIO.setDisplayInfo(...args),
        setDisplay: (...args) => clientIO.setDisplay(...args),
        appendDisplay: (...args) => clientIO.appendDisplay(...args),
        appendDiagnosticData: (...args) => {
            clientIO.appendDiagnosticData(...args);
        },
        setDynamicDisplay: (...args) => clientIO.setDynamicDisplay(...args),
        notify: (...args) => clientIO.notify(...args),
        requestChoice: (...args) => clientIO.requestChoice(...args),
        takeAction: (...args) => clientIO.takeAction(...args),
    };
    createRpc(
        "clientio",
        channel,
        clientIOInvokeFunctions,
        clientIOCallFunctions,
    );
}

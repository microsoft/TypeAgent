// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createChannelAdapter,
    type ChannelAdapter,
} from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";

interface ElectronAPI {
    sendRpcMessage?: (message: any) => void;
    onRpcMessage?: (callback: (message: any) => void) => void;
}

function getElectronAPI(): ElectronAPI | undefined {
    return (window as any).electronAPI;
}

/**
 * Creates an RPC client for extension views running inside Electron.
 * Communicates with the agent backend via IPC through the preload script.
 *
 * Requires `sendRpcMessage` and `onRpcMessage` to be exposed on `window.electronAPI`.
 */
export function createElectronRpcClient<
    InvokeTargets extends Record<
        string,
        (...args: any[]) => Promise<any>
    > = {},
    CallTargets extends Record<string, (...args: any[]) => void> = {},
>(): { adapter: ChannelAdapter; rpc: ReturnType<typeof createRpc> } | undefined {
    const electronAPI = getElectronAPI();
    if (!electronAPI?.sendRpcMessage || !electronAPI?.onRpcMessage) {
        return undefined;
    }

    const adapter = createChannelAdapter((message: any) => {
        electronAPI.sendRpcMessage!(message);
    });

    electronAPI.onRpcMessage!((message: any) => {
        adapter.notifyMessage(message);
    });

    const rpc = createRpc<InvokeTargets, CallTargets>(
        "browser:view:electron",
        adapter.channel,
    );

    return { adapter, rpc };
}

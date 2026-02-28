// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process from "child_process";
import { execFileSync } from "child_process";
import { AppAgent } from "@typeagent/agent-sdk";
import { createAgentRpcClient } from "@typeagent/agent-rpc/client";
import { createChannelProvider } from "@typeagent/agent-rpc/channel";
import { fileURLToPath } from "url";
import { AgentInterfaceFunctionName } from "@typeagent/agent-rpc/server";

export type AgentProcess = {
    appAgent: AppAgent;
    count: number;
    process?: child_process.ChildProcess;
    trace?: (namespaces: string) => void;
};

// When running inside Electron, process.execPath points to the Electron binary,
// not system Node.js. Agent child processes must use system Node so that native
// modules (e.g. better-sqlite3) compiled for the system Node ABI load correctly.
let _systemNodePath: string | undefined | null = undefined;
function getSystemNodeExecPath(): string | undefined {
    if (!process.versions.electron) {
        return undefined;
    }
    if (_systemNodePath !== undefined) {
        return _systemNodePath ?? undefined;
    }
    try {
        const cmd = process.platform === "win32" ? "where" : "which";
        const result = execFileSync(cmd, ["node"], { encoding: "utf8" });
        _systemNodePath = result.split(/\r?\n/)[0].trim() || null;
    } catch {
        _systemNodePath = null;
    }
    return _systemNodePath ?? undefined;
}

export async function createAgentProcess(
    agentName: string,
    modulePath: string,
): Promise<AgentProcess> {
    const env = { ...process.env };
    const forkOptions: child_process.ForkOptions = { env };
    const systemNode = getSystemNodeExecPath();
    if (systemNode) {
        forkOptions.execPath = systemNode;
    }
    const agentProcess = child_process.fork(
        fileURLToPath(new URL(`./agentProcess.js`, import.meta.url)),
        [agentName, modulePath],
        forkOptions,
    );

    const channelProvider = createChannelProvider(
        `agent-process:client:${agentName}`,
        agentProcess,
    );
    const traceChannel = channelProvider.createChannel("trace");
    return {
        process: agentProcess,
        trace: (namespaces: string) => {
            traceChannel.send(namespaces);
        },
        appAgent: await initializeAgentRpcClient(agentName, channelProvider),
        count: 1,
    };
}

async function initializeAgentRpcClient(name: string, channelProvider: any) {
    const channel = channelProvider.createChannel("initialize");
    const agentInterface = await new Promise<AgentInterfaceFunctionName[]>(
        (resolve, reject) => {
            channel.once("message", (message: any) => {
                if (Array.isArray(message)) {
                    resolve(message);
                } else {
                    reject(
                        new Error(
                            `Unexpected message: ${JSON.stringify(message)}`,
                        ),
                    );
                }
            });
        },
    );
    return createAgentRpcClient(name, channelProvider, agentInterface);
}

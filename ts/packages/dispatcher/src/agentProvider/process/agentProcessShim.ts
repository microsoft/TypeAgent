// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process from "child_process";
import { AppAgent } from "@typeagent/agent-sdk";
import { createAgentRpcClient } from "agent-rpc/client";
import { createChannelProvider } from "agent-rpc/channel";
import { fileURLToPath } from "url";
import { AgentInterfaceFunctionName } from "agent-rpc/server";

export type AgentProcess = {
    appAgent: AppAgent;
    count: number;
    process?: child_process.ChildProcess;
    trace?: (namespaces: string) => void;
};

export async function createAgentProcess(
    agentName: string,
    modulePath: string,
): Promise<AgentProcess> {
    const env = { ...process.env };
    const agentProcess = child_process.fork(
        fileURLToPath(new URL(`./agentProcess.js`, import.meta.url)),
        [agentName, modulePath],
        { env },
    );

    const channelProvider = createChannelProvider(agentProcess);
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

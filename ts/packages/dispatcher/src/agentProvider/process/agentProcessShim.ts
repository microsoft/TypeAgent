// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process from "child_process";
import { AppAgent } from "@typeagent/agent-sdk";
import { createAgentRpcClient } from "agent-rpc/client";
import { createChannelProvider } from "agent-rpc/channel";
import { fileURLToPath } from "url";

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
        appAgent: await createAgentRpcClient(agentName, channelProvider),
        count: 1,
    };
}

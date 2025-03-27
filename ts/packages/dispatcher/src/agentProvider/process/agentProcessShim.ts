// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process from "child_process";
import { AppAgent } from "@typeagent/agent-sdk";
import { createAgentRpcClient } from "agent-rpc/client";
import { createChannelProvider } from "agent-rpc/channel";
import { fileURLToPath } from "url";
import { createLimiter } from "common-utils";

export type AgentProcess = {
    appAgent: AppAgent;
    process: child_process.ChildProcess | undefined;
    count: number;
};

const limiter = createLimiter(1);
export async function createAgentProcess(
    agentName: string,
    modulePath: string,
): Promise<AgentProcess> {
    return limiter(async () => {
        const process = child_process.fork(
            fileURLToPath(new URL(`./agentProcess.js`, import.meta.url)),
            [agentName, modulePath],
        );

        return {
            process,
            appAgent: await createAgentRpcClient(
                agentName,
                createChannelProvider(process),
            ),
            count: 1,
        };
    });
}

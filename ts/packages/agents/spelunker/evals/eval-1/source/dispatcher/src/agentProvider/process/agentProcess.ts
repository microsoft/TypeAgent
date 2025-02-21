// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent } from "@typeagent/agent-sdk";

import registerDebug from "debug";
import { createAgentRpcServer } from "agent-rpc/server";
import { createChannelProvider } from "agent-rpc/channel";

const debug = registerDebug("typeagent:dispatcher:agentProcess");

const agentName = process.argv[2];
const modulePath = process.argv[3];
const module = await import(modulePath);
if (typeof module.instantiate !== "function") {
    throw new Error(
        `Failed to load module agent '${modulePath}': missing 'instantiate' function.`,
    );
}

const agent: AppAgent = module.instantiate();

if (process.send === undefined) {
    throw new Error("No IPC channel to parent process");
}

const checkedProcess = process as NodeJS.Process & {
    send: (message: any) => void;
};

createAgentRpcServer(agentName, agent, createChannelProvider(checkedProcess));

debug(`${agentName} agent process started: ${modulePath}`);
process.on("disconnect", () => {
    debug(`Parent process disconnected, exiting '${agentName}': ${modulePath}`);
    process.exit(-1);
});

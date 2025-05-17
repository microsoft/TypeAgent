// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { AppAgent } from "@typeagent/agent-sdk";
import { createAgentRpcServer } from "agent-rpc/server";
import { createChannelProvider } from "agent-rpc/channel";
import { createRequire } from "node:module";

//=================================================================
// Get arguments from command line
//=================================================================
const agentName = process.argv[2];
const modulePath = process.argv[3];

//=================================================================
// Create debug trace object
//=================================================================
const debug = registerDebug(`typeagent:dispatcher:agentProcess:${agentName}`);

//=================================================================
// Check and setup process
//=================================================================
function isIPCProcess(
    process: NodeJS.Process,
): process is NodeJS.Process & { send: (message: any) => void } {
    return typeof process.send === "function";
}

if (!isIPCProcess(process)) {
    throw new Error("No IPC channel to parent process");
}

process.on("disconnect", () => {
    debug(`Parent process disconnected, exiting '${agentName}': ${modulePath}`);
    process.exit(-1);
});

//=================================================================
// Load the module.
//=================================================================
const module = await import(modulePath);
if (typeof module.instantiate !== "function") {
    throw new Error(
        `Failed to load module agent '${modulePath}': missing 'instantiate' function.`,
    );
}

//=================================================================
// Instantiate agent and  Create agent RPC server
//=================================================================
const agent: AppAgent = module.instantiate();
const channelProvider = createChannelProvider(process);
const { agentInterface } = createAgentRpcServer(
    agentName,
    agent,
    channelProvider,
);

channelProvider.createChannel("initialize").send(agentInterface);

//=================================================================
// Set up debug trace coordination
//=================================================================
async function getAgentDebug(): Promise<typeof registerDebug | undefined> {
    try {
        // get the "debug" package from the module.
        const require = createRequire(modulePath);
        const debugPath = require.resolve("debug");
        const agentDebug = (await import(debugPath)).default;
        if (agentDebug === registerDebug) {
            return undefined;
        }
        debug(`'${agentName}': Agent debug trace loaded. ${debugPath}`);
        return agentDebug;
    } catch {
        return undefined;
    }
}

const agentDebug = await getAgentDebug();
const traceChannel = channelProvider.createChannel<string>("trace");
traceChannel.on("message", (message) => {
    registerDebug.enable(message);
    agentDebug?.enable(message);
    debug(`'${agentName}': Trace settings:  ${message}`);
});

//=================================================================
// Done
//=================================================================
debug(`${agentName} agent process started: ${modulePath}`);

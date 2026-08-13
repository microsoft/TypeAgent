// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { AppAgent } from "@typeagent/agent-sdk";
import {
    AgentControlMessage,
    AgentInterfaceFunctionName,
    createAgentRpcServer,
} from "@typeagent/agent-rpc/server";
import { createChannelProvider } from "@typeagent/agent-rpc/channel";
import { otel } from "@typeagent/telemetry";
import { loadAgentDebug } from "./agentDebug.js";

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
const ipcProcess = process;

let exitPromise: Promise<void> | undefined;

function exitAgentProcess(exitCode: number, message: string): Promise<void> {
    debug(message);
    exitPromise ??= otel
        .shutdownTelemetry()
        .catch((error) => {
            debug(`Telemetry shutdown failed: ${error}`);
        })
        .then(() => {
            process.exit(exitCode);
        });
    return exitPromise;
}

process.on("disconnect", () => {
    void exitAgentProcess(
        -1,
        `Parent process disconnected, exiting '${agentName}': ${modulePath}`,
    );
});

process.on("SIGTERM", () => {
    void exitAgentProcess(
        -2,
        `SIGTERM received, exiting '${agentName}': ${modulePath}`,
    );
});
process.on("SIGINT", () => {
    void exitAgentProcess(
        -2,
        `SIGINT received, exiting '${agentName}': ${modulePath}`,
    );
});

async function startAgentProcess(): Promise<void> {
    const loadedAgentDebug = loadAgentDebug(modulePath, registerDebug);
    const agentDebug = loadedAgentDebug?.debug;
    if (loadedAgentDebug !== undefined) {
        debug(
            `'${agentName}': Agent debug trace loaded. ${loadedAgentDebug.path}`,
        );
    }
    const debugModules =
        agentDebug === undefined
            ? [registerDebug]
            : [registerDebug, agentDebug];
    await otel.initTelemetry({
        processName: `agent-${agentName}`,
        debugModules,
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
    // Instantiate agent and create agent RPC server
    //=================================================================
    const agent: AppAgent = module.instantiate();
    const channelProvider = createChannelProvider(
        `agent-process:server:${agentName}`,
        ipcProcess,
    );
    const { agentInterface } = createAgentRpcServer(
        agentName,
        agent,
        channelProvider,
    );

    const controlChannel = channelProvider.createChannel<
        AgentControlMessage,
        AgentInterfaceFunctionName[]
    >("control");

    controlChannel.on("message", () => {
        void exitAgentProcess(
            0,
            `Parent process requested exit, exiting '${agentName}': ${modulePath}`,
        );
    });
    controlChannel.send(agentInterface);

    //=================================================================
    // Set up debug trace coordination
    //=================================================================
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
}

await startAgentProcess().catch(async (error) => {
    console.error(
        `Failed to start agent process '${agentName}' from '${modulePath}':`,
        error,
    );
    await exitAgentProcess(-3, "Agent process startup failed");
});

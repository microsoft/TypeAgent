// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import child_process from "child_process";
import { execFileSync } from "child_process";
import { AppAgent } from "@typeagent/agent-sdk";
import { createAgentRpcClient } from "@typeagent/agent-rpc/client";
import { createChannelProvider } from "@typeagent/agent-rpc/channel";
import { fileURLToPath } from "url";
import {
    AgentControlMessage,
    AgentInterfaceFunctionName,
} from "@typeagent/agent-rpc/server";

export type AgentProcess = {
    appAgent: AppAgent;
    count: number;
    close?: () => Promise<void>;
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
    // `windowsHide` isn't declared on ForkOptions, but fork() forwards its
    // options to spawn(), which honors it - so widen the type to set it below.
    const forkOptions: child_process.ForkOptions & { windowsHide?: boolean } = {
        env,
    };
    const systemNode = getSystemNodeExecPath();
    if (systemNode) {
        forkOptions.execPath = systemNode;
    }
    // Pipe child stderr so it flows through the parent's process.stderr.write,
    // which may be intercepted for debug output formatting (e.g. --testUI).
    forkOptions.stdio = ["pipe", "inherit", "pipe", "ipc"];
    // Never let an agent worker pop its own console window. stdout is inherited
    // and stderr is piped back to the parent, so output still flows; this only
    // suppresses a visible console. It matters when the parent has no console
    // of its own (e.g. a restarted/detached agent-server): without it, Windows
    // gives each forked child a fresh console window (CREATE_NEW_CONSOLE).
    forkOptions.windowsHide = true;
    const agentProcess = child_process.fork(
        fileURLToPath(new URL(`./agentProcess.js`, import.meta.url)),
        [agentName, modulePath],
        forkOptions,
    );
    agentProcess.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(chunk);
    });

    const channelProvider = createChannelProvider(
        `agent-process:client:${agentName}`,
        agentProcess,
    );
    const traceChannel = channelProvider.createChannel("trace");
    const channel = channelProvider.createChannel<
        AgentInterfaceFunctionName[],
        AgentControlMessage
    >("control");
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
    return {
        close: async () => {
            if (agentProcess.exitCode !== null) {
                return;
            }
            await new Promise<void>((resolve) => {
                let timer: NodeJS.Timeout | undefined;
                agentProcess.once("exit", () => {
                    if (timer !== undefined) {
                        clearTimeout(timer);
                    }
                    resolve();
                });

                // Ask the child to exit gracefully via the control channel.
                // If it doesn't exit within 1s, fall back to disconnect/kill.
                if (agentProcess.connected) {
                    timer = setTimeout(() => {
                        if (agentProcess.exitCode !== null) {
                            return;
                        }
                        if (agentProcess.connected) {
                            agentProcess.disconnect();
                        } else {
                            agentProcess.kill();
                        }
                    }, 1000);
                    timer.unref();
                    try {
                        channel.send("exit");
                    } catch {
                        // IPC channel may have closed between the
                        // connected check and the send; the exit
                        // event will still fire.
                    }
                } else {
                    agentProcess.kill();
                }
            });
        },
        trace: (namespaces: string) => {
            traceChannel.send(namespaces);
        },
        appAgent: await createAgentRpcClient(
            agentName,
            channelProvider,
            agentInterface,
        ),
        // `count` is a HOLDER refcount owned by the caller (the npm provider's
        // load/unload). A freshly created process has no holders yet; the
        // loader takes the first hold.
        count: 0,
    };
}

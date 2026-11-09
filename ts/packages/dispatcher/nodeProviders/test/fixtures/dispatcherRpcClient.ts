// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createChannelProvider } from "@typeagent/agent-rpc/channel";
import { createDispatcherRpcClient } from "@typeagent/dispatcher-rpc/dispatcher/client";
import { otel } from "@typeagent/telemetry";

function isIpcProcess(
    value: NodeJS.Process,
): value is NodeJS.Process & { send: (message: unknown) => boolean } {
    return typeof value.send === "function";
}

if (!isIpcProcess(process)) {
    throw new Error("Dispatcher RPC client fixture requires an IPC channel");
}

const channelProvider = createChannelProvider(
    "dispatcher-telemetry-client",
    process,
);
const controlChannel = channelProvider.createChannel<string>("control");
const dispatcherChannel = channelProvider.createChannel("dispatcher");

controlChannel.on("message", (message) => {
    if (message === "run") {
        void run().catch((error) => {
            const detail =
                error instanceof Error ? error.message : String(error);
            controlChannel.send(`error:${detail}`);
        });
    } else if (message === "shutdown") {
        void shutdown();
    }
});

async function run(): Promise<void> {
    await otel.initTelemetry({
        serviceName: "typeagent-client-test",
        processName: "cli-test",
    });
    const { dispatcher } = createDispatcherRpcClient(
        dispatcherChannel,
        undefined,
        {
            trustedContextPropagation: true,
        },
    );
    const result = await dispatcher.submitCommand("run telemetry fixture");
    if (!result.ok) {
        throw new Error(`Dispatcher submission failed: ${result.error}`);
    }
    controlChannel.send("submitted");
}

async function shutdown(): Promise<void> {
    await otel.shutdownTelemetry();
    process.disconnect();
}

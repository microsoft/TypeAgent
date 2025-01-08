// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { createGenericChannelProvider } from "agent-rpc/client";
import { createAgentRpcServer } from "agent-rpc/server";

declare global {
    function registerTypeAgent(
        name: string,
        manifest: AppAgentManifest,
        agent: AppAgent,
    ): void;
}

const channelProvider = createGenericChannelProvider((message: any) =>
    window.postMessage({
        target: "dispatcher",
        source: "webAgent",
        messageType: "message",
        body: message,
    }),
);

global.registerTypeAgent = (
    name: string,
    manifest: AppAgentManifest,
    agent: AppAgent,
): void => {
    window.postMessage({
        target: "dispatcher",
        source: "webAgent",
        messageType: "add",
        body: {
            name,
            manifest,
        },
    });

    window.addEventListener("message", (event) => {
        const data = event.data;
        if (data.target === "webAgent" && data.source === "dispatcher") {
            if (data.messageType === "message") {
                channelProvider.message(data.body);
            } else if (data.messageType === "disconnect") {
                channelProvider.disconnect();
            }
        }
    });
    createAgentRpcServer(name, agent, channelProvider);
};

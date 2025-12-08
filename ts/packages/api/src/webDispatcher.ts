// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandResult, createDispatcher } from "agent-dispatcher";
import { getConsolePrompt } from "agent-dispatcher/helpers/console";
import { getInstanceDir, getClientId } from "agent-dispatcher/helpers/data";
import { getStatusSummary } from "agent-dispatcher/helpers/status";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { createDispatcherRpcServer } from "@typeagent/dispatcher-rpc/dispatcher/server";
import { createChannelAdapter } from "@typeagent/agent-rpc/channel";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import WebSocket from "ws";
import { getFsStorageProvider } from "dispatcher-node-providers";
import registerDebug from "debug";
import { FullAction } from "agent-cache";

const debug = registerDebug("typeagent:webserver:api");
registerDebug.enable("typeagent:webserver:*");

export interface WebDispatcher {
    connect(ws: WebSocket): void;
    close(): void;
    handleAction(action: FullAction): Promise<CommandResult>;
}

export async function createWebDispatcher(): Promise<WebDispatcher> {
    let ws: WebSocket | null = null;
    const clientIOChannel = createChannelAdapter((message: any) =>
        ws?.send(
            JSON.stringify({
                message: "clientio-rpc-call",
                data: message,
            }),
        ),
    );

    debug("Creating Web Dispatcher...");

    const instanceDir = getInstanceDir();
    const clientIO = createClientIORpcClient(clientIOChannel.channel);
    const dispatcher = await createDispatcher("api", {
        appAgentProviders: getDefaultAppAgentProviders(instanceDir),
        persistSession: true,
        persistDir: instanceDir,
        storageProvider: getFsStorageProvider(),
        metrics: true,
        dblogging: true,
        clientId: getClientId(),
        clientIO: clientIO,
        constructionProvider: getDefaultConstructionProvider(),
        indexingServiceRegistry: await getIndexingServiceRegistry(instanceDir),
    });

    let settingSummary: string = "";
    const updateSettingSummary = async (force: boolean = false) => {
        const status = await dispatcher.getStatus();
        const newSettingSummary = getStatusSummary(status);
        if (force || newSettingSummary !== settingSummary) {
            settingSummary = newSettingSummary;
            ws?.send(
                JSON.stringify({
                    message: "setting-summary-changed",
                    data: {
                        registeredAgents: status.agents.map((agent) => [
                            agent.name,
                            agent.emoji,
                        ]),
                    },
                }),
            );
        }

        return newSettingSummary;
    };

    async function handleAction(action: FullAction): Promise<any> {
        // TODO: expose executeAction so we can call that directly instead of running it through a command
        // TODO: bubble back any action results along with the command result
        await dispatcher.processCommand(
            `@action ${action.schemaName} ${action.actionName} --parameters '${JSON.stringify(action.parameters).replaceAll("'", "\\'")}'`,
            undefined,
            undefined,
        );
    }

    async function processShellRequest(
        text: string,
        id: string,
        images: string[],
    ) {
        if (typeof text !== "string" || typeof id !== "string") {
            throw new Error("Invalid request");
        }

        // Update before processing the command in case there was change outside of command processing
        const summary = await updateSettingSummary();
        console.log(getConsolePrompt(summary), text);

        const result = await dispatcher.processCommand(text, id, images);

        await updateSettingSummary();

        return result;
    }

    const patchedDispatcher = {
        ...dispatcher,
        processCommand: processShellRequest,
        handleAction: handleAction,
    };

    const dispatcherChannel = createChannelAdapter((message: any) =>
        ws?.send(
            JSON.stringify({
                message: "dispatcher-rpc-reply",
                data: message,
            }),
        ),
    );
    createDispatcherRpcServer(patchedDispatcher, dispatcherChannel.channel);

    // messages from web clients arrive here
    return {
        connect: (newWebSocket: WebSocket) => {
            // Close existing connection.  Only support one client at a time.
            ws?.close();
            ws = newWebSocket;
            ws.on("message", async (message: string) => {
                try {
                    const msgObj = JSON.parse(message);
                    console.log(`Received ${msgObj.message} message`);

                    switch (msgObj.message) {
                        case "dispatcher-rpc-call":
                            dispatcherChannel.notifyMessage(msgObj.data);
                            break;
                        case "clientio-rpc-reply":
                            clientIOChannel.notifyMessage(msgObj.data);
                            break;
                    }
                } catch (e) {
                    console.warn(`WebSocket message not parsed. Error: ${e}`);
                }
            });

            ws.on("close", () => {
                console.log("Client disconnected");
                ws = null;
            });

            // Always update setting on first connect
            updateSettingSummary(true);
        },
        close: () => {
            dispatcher.close();
        },
        handleAction: handleAction,
    };
}

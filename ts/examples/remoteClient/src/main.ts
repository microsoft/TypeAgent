// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Remote Client Example
 *
 * Demonstrates connecting to a TypeAgent agent-server running on another
 * machine via a Microsoft Dev Tunnel. Shows:
 *   1. Reading server URL and tunnel token from environment
 *   2. Connecting with tunnel authorization headers
 *   3. Joining a conversation and sending a request
 *
 * Setup (on the host machine):
 *   pnpm run devtunnel:setup
 *   pnpm -C packages/agentServer/server run start:tunnel
 *   pnpm run devtunnel:status -- --token
 *
 * Usage (on this machine):
 *   set TYPEAGENT_SERVER_URL=wss://typeagent-mybox-8999.usw2.devtunnels.ms
 *   set TYPEAGENT_TUNNEL_TOKEN=eyJhbG...
 *   node dist/main.js [message]
 */

import {
    connectAgentServer,
    getConnectOptionsFromEnv,
} from "@typeagent/agent-server-client";
import { AGENT_SERVER_DEFAULT_URL } from "@typeagent/agent-server-protocol";
import type { ClientIO, Dispatcher } from "@typeagent/agent-server-client";

function getServerUrl(): string {
    return process.env.TYPEAGENT_SERVER_URL ?? AGENT_SERVER_DEFAULT_URL;
}

function createMinimalClientIO(): ClientIO {
    return {
        setDisplay(content: any) {
            if (content?.content) {
                console.log("[display]", content.content);
            }
        },
        clear() {},
        setDynamicDisplay() {},
        exit() {
            process.exit(0);
        },
        askYesNo(message: string) {
            console.log("[askYesNo]", message);
            return Promise.resolve(true);
        },
        proposeAction(action: any) {
            console.log("[proposeAction]", JSON.stringify(action));
            return Promise.resolve(true);
        },
        notify(event: string, requestId: any, data: any) {
            if (event === "explained" && data?.message) {
                console.log("[agent]", data.message);
            } else {
                console.log(`[notify:${event}]`, data ?? "");
            }
        },
        setUserRequest(message: string) {
            console.log("[you]", message);
        },
        requestChoice(message: string, choices: string[]) {
            console.log("[choice]", message, choices);
            return Promise.resolve(0);
        },
    } as unknown as ClientIO;
}

async function main() {
    const url = getServerUrl();
    const connectOptions = getConnectOptionsFromEnv();
    const message = process.argv.slice(2).join(" ") || "hello";

    console.log(`Connecting to: ${url}`);
    if (connectOptions?.headers) {
        console.log("Using tunnel authorization token");
    }

    try {
        const connection = await connectAgentServer(
            url,
            () => {
                console.log("Disconnected from server");
                process.exit(1);
            },
            connectOptions,
        );

        console.log("Connected! Joining conversation...");
        const { dispatcher, conversationId } =
            await connection.joinConversation(createMinimalClientIO());

        console.log(`Joined conversation: ${conversationId}`);
        console.log(`Sending: "${message}"`);
        console.log("---");

        const result = await dispatcher.submitCommand(
            `@dispatcher request "${message}"`,
        );
        if (!result.ok) {
            console.error("Command rejected:", result.error);
        } else {
            // Wait for the command to complete
            const completion = await result.entry.completion;
            if (completion) {
                console.log("[result]", JSON.stringify(completion, null, 2));
            }
        }

        console.log("---");
        console.log("Done. Closing connection.");
        await connection.close();
    } catch (err: any) {
        console.error(`Failed to connect: ${err.message}`);
        if (err.message?.includes("302") || err.message?.includes("401")) {
            console.error(
                "\nThis looks like a tunnel auth error. Ensure TYPEAGENT_TUNNEL_TOKEN is set.\n" +
                    "Get a token on the host machine:\n" +
                    "  devtunnel token <tunnel-name> --scopes connect",
            );
        }
        process.exit(1);
    }
}

main();

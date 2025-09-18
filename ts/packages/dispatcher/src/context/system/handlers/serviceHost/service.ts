// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket, WebSocketServer } from "ws";
import registerDebug from "debug";
import { IncomingMessage } from "node:http";

interface Client {
    id: string | null;
    role: string;
    socket: WebSocket;
    channelName: string;
}

interface Channel {
    name: string;
    clients: Set<Client>;
}

const debug = registerDebug("typeagent:serviceHost");

const hostEndpoint = process.env["WEBSOCKET_HOST"] ?? "ws://localhost:8080";
const url = new URL(hostEndpoint);

// Channels organized by agentType
const channels: Map<string, Channel> = new Map();

try {
    const wss = new WebSocketServer({
        port: parseInt(url.port),
        path: url.pathname,
    });

    wss.on("listening", () => {
        debug(`WebSocket server started at ${hostEndpoint}`);
        process.send?.("Success");
    });

    wss.on("error", (error) => {
        console.error(`WebSocket server error: ${error}`);
        wss.close();
        process.send!("Failure");
        process.exit(1);
    });

    wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        debug("New client connected");

        const params = new URLSearchParams(req.url?.split("?")[1]);
        const clientId = params.get("clientId");
        const channelName = params.get("channel");
        const role = params.get("role");

        if (!channelName || !role) {
            ws.send(JSON.stringify({ error: "Missing agentName or role" }));
            ws.close();
            return;
        }

        // Ensure the channel exists
        if (!channels.has(channelName)) {
            channels.set(channelName, {
                name: channelName,
                clients: new Set(),
            });
        }

        const channel = channels.get(channelName)!;
        const client: Client = {
            id: clientId,
            role: role,
            socket: ws,
            channelName: channelName,
        };

        if (clientId) {
            for (var socket of wss.clients) {
                if ((socket as any).clientId == clientId && socket !== ws) {
                    debug(
                        "Closing duplicate socket instance for id " + clientId,
                    );
                    socket.close(1013, "duplicate");
                    wss.clients.delete(socket);
                    const tempClient = {
                        id: clientId,
                        role: role,
                        socket: socket,
                        channelName: channelName,
                    };

                    if (channel.clients.has(tempClient)) {
                        channel.clients.delete(tempClient);
                    }
                }
            }

            (ws as any).clientId = clientId;
        }

        channel.clients.add(client);
        debug(`Client ${clientId} joined channel ${channelName}.`);

        ws.on("message", (message: string) => {
            try {
                const data = JSON.parse(message);
                if (
                    data.messageType === "keepAlive" ||
                    data.method === "keepAlive"
                ) {
                    return;
                }
                let foundAtLeastOneTarget = false;
                const messageTargetRole =
                    role !== "client" ? "client" : "dispatcher";

                // Broadcast message to all clients in the same channel that have a different role
                channel.clients.forEach((currClient) => {
                    if (
                        currClient.role === messageTargetRole &&
                        currClient.socket.readyState === WebSocket.OPEN
                    ) {
                        currClient.socket.send(message);
                        foundAtLeastOneTarget = true;
                    }
                });

                if (!foundAtLeastOneTarget) {
                    const errorMessage =
                        client.role === "client"
                            ? `The ${channelName} agent is not connected. The message cannot be processed.`
                            : `No ${channelName} clients are listening for messages on this channel`;
                    ws.send(JSON.stringify({ error: errorMessage }));
                }
            } catch {
                debug("WebSocket message not parsed.");
            }
        });

        ws.on("close", () => {
            debug(`Client ${clientId} disconnected.`);
            channel.clients.delete(client);

            // Cleanup empty channels
            if (channel.clients.size === 0) {
                channels.delete(channelName);
                debug(`Channel ${channelName} deleted.`);
            }
        });
    });

    process.on("disconnect", () => {
        // Parent process has disconnected, close the WebSocket server and exit
        wss.close();
        process.exit(1);
    });
} catch (e: any) {
    const message = `WebSocket server could not be started at ${hostEndpoint}: Error ${e.message}`;
    console.error(message);
    process.send?.(message);
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket, WebSocketServer } from "ws";
import { WebSocketMessage } from "common-utils";
import registerDebug from "debug";
import { IncomingMessage } from "node:http";

const debug = registerDebug("typeagent:serviceHost");

const hostEndpoint = process.env["WEBSOCKET_HOST"] ?? "ws://localhost:8080";
const url = new URL(hostEndpoint);

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

        if (req.url) {
            const params = new URLSearchParams(req.url.split("?")[1]);
            const clientId = params.get("clientId");
            if (clientId) {
                for (var client of wss.clients) {
                    if ((client as any).clientId) {
                        wss.clients.delete(client);
                    }
                }

                (ws as any).clientId = clientId;
            }
        }

        debug(`Connection count: ${wss.clients.size}`);

        ws.on("message", (message: string) => {
            try {
                const data = JSON.parse(message) as WebSocketMessage;
                if (data.messageType != "keepAlive") {
                    // broadcast to all connected clients
                    // TO DO: add routing to send messages to specific clients
                    wss.clients.forEach((client) => client.send(message));
                }
            } catch {
                debug("WebSocket message not parsed.");
            }
        });

        ws.on("close", () => {
            debug("Client disconnected");
        });
    });

    process.on("disconnect", () => {
        // Parent process has disconnected, close the WebSocket server and exit
        wss.close();
        process.exit(1);
    });
} catch (e: any) {
    console.error(
        `WebSocket server could not be started at ${hostEndpoint}: Error ${e.message}`,
    );
    process.send?.("Failure");
}

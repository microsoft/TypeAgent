// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket, { WebSocketServer } from "ws";
import { IncomingMessage, Server } from "node:http";
import { isAllowedApiOrigin } from "./originPolicy.js";

/**
 * Origin gate for the dispatcher WebSocket. A client that completes the
 * upgrade gets full dispatcher RPC with the local user's permissions, so
 * only the chat view this server serves (a loopback origin, or one named in
 * TYPEAGENT_API_ALLOWED_ORIGINS for a hosted deployment) and non-browser
 * clients (no Origin header) are let through. Everything else is refused
 * with HTTP 403 before the `connection` event fires, which keeps a web page
 * the user happens to visit from dialing the port.
 */

export class TypeAgentAPIWebSocketServer {
    private server: WebSocketServer;

    constructor(
        webServer: Server<any, any>,
        connectCallback: (ws: WebSocket) => void,
        requestExit: (exitCode: number) => void,
    ) {
        this.server = new WebSocketServer({
            server: webServer,
            verifyClient: (info, cb) => {
                if (isAllowedApiOrigin(info.origin)) {
                    cb(true);
                    return;
                }
                console.warn(
                    `Rejected WebSocket upgrade from origin '${info.origin}'`,
                );
                cb(false, 403, "Origin not allowed");
            },
        });

        this.server.on("listening", () => {
            console.log(`WebSocket server started!`);
            process.send?.("Success");
        });

        this.server.on("error", (error: string) => {
            console.error(`WebSocket server error: ${error}`);
            this.server.close();
            process.send?.("Failure");
            requestExit(1);
        });

        this.server.on("connection", (ws: WebSocket, req: IncomingMessage) => {
            console.log("New client connected");

            if (req.url) {
                const params = new URLSearchParams(req.url.split("?")[1]);
                const clientId = params.get("clientId");
                if (clientId) {
                    for (const client of this.server.clients) {
                        if ((client as any).clientId) {
                            this.server.clients.delete(client);
                        }
                    }

                    (ws as any).clientId = clientId;
                }
            }

            console.log(`Connection count: ${this.server.clients.size}`);

            // TODO: send agent greeting!?

            // messages from web clients arrive here
            connectCallback(ws);
        });
    }

    stop() {
        this.server.close();
    }
}

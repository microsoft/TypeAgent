// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket, { WebSocketServer } from "ws";
import { IncomingMessage, Server } from "node:http";

export class TypeAgentAPIWebSocketServer {
    private server: WebSocketServer;

    constructor(
        webServer: Server<any, any>,
        connectCallback: (ws: WebSocket) => void,
    ) {
        this.server = new WebSocketServer({
            server: webServer,
        });

        this.server.on("listening", () => {
            console.log(`WebSocket server started!`);
            process.send?.("Success");
        });

        this.server.on("error", (error: string) => {
            console.error(`WebSocket server error: ${error}`);
            this.server.close();
            process.send!("Failure");
            process.exit(1);
        });

        this.server.on("connection", (ws: WebSocket, req: IncomingMessage) => {
            console.log("New client connected");

            if (req.url) {
                const params = new URLSearchParams(req.url.split("?")[1]);
                const clientId = params.get("clientId");
                if (clientId) {
                    for (var client of this.server.clients) {
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

        process.on("disconnect", () => {
            // Parent process has disconnected, close the WebSocket server and exit
            this.server.close();
            process.exit(1);
        });
    }

    stop() {
        this.server.close();
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket, { WebSocketServer } from "ws";
//import registerDebug from "debug";
import { Dispatcher } from "agent-dispatcher";
import { IncomingMessage } from "node:http";

export class TypeAgentAPIWebSocketServer {
    private server: WebSocketServer;
    //private debug = registerDebug("typeagent:api");
    private settingSummary: string = "";
    private currentws: WebSocket | undefined;

    constructor(endpoint: URL, dispatcher: Dispatcher) {
        this.server = new WebSocketServer({
            port: parseInt(endpoint.port),
            path: endpoint.pathname
          });                     
    
        this.server.on("listening", () => {
            console.log(`WebSocket server started at ${endpoint}`);
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
            
            this.currentws = ws;
            
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
            
            // messages from web clients arrive here
            ws.on("message", async (message: string) => {
                try {
                    const msgObj = JSON.parse(message);
                    console.log(`Received ${msgObj.message} message`);
            
                    const newSettingSummary = dispatcher.getSettingSummary();
                    if (newSettingSummary !== this.settingSummary) {
                        this.settingSummary = newSettingSummary;
            
                        this.currentws?.send(JSON.stringify({
                            message: "setting-summary-changed",
                            data: {
                            summary: newSettingSummary,
                            registeredAgents: [...dispatcher.getTranslatorNameToEmojiMap()],
                            }
                        }));
                    }
            
                    switch(msgObj.message) {
                        case "shellrequest":
                            const metrics = await dispatcher.processCommand(msgObj.data.request, msgObj.data.id, msgObj.data.images);
                            console.log(metrics);            
                        break;
                    }
                } catch {
                    console.log("WebSocket message not parsed.");
                }
            });
            
            ws.on("close", () => {
                console.log("Client disconnected");
            });
        });
        
        process.on("disconnect", () => {
            // Parent process has disconnected, close the WebSocket server and exit
            this.server.close();
            process.exit(1);
        });    
    }

    noop() {

    }
}
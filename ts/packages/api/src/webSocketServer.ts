// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket, { WebSocketServer } from "ws";
import { Dispatcher } from "agent-dispatcher";
import { IncomingMessage } from "node:http";
import { WebAPIClientIO } from "./webClientIO.js";

export class TypeAgentAPIWebSocketServer {
    private server: WebSocketServer;
    private settingSummary: string = "";

    constructor(endpoint: URL, dispatcher: Dispatcher, webClientIO: WebAPIClientIO) {
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
            
            webClientIO.CurrentWebSocket = ws;
            
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

            // intialize client
            webClientIO.updateSettingsSummary(this.settingSummary, [...dispatcher.getTranslatorNameToEmojiMap()]);
            // TODO: send agent greeting!? 
            
            // messages from web clients arrive here
            ws.on("message", async (message: string) => {
                try {
                    const msgObj = JSON.parse(message);
                    console.log(`Received ${msgObj.message} message`);
            
                    // update client summary if it has changed
                    const newSettingSummary = dispatcher.getSettingSummary();
                    if (newSettingSummary !== this.settingSummary) {
                        this.settingSummary = newSettingSummary;
                        webClientIO.updateSettingsSummary(this.settingSummary, [...dispatcher.getTranslatorNameToEmojiMap()]);
                    }
            
                    switch(msgObj.message) {
                        case "process-shell-request":
                            try {
                                const metrics = await dispatcher.processCommand(msgObj.data.request, msgObj.data.id, msgObj.data.images);
                                console.log(metrics);
                                webClientIO.sendSuccessfulCommandResult(msgObj.data.id, metrics);
                            } catch (error: any) {
                                webClientIO.sendFailedCommandResult(msgObj.data.id, error);
                            }
                            break;
                        case "askYesNoResponse":
                            // user said Yes (or no)!
                            webClientIO.resolveYesNoPromise(msgObj.data.askYesNoId, msgObj.data.accept);
                            break;          
                        case "proposeActionResponse":
                            webClientIO.resolveProposeActionPromise(msgObj.data.proposeActionId, msgObj.data.replacement);
                            break;
                        case "questionResponse":
                            webClientIO.resolveQuestionPromise(msgObj.data.questionId, msgObj.data.answer);
                            break;
                        case "get-dynamic-display":
                            dispatcher.getDynamicDisplay(msgObj.data.appAgentName, msgObj.data.displayType, msgObj.data.requestId);
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
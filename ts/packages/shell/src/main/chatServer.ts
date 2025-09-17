// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.
import {
    createServer,
    Server,
    IncomingMessage
} from "node:http";

import registerDebug from "debug";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import WebSocket, { WebSocketServer } from "ws";
import { getMimeType } from "common-utils";
import path from "node:path";

const debug = registerDebug("typeagent:shell:chatServer");

export class ChatServer {

    private server: Server<any, any>;
    private socketServer: WebSocketServer;
    private port: number;

    onConnection(callback: (ws: WebSocket, req: IncomingMessage) => void) {        

        this.socketServer.on("connection", (ws: WebSocket, req: IncomingMessage) => {
            console.log(`New client ${ws} ${req}`);

            callback(ws, req);
        });
    }

    constructor(port: number) {
        this.port = port;

        // web server for HTML page
        this.server = createServer((request: any, response: any) => {
            this.serve(request, response);
        });

        // socket server for web page IPC calls
        this.socketServer = new WebSocketServer({ server: this.server });

        this.server.on("listening", () => {
            console.log(`WebSocket server started!`);
        });

        this.server.on("error", (error: string) => {
            console.error(`WebSocket server error: ${error}`);
            this.server.close();
        });

        // this.server.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        //     console.log(`New client ${ws} ${req}`);

        //     // send the contents of the chat log upon the initial connection
        //     this.socketServer.clients.forEach((client) => {
        //         if (client.readyState === WebSocket.OPEN) {
        //             client.send();
        //         }
        //     });
        // });        
    }

    async start() {
        this.server.listen(this.port, () => {
            console.log(`ChatServer is listening on port ${this.port}`);
        });
    }

    stop() {
        this.server.close(() => {
            console.log("ChatServer has been stopped.");
        });

        this.socketServer.close(() => {
            console.log("WebSocket server has been stopped.");
        });
    }

    serve(request: any, response: any) {
        debug(`Received request: ${request.url}`);

        // serve up the requested file if we have it
        let root: string = path.resolve("out/renderer");
        let requestedFile: string =
            request.url == "/" || request.url === undefined
                ? "index.html"
                : request.url;

        // make sure requested file falls under web root
        try {
            requestedFile = realpathSync(
                path.resolve(path.join(root, requestedFile)),
            );
            if (!requestedFile.startsWith(root)) {
                response.statusCode = 403;
                response.end();
                return;
            }

            // serve requested file
            if (existsSync(requestedFile)) {
                response.writeHead(200, {
                    "Content-Type": getMimeType(path.extname(requestedFile)),
                    "Access-Control-Allow-Origin": "*",
                    //"Permissions-Policy": "camera=(self)", // allow access to getUserMedia() for the camera
                });
                response.end(readFileSync(requestedFile).toString());

                console.log(`Served '${requestedFile}' as '${request.url}'`);
            }
        } catch (error) {
            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end("File Not Found!\n");

            console.log(`Unable to serve '${request.url}', 404. ${error}`);
        }                
    }

    broadcast(message: string) {
        this.socketServer.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }
}

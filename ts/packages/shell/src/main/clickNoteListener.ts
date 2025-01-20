// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer, Server } from "node:http";

export type ClickNoteListenerConfig = {
    port: number;
    triggerRecognitionOnce: () => void
};

export class ClickNoteListener {
    public server: Server<any, any>;
    public port: number;
    public triggerFunc: () => void;

    constructor(config: ClickNoteListenerConfig) {
        // web server
        this.server = createServer((request: any, response: any) => {
            this.serve(request, response);
        });

        this.port = config.port;
        this.triggerFunc = config.triggerRecognitionOnce;

        console.log(`Listening on ${config.port} for Pen events.`);
    }

    serve(request: any, response: any) {

        // do we recognize this request?
        if (request.url == "/?listen=true") {
            response.writeHead(200, {
                "Content-Type": "application/json",
            });
            response.end("{}");
            console.log("Pen button Click received!");

            this.triggerFunc();

        } else {
            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end("File Not Found!\n");    
        }
    }

    start() {
        this.server.listen(this.port, "127.0.0.1", () => {
            console.log("Listening on all local IPs at port 3000");
        });

    }

    stop() {
        this.server.close();
    }
}

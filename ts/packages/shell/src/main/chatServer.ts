// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.
import {
    createServer,
    Server,
} from "node:https";

import registerDebug from "debug";

const debug = registerDebug("typeagent:shell:chatServer");

export class ChatServer {

    private server: Server<any, any>;
    private port: number

    constructor(port: number) {
        this.port = port;
        this.server = createServer((request: any, response: any) => {
            this.serve(request, response);
        });
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
    }

    serve(request: any, response: any) {
        debug(`Received request: ${request.url}`);
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("Hello from ChatServer!\n");
    }
}
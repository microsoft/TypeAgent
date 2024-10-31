// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { createDispatcher, Dispatcher } from "agent-dispatcher";
import { readFileSync } from "node:fs";
import {
    TypeAgentAPIServerConfig,
    TypeAgentAPIWebServer,
} from "./webServer.js";
import { WebAPIClientIO } from "./webClientIO.js";
import { TypeAgentAPIWebSocketServer } from "./webSocketServer.js";

export class TypeAgentServer {
    private dispatcher: Dispatcher | undefined;
    private webClientIO: WebAPIClientIO | undefined;
    private webSocketServer: TypeAgentAPIWebSocketServer | undefined;
    private webServer: TypeAgentAPIWebServer | undefined;

    constructor(
        private envPath: string,
        private wsPort: number = 3030,
    ) {
        // typeAgent config
        dotenv.config({ path: this.envPath });
    }

    async start() {
        // dispatcher
        this.webClientIO = new WebAPIClientIO();
        this.dispatcher = await createDispatcher("api", {
            appAgentProviders: [],
            explanationAsynchronousMode: true,
            persistSession: true,
            enableServiceHost: true,
            metrics: true,
            clientIO: this.webClientIO,
        });

        // websocket server
        const hostEndpoint =
            process.env["WEBSOCKET_HOST"] ?? `ws://localhost:${this.wsPort}`;
        const url = new URL(hostEndpoint);
        this.webSocketServer = new TypeAgentAPIWebSocketServer(
            url,
            this.dispatcher,
            this.webClientIO!,
        );

        // web server config
        const config: TypeAgentAPIServerConfig = JSON.parse(
            readFileSync("data/config.json").toString(),
        );

        // web server
        this.webServer = new TypeAgentAPIWebServer(config);
        this.webServer.start();
    }

    stop() {
        this.webServer?.stop();
        this.webSocketServer?.stop();
    }
}

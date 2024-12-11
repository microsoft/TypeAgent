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
import { getDefaultAppAgentProviders } from "agent-dispatcher/internal";

export class TypeAgentServer {
    private dispatcher: Dispatcher | undefined;
    private webClientIO: WebAPIClientIO | undefined;
    private webSocketServer: TypeAgentAPIWebSocketServer | undefined;
    private webServer: TypeAgentAPIWebServer | undefined;

    constructor(private envPath: string) {
        // typeAgent config
        dotenv.config({ path: this.envPath });
    }

    async start() {
        // dispatcher
        this.webClientIO = new WebAPIClientIO();
        this.dispatcher = await createDispatcher("api", {
            appAgentProviders: getDefaultAppAgentProviders(),
            explanationAsynchronousMode: true,
            persistSession: true,
            enableServiceHost: true,
            metrics: true,
            clientIO: this.webClientIO,
        });

        // web server config
        const config: TypeAgentAPIServerConfig = JSON.parse(
            readFileSync("data/config.json").toString(),
        );

        // web server
        this.webServer = new TypeAgentAPIWebServer(config);
        this.webServer.start();

        // websocket server
        this.webSocketServer = new TypeAgentAPIWebSocketServer(
            this.webServer.server,
            this.dispatcher,
            this.webClientIO!,
        );
    }

    stop() {
        this.webServer?.stop();
        this.webSocketServer?.stop();
        this.dispatcher?.close();
    }
}

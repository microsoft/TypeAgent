// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { createDispatcher } from 'agent-dispatcher';
import { readFileSync } from "node:fs";
import { TypeAgentAPIServerConfig, TypeAgentAPIWebServer } from "./webServer.js";
import { WebAPIClientIO } from "./webClientIO.js";
import { TypeAgentAPIWebSocketServer } from "./webSocketServer.js";

// create things in this order so that when they are started we are ready to serve:
// 1. Dispatcher, 2. Web socket server, 3. web server

// TypeAgent - Dispatcher setup -------------------------------------------------------------------
// typeAgent config
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const webClientIO = new WebAPIClientIO();

// dispatcher
const dispatcher = await createDispatcher("api", {
  appAgentProviders: [],
  explanationAsynchronousMode: true,
  persistSession: true,
  enableServiceHost: true,
  metrics: true,
  clientIO: webClientIO,
});

// Web Socket Server setup ------------------------------------------------------------------------
// websocket server
const hostEndpoint = process.env["WEBSOCKET_HOST"] ?? "ws://localhost:3030";
const url = new URL(hostEndpoint);
const webSocketServer: TypeAgentAPIWebSocketServer = new TypeAgentAPIWebSocketServer(url, dispatcher);
webSocketServer.noop();

// Web Server setup -------------------------------------------------------------------------------
// web server config
const config: TypeAgentAPIServerConfig = JSON.parse(readFileSync("data/config.json").toString());

// web server
const webServer: TypeAgentAPIWebServer = new TypeAgentAPIWebServer(config);
webServer.start();
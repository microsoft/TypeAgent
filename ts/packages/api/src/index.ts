// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { DisplayAppendMode } from '@typeagent/agent-sdk';
import { ClientIO, createDispatcher, IAgentMessage, RequestId } from 'agent-dispatcher';
import { createServer, IncomingMessage } from 'node:http';
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getMimeType } from "common-utils";
import WebSocket, { WebSocketServer } from "ws";
import registerDebug from "debug";

const debug = registerDebug("typeagent:api");

// web server config
const webConfig = JSON.parse(readFileSync("data/config.json").toString());

// typeAgent config
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });
let settingSummary: string = "";

// web server
const server = createServer(async (req, res) => {

  // serve up the requested file if we have it
  const requestedFile: string = path.join(webConfig.wwwroot, req.url == "/" || req.url === undefined ? "index.html" : req.url);
  if (existsSync(requestedFile)) {
    res.writeHead(200, { 'Content-Type': getMimeType(path.extname(requestedFile)), 'Access-Control-Allow-Origin': '*' });
    res.end(readFileSync(requestedFile).toString());
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File Not Found!\n'); 
  }

});

// websocket server
const hostEndpoint = process.env["WEBSOCKET_HOST"] ?? "ws://localhost:3030";
const url = new URL(hostEndpoint);
const wss = new WebSocketServer({
  port: parseInt(url.port),
  path: url.pathname
});

wss.on("listening", () => {
  debug(`WebSocket server started at ${hostEndpoint}`);
  process.send?.("Success");
});

wss.on("error", (error) => {
  console.error(`WebSocket server error: ${error}`);
  wss.close();
  process.send!("Failure");
  process.exit(1);
});

let currentws: WebSocket | undefined;
wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  debug("New client connected");

  currentws = ws;

  if (req.url) {
      const params = new URLSearchParams(req.url.split("?")[1]);
      const clientId = params.get("clientId");
      if (clientId) {
          for (var client of wss.clients) {
              if ((client as any).clientId) {
                  wss.clients.delete(client);
              }
          }

          (ws as any).clientId = clientId;
      }
  }

  debug(`Connection count: ${wss.clients.size}`);

  // messages from web clients arrive here
  ws.on("message", async (message: string) => {
      try {
          const msgObj = JSON.parse(message);
          debug(`Received ${msgObj.message} message`);

          const newSettingSummary = dispatcher.getSettingSummary();
          if (newSettingSummary !== settingSummary) {
              settingSummary = newSettingSummary;

              currentws?.send(JSON.stringify({
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
          debug("WebSocket message not parsed.");
      }
  });

  ws.on("close", () => {
      debug("Client disconnected");
  });
});

process.on("disconnect", () => {
  // Parent process has disconnected, close the WebSocket server and exit
  wss.close();
  process.exit(1);
});



























function updateDisplay(message: IAgentMessage, mode?: DisplayAppendMode) {
  currentws?.send(JSON.stringify({
    message: "update-display",
    data: {
      message,
      mode
    }
  }));
  console.log("update-display");
}

const clientIO: ClientIO = {
  clear: () => {
    currentws?.send(JSON.stringify({
      message: "clear",
      data: {}
    }));
  },
  setDisplay: updateDisplay,
  appendDisplay: (message, mode) => updateDisplay(message, mode ?? "inline"),
  setDynamicDisplay: (
    source: string,
    requestId: RequestId,
    actionIndex: number,
    displayId: string,
    nextRefreshMs: number,
  ) => { 
    currentws?.send(JSON.stringify({
      message: "set-dynamic-action-display",
      data: {
        source,
        requestId,
        actionIndex,
        displayId,
        nextRefreshMs
      }
    }));
  },
  askYesNo: (message, requestId, defaultValue?): Promise<boolean> => {
    return new Promise<boolean>((resolve)=>{});
  },
  question: (): Promise<string> => { return new Promise<string>((resolve) => {});},
  proposeAction: (actionTemplates, requestId, source): Promise<unknown> => {return new Promise<unknown>((resolve) => {});},
  notify(event: string, requestId: RequestId, data: any, source: string) {
    currentws?.send(JSON.stringify({
      message: "notify",
      data: {
        event,
        requestId,
        data,
        source
      }
    }));

      // switch (event) {
      //     case "explained":
      //         markRequestExplained(
      //             requestId,
      //             data.time,
      //             data.fromCache,
      //             data.fromUser,
      //         );
      //         break;
      //     case "randomCommandSelected":
      //         updateRandomCommandSelected(requestId, data.message);
      //         break;
      //     case "showNotifications":
      //         mainWindow?.webContents.send(
      //             "notification-command",
      //             requestId,
      //             data,
      //         );
      //         break;
      //     case AppAgentEvent.Error:
      //     case AppAgentEvent.Warning:
      //     case AppAgentEvent.Info:
      //         console.log(`[${event}] ${source}: ${data}`);
      //         mainWindow?.webContents.send(
      //             "notification-arrived",
      //             event,
      //             requestId,
      //             source,
      //             data,
      //         );
      //         break;
      //     default:
      //     // ignore
      // }
  },
  exit: () => {
    currentws?.send(JSON.stringify({
      message: "exit",
      data: {}
    }));
  
  },
  takeAction: (action: string) => {
    currentws?.send(JSON.stringify({
      message: "take-action",
      data: action
    }));
  },
};

// dispatcher
const dispatcher = await createDispatcher("api", {
  appAgentProviders: [],
  explanationAsynchronousMode: true,
  persistSession: true,
  enableServiceHost: true,
  metrics: true,
  clientIO,
});

// starts a simple http server locally on port 3000
server.listen(3000, '127.0.0.1', () => {
  console.log('Listening on 127.0.0.1:3000');
});
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { DisplayAppendMode } from '@typeagent/agent-sdk';
import { ClientIO, createDispatcher, IAgentMessage, RequestId } from 'agent-dispatcher';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

// typeAgent config
const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

let reqq: ServerResponse<IncomingMessage> | undefined = undefined;
// web server
const server = createServer(async (req, res) => {

  reqq = res;
  const metrics = await dispatcher.processCommand("@greeting", "agent-0", []);
  console.log(metrics);


  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello World!\n');
});

function updateDisplay(message: IAgentMessage, mode?: DisplayAppendMode) {
  console.log("updateDisplay");

  reqq!.writeHead(200, { 'Content-Type': 'text/plain' });
  reqq!.end(`${message.message}\n`);
}

const clientIO: ClientIO = {
  clear: () => {
      //mainWindow?.webContents.send("clear");
  },
  setDisplay: updateDisplay,
  appendDisplay: (message, mode) => updateDisplay(message, mode ?? "inline"),
  setDynamicDisplay: () => { console.log("setDynamicDisplay");},
  searchMenuCommand: () => {},
  actionCommand: () => {},
  askYesNo: (message, requestId, defaultValue?): Promise<boolean> => {return new Promise<boolean>((resolve)=>{})},
  question: (): Promise<string> => { return new Promise<string>((resolve) => {});},
  notify(event: string, requestId: RequestId, data: any, source: string) {
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
      //app.quit();
  },
  takeAction: (action: string) => {
      //mainWindow?.webContents.send("take-action", action);
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
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessage, createWebSocket } from "common-utils";
import { WebSocket } from "ws";
import {
  DispatcherAction,
  DispatcherAgent,
  DispatcherAgentContext,
  createTurnImpressionFromLiteral,
} from "dispatcher-agent";
import { Crossword } from "./crosswordPageSchema.mjs";
import {
  getBoardSchema,
  handleCrosswordAction,
} from "./crosswordPageUtilities.mjs";

import { BrowserConnector } from "./browserConnector.mjs";

export function instantiate(): DispatcherAgent {
  return {
    initializeAgentContext: initializeBrowserContext,
    updateAgentContext: updateBrowserContext,
    executeAction: executeBrowserAction,
  };
}

export type BrowserActionContext = {
  webSocket: WebSocket | undefined;
  crossWordState: Crossword | undefined;
  browserConnector: BrowserConnector | undefined;
};

function initializeBrowserContext(): BrowserActionContext {
  return {
    webSocket: undefined,
    crossWordState: undefined,
    browserConnector: undefined,
  };
}

async function updateBrowserContext(
  enable: boolean,
  context: DispatcherAgentContext<BrowserActionContext>,
  translatorName: string,
): Promise<void> {
  if (translatorName !== "browser") {
    // REVIEW: ignore sub-translator updates.
    return;
  }
  if (enable) {
    if (context.context.webSocket?.readyState === WebSocket.OPEN) {
      return;
    }

    const webSocket = await createWebSocket();
    if (webSocket) {
      context.context.webSocket = webSocket;
      context.context.browserConnector = new BrowserConnector(context);

      webSocket.onclose = (event: object) => {
        console.error("Browser webSocket connection closed.");
        context.context.webSocket = undefined;
      };
      webSocket.addEventListener("message", async (event: any) => {
        const text = event.data.toString();
        const data = JSON.parse(text) as WebSocketMessage;
        if (
          data.target == "dispatcher" &&
          data.source == "browser" &&
          data.body
        ) {
          switch (data.messageType) {
            case "enableSiteTranslator": {
              if (data.body == "browser.crossword") {
                // initialize crossword state
                sendSiteTranslatorStatus(data.body, "initializing", context);
                context.context.crossWordState = await getBoardSchema(context);
                sendSiteTranslatorStatus(data.body, "initialized", context);
              }

              if (context.currentTranslatorName !== data.body) {
                await context.toggleAgent(data.body, true);

                context.currentTranslatorName = data.body;
              }
              break;
            }
            case "disableSiteTranslator": {
              if (context.currentTranslatorName == data.body) {
                await context.toggleAgent(data.body, false);

                context.currentTranslatorName = "browser";
              }
              break;
            }
            case "confirmAction": {
              /*
              const requestIO = context.requestIO;
              const requestId = context.requestId;
              
              if (requestIO && requestId && data.id === requestId) {
                requestIO.success(data.body);
              }
              */
              break;
            }
          }
        }
      });
    }
  } else {
    const webSocket = context.context.webSocket;
    if (webSocket) {
      webSocket.onclose = null;
      webSocket.close();
    }

    context.context.webSocket = undefined;
  }
}

async function executeBrowserAction(
  action: DispatcherAction,
  context: DispatcherAgentContext<BrowserActionContext>,
) {
  const webSocketEndpoint = context.context.webSocket;

  if (webSocketEndpoint) {
    try {
      const requestIO = context.requestIO;
      const requestId = context.requestId;
      requestIO.status("Running remote action.");

      let messageType = "translatedAction";
      let target = "browser";
      if (action.translatorName === "browser.paleoBioDb") {
        messageType = "siteTranslatedAction_paleoBioDb";
      } else if (action.translatorName === "browser.crossword") {
        const crosswordResult = await handleCrosswordAction(action, context);
        return createTurnImpressionFromLiteral(crosswordResult);
      }

      webSocketEndpoint.send(
        JSON.stringify({
          source: "dispatcher",
          target: target,
          messageType,
          id: requestId,
          body: action,
        }),
      );
    } catch {
      throw new Error("Unable to contact browser backend.");
    }
  } else {
    throw new Error("No websocket connection.");
  }
  return undefined;
}

function sendSiteTranslatorStatus(
  translatorName: string,
  status: string,
  context: DispatcherAgentContext<BrowserActionContext>,
) {
  const webSocketEndpoint = context.context.webSocket;
  const requestId = context.requestId;

  if (webSocketEndpoint) {
    webSocketEndpoint.send(
      JSON.stringify({
        source: "dispatcher",
        target: "browser",
        messageType: "siteTranslatorStatus",
        id: requestId,
        body: {
          translator: translatorName,
          status: status,
        },
      }),
    );
  }
}

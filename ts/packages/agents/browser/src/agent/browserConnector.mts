// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessage } from "common-utils";
import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./browserActionHandler.mjs";

export class BrowserConnector {
  private context: SessionContext<BrowserActionContext>;
  private webSocket: any;

  constructor(context: SessionContext<BrowserActionContext>) {
    this.context = context;
    this.webSocket = context.agentContext.webSocket;
  }

  async sendActionToBrowser(action: any, messageType?: string) {
    return new Promise<string | undefined>((resolve, reject) => {
      if (this.webSocket) {
        try {
          const agentIO = this.context.agentIO;
          let requestId = this.context.requestId;
          if (requestId) {
            agentIO.status("Running remote action.");
          } else {
            requestId = new Date().getTime().toString();
          }
          if (!messageType) {
            if (this.context.currentTranslatorName.startsWith("browser.")) {
              messageType = `siteTranslatedAction_${this.context.currentTranslatorName.substring(8)}`;
            } else {
              messageType = "translatedAction";
            }
          }

          this.webSocket.send(
            JSON.stringify({
              source: "dispatcher",
              target: "browser",
              messageType: messageType,
              id: requestId,
              body: action,
            }),
          );

          const handler = (event: any) => {
            const text = event.data.toString();
            const data = JSON.parse(text) as WebSocketMessage;
            if (
              data.target == "dispatcher" &&
              data.source == "browser" &&
              data.id == requestId &&
              data.body
            ) {
              switch (data.messageType) {
                case "confirmActionWithData":
                case "confirmAction": {
                  this.webSocket.removeEventListener("message", handler);
                  resolve("OK");
                  break;
                }
              }
            }
          };

          this.webSocket.addEventListener("message", handler);
        } catch {
          console.log("Unable to contact browser backend.");
          reject("Unable to contact browser backend.");
        }
      } else {
        throw new Error("No websocket connection.");
      }
    });
  }

  private async getPageDataFromBrowser(action: any) {
    return new Promise<string | undefined>((resolve, reject) => {
      if (this.webSocket) {
        try {
          const requestId = new Date().getTime().toString();

          this.webSocket.send(
            JSON.stringify({
              source: "dispatcher",
              target: "browser",
              messageType: "translatedAction",
              id: requestId,
              body: action,
            }),
          );

          const handler = (event: any) => {
            const text = event.data.toString();
            const data = JSON.parse(text) as WebSocketMessage;
            if (
              data.target == "dispatcher" &&
              data.source == "browser" &&
              data.id == requestId &&
              data.body
            ) {
              switch (data.messageType) {
                case "confirmActionWithData": {
                  this.webSocket.removeEventListener("message", handler);
                  resolve(data.body.data);
                  break;
                }
              }
            }
          };

          this.webSocket.addEventListener("message", handler);
        } catch {
          console.log("Unable to contact browser agent.");
          reject("Unable to contact browser agent.");
        }
      }
    });
  }

  async getHtmlFragments() {
    const timeoutPromise = new Promise((f) => setTimeout(f, 5000));
    const htmlAction = {
      actionName: "getHTML",
      parameters: {
        fullHTML: false,
        downloadAsFile: false,
      },
    };

    const actionPromise = this.getPageDataFromBrowser(htmlAction);
    const liveHtml = await Promise.race([actionPromise, timeoutPromise]);
    if (liveHtml && Array.isArray(liveHtml)) {
      return liveHtml;
    }

    return [];
  }

  async getFilteredHtmlFragments(inputHtmlFragments: any[]) {
    let htmlFragments: any[] = [];
    const timeoutPromise = new Promise((f) => setTimeout(f, 5000));
    const filterAction = {
      actionName: "getFilteredHTMLFragments",
      parameters: {
        fragments: inputHtmlFragments,
      },
    };

    const actionPromise = this.getPageDataFromBrowser(filterAction);
    const result = await Promise.race([actionPromise, timeoutPromise]);

    if (result && Array.isArray(result)) {
      htmlFragments = result;
    }

    return htmlFragments;
  }

  async getCurrentPageScreenshot() {
    const timeoutPromise = new Promise((f) => setTimeout(f, 3000));
    const screenshotAction = {
      actionName: "captureScreenshot",
      parameters: {
        downloadAsFile: false,
      },
    };

    const actionPromise = this.getPageDataFromBrowser(screenshotAction);
    let screenshot = "";
    const liveScreenshot = await Promise.race([actionPromise, timeoutPromise]);

    if (liveScreenshot && typeof liveScreenshot == "string") {
      screenshot = liveScreenshot;
    }

    return screenshot;
  }

  async getCurrentPageAnnotatedScreenshot() {
    const timeoutPromise = new Promise((f) => setTimeout(f, 3000));
    const screenshotAction = {
      actionName: "captureAnnotatedScreenshot",
      parameters: {
        downloadAsFile: true,
      },
    };

    const actionPromise = this.getPageDataFromBrowser(screenshotAction);
    let screenshot = "";
    const liveScreenshot = await Promise.race([actionPromise, timeoutPromise]);

    if (liveScreenshot && typeof liveScreenshot == "string") {
      screenshot = liveScreenshot;
    }

    return screenshot;
  }

  async getCurrentPageSchema(url: string | undefined) {
    const timeoutPromise = new Promise((f) => setTimeout(f, 3000));
    const action = {
      actionName: "getPageSchema",
      parameters: {
        url: url,
      },
    };

    const actionPromise = this.getPageDataFromBrowser(action);
    return Promise.race([actionPromise, timeoutPromise]);
  }

  async setCurrentPageSchema(url: string, data: any) {
    const schemaAction = {
      actionName: "setPageSchema",
      parameters: {
        url: url,
        schema: data,
      },
    };

    return this.sendActionToBrowser(schemaAction, "translatedAction");
  }

  async getPageUrl() {
    const action = {
      actionName: "getPageUrl",
      parameters: {},
    };

    return this.getPageDataFromBrowser(action);
  }

  async clickOn(cssSelector: string) {
    const clickAction = {
      actionName: "clickOnElement",
      parameters: {
        cssSelector: cssSelector,
      },
    };
    return this.sendActionToBrowser(clickAction);
  }

  async enterTextIn(textValue: string, cssSelector?: string) {
    const textAction = {
      actionName: "enterText",
      parameters: {
        value: textValue,
        cssSelector: cssSelector,
      },
    };

    return this.sendActionToBrowser(textAction);
  }

  async awaitPageLoad() {
    const action = {
      actionName: "awaitPageLoad",
      parameters: {},
    };

    return this.sendActionToBrowser(action, "translatedAction");
  }
}

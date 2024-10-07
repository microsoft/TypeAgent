// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocketMessage } from "common-utils";
import { AppActionWithParameters, SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "./actionHandler.mjs";

export class BrowserConnector {
  private webSocket: any;

  constructor(context: SessionContext<BrowserActionContext>) {
    this.webSocket = context.agentContext.webSocket;
  }

  async sendActionToBrowser(
    action: AppActionWithParameters,
    messageType?: string,
  ) {
    return new Promise<any | undefined>((resolve, reject) => {
      if (this.webSocket) {
        try {
          const callId = new Date().getTime().toString();
          if (!messageType) {
            messageType = "browserActionRequest";
          }

          this.webSocket.send(
            JSON.stringify({
              source: "dispatcher",
              target: "browser",
              messageType: messageType,
              id: callId,
              body: action,
            }),
          );

          const handler = (event: any) => {
            const text = event.data.toString();
            const data = JSON.parse(text) as WebSocketMessage;
            if (
              data.target == "dispatcher" &&
              data.source == "browser" &&
              data.messageType == "browserActionResponse" &&
              data.id == callId &&
              data.body
            ) {
              this.webSocket.removeEventListener("message", handler);
              resolve(data.body);
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
    return new Promise<string | undefined>(async (resolve, reject) => {
      const response = await this.sendActionToBrowser(
        action,
        "browserActionRequest",
      );
      if (response.data) {
        resolve(response.data);
      } else {
        resolve(undefined);
      }
    });
  }

  async getHtmlFragments() {
    const timeoutPromise = new Promise((f) => setTimeout(f, 120000));
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

    return this.sendActionToBrowser(schemaAction, "browserActionRequest");
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
    let actionName = cssSelector ? "enterTextInElement" : "enterTextOnPage";

    const textAction = {
      actionName: actionName,
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

    return this.sendActionToBrowser(action, "browserActionRequest");
  }
}

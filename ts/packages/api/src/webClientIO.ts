// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayAppendMode } from "@typeagent/agent-sdk";
import { ActionTemplateSequence, ClientIO, IAgentMessage, RequestId } from "agent-dispatcher";
import WebSocket from "ws";

export class WebAPIClientIO implements ClientIO 
 {
    private currentws: WebSocket | undefined;

    public get CurrentWebSocket() {
      return this.currentws;
    }

    public set CurrentWebSocket(value: WebSocket | undefined) {
      this.currentws = value;
    }
    
    clear() {
      this.currentws?.send(JSON.stringify({
        message: "clear",
        data: {}
      }));
    }

    setDisplay(message: IAgentMessage) { this.updateDisplay(message, "inline"); }

    appendDisplay(message: IAgentMessage, mode: DisplayAppendMode) {
        this.updateDisplay(message, mode ?? "inline");
    }
        
    updateDisplay(message?: IAgentMessage, mode?: DisplayAppendMode) {
        this.currentws?.send(JSON.stringify({
          message: "update-display",
          data: {
            message,
            mode
          }
        }));
        console.log("update-display");
    }
    
    setDynamicDisplay(
      source: string,
      requestId: RequestId,
      actionIndex: number,
      displayId: string,
      nextRefreshMs: number,
    ) {
        this.currentws?.send(JSON.stringify({
        message: "set-dynamic-action-display",
        data: {
          source,
          requestId,
          actionIndex,
          displayId,
          nextRefreshMs
        }
      }));
    };

    // TODO: implement
    askYesNo(message: string, requestId: RequestId, defaultValue?: boolean): Promise<boolean> {
      return new Promise<boolean>((resolve)=>{});
    }

    // TODO: implement
    question(): Promise<string> { return new Promise<string>((resolve) => {}); }
    
    // TODO: implement
    proposeAction(actionTemplates: ActionTemplateSequence, requestId: RequestId, source: string): Promise<unknown> {return new Promise<unknown>((resolve) => {});}
    
    notify(event: string, requestId: RequestId, data: any, source: string) {
      this.currentws?.send(JSON.stringify({
        message: "notify",
        data: {
          event,
          requestId,
          data,
          source
        }
      }));
    }

    exit() {
      this.currentws?.send(JSON.stringify({
        message: "exit",
        data: {}
      }));
    
    }

    takeAction(action: string) {
      this.currentws?.send(JSON.stringify({
        message: "take-action",
        data: action
      }));
    }
  };
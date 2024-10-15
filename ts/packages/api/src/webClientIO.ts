// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayAppendMode } from "@typeagent/agent-sdk";
import { ActionTemplateSequence, ClientIO, IAgentMessage, RequestId } from "agent-dispatcher";
import WebSocket from "ws";

export class WebAPIClientIO implements ClientIO 
 {
    private currentws: WebSocket | undefined;
    
    clear() {
      this.currentws?.send(JSON.stringify({
        message: "clear",
        data: {}
      }));
    }

    setDisplay() { this.updateDisplay(); }

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

    askYesNo(message: string, requestId: RequestId, defaultValue?: boolean): Promise<boolean> {
      return new Promise<boolean>((resolve)=>{});
    }

    question(): Promise<string> { return new Promise<string>((resolve) => {}); }
    
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
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest } from "@typeagent/agent-sdk";

export type WebAgentMessage =
  | WebAgentAddMessage
  | WebAgentRpcMessage
  | WebAgentDisconnectMessage;

export type WebAgentMessageFromDispatcher =
  | WebAgentRpcMessageFromDispatcher
  | WebAgentDisconnectMessageFromDispatcher;

export type WebAgentAddMessage = {
  target: "dispatcher";
  source: "webAgent";
  messageType: "add";
  body: {
    name: string;
    manifest: AppAgentManifest;
  };
};

export type WebAgentRpcMessage = {
  target: "dispatcher";
  source: "webAgent";
  messageType: "message";
  body: any;
};

export type WebAgentDisconnectMessage = {
  target: "dispatcher";
  source: "webAgent";
  messageType: "disconnect";
  body: string;
};

export type WebAgentRpcMessageFromDispatcher = {
  target: "webAgent";
  source: "dispatcher";
  messageType: "message";
  body: any;
};

export type WebAgentDisconnectMessageFromDispatcher = {
  target: "webAgent";
  source: "dispatcher";
  messageType: "disconnect";
};

export function isWebAgentMessage(message: any): message is WebAgentMessage {
  return (
    message.target === "dispatcher" &&
    message.source === "webAgent" &&
    (message.messageType === "add" ||
      message.messageType === "message" ||
      message.messageType === "disconnect")
  );
}

export function isWebAgentMessageFromDispatcher(
  message: any,
): message is WebAgentMessageFromDispatcher {
  return (
    message.target === "webAgent" &&
    message.source === "dispatcher" &&
    (message.messageType === "message" || message.messageType === "disconnect")
  );
}

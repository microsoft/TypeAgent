// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type WebAgentMessage =
  | WebAgentRegisterMessage
  | WebAgentRpcMessage
  | WebAgentDisconnectMessage;

export type WebAgentMessageFromDispatcher =
  | WebAgentRegisterMessageFromDispatcher
  | WebAgentRpcMessageFromDispatcher
  | WebAgentDisconnectMessageFromDispatcher;

export type WebAgentRegisterMessage = {
  target: "dispatcher";
  source: "webAgent";
  messageType: "register";
  body: any;
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

export type WebAgentRegisterMessageFromDispatcher = {
  target: "webAgent";
  source: "dispatcher";
  messageType: "register";
  body: any;
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
    (message.messageType === "register" ||
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
    (message.messageType === "register" ||
      message.messageType === "message" ||
      message.messageType === "disconnect")
  );
}

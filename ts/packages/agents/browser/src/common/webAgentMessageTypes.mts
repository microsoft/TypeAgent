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
    source: "webAgent";
    method: "webAgent/register";
    params: any;
    title?: string;
    url?: string;
};

export type WebAgentRpcMessage = {
    source: "webAgent";
    method: "webAgent/message";
    params: any;
};

export type WebAgentDisconnectMessage = {
    source: "webAgent";
    method: "webAgent/disconnect";
    params: string;
};

export type WebAgentRegisterMessageFromDispatcher = {
    source: "dispatcher";
    method: "webAgent/register";
    params: any;
};

export type WebAgentRpcMessageFromDispatcher = {
    source: "dispatcher";
    method: "webAgent/message";
    params: any;
};

export type WebAgentDisconnectMessageFromDispatcher = {
    source: "dispatcher";
    method: "webAgent/disconnect";
};

export function isWebAgentMessage(message: any): message is WebAgentMessage {
    return (
        message.source === "webAgent" &&
        (message.method === "webAgent/register" ||
            message.method === "webAgent/message" ||
            message.method === "webAgent/disconnect")
    );
}

export function isWebAgentMessageFromDispatcher(
    message: any,
): message is WebAgentMessageFromDispatcher {
    return (
        message.source === "dispatcher" &&
        (message.method === "webAgent/register" ||
            message.method === "webAgent/message" ||
            message.method === "webAgent/disconnect")
    );
}

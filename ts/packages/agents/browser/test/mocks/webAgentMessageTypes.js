// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const isWebAgentMessage = (message) => {
    return (
        message &&
        typeof message === "object" &&
        typeof message.source === "string" &&
        message.source === "webAgent" &&
        typeof message.method === "string" &&
        message.method.startsWith("webAgent/")
    );
};

export const isWebAgentMessageFromDispatcher = (message) => {
    return (
        message &&
        typeof message === "object" &&
        typeof message.source === "string" &&
        message.source === "dispatcher" &&
        typeof message.method === "string" &&
        message.method.startsWith("webAgent/")
    );
};

export class WebAgentDisconnectMessage {
    constructor(name) {
        this.source = "webAgent";
        this.method = "webAgent/disconnect";
        this.params = name;
    }
}

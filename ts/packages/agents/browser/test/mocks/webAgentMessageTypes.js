module.exports = {
    isWebAgentMessage: (message) => {
        return (
            message &&
            typeof message === "object" &&
            typeof message.source === "string" &&
            message.source === "webAgent" &&
            typeof message.method === "string" &&
            message.method.startsWith("webAgent/")
        );
    },

    isWebAgentMessageFromDispatcher: (message) => {
        return (
            message &&
            typeof message === "object" &&
            typeof message.source === "string" &&
            message.source === "dispatcher" &&
            typeof message.method === "string" &&
            message.method.startsWith("webAgent/")
        );
    },

    WebAgentDisconnectMessage: class WebAgentDisconnectMessage {
        constructor(name) {
            this.source = "webAgent";
            this.method = "webAgent/disconnect";
            this.params = name;
        }
    },
};

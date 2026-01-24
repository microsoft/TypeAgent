// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AgentServerInvokeFunctions = {
    join: () => Promise<string>;
};

export const enum ChannelName {
    AgentServer = "agent-server",
    Dispatcher = "dispatcher",
    ClientIO = "clientio",
}

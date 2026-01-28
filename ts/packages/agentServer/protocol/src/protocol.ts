// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DispatcherConnectOptions = {
    filter?: boolean; // filter to message for own request. Default is false (no filtering)
};

export type AgentServerInvokeFunctions = {
    join: (options?: DispatcherConnectOptions) => Promise<string>;
};

export const enum ChannelName {
    AgentServer = "agent-server",
    Dispatcher = "dispatcher",
    ClientIO = "clientio",
}

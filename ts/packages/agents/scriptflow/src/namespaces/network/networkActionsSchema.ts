// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ScriptFlowNetworkActions =
    | TestConnectionAction
    | PortListenersAction
    | NetworkAdaptersAction
    | IpConfigAction
    | DnsLookupAction;

// Test network connectivity (ping)
export type TestConnectionAction = {
    actionName: "testConnection";
    parameters: {
        // Hostname or IP address to test
        computerName: string;
        // Optional port to test
        port?: number;
    };
};

// Show processes listening on network ports
export type PortListenersAction = {
    actionName: "portListeners";
    parameters: {
        // Filter by port number
        port?: number;
    };
};

// List network adapters
export type NetworkAdaptersAction = {
    actionName: "networkAdapters";
    parameters: {
        // Filter by adapter name
        name?: string;
    };
};

// Show IP configuration
export type IpConfigAction = {
    actionName: "ipConfig";
    parameters: {
        // Filter by interface alias
        interfaceAlias?: string;
    };
};

// Perform DNS lookup
export type DnsLookupAction = {
    actionName: "dnsLookup";
    parameters: {
        // Hostname to resolve
        name: string;
        // DNS record type (A, AAAA, MX, etc.)
        type?: string;
    };
};

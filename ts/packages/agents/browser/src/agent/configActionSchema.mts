// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type BrowserConfigActions =
    | UseExternalBrowserControl
    | UseClientBrowserControl
    | ListUrlResolvers
    | ToggleKeywordResolver
    | ToggleHistoryResolver
    | ShowLookupSettings
    | SetLookupMode
    | ListSearchProviders
    | SetSearchProvider
    | ShowSearchProvider
    | AddSearchProvider
    | RemoveSearchProvider
    | ImportSearchProviders;

// Use the connected browser extension for browser control.
export type UseExternalBrowserControl = {
    actionName: "useExternalBrowserControl";
};

// Use the TypeAgent client browser for browser control.
export type UseClientBrowserControl = {
    actionName: "useClientBrowserControl";
};

// List the browser URL resolvers and their enabled state.
export type ListUrlResolvers = {
    actionName: "listUrlResolvers";
};

// Toggle the browser keyword URL resolver.
export type ToggleKeywordResolver = {
    actionName: "toggleKeywordResolver";
};

// Toggle the browser-history URL resolver.
export type ToggleHistoryResolver = {
    actionName: "toggleHistoryResolver";
};

// Show the effective internet lookup configuration.
export type ShowLookupSettings = {
    actionName: "showLookupSettings";
};

// Set how browser internet lookups are answered.
export type SetLookupMode = {
    actionName: "setLookupMode";
    parameters: {
        // Lookup implementation: browser only, Azure AI Search API, or Azure AI Search MCP.
        mode: "off" | "api" | "mcp";
    };
};

// List configured browser search providers.
export type ListSearchProviders = {
    actionName: "listSearchProviders";
};

// Select the active browser search provider.
export type SetSearchProvider = {
    actionName: "setSearchProvider";
    parameters: {
        // Name of the configured search provider.
        provider: string;
    };
};

// Show one browser search provider's configuration.
export type ShowSearchProvider = {
    actionName: "showSearchProvider";
    parameters?: {
        // Name of the configured search provider. Omit to show the active provider.
        provider?: string;
    };
};

// Add a browser search provider.
export type AddSearchProvider = {
    actionName: "addSearchProvider";
    parameters: {
        // Name for the search provider.
        provider: string;
        // Search URL containing a %s placeholder for the encoded query.
        url: string;
    };
};

// Remove a browser search provider.
export type RemoveSearchProvider = {
    actionName: "removeSearchProvider";
    parameters: {
        // Name of the configured search provider.
        provider: string;
    };
};

// Import search providers from an installed browser.
export type ImportSearchProviders = {
    actionName: "importSearchProviders";
    parameters: {
        // Browser from which to import search providers.
        browser: "Edge" | "Chrome";
    };
};

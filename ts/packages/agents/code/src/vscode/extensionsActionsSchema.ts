// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeWorkbenchExtensionActions =
    | CheckExtensionAvailabilityAction
    | InstallExtensionAction
    | ReloadWindowAction
    | ShowExtensionsAction
    | EnableExtensionAction
    | DisableExtensionAction;

export type KnownExtensionQuery =
    | "@updates"
    | "@recentlyPublished"
    | "@workspaceUnsupported"
    | "@builtin"
    | "@installed"
    | "@popular"
    | "@recommended"
    | "@enabled"
    | "@disabled"
    | "@mcp";

export type KnownExtensionCategory =
    | "ai"
    | "azure"
    | "data science"
    | "formatters"
    | "programming languages"
    | "extension packs"
    | "machine learning"
    | "education"
    | "snippets"
    | "chat"
    | "visualizations"
    | "scm providers"
    | "linters"
    | "themes"
    | "notebooks"
    | "debuggers"
    | "language packs"
    | "testing"
    | "education"
    | "other"; // catch-all or extended via marketplace API

// The action checks/searches if an extension is available based on user requests like is the copilot extension available?
// or Show me all extensions related to AI
export interface CheckExtensionAvailabilityAction {
    actionName: "checkExtensionAvailable";
    parameters: {
        // Free text (e.g. "copilot")
        filterByUserQuery?: string;
        // Known query (e.g. "@installed")
        filterByKnownQuery?: KnownExtensionQuery;
        // Category filter (e.g. "@category:ai")
        filterByCategory?: KnownExtensionCategory; // e.g. "azure, themes"
    };
}

export type InstallExtensionAction = {
    actionName: "installExtension";
    parameters: {
        // natural language query, e.g. "copilot"
        extensionQuery: string;
        // whether to prompt user for confirmation before installing, default: true
        promptUser?: boolean;
        // whether to automatically reload the window after installation, default: false
        autoReload?: boolean;
    };
};

export type ReloadWindowAction = {
    actionName: "reloadWindow";
};

// Show the extensions panel
export type ShowExtensionsAction = {
    actionName: "showExtensions";
};
export interface EnableExtensionAction {
    actionName: "enableExtension";
    parameters: {
        // e.g. "prettier", "azure functions"
        extensionQuery: string;
        // whether to prompt user for confirmation before enabling, default: true
        promptUser?: boolean;
        // whether to automatically reload the window after enabling, default: false
        autoReload?: boolean;
    };
}

export interface DisableExtensionAction {
    actionName: "disableExtension";
    parameters: {
        // e.g. "prettier", "azure functions"
        extensionQuery: string;
        // whether to prompt user for confirmation before disabling, default: true
        promptUser?: boolean;
        // whether to automatically reload the window after disabling, default: false
        autoReload?: boolean;
    };
}

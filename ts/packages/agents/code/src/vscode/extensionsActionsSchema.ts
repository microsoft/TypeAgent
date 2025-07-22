// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type CodeWorkbenchExtensionActions =
    | CheckExtensionAvailabilityAction
    | InstallExtensionAction
    | ReloadWindowAction
    | ShowExtensionsAction;

export type CheckExtensionAvailabilityAction = {
    actionName: "checkExtensionAvailable";
    parameters: {
        // e.g., "GitHub copilot"
        extensionId: string;
    };
};

export type InstallExtensionAction = {
    actionName: "installExtension";
    parameters: {
        extensionId: string;
        // default value is true, show VSCode yes/no prompt
        promptUser?: boolean;
        // default value is false, do not reload VSCode after install
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

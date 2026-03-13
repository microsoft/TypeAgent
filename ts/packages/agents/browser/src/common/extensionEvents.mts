// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ExtensionEventMap = {
    connectionStatusChanged: { connected: boolean; timestamp: number };
    importProgress: { importId: string; progress: any };
    knowledgeExtractionProgress: {
        extractionId: string;
        progress: any;
    };
    macroAdded: { actionId: string };
    macroDeleted: { macroId: string };
    settingsUpdated: { settings: any };
};

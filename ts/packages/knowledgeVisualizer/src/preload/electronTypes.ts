// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ElectronAPI } from "@electron-toolkit/preload";

export interface ClientAPI {
    onUpdateListVisualization(
        callback: (e: Electron.IpcRendererEvent, data) => void,
    ): void;
    onUpdateKnowledgeVisualization(
        callback: (e: Electron.IpcRendererEvent, data) => void,
    ): void;
    onUpdateKnowledgeHierarchyVisualization(
        callback: (e: Electron.IpcRendererEvent, data) => void,
    ): void;
    onUpdateWordCloud(
        callback: (e: Electron.IpcRendererEvent, data) => void,
    ): void;
}

export interface ElectronWindowFields {
    api: ClientAPI;
    electron: ElectronAPI;
}

export type ElectronWindow = typeof globalThis & ElectronWindowFields;

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { ClientAPI } from "./electronTypes.js"; // Custom APIs for renderer

const api: ClientAPI = {
    onUpdateListVisualization(callback) {
        ipcRenderer.on("update-list-visualization", callback);
    },
    onUpdateKnowledgeVisualization(callback) {
        ipcRenderer.on("update-knowledge-visualization", callback);
    },
    onUpdateKnowledgeHierarchyVisualization(callback) {
        ipcRenderer.on("update-hierarchy-visualization", callback);
    },
    onUpdateWordCloud(callback) {
        ipcRenderer.on("update-wordcloud", callback);
    },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld("electron", electronAPI);
        contextBridge.exposeInMainWorld("api", api);
    } catch (error) {
        console.error(error);
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = electronAPI;
    // @ts-ignore (define in dts)
    window.api = api;
}

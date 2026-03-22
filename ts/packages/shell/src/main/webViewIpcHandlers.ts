// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { app, ipcMain, session } from "electron";
import { debugShellError } from "./debug.js";
import { ExtensionStorageManager } from "./extensionStorage.js";
import { BrowserAgentIpc } from "./browserIpc.js";
import type { WebSocketMessageV2 } from "websocket-utils";
import path from "path";
import { getShellWindow, getShellWindowForIpcEvent } from "./instance.js";

// If instanceDir is undefined, the external storage is "in memory" and will not persist across restarts
export function initializeExternalStorageIpcHandlers(
    instanceDir: string | undefined,
) {
    const extensionStorage = new ExtensionStorageManager(instanceDir);
    // Extension storage IPC handlers
    ipcMain.handle("extension-storage-get", async (_, keys: string[]) => {
        try {
            return extensionStorage.get(keys);
        } catch (error) {
            debugShellError("Error getting extension storage:", error);
            return {};
        }
    });

    ipcMain.handle(
        "extension-storage-set",
        async (_, items: Record<string, any>) => {
            try {
                extensionStorage.set(items);
                return { success: true };
            } catch (error) {
                debugShellError("Error setting extension storage:", error);
                return { success: false, error: (error as Error).message };
            }
        },
    );

    ipcMain.handle("extension-storage-remove", async (_, keys: string[]) => {
        try {
            extensionStorage.remove(keys);
            return { success: true };
        } catch (error) {
            debugShellError("Error removing extension storage:", error);
            return { success: false, error: (error as Error).message };
        }
    });
}

export function initializePDFViewerIpcHandlers() {
    // PDF viewer IPC handlers
    ipcMain.handle("check-typeagent-connection", async (event) => {
        const shellWindow = getShellWindowForIpcEvent(event);
        if (shellWindow) {
            const connected = await shellWindow.checkTypeAgentConnection();
            return { connected };
        }
        return { connected: false };
    });

    ipcMain.handle("open-pdf-viewer", async (event, pdfUrl: string) => {
        const shellWindow = getShellWindowForIpcEvent(event);
        if (shellWindow) {
            try {
                await shellWindow.openPDFViewer(pdfUrl);
                return { success: true };
            } catch (error) {
                debugShellError("Error opening PDF viewer:", error);
                return {
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                };
            }
        }
        return { success: false, error: "Shell window not available" };
    });
}

export async function initializeBrowserExtension(_appPath: string) {
    const browserExtensionPath = app.isPackaged
        ? path.join(process.resourcesPath, "browser-typeagent-extension")
        : path.join(
              app.getAppPath(),
              "node_modules/browser-typeagent/dist/electron",
          );

    const extension = await session.defaultSession.extensions.loadExtension(
        browserExtensionPath,
        {
            allowFileAccess: true,
        },
    );

    // Store extension info for later URL construction
    (global as any).browserExtensionId = extension.id;
    (global as any).browserExtensionUrls = {
        "/annotationsLibrary.html": `chrome-extension://${extension.id}/views/annotationsLibrary.html`,
        "/knowledgeLibrary.html": `chrome-extension://${extension.id}/views/knowledgeLibrary.html`,
        "/macrosLibrary.html": `chrome-extension://${extension.id}/views/macrosLibrary.html`,
        "/entityGraphView.html": `chrome-extension://${extension.id}/views/entityGraphView.html`,
        "/topicGraphView.html": `chrome-extension://${extension.id}/views/topicGraphView.html`,
    };

    ipcMain.handle("init-browser-ipc", async () => {
        await BrowserAgentIpc.getinstance().ensureWebsocketConnected();

        BrowserAgentIpc.getinstance().onMessageReceived = (
            message: WebSocketMessageV2,
        ) => {
            const shellWindow = getShellWindow();
            shellWindow?.sendMessageToInlineWebContent(message);
        };

        BrowserAgentIpc.getinstance().onSendNotification = (
            message: string,
            id: string,
        ) => {
            const shellWindow = getShellWindow();
            shellWindow?.sendSystemNotification(message, id);
        };
    });

    ipcMain.on("send-to-browser-ipc", async (_, data: WebSocketMessageV2) => {
        await BrowserAgentIpc.getinstance().send(data);
    });

    // Direct WebSocket connection check via browserIPC
    ipcMain.handle("check-websocket-connection", async () => {
        try {
            const browserIpc = BrowserAgentIpc.getinstance();
            const connected = browserIpc.isConnected();
            return { connected };
        } catch (error) {
            return { connected: false };
        }
    });

    // RPC transport: forward channel-multiplexed messages between Electron views and agent backend
    ipcMain.on("browser-rpc-message", async (event, message) => {
        try {
            const browserIpc = BrowserAgentIpc.getinstance();

            // Route RPC replies from agent back to the renderer
            browserIpc.onRpcReply = (reply: any) => {
                event.sender.send("browser-rpc-reply", reply);
            };

            const ws = await browserIpc.ensureWebsocketConnected();
            if (ws && ws.readyState === 1 /* WebSocket.OPEN */) {
                // Wrap in agentService channel envelope
                ws.send(
                    JSON.stringify({
                        name: "agentService",
                        message,
                    }),
                );
            }
        } catch (error) {
            debugShellError("Failed to forward RPC message:", error);
        }
    });
}

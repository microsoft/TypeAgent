// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ipcMain, session } from "electron";
import { debugShellError } from "./debug.js";
import { ExtensionStorageManager } from "./extensionStorage.js";
import { BrowserAgentIpc } from "./browserIpc.js";
import { WebSocketMessageV2 } from "common-utils";
import path from "path";
import { getShellWindow, getShellWindowForIpcEvent } from "./instance.js";

export function initializeExternalStorageIpcHandlers(instanceDir: string) {
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

export async function initializeBrowserExtension(appPath: string) {
    const browserExtensionPath = path.join(
        // HACK HACK for packaged build: The browser extension cannot be loaded from ASAR, so it is not packed.
        // Assume we can just replace app.asar with app.asar.unpacked in all cases.
        path.basename(appPath) === "app.asar"
            ? path.join(path.dirname(appPath), "app.asar.unpacked")
            : appPath,
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
    });

    ipcMain.on("send-to-browser-ipc", async (_, data: WebSocketMessageV2) => {
        await BrowserAgentIpc.getinstance().send(data);
    });

    // Extension service adapter IPC handlers - Must handle async response waiting
    ipcMain.handle("browser-extension-message", async (_, message) => {
        try {
            // Route message through browser IPC to TypeAgent backend
            const browserIpc = BrowserAgentIpc.getinstance();

            // Check if this is a long-running import operation
            // Note: ExtensionServiceBase sends with 'type', but it might also come as 'method'
            const methodName = message.method || message.type;
            const isImportOperation =
                methodName === "importWebsiteDataWithProgress" ||
                methodName === "importHtmlFolder";

            // For import operations, use a longer timeout and handle differently
            const timeout = isImportOperation ? 600000 : 30000; // 10 minutes for imports, 30 seconds for others

            // Create a promise to wait for the WebSocket response
            return new Promise((resolve, reject) => {
                const messageId = Date.now().toString();

                // Set up one-time response listener
                const originalHandler = browserIpc.onMessageReceived;
                browserIpc.onMessageReceived = (response) => {
                    if (response.id === messageId) {
                        // Restore original handler
                        browserIpc.onMessageReceived = originalHandler;

                        // Extract the actual data from the ActionResult if it's an extension message
                        let result = response.result || response;
                        if (result && result.data !== undefined) {
                            // This is likely an ActionResult with data field containing the actual extension response
                            result = result.data;
                        }

                        resolve(result);
                    } else if (originalHandler) {
                        // Forward other messages to original handler
                        originalHandler(response);
                    }
                };

                // Send the message directly using the method/params from the message
                browserIpc
                    .send({
                        method: message.method || message.type,
                        params: message.params || message.parameters || message,
                        id: messageId,
                    })
                    .catch(reject);

                // Set timeout to prevent hanging
                setTimeout(() => {
                    browserIpc.onMessageReceived = originalHandler;
                    const method = message.method || message.type || "unknown";
                    const messageInfo = JSON.stringify({
                        method,
                        messageId,
                        hasParams: !!(message.params || message.parameters),
                    });
                    resolve({
                        error: `Inline-browser message timeout - ${messageInfo}`,
                    });
                }, timeout);
            });
        } catch (error) {
            return { error: (error as Error).message };
        }
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
}

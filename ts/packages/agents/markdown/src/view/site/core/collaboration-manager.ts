// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Doc } from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { CollaborationInfo, CollaborationConfig } from "../types";
import { COLLABORATION_CONFIG } from "../config";
import { createCollaborationStatusElement } from "../utils";

export class CollaborationManager {
    private yjsDoc: Doc | null = null;
    private websocketProvider: WebsocketProvider | null = null;
    private config: CollaborationConfig | null = null;
    private hasShownSyncNotificationForDocument: boolean = false;
    private disconnectedTime: number = 0;
    private static readonly SYNC_NOTIFICATION_COOLDOWN = 300000; // 5 minutes in milliseconds

    public async reconnectToDocument(newDocumentId: string): Promise<void> {
        console.log(`[COLLAB] Reconnecting to document: "${newDocumentId}"`);

        // Destroy existing connection
        if (this.websocketProvider) {
            console.log(
                `[COLLAB] Disconnecting from previous room, was connected: ${this.websocketProvider.wsconnected}`,
            );
            this.websocketProvider.destroy();
            this.websocketProvider = null;
        }

        if (this.yjsDoc) {
            console.log(`[COLLAB] Destroying old Y.js document`);
            this.yjsDoc.destroy();
            this.yjsDoc = null;
        }

        // Create new Y.js document for the new room
        this.yjsDoc = new Doc();
        console.log(
            `[COLLAB] Created new Y.js document for reconnection with client ID: ${this.yjsDoc.clientID}`,
        );

        // Add debugging for Y.js document updates during reconnection
        this.yjsDoc.on("update", (update: Uint8Array, origin: any) => {
            const content = this.yjsDoc?.getText("content").toString() || "";
            console.log(
                `[RECONNECT-UPDATE] Document updated during reconnection (${update.length} bytes), origin:`,
                origin,
            );
            console.log(
                `[RECONNECT-CONTENT] Document content: ${content.length} chars`,
            );
        });
        console.log(
            `[COLLAB] Created new Y.js document with client ID: ${this.yjsDoc.clientID}`,
        );

        // Get the WebSocket server URL (should be same as before)
        const config = await this.getCollaborationConfig();
        console.log(
            `[COLLAB] Using WebSocket URL: ${config.websocketServerUrl}`,
        );

        // Create new WebSocket provider for the new document
        console.log(
            `[COLLAB] Connecting to WebSocket room: "${newDocumentId}"`,
        );

        this.websocketProvider = new WebsocketProvider(
            config.websocketServerUrl,
            newDocumentId,
            this.yjsDoc,
        );

        // Setup connection status monitoring for new connection
        this.setupCollaborationStatus(this.websocketProvider);

        // Log when connection is established and document is synced
        this.websocketProvider.on("sync", (isSynced: boolean) => {
            if (isSynced) {
                const content =
                    this.yjsDoc?.getText("content").toString() || "";
                console.log(
                    `Reconnected and synced to document: "${newDocumentId}" (${content.length} chars)`,
                );
            }
        });

        console.log(
            `[COLLAB] Reconnection initiated for document: "${newDocumentId}"`,
        );
    }

    public async initialize(): Promise<void> {
        console.log("[COLLAB] Initializing Collaboration Manager...");

        try {
            // Get collaboration configuration
            this.config = await this.getCollaborationConfig();
            console.log(`[COLLAB] Got configuration:`, this.config);

            // Create Yjs document
            this.yjsDoc = new Doc();
            console.log(
                `[COLLAB] Created Y.js document with client ID: ${this.yjsDoc.clientID}`,
            );

            // Add debugging for Y.js document updates
            this.yjsDoc.on("update", (update: Uint8Array, origin: any) => {
                const content =
                    this.yjsDoc?.getText("content").toString() || "";
                console.log(
                    `[Y.JS-UPDATE] Frontend document updated (${update.length} bytes), origin:`,
                    origin,
                );
                console.log(
                    `[Y.JS-CONTENT] Frontend document content: ${content.length} chars`,
                );
                if (content.length < 500) {
                    console.log(
                        `[Y.JS-PREVIEW] Content preview: "${content.substring(0, 200)}..."`,
                    );
                }
            });

            // Create WebSocket provider
            console.log(
                `[COLLAB] Connecting to WebSocket: ${this.config.websocketServerUrl} with documentId: "${this.config.documentId}"`,
            );

            this.websocketProvider = new WebsocketProvider(
                this.config.websocketServerUrl,
                this.config.documentId,
                this.yjsDoc,
            );

            // Setup connection status monitoring
            this.setupCollaborationStatus(this.websocketProvider);

            console.log(
                `[COLLAB] Collaboration initialized for document: "${this.config.documentId}"`,
            );

            // Log initial document state
            setTimeout(() => {
                const content =
                    this.yjsDoc?.getText("content").toString() || "";
                console.log(
                    `[COLLAB] Initial document content: ${content.length} chars`,
                );
            }, 1000);
        } catch (error) {
            console.error(
                "[COLLAB] Failed to initialize collaboration:",
                error,
            );
            console.log("[COLLAB] Continuing without collaboration features");

            if (this.config?.fallbackToLocal) {
                // Create a local-only Yjs document as fallback
                this.yjsDoc = new Doc();
                console.log(
                    "[COLLAB] Created local-only Y.js document fallback",
                );
            }
        }
    }

    private async getCollaborationConfig(): Promise<CollaborationConfig> {
        try {
            const collabInfoUrl = "/collaboration/info";

            const response = await fetch(collabInfoUrl);

            if (response.ok) {
                const collabInfo: CollaborationInfo = await response.json();
                console.log(
                    `[COLLAB] Retrieved collaboration info for document: ${collabInfo.currentDocument}`,
                );

                const config = {
                    websocketServerUrl:
                        collabInfo.websocketServerUrl ||
                        COLLABORATION_CONFIG.DEFAULT_WEBSOCKET_URL,
                    documentId: collabInfo.currentDocument
                        ? collabInfo.currentDocument.replace(".md", "")
                        : COLLABORATION_CONFIG.DEFAULT_DOCUMENT_ID,
                    fallbackToLocal: true,
                };

                console.log(`[COLLAB-CONFIG] Resolved configuration:`, config);
                return config;
            } else {
                throw new Error(
                    `Server returned ${response.status} ${response.statusText}`,
                );
            }
        } catch (fetchError) {
            console.warn(
                `[COLLAB] Could not get collaboration info from server, using defaults:`,
                fetchError,
            );

            // Use default configuration if server endpoint is not available
            const defaultConfig = {
                websocketServerUrl: COLLABORATION_CONFIG.DEFAULT_WEBSOCKET_URL,
                documentId: COLLABORATION_CONFIG.DEFAULT_DOCUMENT_ID,
                fallbackToLocal: true,
            };

            console.log(
                `[COLLAB-CONFIG] Using default configuration:`,
                defaultConfig,
            );
            return defaultConfig;
        }
    }

    private setupCollaborationStatus(provider: WebsocketProvider): void {
        const statusElement =
            document.getElementById("collaboration-status") ||
            createCollaborationStatusElement();

        provider.on("status", ({ status }: { status: string }) => {
            console.log(`[WEBSOCKET] Collaboration status changed: ${status}`);

            statusElement.className = `collaboration-status ${status}`;

            this.updateStatusDisplay(statusElement, status);
        });

        provider.on("sync", (isSynced: boolean) => {
            if (isSynced) {
                console.log("[WEBSOCKET] Document synchronized");
                console.log(
                    `[WEBSOCKET] Y.js document content length: ${this.yjsDoc?.getText("content").length || 0} chars`,
                );

                // Show sync notification only once per document or after long disconnection
                const now = Date.now();
                const shouldShowNotification =
                    !this.hasShownSyncNotificationForDocument ||
                    (this.disconnectedTime > 0 &&
                        now - this.disconnectedTime >
                            CollaborationManager.SYNC_NOTIFICATION_COOLDOWN);

                if (shouldShowNotification) {
                    statusElement.textContent = "📄 Document synchronized";
                    statusElement.className = "collaboration-status connected";
                    statusElement.style.display = "block";
                    setTimeout(() => {
                        statusElement.style.display = "none";
                    }, 3000);

                    this.hasShownSyncNotificationForDocument = true;
                    // this.lastSyncNotificationTime = now; // Moved to NotificationManager
                    this.disconnectedTime = 0; // Reset disconnection time

                    console.log(
                        "[SYNC-NOTIFICATION] Shown document sync notification",
                    );
                } else {
                    console.log(
                        "[SYNC-NOTIFICATION] Skipped sync notification (already shown for this document)",
                    );
                }
            } else {
                console.log("[WEBSOCKET] Document sync lost");
                this.disconnectedTime = Date.now(); // Record when we became disconnected
            }
        });

        // Add connection event logging
        provider.on("connection-open", () => {
            console.log("[WEBSOCKET] Connection opened");
        });

        provider.on("connection-close", () => {
            console.log("[WEBSOCKET] Connection closed");
        });

        provider.on("connection-error", (error: any) => {
            console.error("[WEBSOCKET] Connection error:", error);
        });
    }

    private updateStatusDisplay(
        statusElement: HTMLElement,
        status: string,
    ): void {
        const hideDelay = 3000; // From constants

        switch (status) {
            case "connected":
                statusElement.textContent = "Connected to collaboration server";
                // statusElement.style.display = "block";
                setTimeout(() => {
                    statusElement.style.display = "none";
                }, hideDelay);
                break;
            case "disconnected":
                statusElement.textContent =
                    "❌ Disconnected from collaboration server";
                statusElement.style.display = "block";
                break;
            case "connecting":
                statusElement.textContent =
                    "🔄 Connecting to collaboration server...";
                statusElement.style.display = "block";
                break;
        }
    }

    public getYjsDoc(): Doc | null {
        return this.yjsDoc;
    }

    public getWebsocketProvider(): WebsocketProvider | null {
        return this.websocketProvider;
    }

    public isConnected(): boolean {
        return this.websocketProvider?.wsconnected || false;
    }

    public destroy(): void {
        if (this.websocketProvider) {
            this.websocketProvider.destroy();
            this.websocketProvider = null;
        }

        if (this.yjsDoc) {
            this.yjsDoc.destroy();
            this.yjsDoc = null;
        }
    }
}

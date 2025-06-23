// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { NotificationType, SaveStatus } from "../types";
import { EDITOR_CONFIG } from "../config";
import {
    createNotificationElement,
    createErrorNotificationElement,
    addToBody,
    removeElement,
    getElementById,
} from "../utils";

export class NotificationManager {
    private documentSyncNotifications = new Map<
        string,
        { shown: boolean; lastDisconnect?: number }
    >();
    private readonly DISCONNECT_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

    public async initialize(): Promise<void> {
        // No specific initialization needed
    }

    public showNotification(
        message: string,
        type: NotificationType = "info",
    ): void {
        const notification = createNotificationElement(message, type);
        addToBody(notification);

        // Remove after delay
        setTimeout(() => {
            removeElement(notification);
        }, EDITOR_CONFIG.TIMING.ERROR_HIDE_DELAY);
    }

    public showError(message: string): void {
        console.error(message);

        const errorElement = createErrorNotificationElement(message);
        addToBody(errorElement);

        // Remove after 5 seconds
        setTimeout(() => {
            removeElement(errorElement);
        }, 5000);
    }

    public showSaveStatus(status: SaveStatus): void {
        const statusElement = getElementById("save-status");
        if (!statusElement) return;

        switch (status) {
            case "saving":
                statusElement.textContent = "💾 Saving...";
                statusElement.className = "save-status saving";
                break;
            case "saved":
                statusElement.textContent = "✅ Saved";
                statusElement.className = "save-status saved";
                setTimeout(() => {
                    statusElement.textContent = "";
                    statusElement.className = "save-status";
                }, EDITOR_CONFIG.TIMING.STATUS_HIDE_DELAY);
                break;
            case "error":
                statusElement.textContent = "❌ Save failed";
                statusElement.className = "save-status error";
                setTimeout(() => {
                    statusElement.textContent = "";
                    statusElement.className = "save-status";
                }, EDITOR_CONFIG.TIMING.ERROR_HIDE_DELAY);
                break;
        }
    }

    /**
     * Show document synchronized notification - only once per document or if disconnected >5 minutes
     */
    public showDocumentSyncNotification(documentId: string): void {
        const syncInfo = this.documentSyncNotifications.get(documentId);
        const now = Date.now();

        let shouldShow = false;

        if (!syncInfo) {
            // First time for this document
            shouldShow = true;
        } else if (
            syncInfo.lastDisconnect &&
            now - syncInfo.lastDisconnect > this.DISCONNECT_THRESHOLD_MS
        ) {
            // Was disconnected for more than 5 minutes
            shouldShow = true;
        } else if (!syncInfo.shown) {
            // Not shown yet for this session
            shouldShow = true;
        }

        if (shouldShow) {
            this.showNotification("📡 Document is synchronized", "success");
            this.documentSyncNotifications.set(documentId, { shown: true });
            console.log(
                `📡 [SYNC-NOTIFICATION] Shown for document: ${documentId}`,
            );
        } else {
            console.log(
                `📡 [SYNC-NOTIFICATION] Skipped for document: ${documentId} (already shown)`,
            );
        }
    }

    /**
     * Mark document as disconnected
     */
    public markDocumentDisconnected(documentId: string): void {
        const syncInfo = this.documentSyncNotifications.get(documentId) || {
            shown: false,
        };
        syncInfo.lastDisconnect = Date.now();
        this.documentSyncNotifications.set(documentId, syncInfo);
        console.log(
            `📡 [SYNC-NOTIFICATION] Marked document as disconnected: ${documentId}`,
        );
    }

    /**
     * Reset sync notification state for a document (e.g., when switching documents)
     */
    public resetDocumentSyncState(documentId: string): void {
        this.documentSyncNotifications.delete(documentId);
        console.log(
            `📡 [SYNC-NOTIFICATION] Reset state for document: ${documentId}`,
        );
    }
}

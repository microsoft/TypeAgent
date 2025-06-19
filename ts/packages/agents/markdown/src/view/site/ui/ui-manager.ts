// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ToolbarManager } from "./toolbar-manager";
import { PanelManager } from "./panel-manager";
import { NotificationManager } from "./notification-manager";

export class UIManager {
    private toolbarManager: ToolbarManager;
    private panelManager: PanelManager;
    private notificationManager: NotificationManager;

    constructor() {
        this.toolbarManager = new ToolbarManager();
        this.panelManager = new PanelManager();
        this.notificationManager = new NotificationManager();
    }

    public async initialize(): Promise<void> {
        // Initialize all UI components
        await this.toolbarManager.initialize();
        await this.panelManager.initialize();
        await this.notificationManager.initialize();

        // Setup keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    public setDocumentManager(documentManager: any): void {
        this.toolbarManager.setDocumentManager(documentManager);
    }

    public getNotificationManager(): NotificationManager {
        return this.notificationManager;
    }

    public getPanelManager(): PanelManager {
        return this.panelManager;
    }

    private setupKeyboardShortcuts(): void {
        // Auto-save handles document saving automatically
        // Future keyboard shortcuts can be added here
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebsiteImportManager } from "./websiteImportManager";
import { WebsiteImportUI } from "./websiteImportUI";
import {
    ImportOptions,
    FolderImportOptions,
    ImportProgress,
    ImportResult,
} from "../interfaces/websiteImport.types";
import {
    notificationManager,
    extensionService,
    TemplateHelpers,
    FormatUtils,
    EventManager,
    ConnectionManager,
} from "./knowledgeUtilities";

// Import new panels
import { KnowledgeSearchPanel } from "./knowledgeSearchPanel";
import { KnowledgeDiscoveryPanel } from "./knowledgeDiscoveryPanel";
import { KnowledgeAnalyticsPanel } from "./knowledgeAnalyticsPanel";

// Import interfaces
import {
    SearchServices,
    DiscoveryServices,
    AnalyticsServices,
    DefaultSearchServices,
    DefaultDiscoveryServices,
    DefaultAnalyticsServices,
} from "./knowledgeUtilities";
import { CachedAnalyticsService } from "./services/cachedAnalyticsService";

interface FullPageNavigation {
    currentPage: "search" | "discover" | "analytics";
}

interface LibraryStats {
    totalWebsites: number;
    totalBookmarks: number;
    totalHistory: number;
    topDomains: number;
    lastImport?: number;
}

interface UserPreferences {
    viewMode: string;
    autoExtractKnowledge: boolean;
    showConfidenceScores: boolean;
    enableNotifications: boolean;
    theme: "light" | "dark" | "auto";
}

class WebsiteLibraryPanelFullPage {
    private isConnected: boolean = false;
    private isInitialized: boolean = false;
    private connectionStatusCallback?: (connected: boolean) => void;
    private navigation: FullPageNavigation = {
        currentPage: "search",
    };

    // Data storage
    private libraryStats: LibraryStats = {
        totalWebsites: 0,
        totalBookmarks: 0,
        totalHistory: 0,
        topDomains: 0,
    };

    // User preferences
    private userPreferences: UserPreferences;

    // Import components
    private importManager: WebsiteImportManager;
    private importUI: WebsiteImportUI;

    // Panel instances
    private searchPanel: KnowledgeSearchPanel | null = null;
    private discoveryPanel: KnowledgeDiscoveryPanel | null = null;
    private analyticsPanel: KnowledgeAnalyticsPanel | null = null;

    // Service implementations
    private services: {
        search: SearchServices;
        discovery: DiscoveryServices;
        analytics: AnalyticsServices;
    };

    constructor() {
        this.userPreferences = this.loadUserPreferences();

        // Initialize import components
        this.importManager = new WebsiteImportManager();
        this.importUI = new WebsiteImportUI();

        // Initialize services with default implementations
        const defaultAnalyticsService = new DefaultAnalyticsServices(
            extensionService,
        );
        this.services = {
            search: new DefaultSearchServices(extensionService),
            discovery: new DefaultDiscoveryServices(extensionService),
            analytics: new CachedAnalyticsService(defaultAnalyticsService),
        };
    }

    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        try {
            this.setupNavigation();
            this.setupEventListeners();
            this.setupImportFunctionality();

            await this.checkConnectionStatus();
            this.setupConnectionStatusListener();
            await this.loadLibraryStats();
            await this.navigateToPage("search");
        } catch (error) {
            this.isInitialized = false;
            notificationManager.showError(
                "Failed to load Website Library. Please refresh the page.",
                () => window.location.reload(),
            );
        }
    }

    private setupNavigation() {
        const navItems = document.querySelectorAll(".nav-item");
        navItems.forEach((item) => {
            item.addEventListener("click", (e) => {
                const target = e.currentTarget as HTMLElement;
                const page = target.getAttribute("data-page") as
                    | "search"
                    | "discover"
                    | "analytics";
                if (page) {
                    this.navigateToPage(page).catch(console.error);
                }
            });
        });
    }

    private setupImportFunctionality() {
        const importWebActivityBtn = document.getElementById(
            "importWebActivityBtn",
        );
        const importFromFileBtn = document.getElementById("importFromFileBtn");

        if (importWebActivityBtn) {
            importWebActivityBtn.addEventListener("click", () => {
                this.showWebActivityImportModal();
            });
        }

        if (importFromFileBtn) {
            importFromFileBtn.addEventListener("click", () => {
                this.showFolderImportModal();
            });
        }

        this.setupImportEventListeners();
    }

    private setupImportEventListeners() {
        window.addEventListener(
            "startWebActivityImport",
            async (event: any) => {
                const options = event.detail as ImportOptions;
                await this.handleWebActivityImport(options);
            },
        );

        window.addEventListener("startFolderImport", async (event: any) => {
            const options = event.detail as FolderImportOptions;
            await this.handleFolderImport(options);
        });

        window.addEventListener("cancelImport", () => {
            this.handleCancelImport();
        });

        EventManager.setupMessageListener((message, sender, sendResponse) => {
            if (message.type === "importProgress") {
                this.handleImportProgressMessage(message);
            }
        });

        this.importUI.onProgressUpdate((progress: ImportProgress) => {
            this.importUI.updateImportProgress(progress);
        });

        this.importUI.onImportComplete((result: ImportResult) => {
            this.handleImportComplete(result);
        });

        this.importUI.onImportError((error: any) => {
            console.error("Import error:", error);
            notificationManager.showError(
                `Import failed: ${error.message || "Unknown error"}`,
            );
        });
    }

    private async checkConnectionStatus(): Promise<boolean> {
        try {
            const response = await extensionService.checkWebSocketConnection();
            this.isConnected = response?.connected === true;
            return this.isConnected;
        } catch (error) {
            console.error("Connection check failed:", error);
            this.isConnected = false;
            return false;
        } finally {
            this.updateConnectionStatus();
            this.updatePanelConnectionStatus();
        }
    }

    private updateConnectionStatus() {
        const statusElement = document.getElementById("connectionStatus");
        if (statusElement) {
            const indicator = statusElement.querySelector(".status-indicator");
            const text = statusElement.querySelector("span:last-child");

            if (indicator && text) {
                if (this.isConnected) {
                    indicator.className = "status-indicator status-connected";
                    text.textContent = "Connected";
                } else {
                    indicator.className =
                        "status-indicator status-disconnected";
                    text.textContent = "Disconnected";
                }
            }
        }
    }

    private setupConnectionStatusListener(): void {
        this.connectionStatusCallback = (connected: boolean) => {
            console.log(`Connection status changed: ${connected ? 'Connected' : 'Disconnected'}`);
            this.isConnected = connected;
            this.updateConnectionStatus();
            this.updatePanelConnectionStatus();
        };
        
        extensionService.onConnectionStatusChange(this.connectionStatusCallback);
    }

    public cleanup(): void {
        if (this.connectionStatusCallback) {
            extensionService.removeConnectionStatusListener(this.connectionStatusCallback);
        }
    }

    private updatePanelConnectionStatus() {
        if (this.searchPanel) {
            this.searchPanel.setConnectionStatus(this.isConnected);
        }
        if (this.discoveryPanel) {
            this.discoveryPanel.setConnectionStatus(this.isConnected);
        }
        if (this.analyticsPanel) {
            this.analyticsPanel.setConnectionStatus(this.isConnected);
        }
    }

    private async loadLibraryStats() {
        if (!this.isConnected) {
            return;
        }

        try {
            this.libraryStats = await extensionService.getLibraryStats();
            this.updateStatsDisplay();
        } catch (error) {
            console.error("Failed to load library stats:", error);
            notificationManager.showError(
                "Failed to load library statistics",
                () => this.loadLibraryStats(),
            );
        }
    }

    private updateStatsDisplay() {
        const updates: Array<[string, number]> = [
            ["totalWebsites", this.libraryStats.totalWebsites],
            ["totalBookmarks", this.libraryStats.totalBookmarks],
            ["totalHistory", this.libraryStats.totalHistory],
            ["topDomains", this.libraryStats.topDomains],
        ];

        updates.forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value.toString();
            }
        });
    }

    private async navigateToPage(page: "search" | "discover" | "analytics") {
        this.navigation.currentPage = page;

        this.updateNavigation();
        this.showPage(page);

        switch (page) {
            case "search":
                await this.initializeSearchPage();
                break;
            case "discover":
                await this.initializeDiscoverPage();
                break;
            case "analytics":
                await this.initializeAnalyticsPage();
                break;
        }
    }

    private async initializeSearchPage() {
        if (!this.searchPanel) {
            const container = document.getElementById("search-page");
            if (container) {
                this.searchPanel = new KnowledgeSearchPanel(
                    container,
                    this.services.search,
                );
                await this.searchPanel.initialize();
                this.searchPanel.setConnectionStatus(this.isConnected);
            }
        }
    }

    private async initializeDiscoverPage() {
        if (!this.discoveryPanel) {
            const container = document.getElementById("discover-page");
            if (container) {
                this.discoveryPanel = new KnowledgeDiscoveryPanel(
                    container,
                    this.services.discovery,
                );
                await this.discoveryPanel.initialize();
                this.discoveryPanel.setConnectionStatus(this.isConnected);
            }
        }
    }

    private async initializeAnalyticsPage() {
        if (!this.analyticsPanel) {
            const container = document.getElementById("analytics-page");
            if (container) {
                this.analyticsPanel = new KnowledgeAnalyticsPanel(
                    container,
                    this.services.analytics,
                );
                await this.analyticsPanel.initialize();
                this.analyticsPanel.setConnectionStatus(this.isConnected);
            }
        }
    }

    private updateNavigation() {
        document.querySelectorAll(".nav-item").forEach((item) => {
            item.classList.remove("active");
        });

        const activeItem = document.querySelector(
            `[data-page="${this.navigation.currentPage}"]`,
        );
        if (activeItem) {
            activeItem.classList.add("active");
        }
    }

    private showPage(page: string) {
        document.querySelectorAll(".page-content").forEach((pageEl) => {
            pageEl.classList.remove("active");
        });

        const currentPageEl = document.getElementById(`${page}-page`);
        if (currentPageEl) {
            currentPageEl.classList.add("active");
        }
    }

    private setupEventListeners() {
        const settingsButton = document.getElementById("settingsButton");
        if (settingsButton) {
            settingsButton.addEventListener("click", () => {
                this.showSettings();
            });
        }

        document.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const actionButton = target.closest("[data-action]") as HTMLElement;

            if (actionButton) {
                e.preventDefault();
                const action = actionButton.getAttribute("data-action");
                this.handleAction(action, actionButton);
            }
        });

        EventManager.setupMessageListener((message, sender, sendResponse) => {
            if (
                message.type === "knowledgeExtracted" ||
                message.type === "importComplete" ||
                message.type === "contentIndexed"
            ) {
                if (
                    this.navigation.currentPage === "analytics" &&
                    this.analyticsPanel
                ) {
                    this.analyticsPanel.refreshData().catch(console.error);
                }
            }
        });
    }

    private handleAction(action: string | null, button: HTMLElement) {
        if (!action) return;

        switch (action) {
            case "showImportModal":
                this.showImportModal();
                break;
            case "reconnect":
                this.reconnect();
                break;
        }
    }

    private async reconnect() {
        notificationManager.showInfo("Attempting to reconnect...");
        const connected = await this.checkConnectionStatus();

        if (connected) {
            notificationManager.showSuccess("Reconnected successfully!");
            await this.loadLibraryStats();
        } else {
            notificationManager.showError(
                "Failed to reconnect. Please check your connection.",
                () => this.reconnect(),
            );
        }
    }

    // Import handling methods
    private async handleWebActivityImport(
        options: ImportOptions,
    ): Promise<void> {
        try {
            let isFirstProgress = true;

            this.importManager.onProgressUpdate((progress: ImportProgress) => {
                if (isFirstProgress) {
                    this.importUI.showImportProgress(progress);
                    isFirstProgress = false;
                } else {
                    this.importUI.updateImportProgress(progress);
                }
            });

            const result =
                await this.importManager.startWebActivityImport(options);
            // Don't show completion immediately - let progress updates handle it
        } catch (error) {
            this.importUI.showImportError({
                type: "processing",
                message:
                    error instanceof Error
                        ? error.message
                        : "Unknown error occurred",
                timestamp: Date.now(),
            });
        }
    }

    private async handleFolderImport(
        options: FolderImportOptions,
    ): Promise<void> {
        try {
            let isFirstProgress = true;

            this.importManager.onProgressUpdate((progress: ImportProgress) => {
                if (isFirstProgress) {
                    this.importUI.showImportProgress(progress);
                    isFirstProgress = false;
                } else {
                    this.importUI.updateImportProgress(progress);
                }
            });

            const result = await this.importManager.startFolderImport(options);
            // Don't show completion immediately - let progress updates handle it
        } catch (error) {
            this.importUI.showImportError({
                type: "processing",
                message:
                    error instanceof Error
                        ? error.message
                        : "Unknown error occurred",
                timestamp: Date.now(),
            });
        }
    }

    private handleImportProgressMessage(message: any) {
        console.log("🔄 Raw import progress message received:", message);

        // Validate message structure
        if (!message.importId || !message.progress) {
            console.warn("❌ Invalid progress message structure:", message);
            return;
        }

        console.log("📨 Progress message details:", {
            importId: message.importId,
            progress: message.progress,
            progressType: typeof message.progress,
            progressKeys: Object.keys(message.progress || {}),
        });

        // Update the UI with the progress from service worker
        this.importUI.updateImportProgress(message.progress);
    }

    private async handleCancelImport(): Promise<void> {
        try {
            await this.importManager.cancelImport("web-activity-import");
            await this.importManager.cancelImport("file-import");
        } catch (error) {
            console.error("Failed to cancel import:", error);
        }
    }

    private async handleImportComplete(result: ImportResult): Promise<void> {
        await this.loadLibraryStats();

        if (this.navigation.currentPage === "discover" && this.discoveryPanel) {
            await this.discoveryPanel.refreshData();
        }

        notificationManager.showSuccess(
            `Successfully imported ${result.itemCount} items!`,
        );
    }

    public showSettings() {
        this.createEnhancedSettingsModal();
    }

    // Settings management
    private createEnhancedSettingsModal() {
        const existingModal = document.getElementById("settingsModal");
        if (existingModal) {
            existingModal.remove();
        }

        const modalHtml = `
            <div class="modal fade" id="settingsModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Enhanced Settings</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <div class="col-md-6">
                                    <h6>Search Preferences</h6>
                                    <div class="mb-3">
                                        <label class="form-label">Default View Mode</label>
                                        <select class="form-select" id="defaultViewMode">
                                            <option value="list">List</option>
                                            <option value="grid">Grid</option>
                                            <option value="timeline">Timeline</option>
                                            <option value="domain">Domain</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <h6>Knowledge & Notifications</h6>
                                    <div class="mb-3">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="autoExtractKnowledge">
                                            <label class="form-check-label">Auto-extract knowledge</label>
                                        </div>
                                    </div>
                                    <div class="mb-3">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="showConfidenceScores">
                                            <label class="form-check-label">Show confidence scores</label>
                                        </div>
                                    </div>
                                    <div class="mb-3">
                                        <div class="form-check">
                                            <input class="form-check-input" type="checkbox" id="enableNotifications">
                                            <label class="form-check-label">Enable notifications</label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="saveSettingsBtn">Save Changes</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML("beforeend", modalHtml);

        this.populateSettingsModal();

        const saveBtn = document.getElementById("saveSettingsBtn");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => this.saveUserPreferences());
        }

        const modal = document.getElementById("settingsModal");
        if (modal && (window as any).bootstrap) {
            const bsModal = new (window as any).bootstrap.Modal(modal);
            bsModal.show();
        }
    }

    private populateSettingsModal() {
        const prefs = this.userPreferences;

        const defaultViewMode = document.getElementById(
            "defaultViewMode",
        ) as HTMLSelectElement;
        const autoExtractKnowledge = document.getElementById(
            "autoExtractKnowledge",
        ) as HTMLInputElement;
        const showConfidenceScores = document.getElementById(
            "showConfidenceScores",
        ) as HTMLInputElement;
        const enableNotifications = document.getElementById(
            "enableNotifications",
        ) as HTMLInputElement;

        if (defaultViewMode) defaultViewMode.value = prefs.viewMode;
        if (autoExtractKnowledge)
            autoExtractKnowledge.checked = prefs.autoExtractKnowledge;
        if (showConfidenceScores)
            showConfidenceScores.checked = prefs.showConfidenceScores;
        if (enableNotifications)
            enableNotifications.checked = prefs.enableNotifications;
    }

    private saveUserPreferences() {
        const defaultViewMode = document.getElementById(
            "defaultViewMode",
        ) as HTMLSelectElement;
        const autoExtractKnowledge = document.getElementById(
            "autoExtractKnowledge",
        ) as HTMLInputElement;
        const showConfidenceScores = document.getElementById(
            "showConfidenceScores",
        ) as HTMLInputElement;
        const enableNotifications = document.getElementById(
            "enableNotifications",
        ) as HTMLInputElement;

        this.userPreferences = {
            viewMode: defaultViewMode?.value || "list",
            autoExtractKnowledge: autoExtractKnowledge?.checked || false,
            showConfidenceScores: showConfidenceScores?.checked || true,
            enableNotifications: enableNotifications?.checked || true,
            theme: this.userPreferences.theme,
        };

        try {
            localStorage.setItem(
                "websiteLibrary_userPreferences",
                JSON.stringify(this.userPreferences),
            );
            notificationManager.showSuccess("Settings saved successfully");

            if (this.searchPanel) {
                this.searchPanel.setViewMode(
                    this.userPreferences.viewMode as any,
                );
            }

            const modal = document.getElementById("settingsModal");
            if (modal && (window as any).bootstrap) {
                const bsModal = (window as any).bootstrap.Modal.getInstance(
                    modal,
                );
                if (bsModal) bsModal.hide();
            }
        } catch (error) {
            console.error("Failed to save user preferences:", error);
            notificationManager.showError("Failed to save settings");
        }
    }

    private loadUserPreferences(): UserPreferences {
        try {
            const stored = localStorage.getItem(
                "websiteLibrary_userPreferences",
            );
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error("Failed to load user preferences:", error);
        }

        return {
            viewMode: "list",
            autoExtractKnowledge: false,
            showConfidenceScores: true,
            enableNotifications: true,
            theme: "light",
        };
    }

    // Public API methods for compatibility
    public handleNotificationAction(id: string, actionLabel: string): void {
        notificationManager.handleNotificationAction(id, actionLabel);
    }

    public hideNotification(id: string): void {
        notificationManager.hideNotification(id);
    }

    public showImportModal() {
        this.showWebActivityImportModal();
    }

    public showWebActivityImportModal() {
        this.importUI.showWebActivityImportModal();
    }

    public showFolderImportModal() {
        this.importUI.showFolderImportModal();
    }

    public performSearchWithQuery(query: string) {
        if (this.searchPanel) {
            this.searchPanel.performSearchWithQuery(query);
        }
    }

    public destroy() {
        if (this.searchPanel) {
            this.searchPanel.destroy();
        }
        if (this.discoveryPanel) {
            this.discoveryPanel.destroy();
        }
        if (this.analyticsPanel) {
            this.analyticsPanel.destroy();
        }
    }
}

// Global instance for compatibility
let libraryPanelInstance: WebsiteLibraryPanelFullPage;
let isInitialized = false;

function initializeLibraryPanel() {
    if (isInitialized) {
        return;
    }

    isInitialized = true;
    libraryPanelInstance = new WebsiteLibraryPanelFullPage();
    libraryPanelInstance.initialize();

    (window as any).libraryPanel = libraryPanelInstance;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeLibraryPanel);
} else {
    initializeLibraryPanel();
}

// Add cleanup on window unload
window.addEventListener('beforeunload', () => {
    if (libraryPanelInstance) {
        libraryPanelInstance.cleanup();
    }
});

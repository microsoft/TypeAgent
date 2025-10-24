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
            // Ensure sidebar is always collapsed
            this.ensureSidebarCollapsed();

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

    private ensureSidebarCollapsed() {
        const sidebar = document.getElementById("iconRailSidebar");
        if (sidebar) {
            // Remove expanded class if it exists
            sidebar.classList.remove("expanded");
        }
        // Clear any saved state from localStorage
        localStorage.removeItem("sidebar-collapsed-state");
    }

    private setupNavigation() {
        // Setup navigation items
        const navItems = document.querySelectorAll(".nav-item");
        navItems.forEach((item) => {
            item.addEventListener("click", (e) => {
                const target = e.currentTarget as HTMLElement;
                const page = target.getAttribute("data-page");

                // Handle special graph pages
                if (page === "topic-graph") {
                    window.open("topicGraphView.html", "_blank");
                    return;
                }
                if (page === "entity-graph") {
                    window.open("entityGraphView.html", "_blank");
                    return;
                }

                // Handle regular pages
                if (
                    page === "search" ||
                    page === "discover" ||
                    page === "analytics"
                ) {
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
        const buildKnowledgeGraphBtn = document.getElementById(
            "buildKnowledgeGraphBtn",
        );

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

        if (buildKnowledgeGraphBtn) {
            buildKnowledgeGraphBtn.addEventListener("click", () => {
                this.showKnowledgeGraphModal();
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
            if (this.isConnected) {
                // Hide connection status when connected
                statusElement.style.display = "none";
            } else {
                // Show disconnection warning
                statusElement.style.display = "flex";
                statusElement.innerHTML = `
                    <span class="status-indicator status-disconnected"></span>
                    <span class="text-warning">Disconnected</span>
                `;
            }
        }
    }

    private setupConnectionStatusListener(): void {
        this.connectionStatusCallback = (connected: boolean) => {
            console.log(
                `Connection status changed: ${connected ? "Connected" : "Disconnected"}`,
            );
            this.isConnected = connected;
            this.updateConnectionStatus();
            this.updatePanelConnectionStatus();
        };

        extensionService.onConnectionStatusChange(
            this.connectionStatusCallback,
        );
    }

    public cleanup(): void {
        if (this.connectionStatusCallback) {
            extensionService.removeConnectionStatusListener(
                this.connectionStatusCallback,
            );
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
            settingsButton.addEventListener("click", async () => {
                await this.showSettings();
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

    public async showSettings() {
        await this.createEnhancedSettingsModal();
    }

    // Settings management
    private async createEnhancedSettingsModal() {
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

        await this.populateSettingsModal();

        const saveBtn = document.getElementById("saveSettingsBtn");
        if (saveBtn) {
            saveBtn.addEventListener(
                "click",
                async () => await this.saveUserPreferences(),
            );
        }

        const modal = document.getElementById("settingsModal");
        if (modal && (window as any).bootstrap) {
            const bsModal = new (window as any).bootstrap.Modal(modal);
            bsModal.show();
        }
    }

    private async populateSettingsModal() {
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
        if (autoExtractKnowledge) {
            autoExtractKnowledge.checked = await this.loadAutoIndexSetting();
        }
        if (showConfidenceScores)
            showConfidenceScores.checked = prefs.showConfidenceScores;
        if (enableNotifications)
            enableNotifications.checked = prefs.enableNotifications;
    }

    // Auto-indexing setting helpers using ExtensionService
    private async loadAutoIndexSetting(): Promise<boolean> {
        try {
            return await extensionService.getAutoIndexSetting();
        } catch (error) {
            console.error("Failed to load auto-index setting:", error);
            return false;
        }
    }

    private async saveAutoIndexSetting(enabled: boolean): Promise<void> {
        try {
            await extensionService.setAutoIndexSetting(enabled);
        } catch (error) {
            console.error("Failed to save auto-index setting:", error);
            throw error;
        }
    }

    private async saveUserPreferences() {
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

        // Handle auto-indexing separately via ExtensionService
        if (autoExtractKnowledge) {
            try {
                await this.saveAutoIndexSetting(autoExtractKnowledge.checked);
            } catch (error) {
                console.error("Failed to save auto-index setting:", error);
                notificationManager.showError(
                    "Failed to save auto-indexing setting",
                );
                return;
            }
        }

        // Save other preferences to localStorage
        this.userPreferences = {
            viewMode: defaultViewMode?.value || "list",
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

    public async showKnowledgeGraphModal() {
        const modal = document.getElementById("knowledgeGraphModal");
        if (modal) {
            // Show the modal
            const bootstrapModal = new (window as any).bootstrap.Modal(modal);
            bootstrapModal.show();

            // Load graph status
            await this.loadGraphStatus();

            // Setup modal event listeners
            this.setupKnowledgeGraphModalEventListeners();
        }
    }

    private async loadGraphStatus() {
        try {
            // Get graph status from backend
            const response = await extensionService.getKnowledgeGraphStatus();

            // Handle null or undefined response
            if (!response) {
                this.updateGraphStatusDisplay({
                    hasGraph: false,
                    entityCount: 0,
                    relationshipCount: 0,
                    communityCount: 0,
                    isBuilding: false,
                    error: "No graph status available",
                });
                return;
            }

            this.updateGraphStatusDisplay(response);
        } catch (error) {
            console.error("Failed to load graph status:", error);
            this.updateGraphStatusDisplay({
                hasGraph: false,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: false,
                error: "Failed to check graph status",
            });
        }
    }

    private updateGraphStatusDisplay(status: any) {
        const graphStateIcon = document.getElementById("graphStateIcon");
        const graphStateText = document.getElementById("graphStateText");
        const graphStateDescription = document.getElementById(
            "graphStateDescription",
        );
        const graphMetrics = document.getElementById("graphMetrics");
        const buildProgress = document.getElementById("buildProgress");
        const viewEntityGraphBtn =
            document.getElementById("viewEntityGraphBtn");
        const rebuildGraphBtn = document.getElementById("rebuildGraphBtn");
        const buildGraphBtn = document.getElementById("buildGraphBtn");
        const mergeTopicsBtn = document.getElementById("mergeTopicsBtn");

        if (!graphStateIcon || !graphStateText || !graphStateDescription)
            return;

        // Ensure status object has required properties with defaults
        const safeStatus = {
            hasGraph: status?.hasGraph || false,
            entityCount: status?.entityCount || 0,
            relationshipCount: status?.relationshipCount || 0,
            communityCount: status?.communityCount || 0,
            isBuilding: status?.isBuilding || false,
            error: status?.error || null,
        };

        // Hide all sections initially
        if (graphMetrics) graphMetrics.style.display = "none";
        if (buildProgress) buildProgress.style.display = "none";
        if (viewEntityGraphBtn) viewEntityGraphBtn.style.display = "none";
        if (rebuildGraphBtn) rebuildGraphBtn.style.display = "none";
        if (buildGraphBtn) buildGraphBtn.style.display = "none";
        if (mergeTopicsBtn) mergeTopicsBtn.style.display = "none";

        if (safeStatus.isBuilding) {
            // Show building state
            graphStateIcon.innerHTML =
                '<i class="bi bi-circle-fill text-warning"></i>';
            graphStateText.textContent = "Building Knowledge Graph";
            graphStateDescription.textContent =
                "Analyzing entities and relationships from your website data...";
            if (buildProgress) buildProgress.style.display = "block";
        } else if (safeStatus.hasGraph && safeStatus.entityCount > 0) {
            // Show active graph state
            graphStateIcon.innerHTML =
                '<i class="bi bi-circle-fill text-success"></i>';
            graphStateText.textContent = "Knowledge Graph Ready";
            graphStateDescription.textContent = `Your graph contains ${safeStatus.entityCount} entities, ${safeStatus.relationshipCount} relationships, and ${safeStatus.communityCount} communities.`;

            // Show metrics
            if (graphMetrics) {
                graphMetrics.style.display = "flex";
                const entityCount = document.getElementById("entityCount");
                const relationshipCount =
                    document.getElementById("relationshipCount");
                const communityCount =
                    document.getElementById("communityCount");

                if (entityCount)
                    entityCount.textContent = safeStatus.entityCount.toString();
                if (relationshipCount)
                    relationshipCount.textContent =
                        safeStatus.relationshipCount.toString();
                if (communityCount)
                    communityCount.textContent =
                        safeStatus.communityCount.toString();
            }

            // Show action buttons
            if (viewEntityGraphBtn)
                viewEntityGraphBtn.style.display = "inline-block";
            if (rebuildGraphBtn) rebuildGraphBtn.style.display = "inline-block";
            if (mergeTopicsBtn) mergeTopicsBtn.style.display = "inline-block";
        } else if (safeStatus.error) {
            // Show error state
            graphStateIcon.innerHTML =
                '<i class="bi bi-circle-fill text-danger"></i>';
            graphStateText.textContent = "Graph Status Error";
            graphStateDescription.textContent = safeStatus.error;
            if (buildGraphBtn) buildGraphBtn.style.display = "inline-block";
        } else {
            // Show empty state
            graphStateIcon.innerHTML =
                '<i class="bi bi-circle-fill text-secondary"></i>';
            graphStateText.textContent = "No Knowledge Graph";
            graphStateDescription.textContent =
                "Build a knowledge graph to visualize relationships between entities, topics, and pages in your library.";
            if (buildGraphBtn) buildGraphBtn.style.display = "inline-block";
        }
    }

    private setupKnowledgeGraphModalEventListeners() {
        const viewEntityGraphBtn =
            document.getElementById("viewEntityGraphBtn");
        const rebuildGraphBtn = document.getElementById("rebuildGraphBtn");
        const buildGraphBtn = document.getElementById("buildGraphBtn");
        const mergeTopicsBtn = document.getElementById("mergeTopicsBtn");

        // Remove existing listeners to avoid duplicates
        viewEntityGraphBtn?.removeEventListener(
            "click",
            this.handleViewEntityGraph,
        );
        rebuildGraphBtn?.removeEventListener("click", this.handleRebuildGraph);
        buildGraphBtn?.removeEventListener("click", this.handleBuildGraph);
        mergeTopicsBtn?.removeEventListener("click", this.handleMergeTopics);

        // Add new listeners
        if (viewEntityGraphBtn) {
            viewEntityGraphBtn.addEventListener(
                "click",
                this.handleViewEntityGraph.bind(this),
            );
        }
        if (rebuildGraphBtn) {
            rebuildGraphBtn.addEventListener(
                "click",
                this.handleRebuildGraph.bind(this),
            );
        }
        if (buildGraphBtn) {
            buildGraphBtn.addEventListener(
                "click",
                this.handleBuildGraph.bind(this),
            );
        }
        if (mergeTopicsBtn) {
            mergeTopicsBtn.addEventListener(
                "click",
                this.handleMergeTopics.bind(this),
            );
        }
    }

    private handleViewEntityGraph() {
        // Close the modal and open entity graph view
        const modal = document.getElementById("knowledgeGraphModal");
        if (modal) {
            const bootstrapModal = (window as any).bootstrap.Modal.getInstance(
                modal,
            );
            if (bootstrapModal) {
                bootstrapModal.hide();
            }
        }

        // Open entity graph view
        window.open("entityGraphView.html", "_blank");
    }

    private async handleBuildGraph() {
        try {
            // Show building state
            this.updateGraphStatusDisplay({
                hasGraph: false,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: true,
            });

            // Start graph building in minimal mode for testing
            await extensionService.buildKnowledgeGraph();

            // Reload status after building
            await this.loadGraphStatus();

            notificationManager.showSuccess(
                "Knowledge graph built successfully!",
            );
        } catch (error) {
            console.error("Failed to build graph:", error);
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            notificationManager.showError(
                `Failed to build knowledge graph: ${errorMessage}`,
            );

            // Reset to error state
            this.updateGraphStatusDisplay({
                hasGraph: false,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: false,
                error: errorMessage,
            });
        }
    }

    private async handleRebuildGraph() {
        try {
            // Show building state
            this.updateGraphStatusDisplay({
                hasGraph: false,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: true,
            });

            // Rebuild graph
            await extensionService.rebuildKnowledgeGraph();

            // Reload status after rebuilding
            await this.loadGraphStatus();

            notificationManager.showSuccess(
                "Knowledge graph rebuilt successfully!",
            );
        } catch (error) {
            console.error("Failed to rebuild graph:", error);
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            notificationManager.showError(
                `Failed to rebuild knowledge graph: ${errorMessage}`,
            );

            // Reset to error state
            this.updateGraphStatusDisplay({
                hasGraph: false,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: false,
                error: errorMessage,
            });
        }
    }

    private async handleMergeTopics() {
        try {
            this.updateGraphStatusDisplay({
                hasGraph: true,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: true,
            });

            notificationManager.showInfo("Merging topic hierarchies...");

            const result = await extensionService.mergeTopicHierarchies();

            await this.loadGraphStatus();

            notificationManager.showSuccess(
                result.message || `Topics merged successfully: ${result.mergeCount} topics merged`,
            );
        } catch (error) {
            console.error("Failed to merge topics:", error);
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            notificationManager.showError(
                `Failed to merge topics: ${errorMessage}`,
            );

            await this.loadGraphStatus();
        }
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
window.addEventListener("beforeunload", () => {
    if (libraryPanelInstance) {
        libraryPanelInstance.cleanup();
    }
});

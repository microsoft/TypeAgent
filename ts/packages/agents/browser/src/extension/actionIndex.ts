// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActionsForUrl, getAllActions, getActionDomains } from "./storage";

declare global {
    interface Window {
        Prism: {
            highlightAll: () => void;
        };
    }
}

interface ActionIndexState {
    // Data
    allActions: any[];
    filteredActions: any[];
    searchQuery: string;
    filters: {
        author: string;
        domain: string;
        category: string;
        dateRange: string;
        usageFrequency: string;
    };

    // UI State
    viewMode: "website" | "category" | "usage" | "timeline";
    selectedActions: string[];
    expandedGroups: string[];
    loading: boolean;
    error: string | null;

    // Statistics
    totalActions: number;
    totalDomains: number;
    userActionsCount: number;
    actionStatistics: any[];
}

class ActionIndexPanel {
    private state: ActionIndexState = {
        allActions: [],
        filteredActions: [],
        searchQuery: "",
        filters: {
            author: "all",
            domain: "all",
            category: "all",
            dateRange: "all",
            usageFrequency: "all",
        },
        viewMode: "website",
        selectedActions: [],
        expandedGroups: [],
        loading: false,
        error: null,
        totalActions: 0,
        totalDomains: 0,
        userActionsCount: 0,
        actionStatistics: [],
    };

    private searchTimeout: number | null = null;

    async initialize() {
        console.log("Initializing Action Index Panel");

        this.setupEventListeners();
        await this.loadAllActions();
        this.renderUI();
    }

    private setupEventListeners() {
        // Search functionality
        const searchInput = document.getElementById(
            "searchInput",
        ) as HTMLInputElement;
        searchInput.addEventListener("input", (e) => {
            const query = (e.target as HTMLInputElement).value;
            this.handleSearch(query);
        });

        // Clear search
        document
            .getElementById("clearSearchBtn")!
            .addEventListener("click", () => {
                searchInput.value = "";
                this.handleSearch("");
            });

        // View mode controls
        document
            .getElementById("viewModeWebsite")!
            .addEventListener("click", () => {
                this.setViewMode("website");
            });

        document
            .getElementById("viewModeCategory")!
            .addEventListener("click", () => {
                this.setViewMode("category");
            });

        document
            .getElementById("viewModeUsage")!
            .addEventListener("click", () => {
                this.setViewMode("usage");
            });

        document
            .getElementById("viewModeTimeline")!
            .addEventListener("click", () => {
                this.setViewMode("timeline");
            });

        // Filter controls
        document
            .getElementById("authorFilter")!
            .addEventListener("change", (e) => {
                this.state.filters.author = (
                    e.target as HTMLSelectElement
                ).value;
                this.applyFilters();
            });

        document
            .getElementById("domainFilter")!
            .addEventListener("change", (e) => {
                this.state.filters.domain = (
                    e.target as HTMLSelectElement
                ).value;
                this.applyFilters();
            });

        document
            .getElementById("categoryFilter")!
            .addEventListener("change", (e) => {
                this.state.filters.category = (
                    e.target as HTMLSelectElement
                ).value;
                this.applyFilters();
            });

        document
            .getElementById("dateRangeFilter")!
            .addEventListener("change", (e) => {
                this.state.filters.dateRange = (
                    e.target as HTMLSelectElement
                ).value;
                this.applyFilters();
            });

        document
            .getElementById("usageFrequencyFilter")!
            .addEventListener("change", (e) => {
                this.state.filters.usageFrequency = (
                    e.target as HTMLSelectElement
                ).value;
                this.applyFilters();
            });

        // Clear filters
        document
            .getElementById("clearFiltersBtn")!
            .addEventListener("click", () => {
                this.clearFilters();
            });

        // Bulk operations
        document
            .getElementById("selectAllBtn")!
            .addEventListener("click", () => {
                this.selectAllActions();
            });

        document
            .getElementById("deselectAllBtn")!
            .addEventListener("click", () => {
                this.deselectAllActions();
            });

        document
            .getElementById("bulkDeleteBtn")!
            .addEventListener("click", () => {
                this.bulkDeleteActions();
            });

        // Refresh actions
        document
            .getElementById("refreshActionsBtn")!
            .addEventListener("click", () => {
                this.loadAllActions();
            });
    }

    private handleSearch(query: string) {
        // Debounce search
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        this.searchTimeout = window.setTimeout(() => {
            this.state.searchQuery = query.toLowerCase();
            this.applyFilters();
        }, 300);
    }

    private setViewMode(mode: "website" | "category" | "usage" | "timeline") {
        this.state.viewMode = mode;
        this.updateViewModeUI();
        this.renderActionsList();
    }

    private updateViewModeUI() {
        // Update view mode button states
        const buttons = [
            "viewModeWebsite",
            "viewModeCategory",
            "viewModeUsage",
            "viewModeTimeline",
        ];
        buttons.forEach((buttonId) => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.classList.remove("active");
            }
        });

        const activeButtonId = `viewMode${this.state.viewMode.charAt(0).toUpperCase() + this.state.viewMode.slice(1)}`;
        const activeButton = document.getElementById(activeButtonId);
        if (activeButton) {
            activeButton.classList.add("active");
        }

        // Update view mode specific UI elements
        this.updateBulkOperationsVisibility();
    }

    private updateBulkOperationsVisibility() {
        const bulkOpsContainer = document.getElementById(
            "bulkOperationsContainer",
        );
        if (bulkOpsContainer) {
            // Show bulk operations when actions are selected
            if (this.state.selectedActions.length > 0) {
                bulkOpsContainer.classList.remove("d-none");
            } else {
                bulkOpsContainer.classList.add("d-none");
            }
        }
    }

    private selectAllActions() {
        this.state.selectedActions = this.state.filteredActions.map(
            (action) => action.id || action.name,
        );
        this.updateActionSelectionUI();
        this.updateBulkOperationsVisibility();
    }

    private deselectAllActions() {
        this.state.selectedActions = [];
        this.updateActionSelectionUI();
        this.updateBulkOperationsVisibility();
    }

    private updateActionSelectionUI() {
        // Update checkboxes in the UI
        this.state.filteredActions.forEach((action) => {
            const checkbox = document.querySelector(
                `[data-action-checkbox="${action.id || action.name}"]`,
            ) as HTMLInputElement;
            if (checkbox) {
                checkbox.checked = this.state.selectedActions.includes(
                    action.id || action.name,
                );
            }
        });

        // Update bulk operations counter
        const selectedCountElement = document.getElementById(
            "selectedActionsCount",
        );
        if (selectedCountElement) {
            selectedCountElement.textContent =
                this.state.selectedActions.length.toString();
        }
    }

    private async bulkDeleteActions() {
        if (this.state.selectedActions.length === 0) {
            this.showNotification("No actions selected for deletion", "error");
            return;
        }

        const confirmed = confirm(
            `Are you sure you want to delete ${this.state.selectedActions.length} selected action(s)? This cannot be undone.`,
        );

        if (!confirmed) return;

        const deleteButton = document.getElementById(
            "bulkDeleteBtn",
        ) as HTMLButtonElement;
        const originalContent = deleteButton.innerHTML;
        deleteButton.innerHTML =
            '<span class="spinner-border spinner-border-sm" role="status"></span> Deleting...';
        deleteButton.disabled = true;

        try {
            let successCount = 0;
            let errorCount = 0;

            for (const actionId of this.state.selectedActions) {
                try {
                    const response = await chrome.runtime.sendMessage({
                        type: "deleteAction",
                        actionId: actionId,
                    });

                    if (response?.success) {
                        successCount++;
                    } else {
                        errorCount++;
                        console.error(
                            `Failed to delete action ${actionId}:`,
                            response?.error,
                        );
                    }
                } catch (error) {
                    errorCount++;
                    console.error(`Error deleting action ${actionId}:`, error);
                }
            }

            if (successCount > 0) {
                this.showNotification(
                    `Successfully deleted ${successCount} action(s)${errorCount > 0 ? `, ${errorCount} failed` : ""}`,
                    errorCount > 0 ? "info" : "success",
                );
                this.state.selectedActions = [];
                await this.loadAllActions(); // Refresh the list
            } else {
                this.showNotification("Failed to delete any actions", "error");
            }
        } catch (error) {
            console.error("Error in bulk delete:", error);
            this.showNotification("Failed to delete actions", "error");
        } finally {
            deleteButton.innerHTML = originalContent;
            deleteButton.disabled = false;
            this.updateBulkOperationsVisibility();
        }
    }

    private clearFilters() {
        this.state.filters = {
            author: "all",
            domain: "all",
            category: "all",
            dateRange: "all",
            usageFrequency: "all",
        };

        // Reset UI controls
        (document.getElementById("authorFilter") as HTMLSelectElement).value =
            "all";
        (document.getElementById("domainFilter") as HTMLSelectElement).value =
            "all";
        (document.getElementById("categoryFilter") as HTMLSelectElement).value =
            "all";
        (
            document.getElementById("dateRangeFilter") as HTMLSelectElement
        ).value = "all";
        (
            document.getElementById("usageFrequencyFilter") as HTMLSelectElement
        ).value = "all";

        this.applyFilters();
    }

    private async loadAllActions() {
        this.state.loading = true;
        this.state.error = null;
        this.showLoadingState();

        try {
            // Get all actions across all URLs
            const actions = await getAllActions();
            this.state.allActions = actions;

            // Load analytics data for actions
            await this.loadActionStatistics();

            // Update statistics
            this.updateStatistics();

            // Populate filter dropdowns
            this.populateFilterDropdowns();

            // Apply current filters
            this.applyFilters();
        } catch (error) {
            console.error("Error loading actions:", error);
            this.state.error = "Failed to load actions. Please try again.";
            this.showErrorState();
        } finally {
            this.state.loading = false;
        }
    }

    private async loadActionStatistics() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getActionStatistics",
            });

            this.state.actionStatistics = response?.actions || [];
        } catch (error) {
            console.warn("Failed to load action statistics:", error);
            this.state.actionStatistics = [];
        }
    }

    private updateStatistics() {
        this.state.totalActions = this.state.allActions.length;
        this.state.userActionsCount = this.state.allActions.filter(
            (action) => action.author === "user",
        ).length;

        // Count unique domains
        const domains = new Set();
        this.state.allActions.forEach((action) => {
            if (action.scope?.pattern || action.urlPattern) {
                try {
                    const url = action.scope?.pattern || action.urlPattern;
                    const domain = new URL(url).hostname;
                    domains.add(domain);
                } catch {
                    // If URL parsing fails, try to extract domain from pattern
                    const pattern = action.scope?.pattern || action.urlPattern;
                    const domainMatch = pattern.match(
                        /(?:https?:\/\/)?([^\/\*]+)/,
                    );
                    if (domainMatch) {
                        domains.add(domainMatch[1]);
                    }
                }
            }
        });
        this.state.totalDomains = domains.size;

        // Update UI
        this.updateStatsDisplay();
    }

    private updateStatsDisplay() {
        document.getElementById("totalActionsCount")!.textContent =
            this.state.totalActions.toString();
        document.getElementById("domainsCount")!.textContent =
            this.state.totalDomains.toString();
        document.getElementById("userActionsCount")!.textContent =
            this.state.userActionsCount.toString();
    }

    private populateFilterDropdowns() {
        // Populate domain filter
        const domainFilter = document.getElementById(
            "domainFilter",
        ) as HTMLSelectElement;
        const domains = new Set<string>();

        this.state.allActions.forEach((action) => {
            if (action.scope?.pattern || action.urlPattern) {
                try {
                    const url = action.scope?.pattern || action.urlPattern;
                    const domain = new URL(url).hostname;
                    domains.add(domain);
                } catch {
                    const pattern = action.scope?.pattern || action.urlPattern;
                    const domainMatch = pattern.match(
                        /(?:https?:\/\/)?([^\/\*]+)/,
                    );
                    if (domainMatch) {
                        domains.add(domainMatch[1]);
                    }
                }
            }
        });

        // Clear existing options except "All Websites"
        while (domainFilter.children.length > 1) {
            domainFilter.removeChild(domainFilter.lastChild!);
        }

        // Add domain options
        Array.from(domains)
            .sort()
            .forEach((domain) => {
                const option = document.createElement("option");
                option.value = domain;
                option.textContent = domain;
                domainFilter.appendChild(option);
            });

        // Populate category filter (basic categories based on action names/descriptions)
        const categoryFilter = document.getElementById(
            "categoryFilter",
        ) as HTMLSelectElement;
        const categories = this.extractCategories();

        // Clear existing options except "All Categories"
        while (categoryFilter.children.length > 1) {
            categoryFilter.removeChild(categoryFilter.lastChild!);
        }

        categories.forEach((category) => {
            const option = document.createElement("option");
            option.value = category;
            option.textContent = category;
            categoryFilter.appendChild(option);
        });

        // Populate date range filter
        this.populateDateRangeFilter();

        // Populate usage frequency filter
        this.populateUsageFrequencyFilter();
    }

    private populateDateRangeFilter() {
        const dateRangeFilter = document.getElementById(
            "dateRangeFilter",
        ) as HTMLSelectElement;

        // Clear existing options except "All Time"
        while (dateRangeFilter.children.length > 1) {
            dateRangeFilter.removeChild(dateRangeFilter.lastChild!);
        }

        // Add predefined date range options
        const dateRanges = [
            { value: "today", label: "Today" },
            { value: "week", label: "This Week" },
            { value: "month", label: "This Month" },
            { value: "quarter", label: "This Quarter" },
            { value: "year", label: "This Year" },
        ];

        dateRanges.forEach((range) => {
            const option = document.createElement("option");
            option.value = range.value;
            option.textContent = range.label;
            dateRangeFilter.appendChild(option);
        });
    }

    private populateUsageFrequencyFilter() {
        const usageFilter = document.getElementById(
            "usageFrequencyFilter",
        ) as HTMLSelectElement;

        // Clear existing options except "All Actions"
        while (usageFilter.children.length > 1) {
            usageFilter.removeChild(usageFilter.lastChild!);
        }

        // Add usage frequency options
        const usageOptions = [
            { value: "frequent", label: "Frequently Used" },
            { value: "occasional", label: "Occasionally Used" },
            { value: "rarely", label: "Rarely Used" },
            { value: "never", label: "Never Used" },
        ];

        usageOptions.forEach((option) => {
            const optionElement = document.createElement("option");
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            usageFilter.appendChild(optionElement);
        });
    }

    private extractCategories(): string[] {
        const categories = new Set<string>();

        this.state.allActions.forEach((action) => {
            // Basic categorization based on action names and descriptions
            const text =
                `${action.name} ${action.description || ""}`.toLowerCase();

            if (text.includes("search") || text.includes("find")) {
                categories.add("Search");
            } else if (
                text.includes("login") ||
                text.includes("sign in") ||
                text.includes("auth")
            ) {
                categories.add("Authentication");
            } else if (
                text.includes("form") ||
                text.includes("submit") ||
                text.includes("input")
            ) {
                categories.add("Form Interaction");
            } else if (
                text.includes("click") ||
                text.includes("button") ||
                text.includes("link")
            ) {
                categories.add("Navigation");
            } else if (
                text.includes("cart") ||
                text.includes("buy") ||
                text.includes("purchase") ||
                text.includes("order")
            ) {
                categories.add("E-commerce");
            } else if (
                text.includes("download") ||
                text.includes("upload") ||
                text.includes("file")
            ) {
                categories.add("File Operations");
            } else {
                categories.add("Other");
            }
        });

        return Array.from(categories).sort();
    }

    private applyFilters() {
        let filtered = [...this.state.allActions];

        // Apply search filter
        if (this.state.searchQuery) {
            filtered = filtered.filter(
                (action) =>
                    action.name
                        .toLowerCase()
                        .includes(this.state.searchQuery) ||
                    (action.description &&
                        action.description
                            .toLowerCase()
                            .includes(this.state.searchQuery)),
            );
        }

        // Apply author filter
        if (this.state.filters.author !== "all") {
            filtered = filtered.filter(
                (action) => action.author === this.state.filters.author,
            );
        }

        // Apply domain filter
        if (this.state.filters.domain !== "all") {
            filtered = filtered.filter((action) => {
                if (action.scope?.pattern || action.urlPattern) {
                    try {
                        const url = action.scope?.pattern || action.urlPattern;
                        const domain = new URL(url).hostname;
                        return domain === this.state.filters.domain;
                    } catch {
                        const pattern =
                            action.scope?.pattern || action.urlPattern;
                        return pattern.includes(this.state.filters.domain);
                    }
                }
                return false;
            });
        }

        // Apply category filter
        if (this.state.filters.category !== "all") {
            filtered = filtered.filter((action) => {
                const text =
                    `${action.name} ${action.description || ""}`.toLowerCase();
                const category = this.state.filters.category.toLowerCase();

                switch (category) {
                    case "search":
                        return text.includes("search") || text.includes("find");
                    case "authentication":
                        return (
                            text.includes("login") ||
                            text.includes("sign in") ||
                            text.includes("auth")
                        );
                    case "form interaction":
                        return (
                            text.includes("form") ||
                            text.includes("submit") ||
                            text.includes("input")
                        );
                    case "navigation":
                        return (
                            text.includes("click") ||
                            text.includes("button") ||
                            text.includes("link")
                        );
                    case "e-commerce":
                        return (
                            text.includes("cart") ||
                            text.includes("buy") ||
                            text.includes("purchase") ||
                            text.includes("order")
                        );
                    case "file operations":
                        return (
                            text.includes("download") ||
                            text.includes("upload") ||
                            text.includes("file")
                        );
                    case "other":
                        return !text.match(
                            /search|find|login|sign in|auth|form|submit|input|click|button|link|cart|buy|purchase|order|download|upload|file/,
                        );
                    default:
                        return true;
                }
            });
        }

        // Apply date range filter
        if (this.state.filters.dateRange !== "all") {
            filtered = filtered.filter((action) => {
                const actionDate = this.getActionDate(action);
                if (!actionDate) return true; // Include actions without dates

                const now = new Date();
                const filterDate = this.getDateRangeStart(
                    this.state.filters.dateRange,
                    now,
                );

                return actionDate >= filterDate;
            });
        }

        // Apply usage frequency filter
        if (this.state.filters.usageFrequency !== "all") {
            filtered = filtered.filter((action) => {
                const usageStats = this.getActionUsageStats(action);
                return this.matchesUsageFrequency(
                    usageStats,
                    this.state.filters.usageFrequency,
                );
            });
        }

        this.state.filteredActions = filtered;
        this.renderActionsList();
        this.updateFilteredCount();
    }

    private getActionDate(action: any): Date | null {
        // Try to get creation date from action metadata
        if (action.createdAt) {
            return new Date(action.createdAt);
        }
        if (action.metadata?.createdAt) {
            return new Date(action.metadata.createdAt);
        }
        if (action.timestamp) {
            return new Date(action.timestamp);
        }
        return null;
    }

    private getDateRangeStart(range: string, now: Date): Date {
        const start = new Date(now);

        switch (range) {
            case "today":
                start.setHours(0, 0, 0, 0);
                break;
            case "week":
                start.setDate(now.getDate() - 7);
                break;
            case "month":
                start.setMonth(now.getMonth() - 1);
                break;
            case "quarter":
                start.setMonth(now.getMonth() - 3);
                break;
            case "year":
                start.setFullYear(now.getFullYear() - 1);
                break;
            default:
                start.setFullYear(1970); // Very old date for "all time"
        }

        return start;
    }

    private getActionUsageStats(action: any): {
        count: number;
        lastUsed: Date | null;
    } {
        // Try to get usage stats from analytics data
        const stats = this.state.actionStatistics.find(
            (stat) =>
                stat.actionId === action.id || stat.actionName === action.name,
        );

        return {
            count: stats?.usageCount || 0,
            lastUsed: stats?.lastUsed ? new Date(stats.lastUsed) : null,
        };
    }

    private matchesUsageFrequency(
        stats: { count: number; lastUsed: Date | null },
        frequency: string,
    ): boolean {
        const { count, lastUsed } = stats;
        const now = new Date();
        const daysSinceLastUse = lastUsed
            ? Math.floor(
                  (now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60 * 24),
              )
            : 999;

        switch (frequency) {
            case "frequent":
                return count >= 10 || (count > 0 && daysSinceLastUse <= 7);
            case "occasional":
                return count >= 3 && count < 10 && daysSinceLastUse <= 30;
            case "rarely":
                return count > 0 && count < 3 && daysSinceLastUse > 30;
            case "never":
                return count === 0;
            default:
                return true;
        }
    }

    private updateFilteredCount() {
        document.getElementById("filteredActionsCount")!.textContent =
            this.state.filteredActions.length.toString();
    }

    private renderUI() {
        this.updateStatsDisplay();
        this.renderActionsList();
    }

    private renderActionsList() {
        const container = document.getElementById("actionsListContainer")!;

        if (this.state.filteredActions.length === 0) {
            if (this.state.allActions.length === 0) {
                this.showEmptyState();
            } else {
                this.showNoResultsState();
            }
            return;
        }

        container.innerHTML = "";

        // Render based on view mode
        switch (this.state.viewMode) {
            case "website":
                this.renderByWebsite(container);
                break;
            case "category":
                this.renderByCategory(container);
                break;
            case "usage":
                this.renderByUsage(container);
                break;
            case "timeline":
                this.renderByTimeline(container);
                break;
            default:
                this.renderFlat(container);
        }

        // Highlight syntax if Prism is available
        if (window.Prism) {
            window.Prism.highlightAll();
        }

        this.updateFilteredCount();
    }

    private renderFlat(container: HTMLElement) {
        this.state.filteredActions.forEach((action, index) => {
            const actionCard = this.createActionCard(action, index);
            container.appendChild(actionCard);
        });
    }

    private renderByWebsite(container: HTMLElement) {
        const groupedActions = this.groupActionsByWebsite();

        Object.entries(groupedActions).forEach(([domain, actions]) => {
            const groupCard = this.createGroupCard(domain, actions, "website");
            container.appendChild(groupCard);
        });
    }

    private renderByCategory(container: HTMLElement) {
        const groupedActions = this.groupActionsByCategory();

        Object.entries(groupedActions).forEach(([category, actions]) => {
            const groupCard = this.createGroupCard(
                category,
                actions,
                "category",
            );
            container.appendChild(groupCard);
        });
    }

    private renderByUsage(container: HTMLElement) {
        const sortedActions = this.sortActionsByUsage();
        const groupedActions = this.groupActionsByUsageFrequency(sortedActions);

        Object.entries(groupedActions).forEach(([frequency, actions]) => {
            const groupCard = this.createGroupCard(frequency, actions, "usage");
            container.appendChild(groupCard);
        });
    }

    private renderByTimeline(container: HTMLElement) {
        const groupedActions = this.groupActionsByTimeline();

        Object.entries(groupedActions).forEach(([period, actions]) => {
            const groupCard = this.createGroupCard(period, actions, "timeline");
            container.appendChild(groupCard);
        });
    }

    private createActionCard(action: any, index: number): HTMLElement {
        const card = document.createElement("div");
        card.className = "action-card";
        card.setAttribute("data-action-id", action.id || action.name);

        const domain = this.extractDomain(action);
        const category = this.getActionCategory(action);
        const stats = this.getActionUsageStats(action);
        const isSelected = this.state.selectedActions.includes(
            action.id || action.name,
        );

        card.innerHTML = `
            <div class="action-card-header">
                <div class="d-flex align-items-start">
                    <div class="form-check me-3">
                        <input class="form-check-input action-checkbox" type="checkbox" 
                               data-action-checkbox="${action.id || action.name}" 
                               ${isSelected ? "checked" : ""}>
                    </div>
                    <div class="action-info flex-grow-1">
                        <h6 class="action-name">${this.escapeHtml(action.name)}</h6>
                        <p class="action-description">${this.escapeHtml(action.description || "No description available")}</p>
                        <div class="action-meta">
                            <span class="badge-author ${action.author}">${action.author === "user" ? "Custom" : "Discovered"}</span>
                            ${domain ? `<span class="badge-domain">${this.escapeHtml(domain)}</span>` : ""}
                            <small class="text-muted">${category}</small>
                            ${stats.count > 0 ? `<span class="usage-stats ms-2"><i class="bi bi-graph-up"></i> ${stats.count} uses</span>` : ""}
                            ${stats.lastUsed ? `<span class="last-used ms-2"><i class="bi bi-clock"></i> Last used ${this.formatRelativeDate(stats.lastUsed)}</span>` : ""}
                        </div>
                    </div>
                    <div class="action-controls">
                        <button class="btn btn-sm btn-outline-primary" data-action="view" title="View details">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" data-action="delete" title="Delete action">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="action-details collapse" id="actionDetails${index}">
                <!-- Details will be populated when expanded -->
            </div>
        `;

        // Add event listeners
        const checkbox = card.querySelector(
            ".action-checkbox",
        ) as HTMLInputElement;
        checkbox?.addEventListener("change", (e) => {
            this.toggleActionSelection(
                action.id || action.name,
                (e.target as HTMLInputElement).checked,
            );
        });

        const viewButton = card.querySelector('[data-action="view"]');
        const deleteButton = card.querySelector('[data-action="delete"]');

        viewButton?.addEventListener("click", () => {
            this.viewActionDetails(action, index);
        });

        deleteButton?.addEventListener("click", () => {
            this.deleteAction(action.id || action.name, action.name);
        });

        return card;
    }

    private formatRelativeDate(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        if (diffMinutes < 60) {
            return `${diffMinutes}m ago`;
        } else if (diffHours < 24) {
            return `${diffHours}h ago`;
        } else if (diffDays === 1) {
            return "yesterday";
        } else if (diffDays < 7) {
            return `${diffDays}d ago`;
        } else if (diffDays < 30) {
            return `${Math.floor(diffDays / 7)}w ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    private extractDomain(action: any): string | null {
        if (action.scope?.pattern || action.urlPattern) {
            try {
                const url = action.scope?.pattern || action.urlPattern;
                return new URL(url).hostname;
            } catch {
                const pattern = action.scope?.pattern || action.urlPattern;
                const domainMatch = pattern.match(/(?:https?:\/\/)?([^\/\*]+)/);
                return domainMatch ? domainMatch[1] : null;
            }
        }
        return null;
    }

    private getActionCategory(action: any): string {
        const text = `${action.name} ${action.description || ""}`.toLowerCase();

        if (text.includes("search") || text.includes("find")) return "Search";
        if (
            text.includes("login") ||
            text.includes("sign in") ||
            text.includes("auth")
        )
            return "Authentication";
        if (
            text.includes("form") ||
            text.includes("submit") ||
            text.includes("input")
        )
            return "Form";
        if (
            text.includes("click") ||
            text.includes("button") ||
            text.includes("link")
        )
            return "Navigation";
        if (
            text.includes("cart") ||
            text.includes("buy") ||
            text.includes("purchase")
        )
            return "E-commerce";
        if (
            text.includes("download") ||
            text.includes("upload") ||
            text.includes("file")
        )
            return "File";

        return "General";
    }

    private viewActionDetails(action: any, index: number) {
        const detailsContainer = document.getElementById(
            `actionDetails${index}`,
        );
        if (!detailsContainer) return;

        // Toggle details
        if (detailsContainer.classList.contains("show")) {
            detailsContainer.classList.remove("show");
            return;
        }

        // Populate details if not already done
        if (!detailsContainer.innerHTML.trim()) {
            detailsContainer.innerHTML =
                this.createActionDetailsContent(action);
        }

        detailsContainer.classList.add("show");

        // Highlight syntax
        if (window.Prism) {
            window.Prism.highlightAll();
        }
    }

    private createActionDetailsContent(action: any): string {
        const steps = action.context?.recordedSteps || action.steps || [];
        const intentSchema =
            action.definition?.intentSchema ||
            action.intentSchema ||
            "No intent schema available";
        const actionSteps =
            action.definition?.actionSteps || action.actionsJson || {};

        return `
            <div class="row">
                <div class="col-md-6">
                    <h6 class="mb-3">Recorded Steps (${steps.length})</h6>
                    ${steps.length > 0 ? this.createStepsTimeline(steps) : '<p class="text-muted">No steps recorded</p>'}
                </div>
                <div class="col-md-6">
                    <h6 class="mb-3">Action Definition</h6>
                    <div class="mb-3">
                        <small class="text-muted d-block mb-1">Intent Schema:</small>
                        <pre><code class="language-typescript">${this.escapeHtml(intentSchema)}</code></pre>
                    </div>
                    <div>
                        <small class="text-muted d-block mb-1">Action Steps:</small>
                        <pre><code class="language-json">${this.escapeHtml(JSON.stringify(actionSteps, null, 2))}</code></pre>
                    </div>
                </div>
            </div>
        `;
    }

    private createStepsTimeline(steps: any[]): string {
        return `
            <div class="timeline-container">
                ${steps
                    .map(
                        (step, index) => `
                    <div class="timeline-item mb-2">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <strong>${index + 1}. ${step.type || "Unknown"}</strong>
                                <div class="text-muted small">
                                    ${step.selector ? `Selector: ${step.selector}` : ""}
                                    ${step.value ? `Value: ${step.value}` : ""}
                                </div>
                            </div>
                            <small class="text-muted">
                                ${step.timestamp ? new Date(step.timestamp).toLocaleTimeString() : ""}
                            </small>
                        </div>
                    </div>
                `,
                    )
                    .join("")}
            </div>
        `;
    }

    private async deleteAction(actionId: string, actionName: string) {
        if (
            !confirm(
                `Are you sure you want to delete the action "${actionName}"? This cannot be undone.`,
            )
        ) {
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                type: "deleteAction",
                actionId: actionId,
            });

            if (response?.success) {
                this.showNotification(
                    `Action "${actionName}" deleted successfully!`,
                    "success",
                );
                await this.loadAllActions(); // Refresh the list
            } else {
                throw new Error(response?.error || "Failed to delete action");
            }
        } catch (error) {
            console.error("Error deleting action:", error);
            this.showNotification(`Failed to delete action: ${error}`, "error");
        }
    }

    private showLoadingState() {
        const container = document.getElementById("actionsListContainer")!;
        container.innerHTML = `
            <div class="loading-state">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2 mb-0">Loading your action library...</p>
            </div>
        `;
    }

    private showEmptyState() {
        const container = document.getElementById("actionsListContainer")!;
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-collection"></i>
                <h6>No Actions Yet</h6>
                <p class="mb-3">You haven't created any actions yet. Use the browser sidepanel to discover and create actions for web pages.</p>
            </div>
        `;

        // Create action button removed - actions can be created via sidepanel discovery
    }

    private showNoResultsState() {
        const container = document.getElementById("actionsListContainer")!;
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-search"></i>
                <h6>No Actions Found</h6>
                <p class="mb-3">No actions match your current search and filter criteria.</p>
                ${this.createButton(
                    '<i class="bi bi-funnel"></i> Clear Filters',
                    "btn btn-outline-primary",
                    { "data-action": "clear-filters" },
                )}
            </div>
        `;

        // Add event listener for the clear filters button
        const clearBtn = container.querySelector(
            '[data-action="clear-filters"]',
        );
        clearBtn?.addEventListener("click", () => {
            this.clearFilters();
        });
    }

    private showErrorState() {
        const container = document.getElementById("actionsListContainer")!;
        container.innerHTML = `
            <div class="error-state">
                <i class="bi bi-exclamation-triangle"></i>
                <h6>Error Loading Actions</h6>
                <p class="mb-3">${this.state.error}</p>
                ${this.createButton(
                    '<i class="bi bi-arrow-clockwise"></i> Try Again',
                    "btn btn-primary",
                    { "data-action": "try-again" },
                )}
            </div>
        `;

        // Add event listener for the try again button
        const tryAgainBtn = container.querySelector(
            '[data-action="try-again"]',
        );
        tryAgainBtn?.addEventListener("click", () => {
            this.loadAllActions();
        });
    }

    private showNotification(
        message: string,
        type: "success" | "error" | "info" = "info",
    ) {
        const toast = document.createElement("div");
        toast.className = `alert alert-${type === "error" ? "danger" : type === "success" ? "success" : "info"} alert-dismissible position-fixed`;
        toast.style.cssText =
            "top: 20px; right: 20px; z-index: 1050; min-width: 300px;";

        const messageSpan = document.createElement("span");
        messageSpan.textContent = message;

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "btn-close";
        closeButton.setAttribute("data-bs-dismiss", "alert");

        toast.appendChild(messageSpan);
        toast.appendChild(closeButton);

        document.body.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // Template utility functions following sidepanel conventions
    private createButton(
        text: string,
        classes: string,
        attributes: Record<string, string> = {},
    ): string {
        const attrs = Object.entries(attributes)
            .map(([key, value]) => `${key}="${value}"`)
            .join(" ");
        return `<button class="${classes}" ${attrs}>${text}</button>`;
    }

    // Phase 2 methods for grouping and view modes
    private groupActionsByWebsite(): Record<string, any[]> {
        const grouped: Record<string, any[]> = {};

        this.state.filteredActions.forEach((action) => {
            const domain = this.extractDomain(action) || "Unknown Website";
            if (!grouped[domain]) {
                grouped[domain] = [];
            }
            grouped[domain].push(action);
        });

        return grouped;
    }

    private groupActionsByCategory(): Record<string, any[]> {
        const grouped: Record<string, any[]> = {};

        this.state.filteredActions.forEach((action) => {
            const category = this.getActionCategory(action);
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push(action);
        });

        return grouped;
    }

    private sortActionsByUsage(): any[] {
        return [...this.state.filteredActions].sort((a, b) => {
            const statsA = this.getActionUsageStats(a);
            const statsB = this.getActionUsageStats(b);

            if (statsA.count !== statsB.count) {
                return statsB.count - statsA.count;
            }

            if (statsA.lastUsed && statsB.lastUsed) {
                return statsB.lastUsed.getTime() - statsA.lastUsed.getTime();
            }

            if (statsA.lastUsed && !statsB.lastUsed) return -1;
            if (!statsA.lastUsed && statsB.lastUsed) return 1;

            return 0;
        });
    }

    private groupActionsByUsageFrequency(
        sortedActions: any[],
    ): Record<string, any[]> {
        const grouped: Record<string, any[]> = {
            "Frequently Used": [],
            "Occasionally Used": [],
            "Rarely Used": [],
            "Never Used": [],
        };

        sortedActions.forEach((action) => {
            const stats = this.getActionUsageStats(action);
            const now = new Date();
            const daysSinceLastUse = stats.lastUsed
                ? Math.floor(
                      (now.getTime() - stats.lastUsed.getTime()) /
                          (1000 * 60 * 60 * 24),
                  )
                : 999;

            if (
                stats.count >= 10 ||
                (stats.count > 0 && daysSinceLastUse <= 7)
            ) {
                grouped["Frequently Used"].push(action);
            } else if (
                stats.count >= 3 &&
                stats.count < 10 &&
                daysSinceLastUse <= 30
            ) {
                grouped["Occasionally Used"].push(action);
            } else if (
                stats.count > 0 &&
                stats.count < 3 &&
                daysSinceLastUse > 30
            ) {
                grouped["Rarely Used"].push(action);
            } else {
                grouped["Never Used"].push(action);
            }
        });

        Object.keys(grouped).forEach((key) => {
            if (grouped[key].length === 0) {
                delete grouped[key];
            }
        });

        return grouped;
    }

    private groupActionsByTimeline(): Record<string, any[]> {
        const grouped: Record<string, any[]> = {};
        const now = new Date();

        this.state.filteredActions.forEach((action) => {
            const actionDate = this.getActionDate(action);
            let period = "Unknown";

            if (actionDate) {
                const daysDiff = Math.floor(
                    (now.getTime() - actionDate.getTime()) /
                        (1000 * 60 * 60 * 24),
                );

                if (daysDiff === 0) {
                    period = "Today";
                } else if (daysDiff <= 7) {
                    period = "This Week";
                } else if (daysDiff <= 30) {
                    period = "This Month";
                } else if (daysDiff <= 90) {
                    period = "Last 3 Months";
                } else if (daysDiff <= 365) {
                    period = "This Year";
                } else {
                    period = "Older";
                }
            }

            if (!grouped[period]) {
                grouped[period] = [];
            }
            grouped[period].push(action);
        });

        const sortedGrouped: Record<string, any[]> = {};
        const periods = [
            "Today",
            "This Week",
            "This Month",
            "Last 3 Months",
            "This Year",
            "Older",
            "Unknown",
        ];
        periods.forEach((period) => {
            if (grouped[period]) {
                sortedGrouped[period] = grouped[period];
            }
        });

        return sortedGrouped;
    }

    private createGroupCard(
        groupName: string,
        actions: any[],
        groupType: string,
    ): HTMLElement {
        const groupCard = document.createElement("div");
        groupCard.className = "group-card mb-3";

        const isExpanded = this.state.expandedGroups.includes(groupName);
        const groupId = `group-${groupType}-${groupName.replace(/\s+/g, "-").toLowerCase()}`;

        groupCard.innerHTML = `
            <div class="group-header" data-group-name="${groupName}">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="d-flex align-items-center">
                        <button class="btn btn-link btn-sm p-0 me-2 group-toggle" data-bs-toggle="collapse" data-bs-target="#${groupId}">
                            <i class="bi ${isExpanded ? "bi-chevron-down" : "bi-chevron-right"}"></i>
                        </button>
                        <div>
                            <h6 class="mb-0">${this.getGroupIcon(groupType)} ${this.escapeHtml(groupName)}</h6>
                            <small class="text-muted">${actions.length} action${actions.length !== 1 ? "s" : ""}</small>
                        </div>
                    </div>
                    <div class="group-controls">
                        ${this.createGroupSelectCheckbox(groupName, actions)}
                    </div>
                </div>
            </div>
            <div class="collapse ${isExpanded ? "show" : ""}" id="${groupId}">
                <div class="group-content">
                    ${actions.map((action, index) => this.createGroupActionCard(action, index, groupName)).join("")}
                </div>
            </div>
        `;

        const toggleButton = groupCard.querySelector(".group-toggle");
        toggleButton?.addEventListener("click", () => {
            this.toggleGroup(groupName);
        });

        const selectCheckbox = groupCard.querySelector(
            ".group-select-checkbox",
        ) as HTMLInputElement;
        selectCheckbox?.addEventListener("change", (e) => {
            this.toggleGroupSelection(
                groupName,
                actions,
                (e.target as HTMLInputElement).checked,
            );
        });

        return groupCard;
    }

    private getGroupIcon(groupType: string): string {
        switch (groupType) {
            case "website":
                return '<i class="bi bi-globe text-primary"></i>';
            case "category":
                return '<i class="bi bi-tags text-success"></i>';
            case "usage":
                return '<i class="bi bi-bar-chart text-info"></i>';
            case "timeline":
                return '<i class="bi bi-clock text-warning"></i>';
            default:
                return '<i class="bi bi-folder text-secondary"></i>';
        }
    }

    private createGroupSelectCheckbox(
        groupName: string,
        actions: any[],
    ): string {
        const allSelected = actions.every((action) =>
            this.state.selectedActions.includes(action.id || action.name),
        );
        const someSelected = actions.some((action) =>
            this.state.selectedActions.includes(action.id || action.name),
        );

        return `
            <div class="form-check">
                <input class="form-check-input group-select-checkbox" type="checkbox" 
                       ${allSelected ? "checked" : ""} 
                       ${someSelected && !allSelected ? "indeterminate" : ""}
                       title="Select all actions in this group">
            </div>
        `;
    }

    private createGroupActionCard(
        action: any,
        index: number,
        groupName: string,
    ): string {
        const domain = this.extractDomain(action);
        const category = this.getActionCategory(action);
        const stats = this.getActionUsageStats(action);
        const isSelected = this.state.selectedActions.includes(
            action.id || action.name,
        );

        return `
            <div class="action-card-compact" data-action-id="${action.id || action.name}">
                <div class="d-flex justify-content-between align-items-start p-2">
                    <div class="form-check">
                        <input class="form-check-input action-checkbox" type="checkbox" 
                               data-action-checkbox="${action.id || action.name}" 
                               ${isSelected ? "checked" : ""}>
                    </div>
                    <div class="action-info flex-grow-1 mx-3">
                        <h6 class="action-name mb-1">${this.escapeHtml(action.name)}</h6>
                        <p class="action-description small text-muted mb-1">${this.escapeHtml(action.description || "No description")}</p>
                        <div class="action-meta-compact">
                            <span class="badge-author-sm ${action.author}">${action.author === "user" ? "Custom" : "Discovered"}</span>
                            ${domain ? `<span class="badge-domain-sm">${this.escapeHtml(domain)}</span>` : ""}
                            <span class="text-muted small">${category}</span>
                            ${stats.count > 0 ? `<span class="usage-badge">${stats.count} uses</span>` : ""}
                        </div>
                    </div>
                    <div class="action-controls-compact">
                        <button class="btn btn-sm btn-outline-primary" data-action="view" data-action-id="${action.id || action.name}" title="View details">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-action-id="${action.id || action.name}" title="Delete action">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    private toggleGroup(groupName: string) {
        const index = this.state.expandedGroups.indexOf(groupName);
        if (index > -1) {
            this.state.expandedGroups.splice(index, 1);
        } else {
            this.state.expandedGroups.push(groupName);
        }

        const toggleButton = document.querySelector(
            `[data-group-name="${groupName}"] .group-toggle i`,
        );
        if (toggleButton) {
            if (this.state.expandedGroups.includes(groupName)) {
                toggleButton.className = "bi bi-chevron-down";
            } else {
                toggleButton.className = "bi bi-chevron-right";
            }
        }
    }

    private toggleGroupSelection(
        groupName: string,
        actions: any[],
        selected: boolean,
    ) {
        const actionIds = actions.map((action) => action.id || action.name);

        if (selected) {
            actionIds.forEach((id) => {
                if (!this.state.selectedActions.includes(id)) {
                    this.state.selectedActions.push(id);
                }
            });
        } else {
            this.state.selectedActions = this.state.selectedActions.filter(
                (id) => !actionIds.includes(id),
            );
        }

        this.updateActionSelectionUI();
        this.updateBulkOperationsVisibility();
    }

    private toggleActionSelection(actionId: string, selected: boolean) {
        if (selected) {
            if (!this.state.selectedActions.includes(actionId)) {
                this.state.selectedActions.push(actionId);
            }
        } else {
            this.state.selectedActions = this.state.selectedActions.filter(
                (id) => id !== actionId,
            );
        }

        this.updateBulkOperationsVisibility();
        this.updateGroupCheckboxes();
    }

    private updateGroupCheckboxes() {
        document
            .querySelectorAll(".group-select-checkbox")
            .forEach((checkbox) => {
                const groupHeader = checkbox.closest(".group-header");
                if (groupHeader) {
                    const groupContent =
                        groupHeader.parentElement?.querySelector(
                            ".group-content",
                        );
                    if (groupContent) {
                        const actionCheckboxes = groupContent.querySelectorAll(
                            ".action-checkbox",
                        ) as NodeListOf<HTMLInputElement>;
                        const checkedCount = Array.from(
                            actionCheckboxes,
                        ).filter((cb) => cb.checked).length;
                        const totalCount = actionCheckboxes.length;

                        const groupCheckbox = checkbox as HTMLInputElement;
                        if (checkedCount === 0) {
                            groupCheckbox.checked = false;
                            groupCheckbox.indeterminate = false;
                        } else if (checkedCount === totalCount) {
                            groupCheckbox.checked = true;
                            groupCheckbox.indeterminate = false;
                        } else {
                            groupCheckbox.checked = false;
                            groupCheckbox.indeterminate = true;
                        }
                    }
                }
            });
    }
}

// Initialize the panel when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
    const panel = new ActionIndexPanel();
    await panel.initialize();
});

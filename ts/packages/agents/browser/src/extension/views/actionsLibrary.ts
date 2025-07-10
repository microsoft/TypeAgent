// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActionsForUrl, getAllActions, getActionDomains } from "../storage";

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
        usage: string;
    };

    // UI State
    viewMode: "grid" | "list";
    selectedActions: string[];
    loading: boolean;
    error: string | null;
}

class ActionIndexApp {
    private state: ActionIndexState = {
        allActions: [],
        filteredActions: [],
        searchQuery: "",
        filters: {
            author: "all",
            domain: "all",
            category: "all",
            usage: "all",
        },
        viewMode: "grid",
        selectedActions: [],
        loading: false,
        error: null,
    };

    private searchTimeout: number | null = null;

    async initialize() {
        console.log("Initializing Action Index App");

        this.setupEventListeners();
        await this.loadAllActions();
        this.renderUI();
    }

    private setupEventListeners() {
        // Global search functionality
        const globalSearchInput = document.getElementById(
            "globalSearchInput",
        ) as HTMLInputElement;
        globalSearchInput.addEventListener("input", (e) => {
            const query = (e.target as HTMLInputElement).value;
            this.handleSearch(query);
        });

        // View mode controls
        document
            .getElementById("viewModeGrid")!
            .addEventListener("click", () => {
                this.setViewMode("grid");
            });

        document
            .getElementById("viewModeList")!
            .addEventListener("click", () => {
                this.setViewMode("list");
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
            .getElementById("usageFilter")!
            .addEventListener("change", (e) => {
                this.state.filters.usage = (
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
    }

    private handleSearch(query: string) {
        // Debounce search
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        this.searchTimeout = window.setTimeout(() => {
            this.state.searchQuery = query.toLowerCase().trim();
            this.applyFilters();
        }, 300);
    }

    private setViewMode(mode: "grid" | "list") {
        this.state.viewMode = mode;
        this.updateViewModeUI();
        this.renderActions();
    }

    private updateViewModeUI() {
        // Update view mode button states
        const gridBtn = document.getElementById("viewModeGrid");
        const listBtn = document.getElementById("viewModeList");

        if (gridBtn && listBtn) {
            gridBtn.classList.toggle("active", this.state.viewMode === "grid");
            listBtn.classList.toggle("active", this.state.viewMode === "list");
        }
    }

    private async loadAllActions() {
        this.state.loading = true;
        this.state.error = null;
        this.showLoadingState();

        try {
            // Get all actions across all URLs
            const actions = await getAllActions();
            this.state.allActions = actions;

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

        // Populate category filter
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
                const category = this.getActionCategory(action);
                return category === this.state.filters.category;
            });
        }

        // Apply usage filter
        if (this.state.filters.usage !== "all") {
            filtered = filtered.filter((action) => {
                const stats = this.getActionUsageStats(action);
                return this.matchesUsageFrequency(
                    stats,
                    this.state.filters.usage,
                );
            });
        }

        this.state.filteredActions = filtered;
        this.renderActions();
        this.updateFilteredCount();
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
            return "Form Interaction";
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
            return "File Operations";

        return "Other";
    }

    private getActionUsageStats(action: any): {
        count: number;
        lastUsed: Date | null;
    } {
        // Return default stats since we removed statistics tracking
        return {
            count: 0,
            lastUsed: null,
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

    private clearFilters() {
        this.state.filters = {
            author: "all",
            domain: "all",
            category: "all",
            usage: "all",
        };

        // Reset UI controls
        (document.getElementById("authorFilter") as HTMLSelectElement).value =
            "all";
        (document.getElementById("domainFilter") as HTMLSelectElement).value =
            "all";
        (document.getElementById("categoryFilter") as HTMLSelectElement).value =
            "all";
        (document.getElementById("usageFilter") as HTMLSelectElement).value =
            "all";

        // Clear search
        const searchInput = document.getElementById(
            "globalSearchInput",
        ) as HTMLInputElement;
        searchInput.value = "";
        this.state.searchQuery = "";

        this.applyFilters();
    }
    private selectAllActions() {
        this.state.selectedActions = this.state.filteredActions.map(
            (action) => action.id || action.name,
        );
        this.updateBulkOperationsUI();
        this.updateActionSelectionUI();
    }

    private deselectAllActions() {
        this.state.selectedActions = [];
        this.updateBulkOperationsUI();
        this.updateActionSelectionUI();
    }

    private updateBulkOperationsUI() {
        const bulkOpsContainer = document.getElementById(
            "bulkOperationsContainer",
        );
        const selectedCountEl = document.getElementById("selectedActionsCount");

        if (bulkOpsContainer && selectedCountEl) {
            if (this.state.selectedActions.length > 0) {
                bulkOpsContainer.classList.add("active");
                selectedCountEl.textContent =
                    this.state.selectedActions.length.toString();
            } else {
                bulkOpsContainer.classList.remove("active");
            }
        }
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
            '<i class="bi bi-hourglass-split"></i> Deleting...';
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
                    errorCount > 0 ? "warning" : "success",
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
            this.updateBulkOperationsUI();
        }
    }

    private updateFilteredCount() {
        const filteredCountEl = document.getElementById("filteredActionsCount");
        if (filteredCountEl) {
            filteredCountEl.textContent =
                this.state.filteredActions.length.toString();
        }
    }

    private renderUI() {
        this.renderActions();
        this.updateViewModeUI();
    }

    private renderActions() {
        const container = document.getElementById("actionsContainer")!;

        if (this.state.loading) {
            this.showLoadingState();
            return;
        }

        if (this.state.error) {
            this.showErrorState();
            return;
        }

        if (this.state.filteredActions.length === 0) {
            if (this.state.allActions.length === 0) {
                this.showEmptyState();
            } else {
                this.showNoResultsState();
            }
            return;
        }

        // Create grid container
        const gridContainer = document.createElement("div");
        gridContainer.className =
            this.state.viewMode === "grid" ? "actions-grid" : "actions-list";

        // Render action cards
        this.state.filteredActions.forEach((action, index) => {
            const actionCard = this.createActionCard(action, index);
            gridContainer.appendChild(actionCard);
        });

        container.innerHTML = "";
        container.appendChild(gridContainer);

        // Add fade-in animation
        gridContainer.classList.add("fade-in");

        // Highlight syntax if Prism is available
        if (window.Prism) {
            window.Prism.highlightAll();
        }

        this.updateFilteredCount();
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
                <div class="action-info">
                    <div class="form-check" style="margin-bottom: 0.5rem;">
                        <input class="form-check-input action-checkbox" type="checkbox" 
                               data-action-checkbox="${action.id || action.name}" 
                               ${isSelected ? "checked" : ""}>
                    </div>
                    <h3 class="action-title">${this.escapeHtml(action.name)}</h3>
                    <p class="action-description">${this.escapeHtml(action.description || "No description available")}</p>
                    <div class="action-meta">
                        <span class="badge badge-author ${action.author}">${action.author === "user" ? "Custom" : "Discovered"}</span>
                        ${domain ? `<span class="badge badge-domain">${this.escapeHtml(domain)}</span>` : ""}
                        <span class="badge badge-category">${category}</span>
                    </div>
                </div>
                <div class="action-controls">
                    <button data-action="view" title="View details">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button data-action="edit" title="Edit action">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button data-action="delete" title="Delete action">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
            ${stats.count > 0 || stats.lastUsed ? this.createUsageStats(stats) : ""}
        `;

        // Add event listeners
        this.attachCardEventListeners(card, action, index);

        return card;
    }

    private createUsageStats(stats: {
        count: number;
        lastUsed: Date | null;
    }): string {
        return `
            <div class="usage-stats">
                ${
                    stats.count > 0
                        ? `
                    <div class="usage-stat">
                        <i class="bi bi-graph-up"></i>
                        <span>Used ${stats.count} times</span>
                    </div>
                `
                        : ""
                }
                ${
                    stats.lastUsed
                        ? `
                    <div class="usage-stat">
                        <i class="bi bi-clock"></i>
                        <span>Last used ${this.formatRelativeDate(stats.lastUsed)}</span>
                    </div>
                `
                        : ""
                }
            </div>
        `;
    }

    private attachCardEventListeners(
        card: HTMLElement,
        action: any,
        index: number,
    ) {
        // Checkbox selection
        const checkbox = card.querySelector(
            ".action-checkbox",
        ) as HTMLInputElement;
        checkbox?.addEventListener("change", (e) => {
            this.toggleActionSelection(
                action.id || action.name,
                (e.target as HTMLInputElement).checked,
            );
        });

        // Action buttons
        const viewBtn = card.querySelector('[data-action="view"]');
        const editBtn = card.querySelector('[data-action="edit"]');
        const deleteBtn = card.querySelector('[data-action="delete"]');

        viewBtn?.addEventListener("click", () => {
            this.viewActionDetails(action);
        });

        editBtn?.addEventListener("click", () => {
            this.editAction(action);
        });

        deleteBtn?.addEventListener("click", () => {
            this.deleteAction(action.id || action.name, action.name);
        });
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

        this.updateBulkOperationsUI();
    }

    private viewActionDetails(action: any) {
        // TODO: Implement action details modal
        console.log("View action details:", action);
        this.showNotification("Action details modal coming soon!", "info");
    }

    private editAction(action: any) {
        // TODO: Implement action editing
        console.log("Edit action:", action);
        this.showNotification("Action editing coming soon!", "info");
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

    private showLoadingState() {
        const container = document.getElementById("actionsContainer")!;
        container.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <h6>Loading Actions</h6>
                <p>Please wait while we load your action library...</p>
            </div>
        `;
    }

    private showEmptyState() {
        const container = document.getElementById("actionsContainer")!;
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-collection"></i>
                <h6>No Actions Yet</h6>
                <p>You haven't created any actions yet. Use the browser sidepanel to discover and create actions for web pages.</p>
            </div>
        `;
    }

    private showNoResultsState() {
        const container = document.getElementById("actionsContainer")!;
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-search"></i>
                <h6>No Actions Found</h6>
                <p>No actions match your current search and filter criteria.</p>
                <button id="clearFiltersFromEmpty" class="btn btn-primary">
                    <i class="bi bi-funnel"></i> Clear Filters
                </button>
            </div>
        `;

        // Add event listener for the clear filters button
        const clearBtn = container.querySelector("#clearFiltersFromEmpty");
        clearBtn?.addEventListener("click", () => {
            this.clearFilters();
        });
    }

    private showErrorState() {
        const container = document.getElementById("actionsContainer")!;
        container.innerHTML = `
            <div class="error-state">
                <i class="bi bi-exclamation-triangle"></i>
                <h6>Error Loading Actions</h6>
                <p>${this.state.error}</p>
                <button id="retryFromError" class="btn btn-primary">
                    <i class="bi bi-arrow-clockwise"></i> Try Again
                </button>
            </div>
        `;

        // Add event listener for the try again button
        const retryBtn = container.querySelector("#retryFromError");
        retryBtn?.addEventListener("click", () => {
            this.loadAllActions();
        });
    }

    private showNotification(
        message: string,
        type: "success" | "error" | "warning" | "info" = "info",
    ) {
        const toast = document.createElement("div");
        toast.className = `alert alert-${type === "error" ? "danger" : type} alert-dismissible position-fixed`;
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
        }, 5000);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
    const app = new ActionIndexApp();
    await app.initialize();
});

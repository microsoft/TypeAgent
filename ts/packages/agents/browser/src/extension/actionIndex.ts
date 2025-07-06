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
    };
    
    // UI State
    loading: boolean;
    error: string | null;
    
    // Statistics
    totalActions: number;
    totalDomains: number;
    userActionsCount: number;
}

class ActionIndexPanel {
    private state: ActionIndexState = {
        allActions: [],
        filteredActions: [],
        searchQuery: "",
        filters: {
            author: "all",
            domain: "all",
            category: "all"
        },
        loading: false,
        error: null,
        totalActions: 0,
        totalDomains: 0,
        userActionsCount: 0
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
        const searchInput = document.getElementById("searchInput") as HTMLInputElement;
        searchInput.addEventListener("input", (e) => {
            const query = (e.target as HTMLInputElement).value;
            this.handleSearch(query);
        });

        // Clear search
        document.getElementById("clearSearchBtn")!.addEventListener("click", () => {
            searchInput.value = "";
            this.handleSearch("");
        });

        // Filter controls
        document.getElementById("authorFilter")!.addEventListener("change", (e) => {
            this.state.filters.author = (e.target as HTMLSelectElement).value;
            this.applyFilters();
        });

        document.getElementById("domainFilter")!.addEventListener("change", (e) => {
            this.state.filters.domain = (e.target as HTMLSelectElement).value;
            this.applyFilters();
        });

        document.getElementById("categoryFilter")!.addEventListener("change", (e) => {
            this.state.filters.category = (e.target as HTMLSelectElement).value;
            this.applyFilters();
        });

        // Clear filters
        document.getElementById("clearFiltersBtn")!.addEventListener("click", () => {
            this.clearFilters();
        });

        // Refresh actions
        document.getElementById("refreshActionsBtn")!.addEventListener("click", () => {
            this.loadAllActions();
        });

        // Create new action - open discovery panel
        document.getElementById("createActionBtn")!.addEventListener("click", (e) => {
            e.preventDefault();
            this.openDiscoveryPanel();
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

    private clearFilters() {
        this.state.filters = {
            author: "all",
            domain: "all", 
            category: "all"
        };
        
        // Reset UI controls
        (document.getElementById("authorFilter") as HTMLSelectElement).value = "all";
        (document.getElementById("domainFilter") as HTMLSelectElement).value = "all";
        (document.getElementById("categoryFilter") as HTMLSelectElement).value = "all";
        
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

    private updateStatistics() {
        this.state.totalActions = this.state.allActions.length;
        this.state.userActionsCount = this.state.allActions.filter(
            action => action.author === "user"
        ).length;
        
        // Count unique domains
        const domains = new Set();
        this.state.allActions.forEach(action => {
            if (action.scope?.pattern || action.urlPattern) {
                try {
                    const url = action.scope?.pattern || action.urlPattern;
                    const domain = new URL(url).hostname;
                    domains.add(domain);
                } catch {
                    // If URL parsing fails, try to extract domain from pattern
                    const pattern = action.scope?.pattern || action.urlPattern;
                    const domainMatch = pattern.match(/(?:https?:\/\/)?([^\/\*]+)/);
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
        document.getElementById("totalActionsCount")!.textContent = this.state.totalActions.toString();
        document.getElementById("domainsCount")!.textContent = this.state.totalDomains.toString();
        document.getElementById("userActionsCount")!.textContent = this.state.userActionsCount.toString();
    }

    private populateFilterDropdowns() {
        // Populate domain filter
        const domainFilter = document.getElementById("domainFilter") as HTMLSelectElement;
        const domains = new Set<string>();
        
        this.state.allActions.forEach(action => {
            if (action.scope?.pattern || action.urlPattern) {
                try {
                    const url = action.scope?.pattern || action.urlPattern;
                    const domain = new URL(url).hostname;
                    domains.add(domain);
                } catch {
                    const pattern = action.scope?.pattern || action.urlPattern;
                    const domainMatch = pattern.match(/(?:https?:\/\/)?([^\/\*]+)/);
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
        Array.from(domains).sort().forEach(domain => {
            const option = document.createElement("option");
            option.value = domain;
            option.textContent = domain;
            domainFilter.appendChild(option);
        });

        // Populate category filter (basic categories based on action names/descriptions)
        const categoryFilter = document.getElementById("categoryFilter") as HTMLSelectElement;
        const categories = this.extractCategories();
        
        // Clear existing options except "All Categories"  
        while (categoryFilter.children.length > 1) {
            categoryFilter.removeChild(categoryFilter.lastChild!);
        }

        categories.forEach(category => {
            const option = document.createElement("option");
            option.value = category;
            option.textContent = category;
            categoryFilter.appendChild(option);
        });
    }

    private extractCategories(): string[] {
        const categories = new Set<string>();
        
        this.state.allActions.forEach(action => {
            // Basic categorization based on action names and descriptions
            const text = `${action.name} ${action.description || ""}`.toLowerCase();
            
            if (text.includes("search") || text.includes("find")) {
                categories.add("Search");
            } else if (text.includes("login") || text.includes("sign in") || text.includes("auth")) {
                categories.add("Authentication"); 
            } else if (text.includes("form") || text.includes("submit") || text.includes("input")) {
                categories.add("Form Interaction");
            } else if (text.includes("click") || text.includes("button") || text.includes("link")) {
                categories.add("Navigation");
            } else if (text.includes("cart") || text.includes("buy") || text.includes("purchase") || text.includes("order")) {
                categories.add("E-commerce");
            } else if (text.includes("download") || text.includes("upload") || text.includes("file")) {
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
            filtered = filtered.filter(action => 
                action.name.toLowerCase().includes(this.state.searchQuery) ||
                (action.description && action.description.toLowerCase().includes(this.state.searchQuery))
            );
        }

        // Apply author filter
        if (this.state.filters.author !== "all") {
            filtered = filtered.filter(action => action.author === this.state.filters.author);
        }

        // Apply domain filter
        if (this.state.filters.domain !== "all") {
            filtered = filtered.filter(action => {
                if (action.scope?.pattern || action.urlPattern) {
                    try {
                        const url = action.scope?.pattern || action.urlPattern;
                        const domain = new URL(url).hostname;
                        return domain === this.state.filters.domain;
                    } catch {
                        const pattern = action.scope?.pattern || action.urlPattern;
                        return pattern.includes(this.state.filters.domain);
                    }
                }
                return false;
            });
        }

        // Apply category filter
        if (this.state.filters.category !== "all") {
            filtered = filtered.filter(action => {
                const text = `${action.name} ${action.description || ""}`.toLowerCase();
                const category = this.state.filters.category.toLowerCase();
                
                switch (category) {
                    case "search":
                        return text.includes("search") || text.includes("find");
                    case "authentication":
                        return text.includes("login") || text.includes("sign in") || text.includes("auth");
                    case "form interaction":
                        return text.includes("form") || text.includes("submit") || text.includes("input");
                    case "navigation":
                        return text.includes("click") || text.includes("button") || text.includes("link");
                    case "e-commerce":
                        return text.includes("cart") || text.includes("buy") || text.includes("purchase") || text.includes("order");
                    case "file operations":
                        return text.includes("download") || text.includes("upload") || text.includes("file");
                    case "other":
                        return !text.match(/search|find|login|sign in|auth|form|submit|input|click|button|link|cart|buy|purchase|order|download|upload|file/);
                    default:
                        return true;
                }
            });
        }

        this.state.filteredActions = filtered;
        this.renderActionsList();
        this.updateFilteredCount();
    }

    private updateFilteredCount() {
        document.getElementById("filteredActionsCount")!.textContent = this.state.filteredActions.length.toString();
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
        
        this.state.filteredActions.forEach((action, index) => {
            const actionCard = this.createActionCard(action, index);
            container.appendChild(actionCard);
        });

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

        card.innerHTML = `
            <div class="action-card-header">
                <div class="action-info">
                    <h6 class="action-name">${this.escapeHtml(action.name)}</h6>
                    <p class="action-description">${this.escapeHtml(action.description || "No description available")}</p>
                    <div class="action-meta">
                        <span class="badge-author ${action.author}">${action.author === "user" ? "Custom" : "Discovered"}</span>
                        ${domain ? `<span class="badge-domain">${this.escapeHtml(domain)}</span>` : ""}
                        <small class="text-muted">${category}</small>
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
            <div class="action-details collapse" id="actionDetails${index}">
                <!-- Details will be populated when expanded -->
            </div>
        `;

        // Add event listeners
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
        if (text.includes("login") || text.includes("sign in") || text.includes("auth")) return "Authentication";
        if (text.includes("form") || text.includes("submit") || text.includes("input")) return "Form";
        if (text.includes("click") || text.includes("button") || text.includes("link")) return "Navigation";
        if (text.includes("cart") || text.includes("buy") || text.includes("purchase")) return "E-commerce";
        if (text.includes("download") || text.includes("upload") || text.includes("file")) return "File";
        
        return "General";
    }

    private viewActionDetails(action: any, index: number) {
        const detailsContainer = document.getElementById(`actionDetails${index}`);
        if (!detailsContainer) return;

        // Toggle details
        if (detailsContainer.classList.contains("show")) {
            detailsContainer.classList.remove("show");
            return;
        }

        // Populate details if not already done
        if (!detailsContainer.innerHTML.trim()) {
            detailsContainer.innerHTML = this.createActionDetailsContent(action);
        }

        detailsContainer.classList.add("show");

        // Highlight syntax
        if (window.Prism) {
            window.Prism.highlightAll();
        }
    }

    private createActionDetailsContent(action: any): string {
        const steps = action.context?.recordedSteps || action.steps || [];
        const intentSchema = action.definition?.intentSchema || action.intentSchema || "No intent schema available";
        const actionSteps = action.definition?.actionSteps || action.actionsJson || {};

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
                ${steps.map((step, index) => `
                    <div class="timeline-item mb-2">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <strong>${index + 1}. ${step.type || 'Unknown'}</strong>
                                <div class="text-muted small">
                                    ${step.selector ? `Selector: ${step.selector}` : ''}
                                    ${step.value ? `Value: ${step.value}` : ''}
                                </div>
                            </div>
                            <small class="text-muted">
                                ${step.timestamp ? new Date(step.timestamp).toLocaleTimeString() : ''}
                            </small>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    private async deleteAction(actionId: string, actionName: string) {
        if (!confirm(`Are you sure you want to delete the action "${actionName}"? This cannot be undone.`)) {
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                type: "deleteAction",
                actionId: actionId
            });

            if (response?.success) {
                this.showNotification(`Action "${actionName}" deleted successfully!`, "success");
                await this.loadAllActions(); // Refresh the list
            } else {
                throw new Error(response?.error || "Failed to delete action");
            }
        } catch (error) {
            console.error("Error deleting action:", error);
            this.showNotification(`Failed to delete action: ${error}`, "error");
        }
    }

    private async openDiscoveryPanel() {
        try {
            // Get current window
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0) {
                // Set sidepanel to discovery panel
                await chrome.sidePanel.setOptions({
                    tabId: tabs[0].id!,
                    path: "sidepanel.html",
                    enabled: true,
                });
            }
        } catch (error) {
            console.error("Error opening discovery panel:", error);
            this.showNotification("Failed to open discovery panel", "error");
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
                <p class="mb-3">You haven't created any actions yet. Get started by creating your first action!</p>
                ${this.createButton(
                    '<i class="bi bi-plus-circle"></i> Create Your First Action',
                    "btn btn-primary",
                    { "data-action": "create-first" }
                )}
            </div>
        `;
        
        // Add event listener for the create button
        const createBtn = container.querySelector('[data-action="create-first"]');
        createBtn?.addEventListener("click", () => {
            this.openDiscoveryPanel();
        });
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
                    { "data-action": "clear-filters" }
                )}
            </div>
        `;
        
        // Add event listener for the clear filters button
        const clearBtn = container.querySelector('[data-action="clear-filters"]');
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
                    { "data-action": "try-again" }
                )}
            </div>
        `;
        
        // Add event listener for the try again button
        const tryAgainBtn = container.querySelector('[data-action="try-again"]');
        tryAgainBtn?.addEventListener("click", () => {
            this.loadAllActions();
        });
    }

    private showNotification(message: string, type: "success" | "error" | "info" = "info") {
        const toast = document.createElement("div");
        toast.className = `alert alert-${type === "error" ? "danger" : type === "success" ? "success" : "info"} alert-dismissible position-fixed`;
        toast.style.cssText = "top: 20px; right: 20px; z-index: 1050; min-width: 300px;";

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
        const div = document.createElement('div');
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
}

// Initialize the panel when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
    const panel = new ActionIndexPanel();
    await panel.initialize();
});
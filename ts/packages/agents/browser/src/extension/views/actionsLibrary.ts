// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { 
    getActionsForUrl, 
    getAllActions, 
    getActionDomains,
    deleteAction,
    deleteMultipleActions,
    showNotification,
    showLoadingState,
    showEmptyState,
    showErrorState,
    showConfirmationDialog,
    extractDomain,
    categorizeAction,
    formatRelativeDate,
    escapeHtml,
    extractCategories,
    filterActions
} from "./actionUtilities";

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
    viewMode: "grid" | "list";
    selectedActions: string[];
    loading: boolean;
    error: string | null;
}

class ActionIndexApp {
    private viewHostUrl: string | null = null;
    private state: ActionIndexState = {
        allActions: [],
        filteredActions: [],
        searchQuery: "",
        filters: {
            author: "all",
            domain: "all",
            category: "all",
        },
        viewMode: "grid",
        selectedActions: [],
        loading: false,
        error: null,
    };

    private searchTimeout: number | null = null;

    async initialize() {
        console.log("Initializing Action Index App");

        this.viewHostUrl = await this.getViewHostUrl();

        this.setupEventListeners();
        await this.loadAllActions();
        this.renderUI();
    }

    private async getViewHostUrl(): Promise<string | null> {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getViewHostUrl",
            });
            return response?.url || null;
        } catch (error) {
            console.error("Failed to get view host URL:", error);
            return null;
        }
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
        const container = document.getElementById("actionsContainer")!;
        showLoadingState(container, "Loading Actions");

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
            const container = document.getElementById("actionsContainer")!;
            showErrorState(container, this.state.error);
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
        const categories = extractCategories(this.state.allActions);

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



    private applyFilters() {
        this.state.filteredActions = filterActions(this.state.allActions, {
            searchQuery: this.state.searchQuery,
            author: this.state.filters.author,
            domain: this.state.filters.domain,
            category: this.state.filters.category,
        });

        this.renderActions();
        this.updateFilteredCount();
    }







    private clearFilters() {
        this.state.filters = {
            author: "all",
            domain: "all",
            category: "all",
        };

        // Reset UI controls
        (document.getElementById("authorFilter") as HTMLSelectElement).value =
            "all";
        (document.getElementById("domainFilter") as HTMLSelectElement).value =
            "all";
        (document.getElementById("categoryFilter") as HTMLSelectElement).value =
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
            showNotification("No actions selected for deletion", "error");
            return;
        }

        const confirmed = await showConfirmationDialog(
            `Are you sure you want to delete ${this.state.selectedActions.length} selected action(s)? This cannot be undone.`
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
            const result = await deleteMultipleActions(this.state.selectedActions);
            
            if (result.successCount > 0) {
                showNotification(
                    `Successfully deleted ${result.successCount} action(s)${result.errorCount > 0 ? `, ${result.errorCount} failed` : ""}`,
                    result.errorCount > 0 ? "warning" : "success",
                );
                this.state.selectedActions = [];
                await this.loadAllActions();
            } else {
                showNotification("Failed to delete any actions", "error");
            }
        } catch (error) {
            console.error("Error in bulk delete:", error);
            showNotification("Failed to delete actions", "error");
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
            const container = document.getElementById("actionsContainer")!;
            showLoadingState(container, "Loading Actions");
            return;
        }

        if (this.state.error) {
            const container = document.getElementById("actionsContainer")!;
            showErrorState(container, this.state.error);
            return;
        }

        if (this.state.filteredActions.length === 0) {
            const container = document.getElementById("actionsContainer")!;
            if (this.state.allActions.length === 0) {
                showEmptyState(
                    container,
                    "You haven't created any actions yet. Use the browser sidepanel to discover and create actions for web pages.",
                    "bi-collection"
                );
            } else {
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
                const clearBtn = container.querySelector("#clearFiltersFromEmpty");
                clearBtn?.addEventListener("click", () => {
                    this.clearFilters();
                });
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

        const domain = extractDomain(action);
        const category = categorizeAction(action);
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
                    <h3 class="action-title">${escapeHtml(action.name)}</h3>
                    <p class="action-description">${escapeHtml(action.description || "No description available")}</p>
                    <div class="action-meta">
                        <span class="badge badge-author ${action.author}">${action.author === "user" ? "Custom" : "Discovered"}</span>
                        ${domain ? `<span class="badge badge-domain">${escapeHtml(domain)}</span>` : ""}
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
        `;

        // Add event listeners
        this.attachCardEventListeners(card, action, index);

        return card;
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

    private async viewActionDetails(action: any) {
        try {
            if (!this.viewHostUrl) {
                showNotification("Loading view service...", "info");
                this.viewHostUrl = await this.getViewHostUrl();

                if (!this.viewHostUrl) {
                    showNotification(
                        "View service is not available",
                        "error",
                    );
                    return;
                }
            }

            if (action.author !== "user") {
                showNotification(
                    "Viewing is only available for user-defined actions",
                    "info",
                );
                return;
            }

            const actionId = action.id || action.name;
            if (!actionId) {
                showNotification("Invalid action ID", "error");
                return;
            }

            const viewUrl = `${this.viewHostUrl}/plans/?actionId=${encodeURIComponent(actionId)}&mode=viewAction`;
            this.showActionViewModal(action.name, viewUrl);
        } catch (error) {
            console.error("Error opening action view:", error);
            showNotification("Failed to open action view", "error");
        }
    }

    private showActionViewModal(actionTitle: string, iframeUrl: string) {
        const modal = document.getElementById(
            "actionDetailsModal",
        ) as HTMLElement;
        const modalTitle = document.getElementById(
            "actionDetailsModalTitle",
        ) as HTMLElement;
        const modalBody = document.getElementById(
            "actionDetailsModalBody",
        ) as HTMLElement;

        if (!modal || !modalTitle || !modalBody) {
            console.error("Modal elements not found");
            showNotification("Error opening action view", "error");
            return;
        }

        // Add action-view-modal class to hide header
        modal.classList.add('action-view-modal');

        modalTitle.textContent = actionTitle;

        const iframe = document.createElement("iframe");
        iframe.className = "action-view-iframe";
        iframe.src = iframeUrl;
        iframe.title = `View ${actionTitle}`;

        modalBody.innerHTML = "";
        modalBody.appendChild(iframe);

        // Set up message listener for iframe communication
        this.setupIframeMessageListener(modal, iframe);

        const bsModal = new (window as any).bootstrap.Modal(modal);
        bsModal.show();

        modal.addEventListener(
            "hidden.bs.modal",
            () => {
                modalBody.innerHTML = "";
                modal.classList.remove('action-view-modal');
                // Remove message listener
                window.removeEventListener('message', this.handleIframeMessage);
            },
            { once: true },
        );
    }

    private setupIframeMessageListener(modal: HTMLElement, iframe: HTMLIFrameElement) {
        this.handleIframeMessage = (event: MessageEvent) => {
            // Verify origin for security (optional but recommended)
            if (event.source !== iframe.contentWindow) {
                return;
            }

            if (event.data.type === 'closeModal') {
                const bsModal = (window as any).bootstrap.Modal.getInstance(modal);
                if (bsModal) {
                    bsModal.hide();
                }
            }
        };

        window.addEventListener('message', this.handleIframeMessage);
    }

    private handleIframeMessage: (event: MessageEvent) => void = () => {};

    private editAction(action: any) {
        // TODO: Implement action editing
        console.log("Edit action:", action);
        showNotification("Action editing coming soon!", "info");
    }

    private async deleteAction(actionId: string, actionName: string) {
        const confirmed = await showConfirmationDialog(
            `Are you sure you want to delete the action "${actionName}"? This cannot be undone.`
        );
        if (!confirmed) return;

        try {
            const result = await deleteAction(actionId);
            if (result.success) {
                showNotification(
                    `Action "${actionName}" deleted successfully!`,
                    "success",
                );
                await this.loadAllActions();
            } else {
                throw new Error(result.error || "Failed to delete action");
            }
        } catch (error) {
            console.error("Error deleting action:", error);
            showNotification(`Failed to delete action: ${error}`, "error");
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
    const app = new ActionIndexApp();
    await app.initialize();
});

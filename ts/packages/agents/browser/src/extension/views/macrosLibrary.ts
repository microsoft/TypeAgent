// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getMacrosForUrl,
    getAllMacros,
    getMacroDomains,
    deleteMacro,
    deleteMultipleMacros,
    showNotification,
    showLoadingState,
    showEmptyState,
    showErrorState,
    showConfirmationDialog,
    extractDomain,
    categorizeMacro,
    formatRelativeDate,
    escapeHtml,
    extractCategories,
    filterMacros,
} from "./macroUtilities";

declare global {
    interface Window {
        Prism: {
            highlightAll: () => void;
        };
    }
}

interface MacroIndexState {
    // Data
    allMacros: any[];
    filteredMacros: any[];
    searchQuery: string;
    filters: {
        author: string;
        domain: string;
        category: string;
    };

    // UI State
    viewMode: "grid" | "list";
    selectedMacros: string[];
    loading: boolean;
    error: string | null;
}

class MacroIndexApp {
    private viewHostUrl: string | null = null;
    private state: MacroIndexState = {
        allMacros: [],
        filteredMacros: [],
        searchQuery: "",
        filters: {
            author: "all",
            domain: "all",
            category: "all",
        },
        viewMode: "grid",
        selectedMacros: [],
        loading: false,
        error: null,
    };

    private searchTimeout: number | null = null;

    async initialize() {
        console.log("Initializing Macro Index App");

        this.viewHostUrl = await this.getViewHostUrl();

        this.setupEventListeners();
        await this.loadAllMacros();
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
                this.selectAllMacros();
            });

        document
            .getElementById("deselectAllBtn")!
            .addEventListener("click", () => {
                this.deselectAllMacros();
            });

        document
            .getElementById("bulkDeleteBtn")!
            .addEventListener("click", () => {
                this.bulkDeleteMacros();
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
        this.renderMacros();
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

    private async loadAllMacros() {
        this.state.loading = true;
        this.state.error = null;
        const container = document.getElementById("macrosContainer")!;
        showLoadingState(container, "Loading Macros");

        try {
            // Get all macros across all URLs
            const macros = await getAllMacros();
            this.state.allMacros = macros;

            // Populate filter dropdowns
            this.populateFilterDropdowns();

            // Apply current filters
            this.applyFilters();
        } catch (error) {
            console.error("Error loading macros:", error);
            this.state.error = "Failed to load macros. Please try again.";
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

        this.state.allMacros.forEach((macro) => {
            const domain = extractDomain(macro);
            if (domain) {
                domains.add(domain);
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
        const categories = extractCategories(this.state.allMacros);

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
        this.state.filteredMacros = filterMacros(this.state.allMacros, {
            searchQuery: this.state.searchQuery,
            author: this.state.filters.author,
            domain: this.state.filters.domain,
            category: this.state.filters.category,
        });

        this.renderMacros();
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
    private selectAllMacros() {
        this.state.selectedMacros = this.state.filteredMacros.map(
            (macro) => macro.id || macro.name,
        );
        this.updateBulkOperationsUI();
        this.updateMacroSelectionUI();
    }

    private deselectAllMacros() {
        this.state.selectedMacros = [];
        this.updateBulkOperationsUI();
        this.updateMacroSelectionUI();
    }

    private updateBulkOperationsUI() {
        const bulkOpsContainer = document.getElementById(
            "bulkOperationsContainer",
        );
        const selectedCountEl = document.getElementById("selectedActionsCount");
        const deselectBtn = document.getElementById(
            "deselectAllBtn",
        ) as HTMLButtonElement;
        const deleteBtn = document.getElementById(
            "bulkDeleteBtn",
        ) as HTMLButtonElement;

        if (bulkOpsContainer && selectedCountEl) {
            if (this.state.selectedMacros.length > 0) {
                bulkOpsContainer.classList.add("active");
                selectedCountEl.textContent =
                    this.state.selectedMacros.length.toString();

                // Show deselect and delete buttons when items are selected
                if (deselectBtn) deselectBtn.style.display = "inline-block";
                if (deleteBtn) deleteBtn.style.display = "inline-block";
            } else {
                bulkOpsContainer.classList.remove("active");

                // Hide deselect and delete buttons when no items are selected
                if (deselectBtn) deselectBtn.style.display = "none";
                if (deleteBtn) deleteBtn.style.display = "none";
            }
        }
    }

    private updateMacroSelectionUI() {
        // Update checkboxes in the UI
        this.state.filteredMacros.forEach((macro) => {
            const checkbox = document.querySelector(
                `[data-macro-checkbox="${macro.id || macro.name}"]`,
            ) as HTMLInputElement;
            if (checkbox) {
                checkbox.checked = this.state.selectedMacros.includes(
                    macro.id || macro.name,
                );
            }
        });
    }

    private async bulkDeleteMacros() {
        if (this.state.selectedMacros.length === 0) {
            showNotification("No macros selected for deletion", "error");
            return;
        }

        const confirmed = await showConfirmationDialog(
            `Are you sure you want to delete ${this.state.selectedMacros.length} selected macro(s)? This cannot be undone.`,
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
            const result = await deleteMultipleMacros(
                this.state.selectedMacros,
            );

            if (result.successCount > 0) {
                showNotification(
                    `Successfully deleted ${result.successCount} macro(s)${result.errorCount > 0 ? `, ${result.errorCount} failed` : ""}`,
                    result.errorCount > 0 ? "warning" : "success",
                );
                this.state.selectedMacros = [];
                await this.loadAllMacros();
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

    private renderUI() {
        this.renderMacros();
        this.updateViewModeUI();
    }

    private renderMacros() {
        const container = document.getElementById("macrosContainer")!;

        if (this.state.loading) {
            const container = document.getElementById("macrosContainer")!;
            showLoadingState(container, "Loading Macros");
            return;
        }

        if (this.state.error) {
            const container = document.getElementById("macrosContainer")!;
            showErrorState(container, this.state.error);
            return;
        }

        if (this.state.filteredMacros.length === 0) {
            const container = document.getElementById("macrosContainer")!;
            if (this.state.allMacros.length === 0) {
                showEmptyState(
                    container,
                    "You haven't created any macros yet. Use the browser sidepanel to discover and create macros for web pages.",
                    "bi-collection",
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
                const clearBtn = container.querySelector(
                    "#clearFiltersFromEmpty",
                );
                clearBtn?.addEventListener("click", () => {
                    this.clearFilters();
                });
            }
            return;
        }

        // Create grid container
        const gridContainer = document.createElement("div");
        gridContainer.className =
            this.state.viewMode === "grid" ? "macros-grid" : "macros-list";

        // Render macro cards
        this.state.filteredMacros.forEach((macro, index) => {
            const macroCard = this.createMacroCard(macro, index);
            gridContainer.appendChild(macroCard);
        });

        container.innerHTML = "";
        container.appendChild(gridContainer);

        // Add fade-in animation
        gridContainer.classList.add("fade-in");

        // Highlight syntax if Prism is available
        if (window.Prism) {
            window.Prism.highlightAll();
        }
    }
    private createMacroCard(macro: any, index: number): HTMLElement {
        const card = document.createElement("div");
        card.className = "macro-card";
        card.setAttribute("data-macro-id", macro.id || macro.name);

        const domain = extractDomain(macro);
        const category = categorizeMacro(macro);
        const isSelected = this.state.selectedMacros.includes(
            macro.id || macro.name,
        );

        card.innerHTML = `
            <div class="macro-card-header">
                <div class="macro-info">
                    <div class="form-check" style="margin-bottom: 0.5rem;">
                        <input class="form-check-input macro-checkbox" type="checkbox" 
                               data-macro-checkbox="${macro.id || macro.name}" 
                               ${isSelected ? "checked" : ""}>
                    </div>
                    <h3 class="macro-title">${escapeHtml(macro.name)}</h3>
                    <p class="macro-description">${escapeHtml(macro.description || "No description available")}</p>
                    <div class="macro-meta">
                        <span class="badge badge-author ${macro.author}">${macro.author === "user" ? "Custom" : "Discovered"}</span>
                        ${domain ? `<span class="badge badge-domain">${escapeHtml(domain)}</span>` : ""}
                        <span class="badge badge-category">${category}</span>
                    </div>
                </div>
                <div class="macro-controls">
                    <button data-action="view" title="View details">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button data-action="edit" title="Edit macro">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button data-action="delete" title="Delete macro">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        `;

        // Add event listeners
        this.attachCardEventListeners(card, macro, index);

        return card;
    }

    private attachCardEventListeners(
        card: HTMLElement,
        macro: any,
        index: number,
    ) {
        // Checkbox selection
        const checkbox = card.querySelector(
            ".macro-checkbox",
        ) as HTMLInputElement;
        checkbox?.addEventListener("change", (e) => {
            this.toggleMacroSelection(
                macro.id || macro.name,
                (e.target as HTMLInputElement).checked,
            );
        });

        // Macro buttons
        const viewBtn = card.querySelector('[data-action="view"]');
        const editBtn = card.querySelector('[data-action="edit"]');
        const deleteBtn = card.querySelector('[data-action="delete"]');

        viewBtn?.addEventListener("click", () => {
            this.viewMacroDetails(macro);
        });

        editBtn?.addEventListener("click", () => {
            this.editMacro(macro);
        });

        deleteBtn?.addEventListener("click", () => {
            this.deleteMacro(macro.id || macro.name, macro.name);
        });
    }

    private toggleMacroSelection(macroId: string, selected: boolean) {
        if (selected) {
            if (!this.state.selectedMacros.includes(macroId)) {
                this.state.selectedMacros.push(macroId);
            }
        } else {
            this.state.selectedMacros = this.state.selectedMacros.filter(
                (id) => id !== macroId,
            );
        }

        this.updateBulkOperationsUI();
    }

    private async viewMacroDetails(macro: any) {
        try {
            if (!this.viewHostUrl) {
                showNotification("Loading view service...", "info");
                this.viewHostUrl = await this.getViewHostUrl();

                if (!this.viewHostUrl) {
                    showNotification("View service is not available", "error");
                    return;
                }
            }

            if (macro.author !== "user") {
                showNotification(
                    "Viewing is only available for user-defined actions",
                    "info",
                );
                return;
            }

            const actionId = macro.id || macro.name;
            if (!actionId) {
                showNotification("Invalid action ID", "error");
                return;
            }

            const viewUrl = `${this.viewHostUrl}/plans/?actionId=${encodeURIComponent(actionId)}&mode=viewAction`;
            this.showActionViewModal(macro.name, viewUrl);
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
        modal.classList.add("action-view-modal");

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
                modal.classList.remove("action-view-modal");
                // Remove message listener
                window.removeEventListener("message", this.handleIframeMessage);
            },
            { once: true },
        );
    }

    private setupIframeMessageListener(
        modal: HTMLElement,
        iframe: HTMLIFrameElement,
    ) {
        this.handleIframeMessage = (event: MessageEvent) => {
            // Verify origin for security (optional but recommended)
            if (event.source !== iframe.contentWindow) {
                return;
            }

            if (event.data.type === "closeModal") {
                const bsModal = (window as any).bootstrap.Modal.getInstance(
                    modal,
                );
                if (bsModal) {
                    bsModal.hide();
                }
            }
        };

        window.addEventListener("message", this.handleIframeMessage);
    }

    private handleIframeMessage: (event: MessageEvent) => void = () => {};

    private editMacro(macro: any) {
        // TODO: Implement macro editing
        console.log("Edit macro:", macro);
        showNotification("Macro editing coming soon!", "info");
    }

    private async deleteMacro(macroId: string, macroName: string) {
        const confirmed = await showConfirmationDialog(
            `Are you sure you want to delete the macro "${macroName}"? This cannot be undone.`,
        );
        if (!confirmed) return;

        try {
            const result = await deleteMacro(macroId);
            if (result.success) {
                showNotification(
                    `Macro "${macroName}" deleted successfully!`,
                    "success",
                );
                await this.loadAllMacros();
            } else {
                throw new Error(result.error || "Failed to delete macro");
            }
        } catch (error) {
            console.error("Error deleting action:", error);
            showNotification(`Failed to delete action: ${error}`, "error");
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
    const app = new MacroIndexApp();
    await app.initialize();
});

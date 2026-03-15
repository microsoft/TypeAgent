// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    refreshSchema as refreshSchemaRpc,
    startRecording,
    stopRecording,
    captureHtmlFragments,
    registerTempSchema as registerTempSchemaRpc,
    createWebFlowFromRecording,
    getWebFlowsForDomain,
    deleteWebFlow,
    checkConnection,
    showNotification,
    showLoadingState,
    showEmptyState,
    showErrorState,
    showConfirmationDialog,
    escapeHtml,
    createButton,
    getDomainFromUrl,
} from "./macroUtilities";

let recording = false;
let recordedMacros: any[] = [];
let launchUrl: string | null = "";
let autoDiscoveryEnabled = false;

declare global {
    interface Window {
        Prism: {
            highlightAll: () => void;
        };
    }
}

interface ConnectionStatus {
    connected: boolean;
    recording: boolean;
}

class ActionDiscoveryPanel {
    private connectionStatus: ConnectionStatus = {
        connected: false,
        recording: false,
    };

    async initialize() {
        console.log("Initializing Action Discovery Panel");

        this.setupEventListeners();
        launchUrl = await this.getActiveTabUrl();
        await this.updateConnectionStatus();
        await this.loadAutoDiscoverySettings();

        // Only run schema update for HTTP/HTTPS URLs
        if (
            launchUrl &&
            (launchUrl.startsWith("http://") ||
                launchUrl.startsWith("https://"))
        ) {
            await this.requestSchemaUpdate();
        } else {
            console.log(
                "Skipping initial schema update for non-HTTP/HTTPS URL:",
                launchUrl,
            );
            const itemsList = document.getElementById(
                "detectedSchemaItemsList",
            ) as HTMLElement;
            showEmptyState(
                itemsList,
                "Action detection not available for this page type",
                "bi-exclamation-circle",
            );
        }

        await this.updateUserActionsUI();
    }

    private setupEventListeners() {
        document
            .getElementById("refreshDetectedActions")!
            .addEventListener("click", () => this.requestSchemaUpdate(true));

        document
            .getElementById("addPageAction")!
            .addEventListener("click", () => this.toggleActionForm());

        document
            .getElementById("clearRecordedActions")!
            .addEventListener("click", () => this.clearRecordedUserAction());

        document
            .getElementById("autoDiscoveryToggle")!
            .addEventListener("change", (e) => {
                const checkbox = e.target as HTMLInputElement;
                this.toggleAutoDiscovery(checkbox.checked);
            });

        chrome.tabs.onActivated.addListener(() => {
            this.onTabChange();
        });

        // Listen for macro changes from the backend
        chrome.runtime.onMessage.addListener(
            (message, sender, sendResponse) => {
                if (
                    message.type === "macroAdded" ||
                    message.type === "macroDeleted" ||
                    message.type === "macrosChanged"
                ) {
                    (async () => {
                        await this.updateUserActionsUI();
                        await this.registerTempSchema();
                    })().catch((error) => {
                        console.error(
                            "Error refreshing UI after macro change:",
                            error,
                        );
                    });
                }
                return false;
            },
        );
    }

    private async getActiveTabUrl(): Promise<string | null> {
        try {
            const tabs = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });
            return tabs.length > 0 ? tabs[0].url || null : null;
        } catch (error) {
            console.error("Error getting active tab URL:", error);
            return null;
        }
    }

    private async updateConnectionStatus() {
        const statusElement = document.getElementById("connectionStatus")!;

        try {
            const response = await checkConnection();
            this.connectionStatus.connected = response?.connected ?? true;
            // Hide connection status when connected
            statusElement.style.display = "none";
        } catch (error) {
            this.connectionStatus.connected = false;
            // Show disconnection warning
            statusElement.style.display = "block";
            statusElement.innerHTML = `
                <span class="status-indicator status-idle"></span>
                <span class="text-warning">Connection unavailable</span>
            `;
        }
    }

    private async loadAutoDiscoverySettings() {
        try {
            const settings = await chrome.storage.local.get(["autoDiscovery"]);
            autoDiscoveryEnabled = settings.autoDiscovery || false;
            const toggle = document.getElementById(
                "autoDiscoveryToggle",
            ) as HTMLInputElement;
            toggle.checked = autoDiscoveryEnabled;

            const toggleContainer = toggle.closest(
                ".form-check, .toggle-container, .auto-discovery-section",
            );
            if (toggleContainer) {
                (toggleContainer as HTMLElement).style.display = "none";
            } else {
                toggle.style.display = "none";
                const label = document.querySelector(
                    'label[for="autoDiscoveryToggle"]',
                );
                if (label) {
                    (label as HTMLElement).style.display = "none";
                }
            }
        } catch (error) {
            console.error("Error loading auto-discovery settings:", error);
        }
    }

    private async toggleAutoDiscovery(enabled: boolean) {
        autoDiscoveryEnabled = enabled;
        try {
            await chrome.storage.local.set({ autoDiscovery: enabled });
            if (enabled) {
                await this.requestSchemaUpdate(true);
            }
        } catch (error) {
            console.error("Error saving auto-discovery setting:", error);
        }
    }

    private async onTabChange() {
        launchUrl = await this.getActiveTabUrl();
        await this.updateConnectionStatus();

        if (
            autoDiscoveryEnabled &&
            launchUrl &&
            (launchUrl.startsWith("http://") ||
                launchUrl.startsWith("https://"))
        ) {
            await this.requestSchemaUpdate(true);
        } else if (autoDiscoveryEnabled) {
            console.log(
                "Skipping auto-discovery for non-HTTP/HTTPS URL:",
                launchUrl,
            );
            const itemsList = document.getElementById(
                "detectedSchemaItemsList",
            ) as HTMLElement;
            showEmptyState(
                itemsList,
                "Action detection not available for this page type",
                "bi-exclamation-circle",
            );
        }

        await this.updateUserActionsUI();
    }

    private async requestSchemaUpdate(forceRefresh?: boolean) {
        const itemsList = document.getElementById(
            "detectedSchemaItemsList",
        ) as HTMLElement;
        const refreshButton = document.getElementById(
            "refreshDetectedActions",
        ) as HTMLButtonElement;
        const originalHtml = refreshButton.innerHTML;

        // Skip action detection for non-HTTP/HTTPS protocols
        if (
            launchUrl &&
            !launchUrl.startsWith("http://") &&
            !launchUrl.startsWith("https://")
        ) {
            console.log(
                "Skipping action detection for non-HTTP/HTTPS URL:",
                launchUrl,
            );
            showEmptyState(
                itemsList,
                "Action detection not available for this page type",
                "bi-exclamation-circle",
            );
            return;
        }

        showLoadingState(itemsList, "Scanning ...");
        refreshButton.innerHTML =
            '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
        refreshButton.disabled = true;

        try {
            let currentActions: any[] = [];
            if (!forceRefresh && launchUrl) {
                const domain = getDomainFromUrl(launchUrl);
                if (domain) {
                    currentActions = (
                        await getWebFlowsForDomain(domain)
                    ).filter((a: any) => a.source?.type === "discovery");
                }
            }

            if (currentActions.length === 0 || forceRefresh) {
                const response = await refreshSchemaRpc();
                this.renderSchemaResults(response.schema ?? []);

                if (response.schema && response.schema.length > 0) {
                    console.log(
                        `Discovered and saved ${response.schema.length} actions`,
                    );
                }
            } else {
                const legacySchema = currentActions.map((action: any) => ({
                    actionName: action.name,
                    description: action.description,
                    parameters: action.parameters || {},
                }));
                this.renderSchemaResults(legacySchema);
            }

            await this.registerTempSchema();
        } catch (error) {
            console.error("Error updating schema:", error);
            showErrorState(itemsList, "Failed to scan page for actions");
        } finally {
            refreshButton.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
            refreshButton.disabled = false;
        }
    }

    private showActionDetails(action: any) {
        const modal = document.createElement("div");
        modal.className = "modal fade";
        modal.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${action.macroName}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <pre><code class="language-json">${JSON.stringify(action.parameters || {}, null, 2)}</code></pre>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const bsModal = new (window as any).bootstrap.Modal(modal);
        bsModal.show();

        modal.addEventListener("hidden.bs.modal", () => {
            document.body.removeChild(modal);
        });
    }

    private async registerTempSchema() {
        try {
            await registerTempSchemaRpc();
        } catch (error) {
            console.error("Error registering temp schema:", error);
        }
    }

    private toggleActionForm() {
        this.showActionModal();
    }

    private showActionModal() {
        // Create modal HTML
        const modalHtml = this.createActionModal();

        // Remove existing modal if any
        const existingModal = document.getElementById("actionModal");
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to body
        document.body.insertAdjacentHTML("beforeend", modalHtml);

        // Get modal element and initialize Bootstrap modal
        const modalElement = document.getElementById("actionModal")!;
        const modal = new (window as any).bootstrap.Modal(modalElement);

        // Setup modal event listeners
        this.setupModalEventListeners(modalElement, modal);

        // Show modal
        modal.show();

        // Clear form fields
        this.clearModalFormFields();
    }

    private createActionModal(): string {
        return `
            <div class="modal fade" id="actionModal" tabindex="-1" aria-labelledby="actionModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="actionModalLabel">
                                <i class="bi bi-gear"></i> Create New Action
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label class="form-label fw-semibold">Macro Name</label>
                                <input
                                    type="text"
                                    id="modalMacroName"
                                    class="form-control"
                                    placeholder="Enter a descriptive name for this macro"
                                    required
                                />
                            </div>

                            <div class="mb-3">
                                <label class="form-label fw-semibold">Macro Description</label>
                                <textarea
                                    id="modalActionStepsDescription"
                                    class="form-control"
                                    rows="4"
                                    placeholder="Describe how to complete this action step by step..."
                                ></textarea>
                            </div>

                            <div id="modalRecordingSection" class="mb-3">
                                <label class="form-label fw-semibold">Record Steps</label>
                                <div class="d-flex macro-controls align-items-center">
                                    <button
                                        id="modalRecordAction"
                                        class="btn btn-outline-danger"
                                        title="Start recording action steps"
                                    >
                                        <i class="bi bi-record-circle"></i> Start Recording
                                    </button>
                                    <button
                                        id="modalStopRecording"
                                        class="btn btn-danger d-none"
                                        title="Stop recording"
                                    >
                                        <i class="bi bi-stop-circle"></i> Stop Recording
                                    </button>
                                </div>
                            </div>

                            <div id="modalStepsTimelineContainer" class="mb-3 d-none">
                                <label class="form-label fw-semibold">Recorded Steps</label>
                                <div id="modalStepsTimeline" class="border rounded p-3 bg-white">
                                    <!-- Timeline items will be populated here -->
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">
                                <i class="bi bi-x-circle"></i> Cancel
                            </button>
                            <button type="button" id="modalSaveMacro" class="btn btn-primary">
                                <i class="bi bi-floppy"></i> Save Macro
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    private setupModalEventListeners(modalElement: HTMLElement, modal: any) {
        // Recording controls
        modalElement
            .querySelector("#modalRecordAction")!
            .addEventListener("click", () => {
                this.startModalRecording();
            });

        modalElement
            .querySelector("#modalStopRecording")!
            .addEventListener("click", () => {
                this.stopModalRecording();
            });

        // Save action
        modalElement
            .querySelector("#modalSaveMacro")!
            .addEventListener("click", () => {
                this.saveModalAction(modal);
            });

        // Handle modal close - stop recording if active
        modalElement.addEventListener("hidden.bs.modal", () => {
            if (recording) {
                this.stopModalRecording();
            }
            // Remove modal from DOM
            modalElement.remove();
        });
    }

    private clearModalFormFields() {
        const nameField = document.getElementById(
            "modalMacroName",
        ) as HTMLInputElement;
        const descField = document.getElementById(
            "modalActionStepsDescription",
        ) as HTMLTextAreaElement;

        if (nameField) nameField.value = "";
        if (descField) descField.value = "";

        const stepsContainer = document.getElementById(
            "modalStepsTimelineContainer",
        )!;
        if (stepsContainer) {
            stepsContainer.classList.add("d-none");
            stepsContainer.innerHTML = `<label class="form-label fw-semibold">Recorded Steps</label>
                  <div id="modalStepsTimeline" class="border rounded p-3 bg-white">
                  </div>
            `;
        }

        this.resetModalRecordingUI();
    }

    private resetModalRecordingUI() {
        const recordBtn = document.getElementById("modalRecordAction");
        const stopBtn = document.getElementById("modalStopRecording");

        if (recordBtn) recordBtn.classList.remove("d-none");
        if (stopBtn) stopBtn.classList.add("d-none");

        recording = false;
    }

    private async startModalRecording() {
        try {
            await startRecording();

            recording = true;
            const recordBtn = document.getElementById("modalRecordAction");
            const stopBtn = document.getElementById("modalStopRecording");

            if (recordBtn) recordBtn.classList.add("d-none");
            if (stopBtn) stopBtn.classList.remove("d-none");

            const stepsContainer = document.getElementById(
                "modalStepsTimelineContainer",
            )!;
            if (stepsContainer) {
                stepsContainer.dataset.steps = "";
                stepsContainer.dataset.screenshot = "";
                stepsContainer.dataset.html = "";
            }
        } catch (error) {
            console.error("Error starting recording:", error);
            showNotification("Failed to start recording", "error");
        }
    }

    private async stopModalRecording() {
        try {
            const response = await stopRecording();

            if (response && response.recordedActions) {
                const stepsContainer = document.getElementById(
                    "modalStepsTimelineContainer",
                )!;
                if (stepsContainer) {
                    stepsContainer.classList.remove("d-none");
                    stepsContainer.dataset.steps = JSON.stringify(
                        response.recordedActions,
                    );
                    stepsContainer.dataset.screenshot = JSON.stringify(
                        response.recordedActionScreenshot,
                    );
                    stepsContainer.dataset.html = JSON.stringify(
                        response.recordedActionHtml,
                    );

                    const timeline =
                        document.getElementById("modalStepsTimeline")!;
                    this.renderTimelineSteps(
                        response.recordedActions,
                        timeline,
                        response.recordedActionScreenshot,
                        response.recordedActionHtml,
                    );
                }
            }

            this.resetModalRecordingUI();
        } catch (error) {
            console.error("Error stopping recording:", error);
            showNotification("Failed to stop recording", "error");
            this.resetModalRecordingUI();
        }
    }

    private async saveModalAction(modal: any) {
        const nameField = document.getElementById(
            "modalMacroName",
        ) as HTMLInputElement;
        const macroName = nameField?.value.trim();
        const stepsDescription = (
            document.getElementById(
                "modalActionStepsDescription",
            ) as HTMLTextAreaElement
        )?.value.trim();

        if (!macroName) {
            showNotification("Please enter a macro name", "error");
            return;
        }

        const saveButton = document.getElementById(
            "modalSaveMacro",
        ) as HTMLButtonElement;
        const originalContent = saveButton?.innerHTML;

        if (saveButton) {
            saveButton.innerHTML =
                '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
            saveButton.disabled = true;
        }

        try {
            const stepsContainer = document.getElementById(
                "modalStepsTimelineContainer",
            )!;
            const steps = JSON.parse(stepsContainer?.dataset?.steps || "[]");
            const screenshot = JSON.parse(
                stepsContainer?.dataset?.screenshot || "[]",
            );
            let html = JSON.parse(stepsContainer?.dataset?.html || '""');

            if (!html || html === "[]") {
                const htmlFragments = await captureHtmlFragments();
                if (htmlFragments && htmlFragments.length > 0) {
                    html = [htmlFragments[0].content];
                }
            }

            // Get existing webFlow names to avoid duplicates
            const domain = getDomainFromUrl(launchUrl!);
            const existingFlows = domain
                ? await getWebFlowsForDomain(domain)
                : [];
            const existingActionNames: string[] = existingFlows.map(
                (f: any) => f.name,
            );

            // Create webFlow directly from recording (single LLM call)
            const response = await createWebFlowFromRecording({
                actionName: macroName,
                actionDescription: stepsDescription,
                steps: JSON.stringify(steps),
                existingActionNames,
                startUrl: launchUrl!,
                screenshots: screenshot,
                html: html.map((str: string) => ({ content: str, frameId: 0 })),
            });

            if (response.success) {
                showNotification(
                    "Action created and saved successfully!",
                    "success",
                );
            } else {
                showNotification(
                    "Failed to create action from recording",
                    "error",
                );
            }

            // Close modal
            modal.hide();

            // Update UI
            console.log("[saveModalAction] Calling updateUserActionsUI");
            await this.updateUserActionsUI();
            console.log("[saveModalAction] Calling registerTempSchema");
            await this.registerTempSchema();
            console.log("[saveModalAction] UI update complete");
        } catch (error) {
            console.error("Error creating action:", error);
            showNotification("Failed to create action", "error");
        } finally {
            if (saveButton && originalContent) {
                saveButton.innerHTML = originalContent;
                saveButton.disabled = false;
            }
        }
    }

    private async clearRecordedUserAction() {
        if (
            !confirm(
                "Are you sure you want to clear all custom actions? This cannot be undone.",
            )
        ) {
            return;
        }

        try {
            const domain = getDomainFromUrl(launchUrl!);
            const flows = domain ? await getWebFlowsForDomain(domain) : [];

            let deletedCount = 0;
            for (const flow of flows) {
                const result = await deleteWebFlow(flow.name);
                if (result?.success) {
                    deletedCount++;
                }
            }

            await this.updateUserActionsUI();
            await this.registerTempSchema();

            showNotification(
                `Cleared ${deletedCount} custom actions`,
                "success",
            );
        } catch (error) {
            console.error("Error clearing actions:", error);
            showNotification("Failed to clear actions", "error");
        }
    }

    private async updateUserActionsUI() {
        const userActionsContainer = document.getElementById(
            "userActionsListContainer",
        ) as HTMLElement;
        const countBadge = document.getElementById(
            "customActionsCount",
        ) as HTMLElement;

        try {
            // Get user-authored and discovered actions (exclude built-in samples)
            const domain = getDomainFromUrl(launchUrl!);
            const allActions = domain ? await getWebFlowsForDomain(domain) : [];
            const actions = allActions.filter(
                (a: any) => a.source?.type !== "manual",
            );

            countBadge.textContent = actions.length.toString();

            if (actions.length > 0) {
                userActionsContainer.innerHTML = "";
                actions.forEach((action: any, index: number) => {
                    this.renderUserAction(action, index);
                });
            } else {
                showEmptyState(
                    userActionsContainer,
                    "No custom actions defined yet",
                    "bi-gear",
                );
            }

            if (window.Prism) {
                window.Prism.highlightAll();
            }
        } catch (error) {
            console.error(
                "[updateUserActionsUI] Error updating user actions UI:",
                error,
            );
            showErrorState(
                userActionsContainer,
                "Failed to load custom actions",
            );
        }
    }

    private renderUserAction(action: any, index: number) {
        const userActionsContainer = document.getElementById(
            "userActionsListContainer",
        )!;

        const actionElement = document.createElement("div");
        actionElement.className = "macro-item mb-3";

        actionElement.innerHTML = this.createUserActionCard(action, index);

        const viewButton = actionElement.querySelector('[data-action="view"]');
        const deleteButton = actionElement.querySelector(
            '[data-action="delete"]',
        );

        viewButton?.addEventListener("click", () => {
            const collapse = actionElement.querySelector(
                `#actionDetails${index}`,
            );
            const bsCollapse = new (window as any).bootstrap.Collapse(
                collapse,
                { toggle: true },
            );
        });

        deleteButton?.addEventListener("click", () => {
            this.deleteAction(action.name);
        });

        userActionsContainer.appendChild(actionElement);
    }

    private renderTimelineSteps(
        steps: any[],
        container: HTMLElement,
        screenshotData?: string[],
        htmlData?: string[],
        macroName?: string,
    ) {
        if (!steps || steps.length === 0) {
            showEmptyState(container, "No steps recorded", "bi-list-ul");
            return;
        }

        container.innerHTML = `
            ${this.createTimelineContainer(steps)}
            ${this.createScreenshotGallery(screenshotData || [])}
            ${this.createActionControls(macroName || "")}
        `;

        container.querySelectorAll(".toggle-details-btn").forEach((button) => {
            button.addEventListener("click", () => {
                const index = button.getAttribute("data-index");
                const details = document.getElementById(`stepDetails${index}`);
                if (details) {
                    details.classList.toggle("show");
                }
            });
        });

        container.querySelectorAll(".screenshot-img").forEach((img) => {
            img.addEventListener("click", () => {
                const src = img.getAttribute("data-src");
                if (src) {
                    // Open image in new tab for viewing
                    window.open(src, "_blank");
                }
            });
        });

        const deleteBtn = container.querySelector(".delete-macro-btn");
        if (deleteBtn) {
            deleteBtn.addEventListener("click", () => {
                const action = deleteBtn.getAttribute("data-action");
                if (action && typeof this.deleteAction === "function") {
                    this.deleteAction(action);
                }
            });
        }

        if (window.Prism) {
            window.Prism.highlightAll();
        }
    }

    private filterStepData(step: any) {
        const { boundingBox, timestamp, id, ...filteredStep } = step;
        return filteredStep;
    }

    private async deleteAction(actionName: string) {
        const confirmed = await showConfirmationDialog(
            "Are you sure you want to delete this action?",
        );
        if (!confirmed) {
            return;
        }

        try {
            const result = await deleteWebFlow(actionName);

            if (result.success) {
                await this.updateUserActionsUI();
                showNotification("Action deleted successfully!", "success");
            } else {
                console.error("Failed to delete action:", result.error);
                showNotification(
                    `Failed to delete action: ${result.error || "Unknown error"}`,
                    "error",
                );
            }
        } catch (error) {
            console.error("Error deleting action:", error);
            showNotification(
                "Failed to delete action. Please try again.",
                "error",
            );
        }
    }

    private renderSchemaResults(schemaActions: any) {
        const itemsList = document.getElementById(
            "detectedSchemaItemsList",
        ) as HTMLElement;
        const countBadge = document.getElementById(
            "detectedActionsCount",
        ) as HTMLElement;

        itemsList.innerHTML = "";

        if (schemaActions && schemaActions.length > 0) {
            countBadge.textContent = schemaActions.length.toString();

            schemaActions.forEach((action: any, index: number) => {
                const actionItem = document.createElement("div");
                actionItem.className = "macro-item";
                actionItem.innerHTML = this.createSchemaActionItem(action);

                const detailsButton = actionItem.querySelector("button");
                detailsButton?.addEventListener("click", () => {
                    this.showActionDetails(action);
                });

                itemsList.appendChild(actionItem);
            });
        } else {
            countBadge.textContent = "0";
            showEmptyState(
                itemsList,
                "No actions detected on this page",
                "bi-search",
            );
        }
    }

    private createSchemaActionItem(action: any): string {
        return `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <span class="fw-semibold">${action.actionName}</span>
                </div>
            </div>
        `;
    }

    private createTabNav(
        tabs: Array<{ id: string; label: string; active?: boolean }>,
    ): string {
        return `
            <ul class="nav nav-tabs nav-tabs-sm mb-3">
                ${tabs
                    .map(
                        (tab) => `
                    <li class="nav-item">
                        <a class="nav-link ${tab.active ? "active" : ""}" 
                           data-bs-toggle="tab" href="#${tab.id}">${tab.label}</a>
                    </li>
                `,
                    )
                    .join("")}
            </ul>
        `;
    }

    private createTabContent(
        panes: Array<{ id: string; content: string; active?: boolean }>,
    ): string {
        return `
            <div class="tab-content">
                ${panes
                    .map(
                        (pane) => `
                    <div class="tab-pane fade ${pane.active ? "show active" : ""}" id="${pane.id}">
                        ${pane.content}
                    </div>
                `,
                    )
                    .join("")}
            </div>
        `;
    }

    private createTimelineContainer(steps: any[]): string {
        return `
            <div class="timeline-container">
                ${steps.map((step, index) => this.createTimelineItem(step, index)).join("")}
            </div>
        `;
    }

    private createTimelineItem(step: any, index: number): string {
        return `
            <div class="timeline-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h6 class="mb-1">${index + 1}. ${step.type}</h6>
                        <small class="text-muted">${new Date(step.timestamp).toLocaleTimeString()}</small>
                    </div>
                    ${createButton(
                        '<i class="bi bi-chevron-down"></i>',
                        "btn btn-outline-secondary btn-sm toggle-details-btn",
                        { "data-index": index.toString() },
                    )}
                </div>
                <div class="collapse mt-2" id="stepDetails${index}">
                    <pre><code class="language-json">${JSON.stringify(this.filterStepData(step), null, 2)}</code></pre>
                </div>
            </div>
        `;
    }

    private createScreenshotGallery(screenshotData: string[]): string {
        if (!screenshotData || screenshotData.length === 0) return "";

        return `
            <div class="mt-3">
                <h6>Screenshots</h6>
                <div class="screenshot-gallery">
                    ${screenshotData
                        .map(
                            (screenshot, index) => `
                        <img src="${screenshot}" alt="Step ${index + 1}" 
                             class="img-thumbnail me-2 mb-2 screenshot-img" 
                             style="max-width: 200px; cursor: pointer;" 
                             data-src="${screenshot}">
                    `,
                        )
                        .join("")}
                </div>
            </div>
        `;
    }

    private createActionControls(actionName: string): string {
        if (!actionName) return "";

        return `
            <div class="mt-3 text-end">
                ${createButton(
                    '<i class="bi bi-download"></i> Export',
                    "btn btn-outline-primary btn-sm me-2 export-macro-btn",
                    { "data-action": actionName },
                )}
                ${createButton(
                    '<i class="bi bi-trash"></i> Delete',
                    "btn btn-outline-danger btn-sm delete-macro-btn",
                    { "data-action": actionName },
                )}
            </div>
        `;
    }

    // User action component methods
    private createUserActionCard(action: any, index: number): string {
        return `
            <div class="macro-item mb-3">
                ${this.createUserActionHeader(action)}
                ${this.createUserActionDetails(action, index)}
            </div>
        `;
    }

    private createUserActionHeader(action: any): string {
        const paramCount = Object.keys(action.parameters || {}).length;
        const sourceLabel = action.source?.type || "unknown";
        return `
            <div class="d-flex justify-content-between align-items-start">
                <div class="flex-grow-1">
                    <div class="d-flex align-items-center mb-2">
                        <span class="fw-semibold">${escapeHtml(action.name)}</span>
                    </div>
                    <p class="mb-2 text-muted">${escapeHtml(action.description || "")}</p>
                    <small class="text-muted">${paramCount} parameter${paramCount !== 1 ? "s" : ""} &middot; ${sourceLabel}</small>
                </div>
                <div class="btn-group-vertical btn-group-sm">
                    ${createButton(
                        '<i class="bi bi-eye"></i>',
                        "btn btn-outline-primary btn-sm",
                        { title: "View details", "data-action": "view" },
                    )}
                    ${createButton(
                        '<i class="bi bi-trash"></i>',
                        "btn btn-outline-danger btn-sm",
                        { title: "Delete action", "data-action": "delete" },
                    )}
                </div>
            </div>
        `;
    }

    private createUserActionDetails(action: any, index: number): string {
        const tabs = [{ id: `script${index}`, label: "Script", active: true }];

        const scriptContent = action.script || "// No script available";
        const paramSummary = Object.entries(action.parameters || {})
            .map(
                ([name, p]: [string, any]) =>
                    `  ${name}: ${p.type}${p.required ? "" : "?"}  // ${p.description || ""}`,
            )
            .join("\n");
        const displayContent = paramSummary
            ? `// Parameters:\n${paramSummary}\n\n${scriptContent}`
            : scriptContent;

        const panes = [
            {
                id: `script${index}`,
                content: `<pre><code class="language-javascript">${escapeHtml(displayContent)}</code></pre>`,
                active: true,
            },
        ];

        return `
            <div class="collapse mt-3" id="actionDetails${index}">
                <div class="card card-body">
                    ${this.createTabNav(tabs)}
                    ${this.createTabContent(panes)}
                </div>
            </div>
        `;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const panel = new ActionDiscoveryPanel();
    await panel.initialize();

    await chrome.storage.local.set({ lastScanTime: Date.now() });
});

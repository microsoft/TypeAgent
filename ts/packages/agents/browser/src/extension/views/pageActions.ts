// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActionsForUrl } from "../storage";

let recording = false;
let recordedActions: any[] = [];
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
        await this.requestSchemaUpdate();
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
        const indicator = statusElement.querySelector(".status-indicator")!;

        try {
            const response = await chrome.runtime.sendMessage({ type: "ping" });
            this.connectionStatus.connected = true;

            indicator.className = "status-indicator status-connected";
            statusElement.innerHTML = `
                <span class="status-indicator status-connected"></span>
                Connected to TypeAgent
            `;
        } catch (error) {
            this.connectionStatus.connected = false;
            indicator.className = "status-indicator status-idle";
            statusElement.innerHTML = `
                <span class="status-indicator status-idle"></span>
                Connection unavailable
            `;
        }
    }

    private async loadAutoDiscoverySettings() {
        try {
            const settings = await chrome.storage.local.get(["autoDiscovery"]);
            autoDiscoveryEnabled = settings.autoDiscovery || false;
            (
                document.getElementById(
                    "autoDiscoveryToggle",
                ) as HTMLInputElement
            ).checked = autoDiscoveryEnabled;
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

        if (autoDiscoveryEnabled) {
            await this.requestSchemaUpdate(true);
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

        this.showLoadingState(itemsList, "Scanning ...");
        refreshButton.innerHTML =
            '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';
        refreshButton.disabled = true;

        try {
            // Get current discovered actions from ActionsStore
            let currentActions: any[] = [];
            if (!forceRefresh) {
                currentActions = await getActionsForUrl(launchUrl!, {
                    includeGlobal: false,
                    author: "discovered",
                });
            }

            if (currentActions.length === 0 || forceRefresh) {
                // Discovery now auto-saves actions to ActionsStore
                const response = await chrome.runtime.sendMessage({
                    type: "refreshSchema",
                });

                if (chrome.runtime.lastError) {
                    console.error(
                        "Error fetching schema:",
                        chrome.runtime.lastError,
                    );
                    this.showErrorState(
                        itemsList,
                        "Failed to scan page for actions",
                    );
                    return;
                }

                // Actions are now automatically saved
                this.renderSchemaResults(response.schema);

                if (response.schema && response.schema.length > 0) {
                    console.log(
                        `Discovered and saved ${response.schema.length} actions`,
                    );
                }
            } else {
                // Convert ActionsStore format to legacy schema format for display
                const legacySchema = currentActions.map((action) => ({
                    actionName: action.name,
                    description: action.description,
                    parameters: action.definition?.intentJson?.parameters || {},
                }));
                this.renderSchemaResults(legacySchema);
            }

            await this.registerTempSchema();
        } catch (error) {
            console.error("Error updating schema:", error);
            this.showErrorState(itemsList, "Failed to scan page for actions");
        } finally {
            refreshButton.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
            refreshButton.disabled = false;
        }
    }

    private showLoadingState(container: HTMLElement, message: string) {
        container.innerHTML = `
            <div class="text-center text-muted p-3">
                <div class="spinner-border spinner-border-sm mb-2" role="status" aria-hidden="true"></div>
                <p class="mb-0">${message}</p>
            </div>
        `;
    }

    private showEmptyState(
        container: HTMLElement,
        message: string,
        icon: string = "bi-info-circle",
    ) {
        container.innerHTML = `
            <div class="text-center text-muted p-3">
                <i class="${icon} fs-4 mb-2"></i>
                <p class="mb-0">${message}</p>
            </div>
        `;
    }

    private showErrorState(container: HTMLElement, message: string) {
        container.innerHTML = `
            <div class="text-center text-danger p-3">
                <i class="bi bi-exclamation-triangle fs-4 mb-2"></i>
                <p class="mb-0">${message}</p>
            </div>
        `;
    }

    private showActionDetails(action: any) {
        const modal = document.createElement("div");
        modal.className = "modal fade";
        modal.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${action.actionName}</h5>
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
            await chrome.runtime.sendMessage({ type: "registerTempSchema" });
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
                                <label class="form-label fw-semibold">Action Name</label>
                                <input
                                    type="text"
                                    id="modalActionName"
                                    class="form-control"
                                    placeholder="Enter a descriptive name for this action"
                                    required
                                />
                            </div>

                            <div class="mb-3">
                                <label class="form-label fw-semibold">Action Description</label>
                                <textarea
                                    id="modalActionStepsDescription"
                                    class="form-control"
                                    rows="4"
                                    placeholder="Describe how to complete this action step by step..."
                                ></textarea>
                            </div>

                            <div id="modalRecordingSection" class="mb-3">
                                <label class="form-label fw-semibold">Record Steps</label>
                                <div class="d-flex action-controls align-items-center">
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
                            <button type="button" id="modalSaveAction" class="btn btn-primary">
                                <i class="bi bi-floppy"></i> Save Action
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
            .querySelector("#modalSaveAction")!
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
            "modalActionName",
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
            await chrome.runtime.sendMessage({ type: "startRecording" });

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
            this.showNotification("Failed to start recording", "error");
        }
    }

    private async stopModalRecording() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "stopRecording",
            });

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
            this.showNotification("Failed to stop recording", "error");
            this.resetModalRecordingUI();
        }
    }

    private async saveModalAction(modal: any) {
        const nameField = document.getElementById(
            "modalActionName",
        ) as HTMLInputElement;
        const actionName = nameField?.value.trim();
        const stepsDescription = (
            document.getElementById(
                "modalActionStepsDescription",
            ) as HTMLTextAreaElement
        )?.value.trim();

        if (!actionName) {
            this.showNotification("Please enter an action name", "error");
            return;
        }

        const saveButton = document.getElementById(
            "modalSaveAction",
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
                const htmlFragments = await chrome.runtime.sendMessage({
                    type: "captureHtmlFragments",
                });
                if (htmlFragments && htmlFragments.length > 0) {
                    html = [htmlFragments[0].content];
                }
            }

            // Get existing action names from ActionsStore to avoid duplicates
            const allActions = await getActionsForUrl(launchUrl!, {
                includeGlobal: true,
            });
            const existingActionNames: string[] = allActions.map(
                (action) => action.name,
            );

            // Create and auto-save action in one step
            const response = await chrome.runtime.sendMessage({
                type: "getIntentFromRecording",
                html: html.map((str: string) => ({ content: str, frameId: 0 })),
                screenshot,
                actionName,
                actionDescription: stepsDescription,
                existingActionNames,
                steps: JSON.stringify(steps),
            });

            if (chrome.runtime.lastError) {
                throw new Error(chrome.runtime.lastError.message);
            }

            // Action is automatically saved during processing
            if (response.actionId) {
                this.showNotification(
                    "Action created and saved successfully!",
                    "success",
                );
                console.log(
                    `Created and saved action: ${response.intentJson.actionName} (ID: ${response.actionId})`,
                );
            } else {
                this.showNotification(
                    "Action created but save status unknown",
                    "info",
                );
                console.warn(
                    "Action creation completed but no actionId returned",
                );
            }

            // Close modal
            modal.hide();

            // Update UI
            await this.updateUserActionsUI();
            await this.registerTempSchema();
        } catch (error) {
            console.error("Error creating action:", error);
            this.showNotification("Failed to create action", "error");
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
            // Get all user actions and delete them individually from ActionsStore
            const userActions = await getActionsForUrl(launchUrl!, {
                includeGlobal: false,
                author: "user",
            });

            // Delete each user action
            let deletedCount = 0;
            for (const action of userActions) {
                const result = await chrome.runtime.sendMessage({
                    type: "deleteAction",
                    actionId: action.id,
                });
                if (result?.success) {
                    deletedCount++;
                }
            }

            await this.updateUserActionsUI();
            await this.registerTempSchema();

            this.showNotification(
                `Cleared ${deletedCount} custom actions`,
                "success",
            );
        } catch (error) {
            console.error("Error clearing actions:", error);
            this.showNotification("Failed to clear actions", "error");
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
            console.log("Getting actions after update. URL: ", launchUrl);
            // Get user-authored actions from the new ActionsStore
            const actions = await getActionsForUrl(launchUrl!, {
                includeGlobal: false,
                author: "user",
            });

            console.log("Custom actions: ", actions);

            countBadge.textContent = actions.length.toString();

            if (actions.length > 0) {
                userActionsContainer.innerHTML = "";
                actions.forEach((action: any, index: number) => {
                    this.renderUserAction(action, index);
                });
            } else {
                this.showEmptyState(
                    userActionsContainer,
                    "No custom actions defined yet",
                    "bi-gear",
                );
            }

            if (window.Prism) {
                window.Prism.highlightAll();
            }
        } catch (error) {
            console.error("Error updating user actions UI:", error);
            this.showErrorState(
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
        actionElement.className = "action-item mb-3";

        if (!action.intentSchema) {
            action.intentSchema = action.definition?.intentSchema;
        }

        if (!action.actionsJson) {
            action.actionsJson = action.definition?.actionsJson;
        }

        let steps = action.definition?.steps || action.steps;
        if (typeof steps === "string") {
            steps = JSON.parse(steps);
        }

        if (!action.steps) {
            action.steps = steps;
        }

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
            // Use action ID, fallback to name for compatibility
            const actionId = action.id || action.name;
            this.deleteAction(actionId);
        });

        userActionsContainer.appendChild(actionElement);

        // Handle both old and new StoredAction formats
        const screenshots = action.definition?.screenshot || action.screenshot;
        const htmlFragments = action.definition?.htmlFragments || action.html;

        if (steps) {
            const stepsContent = actionElement.querySelector(
                `#stepsContent${index}`,
            ) as HTMLElement;
            this.renderTimelineSteps(
                steps,
                stepsContent,
                screenshots,
                htmlFragments,
                action.name,
            );
        }
    }

    private renderTimelineSteps(
        steps: any[],
        container: HTMLElement,
        screenshotData?: string[],
        htmlData?: string[],
        actionName?: string,
    ) {
        if (!steps || steps.length === 0) {
            this.showEmptyState(container, "No steps recorded", "bi-list-ul");
            return;
        }

        container.innerHTML = `
            ${this.createTimelineContainer(steps)}
            ${this.createScreenshotGallery(screenshotData || [])}
            ${this.createActionControls(actionName || "")}
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

        const deleteBtn = container.querySelector(".delete-action-btn");
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

    private async deleteAction(actionId: string) {
        if (!confirm(`Are you sure you want to delete this action?`)) {
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                type: "deleteAction",
                actionId: actionId,
            });

            if (response?.success) {
                console.log(`Action deleted: ${actionId}`);
                // Refresh the UI to show updated action list
                await this.updateUserActionsUI();
                // Show success message
                alert("Action deleted successfully!");
            } else {
                console.error(`Failed to delete action:`, response?.error);
                alert(
                    `Failed to delete action: ${response?.error || "Unknown error"}`,
                );
            }
        } catch (error) {
            console.error("Error deleting action:", error);
            alert("Failed to delete action. Please try again.");
        }
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
                actionItem.className = "action-item";
                actionItem.innerHTML = this.createSchemaActionItem(action);

                const detailsButton = actionItem.querySelector("button");
                detailsButton?.addEventListener("click", () => {
                    this.showActionDetails(action);
                });

                itemsList.appendChild(actionItem);
            });
        } else {
            countBadge.textContent = "0";
            this.showEmptyState(
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

    // Template utility functions for sidepanel
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
                    ${this.createButton(
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
                ${this.createButton(
                    '<i class="bi bi-download"></i> Export',
                    "btn btn-outline-primary btn-sm me-2 export-action-btn",
                    { "data-action": actionName },
                )}
                ${this.createButton(
                    '<i class="bi bi-trash"></i> Delete',
                    "btn btn-outline-danger btn-sm delete-action-btn",
                    { "data-action": actionName },
                )}
            </div>
        `;
    }

    // User action component methods
    private createUserActionCard(action: any, index: number): string {
        return `
            <div class="action-item mb-3">
                ${this.createUserActionHeader(action)}
                ${this.createUserActionDetails(action, index)}
            </div>
        `;
    }

    private createUserActionHeader(action: any): string {
        return `
            <div class="d-flex justify-content-between align-items-start">
                <div class="flex-grow-1">
                    <div class="d-flex align-items-center mb-2">
                        <span class="fw-semibold">${action.name}</span>
                    </div>
                    <p class="mb-2 text-muted">${action.description || ""}</p>
                    <small class="text-muted">${action.steps?.length || 0} recorded steps</small>
                </div>
                <div class="btn-group-vertical btn-group-sm">
                    ${this.createButton(
                        '<i class="bi bi-eye"></i>',
                        "btn btn-outline-primary btn-sm",
                        { title: "View details", "data-action": "view" },
                    )}
                    ${this.createButton(
                        '<i class="bi bi-trash"></i>',
                        "btn btn-outline-danger btn-sm",
                        { title: "Delete action", "data-action": "delete" },
                    )}
                </div>
            </div>
        `;
    }

    private createUserActionDetails(action: any, index: number): string {
        const tabs = [
            { id: `steps${index}`, label: "Steps", active: true },
            { id: `intent${index}`, label: "Intent" },
            { id: `actions${index}`, label: "Actions" },
        ];

        const panes = [
            {
                id: `steps${index}`,
                content: `<div id="stepsContent${index}"></div>`,
                active: true,
            },
            {
                id: `intent${index}`,
                content: `<pre><code class="language-typescript">${action.intentSchema || "No intent schema available"}</code></pre>`,
            },
            {
                id: `actions${index}`,
                content: `<pre><code class="language-json">${JSON.stringify(action.actionsJson || {}, null, 2)}</code></pre>`,
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

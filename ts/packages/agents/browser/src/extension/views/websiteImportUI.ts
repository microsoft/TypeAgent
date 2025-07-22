// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ImportOptions,
    FolderImportOptions,
    FolderImportProgress,
    FolderValidationResult,
    ImportProgress,
    ImportResult,
    ImportError,
    ValidationResult,
    SUPPORTED_FILE_TYPES,
    DEFAULT_MAX_FILE_SIZE,
} from "../interfaces/websiteImport.types";

/**
 * UI components and modal management for website import functionality
 * Handles both web activity import (browser data) and file import operations
 */
export class WebsiteImportUI {
    private webActivityModalId = "webActivityImportModal";
    private folderImportModalId = "folderImportModal";
    private activeModal: string | null = null;
    private progressCallback: ((progress: ImportProgress) => void) | null =
        null;
    private completionCallback: ((result: ImportResult) => void) | null = null;
    private errorCallback: ((error: ImportError) => void) | null = null;

    constructor() {}

    /**
     * Show web activity import modal (browser history/bookmarks)
     */
    public showWebActivityImportModal(): void {
        this.hideActiveModal();
        this.setupWebActivityEventListeners();
        this.showModal(this.webActivityModalId);
        this.activeModal = this.webActivityModalId;
    }

    /**
     * Show folder import modal (HTML folder)
     */
    public showFolderImportModal(): void {
        this.hideActiveModal();
        this.setupFolderImportEventListeners();
        this.showModal(this.folderImportModalId);
        this.activeModal = this.folderImportModalId;
        this.loadStoredFolderPath();
    }

    /**
     * Hide any active import modal
     */
    public hideActiveModal(): void {
        if (this.activeModal) {
            this.hideModal(this.activeModal);
            this.removeModal(this.activeModal);
            this.activeModal = null;
        }
    }

    /**
     * Load stored folder path from localStorage and populate the input
     */
    private loadStoredFolderPath(): void {
        const modal = document.getElementById(this.folderImportModalId);
        const folderPathInput = modal?.querySelector(
            "#folderPath",
        ) as HTMLInputElement;

        if (folderPathInput) {
            try {
                const storedPath = localStorage.getItem(
                    "typeagent_folderImportPath",
                );
                if (storedPath && storedPath.trim()) {
                    folderPathInput.value = storedPath;
                    // Trigger validation and state update
                    this.updateFolderImportState();
                }
            } catch (error) {
                console.warn("Failed to load stored folder path:", error);
            }
        }
    }

    /**
     * Save folder path to localStorage
     */
    private saveFolderPath(path: string): void {
        const trimmedPath = path.trim();
        if (trimmedPath) {
            try {
                localStorage.setItem("typeagent_folderImportPath", trimmedPath);
            } catch (error) {
                console.warn(
                    "Failed to save folder path to localStorage:",
                    error,
                );
            }
        }
    }

    /**
     * Show import progress in the active modal with smooth transitions
     */
    public showImportProgress(progress: ImportProgress): void {
        const modalElement = document.getElementById(this.activeModal || "");
        if (!modalElement) return;

        let progressContainer, formContainer;

        if (this.activeModal === this.webActivityModalId) {
            progressContainer = modalElement.querySelector(
                "#webActivityImportProgress",
            );
            formContainer = modalElement.querySelector(
                "#webActivityImportForm",
            );
        } else if (this.activeModal === this.folderImportModalId) {
            progressContainer = modalElement.querySelector(
                "#folderImportProgress",
            );
            formContainer = modalElement.querySelector("#folderImportForm");
        }

        if (progressContainer && formContainer) {
            this.transitionToProgress(
                formContainer as HTMLElement,
                progressContainer as HTMLElement,
            );
            this.updateImportProgress(progress);
        }
    }

    /**
     * Enhanced form state transitions with animations
     */
    private transitionToProgress(
        formContainer: HTMLElement,
        progressContainer: HTMLElement,
    ): void {
        // Fade out form
        formContainer.classList.add("fade-out");

        setTimeout(() => {
            formContainer.classList.add("d-none");
            progressContainer.classList.remove("d-none");
            progressContainer.classList.add("fade-in");

            // Clean up animation classes
            setTimeout(() => {
                formContainer.classList.remove("fade-out");
                progressContainer.classList.remove("fade-in");
            }, 300);
        }, 300);
    }

    /**
     * Enhanced updateImportProgress method with better validation and logging
     */
    public updateImportProgress(progress: ImportProgress): void {
        console.log("🔄 Updating import progress:", progress);

        // Validate progress object
        if (!progress) {
            console.warn("❌ Progress object is null or undefined");
            return;
        }

        if (
            typeof progress.totalItems !== "number" ||
            typeof progress.processedItems !== "number"
        ) {
            console.warn("❌ Invalid progress data types:", {
                totalItems: typeof progress.totalItems,
                processedItems: typeof progress.processedItems,
                totalItemsValue: progress.totalItems,
                processedItemsValue: progress.processedItems,
            });
        }

        const modalElement = document.getElementById(this.activeModal || "");
        if (!modalElement) {
            console.warn("❌ No active modal found for progress update");
            return;
        }

        let statusElement, progressBar, progressText;

        if (this.activeModal === this.webActivityModalId) {
            statusElement = modalElement.querySelector(
                "#webImportStatusMessage",
            );
            progressBar = modalElement.querySelector(
                "#webImportProgressBar",
            ) as HTMLElement;
            progressText = modalElement.querySelector("#webImportProgressText");
        } else if (this.activeModal === this.folderImportModalId) {
            statusElement = modalElement.querySelector(
                "#folderImportStatusMessage",
            );
            progressBar = modalElement.querySelector(
                "#folderImportProgressBar",
            ) as HTMLElement;
            progressText = modalElement.querySelector(
                "#folderImportProgressText",
            );
        }

        console.log("📊 Progress details:", {
            totalItems: progress.totalItems,
            processedItems: progress.processedItems,
            phase: progress.phase,
            currentItem: progress.currentItem,
            importId: progress.importId,
        });

        // Update status message
        if (statusElement) {
            const phaseMessages: Record<string, string> = {
                counting: "Counting items to import...",
                initializing: "Preparing import...",
                fetching: "Fetching browser data...",
                processing: "Processing items...",
                extracting: "Extracting content...",
                complete: "Import complete!",
                error: "Import failed",
            };

            let newMessage = phaseMessages[progress.phase] || progress.phase;

            // Add current item info if available
            if (progress.currentItem && progress.phase !== "complete") {
                const truncatedItem =
                    progress.currentItem.length > 50
                        ? progress.currentItem.substring(0, 50) + "..."
                        : progress.currentItem;
                newMessage += ` (${truncatedItem})`;
            }

            console.log("📝 Status message:", newMessage);

            // Animate text update
            statusElement.classList.add("status-updating");
            statusElement.textContent = newMessage;

            setTimeout(() => {
                statusElement.classList.remove("status-updating");
            }, 200);
        }

        // Update progress bar with enhanced validation
        if (
            progressBar &&
            typeof progress.totalItems === "number" &&
            typeof progress.processedItems === "number"
        ) {
            let percentage = 0;

            if (progress.totalItems > 0) {
                percentage = Math.round(
                    (progress.processedItems / progress.totalItems) * 100,
                );
                // Ensure percentage is between 0 and 100
                percentage = Math.max(0, Math.min(100, percentage));
            }

            console.log("📈 Progress bar update:", {
                processedItems: progress.processedItems,
                totalItems: progress.totalItems,
                percentage: percentage,
            });

            // Smooth progress bar animation
            progressBar.style.transition = "width 0.3s ease-in-out";
            progressBar.style.width = `${percentage}%`;
            progressBar.setAttribute("aria-valuenow", percentage.toString());

            // Add pulse effect for active progress
            if (
                progress.phase === "processing" ||
                progress.phase === "extracting"
            ) {
                progressBar.classList.add("progress-pulse");
            } else {
                progressBar.classList.remove("progress-pulse");
            }
        } else {
            console.warn(
                "❌ Progress bar update skipped due to invalid data:",
                {
                    progressBar: !!progressBar,
                    totalItems: progress.totalItems,
                    processedItems: progress.processedItems,
                },
            );
        }

        // Update progress text with validation
        if (
            progressText &&
            typeof progress.totalItems === "number" &&
            typeof progress.processedItems === "number"
        ) {
            const displayText = `${progress.processedItems} / ${progress.totalItems} items`;

            console.log("📊 Progress text update:", displayText);
            progressText.textContent = displayText;

            if (progress.estimatedTimeRemaining) {
                const minutes = Math.ceil(
                    progress.estimatedTimeRemaining / 60000,
                );
                progressText.textContent += ` (${minutes}m remaining)`;
            }
        } else {
            console.warn("❌ Progress text update skipped due to invalid data");
        }

        // Note: Do not call this.progressCallback here to avoid infinite recursion
        // The progress callback should only be triggered by external progress updates,
        // not by internal UI updates like this method
    }

    /**
     * Show import completion result
     */
    public showImportComplete(result: ImportResult): void {
        const modalElement = document.getElementById(this.activeModal || "");
        if (!modalElement) return;

        let progressContainer;
        if (this.activeModal === this.webActivityModalId) {
            progressContainer = modalElement.querySelector(
                "#webActivityImportProgress",
            );
        } else if (this.activeModal === this.folderImportModalId) {
            progressContainer = modalElement.querySelector(
                "#folderImportProgress",
            );
        }

        if (progressContainer) {
            const isFolderImport =
                this.activeModal === this.folderImportModalId;
            const iconClass = isFolderImport
                ? "bi-check2-circle"
                : "bi-check-circle";
            const successColor = isFolderImport ? "success" : "primary";

            const successHtml = `
                <div class="text-center">
                    <div class="text-${successColor} mb-3">
                        <i class="bi ${iconClass} fs-1"></i>
                    </div>
                    <h5 class="text-${successColor}">Import Complete!</h5>
                    <p class="mb-3">Successfully imported <strong>${result.itemCount}</strong> items.</p>
                    
                    ${
                        result.summary
                            ? `
                        <div class="import-summary bg-light rounded p-3 mb-3">
                            <div class="row text-center">
                                <div class="col-3">
                                    <div class="h6 mb-1">${result.summary.totalProcessed}</div>
                                    <small class="text-muted">Processed</small>
                                </div>
                                <div class="col-3">
                                    <div class="h6 mb-1">${result.summary.successfullyImported}</div>
                                    <small class="text-muted">Imported</small>
                                </div>
                                <div class="col-3">
                                    <div class="h6 mb-1">${result.summary.knowledgeExtracted}</div>
                                    <small class="text-muted">Knowledge</small>
                                </div>
                                <div class="col-3">
                                    <div class="h6 mb-1">${result.summary.entitiesFound}</div>
                                    <small class="text-muted">Entities</small>
                                </div>
                            </div>
                        </div>
                    `
                            : ""
                    }
                    
                    <div class="d-flex gap-2 justify-content-center">
                        <button id="viewImportedData" class="btn btn-outline-${successColor}">
                            <i class="bi bi-eye"></i> View Data
                        </button>
                        <button id="closeModal" class="btn btn-${successColor}">
                            <i class="bi bi-check"></i> Done
                        </button>
                    </div>
                </div>
            `;

            progressContainer.innerHTML = successHtml;
        }

        // Setup button event listeners
        const closeButton = modalElement.querySelector("#closeModal");
        const viewDataButton = modalElement.querySelector("#viewImportedData");

        if (closeButton) {
            closeButton.addEventListener("click", () => {
                this.hideActiveModal();
            });
        }

        if (viewDataButton) {
            viewDataButton.addEventListener("click", () => {
                this.hideActiveModal();
                // Navigate to search page to view imported data
                window.dispatchEvent(new CustomEvent("navigateToSearch"));
            });
        }

        if (this.completionCallback) {
            this.completionCallback(result);
        }
    }

    /**
     * Show import error
     */
    public showImportError(error: ImportError): void {
        const modalElement = document.getElementById(this.activeModal || "");
        if (!modalElement) return;

        let progressContainer;
        if (this.activeModal === this.webActivityModalId) {
            progressContainer = modalElement.querySelector(
                "#webActivityImportProgress",
            );
        } else if (this.activeModal === this.folderImportModalId) {
            progressContainer = modalElement.querySelector(
                "#folderImportProgress",
            );
        }

        if (progressContainer) {
            const isFolderImport =
                this.activeModal === this.folderImportModalId;

            const errorTypeMessages: Record<string, string> = {
                validation: isFolderImport
                    ? "Please check your folder path and import settings, then try again."
                    : "Please check your import settings and try again.",
                network: "Please check your internet connection and try again.",
                processing: isFolderImport
                    ? "There was an issue processing files in the folder. Some files may be corrupted or in an unsupported format."
                    : "There was an issue processing the data.",
                extraction: isFolderImport
                    ? "Content extraction failed for some HTML files. The files may be corrupted or have unusual formatting."
                    : "Content extraction failed for some items.",
            };

            const suggestion =
                errorTypeMessages[error.type] ||
                "Please try again or contact support if the issue persists.";

            // Provide specific suggestions for folder import errors
            let additionalHelp = "";
            if (isFolderImport) {
                if (
                    error.message.includes("permission") ||
                    error.message.includes("access")
                ) {
                    additionalHelp =
                        "<br><small><strong>Tip:</strong> Ensure the folder is not read-only and you have permission to access it.</small>";
                } else if (
                    error.message.includes("not found") ||
                    error.message.includes("does not exist")
                ) {
                    additionalHelp =
                        "<br><small><strong>Tip:</strong> Verify the folder path exists and is spelled correctly.</small>";
                } else if (
                    error.message.includes("HTML") ||
                    error.message.includes("file")
                ) {
                    additionalHelp =
                        "<br><small><strong>Tip:</strong> Ensure the folder contains valid HTML files (.html, .htm, .mhtml).</small>";
                }
            }

            const errorHtml = `
                <div class="text-center">
                    <div class="text-danger mb-3">
                        <i class="bi bi-x-circle fs-1"></i>
                    </div>
                    <h5 class="text-danger">${isFolderImport ? "Folder Import Failed" : "Import Failed"}</h5>
                    <div class="alert alert-danger text-start" role="alert">
                        <strong>Error:</strong> ${error.message}<br>
                        <small class="text-muted">${suggestion}${additionalHelp}</small>
                    </div>
                    <div class="d-flex gap-2 justify-content-center">
                        <button id="retryImport" class="btn btn-outline-danger">
                            <i class="bi bi-arrow-clockwise"></i> Retry
                        </button>
                        <button id="closeModal" class="btn btn-secondary">
                            <i class="bi bi-x"></i> Close
                        </button>
                    </div>
                </div>
            `;

            progressContainer.innerHTML = errorHtml;
        }

        // Setup button handlers
        const closeButton = modalElement.querySelector("#closeModal");
        const retryButton = modalElement.querySelector("#retryImport");

        if (closeButton) {
            closeButton.addEventListener("click", () => {
                this.hideActiveModal();
            });
        }

        if (retryButton) {
            retryButton.addEventListener("click", () => {
                // Reset to form view
                let formContainer, progressContainer;

                if (this.activeModal === this.webActivityModalId) {
                    formContainer = modalElement.querySelector(
                        "#webActivityImportForm",
                    );
                    progressContainer = modalElement.querySelector(
                        "#webActivityImportProgress",
                    );
                } else if (this.activeModal === this.folderImportModalId) {
                    formContainer =
                        modalElement.querySelector("#folderImportForm");
                    progressContainer = modalElement.querySelector(
                        "#folderImportProgress",
                    );
                }

                if (formContainer && progressContainer) {
                    progressContainer.classList.add("d-none");
                    formContainer.classList.remove("d-none");
                }
            });
        }

        if (this.errorCallback) {
            this.errorCallback(error);
        }
    }

    /**
     * Get web activity import options from form
     */
    public getWebActivityImportOptions(): ImportOptions | null {
        const modal = document.getElementById(this.webActivityModalId);
        if (!modal) return null;

        const selectedBrowser = modal.querySelector("[data-browser].selected");
        const selectedType = modal.querySelector("[data-type].selected");

        if (!selectedBrowser || !selectedType) {
            return null;
        }

        const source = selectedBrowser.getAttribute("data-browser") as
            | "chrome"
            | "edge";
        const type = selectedType.getAttribute("data-type") as
            | "bookmarks"
            | "history";

        // Get form values with updated IDs
        const limitInput = modal.querySelector(
            "#webImportLimit",
        ) as HTMLInputElement;
        const daysBackInput = modal.querySelector(
            "#webDaysBack",
        ) as HTMLInputElement;
        const folderInput = modal.querySelector(
            "#webBookmarkFolder",
        ) as HTMLInputElement;
        const extractionModeInput = modal.querySelector(
            "#webExtractionMode",
        ) as HTMLInputElement;
        const maxConcurrentInput = modal.querySelector(
            "#webMaxConcurrent",
        ) as HTMLInputElement;
        const contentTimeoutInput = modal.querySelector(
            "#webContentTimeout",
        ) as HTMLInputElement;

        // Convert slider value to mode string
        const modeMap = ["basic", "summary", "content", "macros", "full"];
        const extractionMode = extractionModeInput?.value
            ? (modeMap[parseInt(extractionModeInput.value)] as any)
            : "content";

        const options: ImportOptions = {
            source,
            type,
            mode: extractionMode,
            maxConcurrent: maxConcurrentInput?.value
                ? parseInt(maxConcurrentInput.value)
                : 5,
            contentTimeout: contentTimeoutInput?.value
                ? parseInt(contentTimeoutInput.value) * 1000
                : 30000,
        };

        // Add optional parameters
        if (limitInput?.value) {
            options.limit = parseInt(limitInput.value);
        }

        if (type === "history" && daysBackInput?.value) {
            options.days = parseInt(daysBackInput.value);
        }

        if (type === "bookmarks" && folderInput?.value) {
            options.folder = folderInput.value.trim();
        }

        return options;
    }

    /**
     * Get folder import options from form
     */
    public getFolderImportOptions(): FolderImportOptions | null {
        const modal = document.getElementById(this.folderImportModalId);
        if (!modal) return null;

        const folderPathInput = modal.querySelector(
            "#folderPath",
        ) as HTMLInputElement;
        if (!folderPathInput?.value.trim()) {
            return null;
        }

        // Get form values with updated IDs
        const extractionModeInput = modal.querySelector(
            "#folderExtractionMode",
        ) as HTMLInputElement;
        const preserveStructureInput = modal.querySelector(
            "#folderPreserveStructure",
        ) as HTMLInputElement;
        const recursiveInput = modal.querySelector(
            "#folderRecursive",
        ) as HTMLInputElement;
        const limitInput = modal.querySelector(
            "#folderFileLimit",
        ) as HTMLInputElement;
        const maxFileSizeInput = modal.querySelector(
            "#folderMaxFileSize",
        ) as HTMLInputElement;
        const skipHiddenInput = modal.querySelector(
            "#folderSkipHidden",
        ) as HTMLInputElement;

        // Convert slider value to mode string
        const modeMap = ["basic", "summary", "content", "macros", "full"];
        const extractionMode = extractionModeInput?.value
            ? (modeMap[parseInt(extractionModeInput.value)] as any)
            : "content";

        const options: FolderImportOptions = {
            folderPath: folderPathInput.value.trim(),
            mode: extractionMode,
            preserveStructure: preserveStructureInput?.checked ?? true,
            recursive: recursiveInput?.checked ?? true,
            fileTypes: [".html", ".htm", ".mhtml"],
            skipHidden: skipHiddenInput?.checked ?? true,
        };

        // Add optional numeric parameters
        if (limitInput?.value) {
            options.limit = parseInt(limitInput.value);
        }

        if (maxFileSizeInput?.value) {
            options.maxFileSize =
                parseInt(maxFileSizeInput.value) * 1024 * 1024; // Convert MB to bytes
        }

        return options;
    }

    /**
     * Validate import form
     */
    public validateImportForm(): boolean {
        const modal = document.getElementById(this.activeModal || "");
        if (!modal) return false;

        if (this.activeModal === this.webActivityModalId) {
            const selectedBrowser = modal.querySelector(
                "[data-browser].selected",
            );
            const selectedType = modal.querySelector("[data-type].selected");
            return !!(selectedBrowser && selectedType);
        }

        if (this.activeModal === this.folderImportModalId) {
            const folderPathInput = modal.querySelector(
                "#folderPath",
            ) as HTMLInputElement;
            return !!folderPathInput?.value.trim();
        }

        return false;
    }

    /**
     * Validate folder path for import
     */
    public async validateFolderPath(
        folderPath: string,
    ): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!folderPath || !folderPath.trim()) {
            errors.push("Folder path is required.");
            return { isValid: false, errors, warnings };
        }

        const trimmedPath = folderPath.trim();

        // Basic path validation
        if (trimmedPath.length > 260) {
            errors.push("Folder path is too long (maximum 260 characters).");
        }

        // Check for invalid characters (basic validation)
        const invalidChars = /[<>"|?*]/;
        if (invalidChars.test(trimmedPath)) {
            errors.push("Folder path contains invalid characters.");
        }

        // Since we can't directly access the file system from browser extension,
        // we'll validate the path format and provide helpful guidance
        const windowsPathPattern = /^[A-Za-z]:\\([^\\]+\\)*[^\\]*$/;
        const unixPathPattern = /^\/([^\/]+\/)*[^\/]*$/;
        const relativePathPattern = /^[^\/\\:*?"<>|]+([\/\\][^\/\\:*?"<>|]+)*$/;

        if (
            !windowsPathPattern.test(trimmedPath) &&
            !unixPathPattern.test(trimmedPath) &&
            !relativePathPattern.test(trimmedPath)
        ) {
            warnings.push(
                "Please ensure the folder path is valid for your operating system.",
            );
        }

        // Provide helpful examples
        if (errors.length === 0) {
            warnings.push(
                "The folder will be validated when import starts. Ensure you have read permissions.",
            );
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }

    /**
     * Show folder path validation feedback
     */
    private showFolderValidationFeedback(validation: ValidationResult): void {
        const modal = document.getElementById(this.folderImportModalId);
        if (!modal) return;

        const feedbackContainer = modal.querySelector(
            "#folderValidationFeedback",
        );
        if (!feedbackContainer) return;

        if (!validation.isValid) {
            feedbackContainer.innerHTML = `
                <div class="alert alert-danger alert-sm">
                    <i class="bi bi-exclamation-triangle"></i>
                    ${validation.errors.join("<br>")}
                </div>
            `;
        } else if (validation.warnings.length > 0) {
            feedbackContainer.innerHTML = `
                <div class="alert alert-warning alert-sm">
                    <i class="bi bi-info-circle"></i>
                    ${validation.warnings.join("<br>")}
                </div>
            `;
        } else {
            feedbackContainer.innerHTML = "";
        }
    }

    /**
     * Update folder import form state
     */
    private updateFolderImportState(): void {
        const modal = document.getElementById(this.folderImportModalId);
        if (!modal) return;

        const folderPathInput = modal.querySelector(
            "#folderPath",
        ) as HTMLInputElement;
        const startButton = modal.querySelector(
            "#startFolderImport",
        ) as HTMLButtonElement;

        if (startButton) {
            startButton.disabled = !folderPathInput?.value.trim();
        }
    }

    /**
     * Set progress update callback
     */
    public onProgressUpdate(
        callback: (progress: ImportProgress) => void,
    ): void {
        this.progressCallback = callback;
    }

    /**
     * Set completion callback
     */
    public onImportComplete(callback: (result: ImportResult) => void): void {
        this.completionCallback = callback;
    }

    /**
     * Set error callback
     */
    public onImportError(callback: (error: ImportError) => void): void {
        this.errorCallback = callback;
    }

    // Private helper methods

    /**
     * Setup event listeners for web activity modal
     */
    private setupWebActivityEventListeners(): void {
        const modal = document.getElementById(this.webActivityModalId);
        if (!modal) return;

        // Browser selection
        const browserOptions = modal.querySelectorAll("[data-browser]");
        browserOptions.forEach((option) => {
            option.addEventListener("click", () => {
                browserOptions.forEach((opt) =>
                    opt.classList.remove("selected"),
                );
                option.classList.add("selected");
                this.updateWebActivityFormState();
            });
        });

        // Data type selection
        const typeOptions = modal.querySelectorAll("[data-type]");
        typeOptions.forEach((option) => {
            option.addEventListener("click", () => {
                typeOptions.forEach((opt) => opt.classList.remove("selected"));
                option.classList.add("selected");
                this.updateWebActivityFormState();
            });
        });

        // Form inputs
        const formInputs = modal.querySelectorAll("input, select");
        formInputs.forEach((input) => {
            input.addEventListener("change", () => {
                this.updateWebActivityFormState();
            });
        });

        // Setup extraction mode slider
        const extractionSlider = modal.querySelector(
            "#extractionMode",
        ) as HTMLInputElement;
        if (extractionSlider) {
            this.setupSliderEventListeners(
                extractionSlider,
                "#webModeDescription",
            );
        }

        // Start import button - use replaceWith to remove any existing event listeners
        const startButton = modal.querySelector("#startWebActivityImport");
        if (startButton) {
            // Clone the button to remove any existing event listeners
            const newStartButton = startButton.cloneNode(true) as HTMLElement;
            startButton.replaceWith(newStartButton);

            newStartButton.addEventListener("click", () => {
                const options = this.getWebActivityImportOptions();
                if (options) {
                    window.dispatchEvent(
                        new CustomEvent("startWebActivityImport", {
                            detail: options,
                        }),
                    );
                }
            });
        }

        // Cancel buttons
        const cancelButtons = modal.querySelectorAll(
            "#cancelWebActivityImport, #cancelImportProgress",
        );
        cancelButtons.forEach((button) => {
            button.addEventListener("click", () => {
                window.dispatchEvent(new CustomEvent("cancelImport"));
            });
        });

        modal.addEventListener("hidden.bs.modal", () => {
            this.removeModal(this.webActivityModalId);
        });
    }

    /**
     * Update web activity form state and validation
     */
    private updateWebActivityFormState(): void {
        const modal = document.getElementById(this.webActivityModalId);
        if (!modal) return;

        const selectedBrowser = modal.querySelector("[data-browser].selected");
        const selectedType = modal.querySelector("[data-type].selected");
        const startButton = modal.querySelector(
            "#startWebActivityImport",
        ) as HTMLButtonElement;

        // Show/hide conditional fields
        const daysBackContainer = modal.querySelector(
            "#daysBackContainer",
        ) as HTMLElement;
        const folderContainer = modal.querySelector(
            "#folderContainer",
        ) as HTMLElement;

        if (selectedType && daysBackContainer && folderContainer) {
            const type = selectedType.getAttribute("data-type");
            if (type === "history") {
                daysBackContainer.style.display = "block";
                folderContainer.style.display = "none";
            } else if (type === "bookmarks") {
                daysBackContainer.style.display = "none";
                folderContainer.style.display = "block";
            }
        }

        // Enable/disable start button
        if (startButton) {
            startButton.disabled = !selectedBrowser || !selectedType;
        }
    }

    /**
     * Setup event listeners for folder import modal
     */
    private setupFolderImportEventListeners(): void {
        const modal = document.getElementById(this.folderImportModalId);
        if (!modal) return;

        const folderPathInput = modal.querySelector(
            "#folderPath",
        ) as HTMLInputElement;
        const startButton = modal.querySelector(
            "#startFolderImport",
        ) as HTMLButtonElement;

        // Folder path input validation
        if (folderPathInput) {
            folderPathInput.addEventListener("input", async () => {
                this.updateFolderImportState();

                // Save path to localStorage
                this.saveFolderPath(folderPathInput.value);

                // Debounced validation
                clearTimeout((folderPathInput as any)._validationTimeout);
                (folderPathInput as any)._validationTimeout = setTimeout(
                    async () => {
                        const validation = await this.validateFolderPath(
                            folderPathInput.value,
                        );
                        this.showFolderValidationFeedback(validation);
                    },
                    500,
                );
            });

            folderPathInput.addEventListener("blur", async () => {
                if (folderPathInput.value.trim()) {
                    const validation = await this.validateFolderPath(
                        folderPathInput.value,
                    );
                    this.showFolderValidationFeedback(validation);
                    // Also save on blur to ensure it's saved
                    this.saveFolderPath(folderPathInput.value);
                }
            });
        }

        // Form inputs change handlers
        const formInputs = modal.querySelectorAll("input, select");
        formInputs.forEach((input) => {
            input.addEventListener("change", () => {
                this.updateFolderImportState();
            });
        });

        // Setup extraction mode slider
        const folderExtractionSlider = modal.querySelector(
            "#folderExtractionMode",
        ) as HTMLInputElement;
        if (folderExtractionSlider) {
            this.setupSliderEventListeners(
                folderExtractionSlider,
                "#folderModeDescription",
            );
        }

        // Start import button - use replaceWith to remove any existing event listeners
        if (startButton) {
            // Clone the button to remove any existing event listeners
            const newStartButton = startButton.cloneNode(true) as HTMLElement;
            startButton.replaceWith(newStartButton);

            newStartButton.addEventListener("click", () => {
                const options = this.getFolderImportOptions();
                if (options) {
                    window.dispatchEvent(
                        new CustomEvent("startFolderImport", {
                            detail: options,
                        }),
                    );
                }
            });
        }

        // Cancel buttons
        const cancelButtons = modal.querySelectorAll(
            "#cancelFolderImport, #cancelImportProgress",
        );
        cancelButtons.forEach((button) => {
            button.addEventListener("click", () => {
                window.dispatchEvent(new CustomEvent("cancelImport"));
            });
        });

        modal.addEventListener("hidden.bs.modal", () => {
            this.removeModal(this.folderImportModalId);
        });
    }

    /**
     * Show modal with enhanced animations
     */
    private showModal(modalId: string): void {
        const modalElement = document.getElementById(modalId);
        if (modalElement && (window as any).bootstrap) {
            // Add entrance animation class
            modalElement.classList.add("modal-entering");

            const modal = new (window as any).bootstrap.Modal(modalElement);
            modal.show();

            // Remove animation class after transition
            setTimeout(() => {
                modalElement.classList.remove("modal-entering");
            }, 300);
        }
    }

    /**
     * Hide modal with enhanced animations
     */
    private hideModal(modalId: string): void {
        const modalElement = document.getElementById(modalId);
        if (modalElement && (window as any).bootstrap) {
            // Add exit animation class
            modalElement.classList.add("modal-exiting");

            const modal = (window as any).bootstrap.Modal.getInstance(
                modalElement,
            );
            if (modal) {
                modal.hide();
            }

            // Clean up animation class after hide
            setTimeout(() => {
                modalElement.classList.remove("modal-exiting");
            }, 300);
        }
    }

    /**
     * Remove modal from DOM
     */
    private removeModal(modalId: string): void {
        const modalElement = document.getElementById(modalId);
        if (modalElement) {
            modalElement.remove();
        }

        // Clean up any leftover backdrop
        const backdrop = document.querySelector(".modal-backdrop");
        if (backdrop) {
            backdrop.remove();
        }

        document.body.classList.remove("modal-open");
        document.body.style.removeProperty("overflow");
        document.body.style.removeProperty("padding-right");
    }

    /**
     * Setup event listeners for extraction mode slider
     */
    private setupSliderEventListeners(
        slider: HTMLInputElement,
        descriptionSelector: string,
    ): void {
        const modal = slider.closest(".modal");
        if (!modal) return;

        // Handle slider input
        slider.addEventListener("input", () => {
            const modeMap = ["basic", "summary", "content", "macros", "full"];
            const mode = modeMap[parseInt(slider.value)];
            slider.setAttribute("data-mode", mode);
            this.updateSliderLabels(slider);
            this.updateModeDescription(descriptionSelector, mode);
        });

        // Handle label clicks
        const labels = modal.querySelectorAll(".slider-label");
        labels.forEach((label, index) => {
            label.addEventListener("click", () => {
                const modeMap = [
                    "basic",
                    "summary",
                    "content",
                    "macros",
                    "full",
                ];
                slider.value = index.toString();
                slider.setAttribute("data-mode", modeMap[index]);
                this.updateSliderLabels(slider);
                this.updateModeDescription(descriptionSelector, modeMap[index]);
            });
        });

        // Initialize state
        this.updateSliderLabels(slider);
        this.updateModeDescription(descriptionSelector, "content");
    }

    /**
     * Update slider labels and ticks visual state
     */
    private updateSliderLabels(slider: HTMLInputElement): void {
        const modal = slider.closest(".modal");
        if (!modal) return;

        const activeValue = parseInt(slider.value);
        const labels = modal.querySelectorAll(".slider-label");
        const ticks = modal.querySelectorAll(".slider-tick");

        labels.forEach((label, index) => {
            if (index === activeValue) {
                label.classList.add("active");
            } else {
                label.classList.remove("active");
            }
        });

        ticks.forEach((tick, index) => {
            if (index === activeValue) {
                tick.classList.add("active");
            } else {
                tick.classList.remove("active");
            }
        });
    }

    /**
     * Update mode description text
     */
    private updateModeDescription(selector: string, mode: string): void {
        const descriptionElement = document.querySelector(selector);
        if (!descriptionElement) return;

        const descriptions: Record<string, string> = {
            basic: "Fast metadata extraction without AI - perfect for bulk operations",
            summary:
                "AI-enhanced content summarization with key insights extraction",
            content:
                "AI-powered content analysis with entity and topic extraction",
            macros: "AI analysis plus interaction detection for dynamic pages",
            full: "Complete AI analysis with relationships and cross-references",
        };

        descriptionElement.textContent =
            descriptions[mode] || descriptions.content;
    }
}

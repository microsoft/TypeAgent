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

    constructor() {
        this.initializeStyles();
    }

    /**
     * Show web activity import modal (browser history/bookmarks)
     */
    public showWebActivityImportModal(): void {
        this.hideActiveModal();

        // Only create modal if it doesn't exist to prevent duplicate event listeners
        const existingModal = document.getElementById(this.webActivityModalId);
        if (!existingModal) {
            this.createWebActivityModal();
        }

        this.showModal(this.webActivityModalId);
        this.activeModal = this.webActivityModalId;
    }

    /**
     * Show folder import modal (HTML folder)
     */
    public showFolderImportModal(): void {
        this.hideActiveModal();

        // Only create modal if it doesn't exist to prevent duplicate event listeners
        const existingModal = document.getElementById(this.folderImportModalId);
        if (!existingModal) {
            this.createFolderImportModal();
        }

        this.showModal(this.folderImportModalId);
        this.activeModal = this.folderImportModalId;
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
     * Show import progress in the active modal with smooth transitions
     */
    public showImportProgress(progress: ImportProgress): void {
        const modalElement = document.getElementById(this.activeModal || "");
        if (!modalElement) return;

        const progressContainer = modalElement.querySelector("#importProgress");
        const formContainer = modalElement.querySelector("#importForm");

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

        const statusElement = modalElement.querySelector(
            "#importStatusMessage",
        );
        const progressBar = modalElement.querySelector(
            "#importProgressBar",
        ) as HTMLElement;
        const progressText = modalElement.querySelector("#importProgressText");

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

        const progressContainer = modalElement.querySelector("#importProgress");
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

        const progressContainer = modalElement.querySelector("#importProgress");
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
                const formContainer = modalElement.querySelector("#importForm");
                const progressContainer =
                    modalElement.querySelector("#importProgress");

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

        // Get form values
        const limitInput = modal.querySelector(
            "#importLimit",
        ) as HTMLInputElement;
        const daysBackInput = modal.querySelector(
            "#daysBack",
        ) as HTMLInputElement;
        const folderInput = modal.querySelector(
            "#bookmarkFolder",
        ) as HTMLInputElement;
        const extractionModeInput = modal.querySelector(
            "#extractionMode",
        ) as HTMLInputElement;
        const maxConcurrentInput = modal.querySelector(
            "#maxConcurrent",
        ) as HTMLInputElement;
        const contentTimeoutInput = modal.querySelector(
            "#contentTimeout",
        ) as HTMLInputElement;

        // Convert slider value to mode string
        const modeMap = ["basic", "content", "actions", "full"];
        const extractionMode = extractionModeInput?.value 
            ? modeMap[parseInt(extractionModeInput.value)] as any
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

        // Get form values
        const extractionModeInput = modal.querySelector(
            "#folderExtractionMode",
        ) as HTMLInputElement;
        const preserveStructureInput = modal.querySelector(
            "#preserveStructure",
        ) as HTMLInputElement;
        const recursiveInput = modal.querySelector(
            "#recursive",
        ) as HTMLInputElement;
        const limitInput = modal.querySelector(
            "#fileLimit",
        ) as HTMLInputElement;
        const maxFileSizeInput = modal.querySelector(
            "#maxFileSize",
        ) as HTMLInputElement;
        const skipHiddenInput = modal.querySelector(
            "#skipHidden",
        ) as HTMLInputElement;

        // Convert slider value to mode string
        const modeMap = ["basic", "content", "actions", "full"];
        const extractionMode = extractionModeInput?.value 
            ? modeMap[parseInt(extractionModeInput.value)] as any
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
     * Create web activity import modal
     */
    private createWebActivityModal(): void {
        const modalDiv = document.createElement("div");
        modalDiv.className = "modal fade";
        modalDiv.id = this.webActivityModalId;
        modalDiv.setAttribute("tabindex", "-1");

        modalDiv.innerHTML = `
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                        <h5 class="modal-title">
                            <i class="bi bi-download me-2"></i>Import Web Activity
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" style="filter: invert(1);"></button>
                    </div>
                    <div class="modal-body">
                        <div id="importForm">
                            <!-- Browser Selection -->
                            <div class="mb-3">
                                <label class="form-label fw-semibold">Select Browser</label>
                                <div class="row">
                                    <div class="col-md-6">
                                        <div class="import-option" data-browser="chrome">
                                            <div class="d-flex align-items-center">
                                                <i class="bi bi-browser-chrome text-success me-3 fs-4"></i>
                                                <div>
                                                    <div class="fw-semibold">Google Chrome</div>
                                                    <small class="text-muted">Import from Chrome browser</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="import-option" data-browser="edge">
                                            <div class="d-flex align-items-center">
                                                <i class="bi bi-browser-edge text-primary me-3 fs-4"></i>
                                                <div>
                                                    <div class="fw-semibold">Microsoft Edge</div>
                                                    <small class="text-muted">Import from Edge browser</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Data Type Selection -->
                            <div class="mb-3">
                                <label class="form-label fw-semibold">Data Type</label>
                                <div class="row">
                                    <div class="col-md-6">
                                        <div class="import-option" data-type="bookmarks">
                                            <div class="d-flex align-items-center">
                                                <i class="bi bi-bookmark-star text-warning me-3 fs-4"></i>
                                                <div>
                                                    <div class="fw-semibold">Bookmarks</div>
                                                    <small class="text-muted">Saved bookmarks and favorites</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="import-option" data-type="history">
                                            <div class="d-flex align-items-center">
                                                <i class="bi bi-clock-history text-info me-3 fs-4"></i>
                                                <div>
                                                    <div class="fw-semibold">Browser History</div>
                                                    <small class="text-muted">Recently visited pages</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Advanced Options -->
                            <div class="mb-3">
                                <button class="btn btn-outline-secondary btn-sm" type="button" data-bs-toggle="collapse" data-bs-target="#advancedOptions">
                                    <i class="bi bi-gear"></i> Advanced Options
                                </button>

                                <div class="collapse mt-3" id="advancedOptions">
                                    <div class="card card-body bg-light">
                                        <div class="row">
                                            <div class="col-md-6">
                                                <label class="form-label">Limit (max items)</label>
                                                <input type="number" id="importLimit" class="form-control form-control-sm" 
                                                       placeholder="e.g., 1000" min="1" max="50000" value="1000">
                                            </div>
                                            <div class="col-md-6" id="daysBackContainer" style="display: none">
                                                <label class="form-label">Days back (history only)</label>
                                                <input type="number" id="daysBack" class="form-control form-control-sm" 
                                                       placeholder="e.g., 30" min="1" max="365" value="30">
                                            </div>
                                        </div>

                                        <div class="mt-3" id="folderContainer" style="display: none">
                                            <label class="form-label">Bookmark Folder (optional)</label>
                                            <input type="text" id="bookmarkFolder" class="form-control form-control-sm" 
                                                   placeholder="e.g., Work, Personal">
                                        </div>

                                        <div class="mt-3">
                                            <h6 class="mb-3">Enhancement Options</h6>
                                            
                                            <div class="mb-3">
                                                <label for="extractionMode" class="form-label">
                                                    <i class="bi bi-gear"></i> Extraction Mode
                                                </label>
                                                <div class="extraction-mode-slider-container">
                                                    <input 
                                                        type="range" 
                                                        id="extractionMode" 
                                                        class="extraction-mode-slider" 
                                                        min="0" 
                                                        max="3" 
                                                        value="1" 
                                                        step="1"
                                                        data-mode="content"
                                                    />
                                                    <div class="slider-labels">
                                                        <span class="slider-label" data-value="0">Basic</span>
                                                        <span class="slider-label" data-value="1">Content</span>
                                                        <span class="slider-label" data-value="2">Actions</span>
                                                        <span class="slider-label" data-value="3">Full</span>
                                                    </div>
                                                    <div class="slider-ticks">
                                                        <span class="slider-tick" data-value="0"></span>
                                                        <span class="slider-tick" data-value="1"></span>
                                                        <span class="slider-tick" data-value="2"></span>
                                                        <span class="slider-tick" data-value="3"></span>
                                                    </div>
                                                </div>
                                                <small class="text-muted">
                                                    <span id="webModeDescription">AI-powered content analysis with entity and topic extraction</span>
                                                </small>
                                            </div>

                                            <div class="row">
                                                <div class="col-md-6">
                                                    <label for="maxConcurrent" class="form-label">Max Concurrent</label>
                                                    <input type="number" id="maxConcurrent" class="form-control form-control-sm" 
                                                           value="5" min="1" max="20">
                                                </div>
                                                <div class="col-md-6">
                                                    <label for="contentTimeout" class="form-label">Timeout (seconds)</label>
                                                    <input type="number" id="contentTimeout" class="form-control form-control-sm" 
                                                           value="30" min="5" max="120">
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Import Controls -->
                            <div class="d-flex gap-2">
                                <button id="startWebActivityImport" class="btn btn-primary" disabled>
                                    <i class="bi bi-download"></i> Start Import
                                </button>
                                <button id="cancelWebActivityImport" class="btn btn-outline-secondary d-none">
                                    <i class="bi bi-x-circle"></i> Cancel
                                </button>
                            </div>
                        </div>

                        <!-- Progress Display -->
                        <div id="importProgress" class="d-none">
                            <div class="progress-container">
                                <div class="text-center">
                                    <div class="spinner-border text-primary mb-3" role="status">
                                        <span class="visually-hidden">Importing...</span>
                                    </div>
                                    <div>
                                        <span class="fw-semibold">Importing Data...</span>
                                    </div>
                                    <small id="importStatusMessage" class="text-muted d-block mt-2">
                                        Preparing import...
                                    </small>
                                    <div class="progress mt-3" style="height: 6px;">
                                        <div id="importProgressBar" class="progress-bar" role="progressbar" 
                                             style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                                    </div>
                                    <small id="importProgressText" class="text-muted d-block mt-1">0 / 0 items</small>
                                </div>

                                <div class="mt-4 text-center">
                                    <button id="cancelImportProgress" class="btn btn-outline-danger btn-sm">
                                        <i class="bi bi-x-circle"></i> Cancel Import
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modalDiv);
        this.setupWebActivityEventListeners();
    }

    /**
     * Create folder import modal
     */
    private createFolderImportModal(): void {
        const modalDiv = document.createElement("div");
        modalDiv.className = "modal fade";
        modalDiv.id = this.folderImportModalId;
        modalDiv.setAttribute("tabindex", "-1");

        modalDiv.innerHTML = `
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header" style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white;">
                        <h5 class="modal-title">
                            <i class="bi bi-folder2-open me-2"></i>Import from Folder
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" style="filter: invert(1);"></button>
                    </div>
                    <div class="modal-body">
                        <div id="importForm">
                            <!-- Folder Path Input -->
                            <div class="mb-3">
                                <label for="folderPath" class="form-label fw-semibold">
                                    <i class="bi bi-folder"></i> Folder Path
                                </label>
                                <div class="input-group">
                                    <input type="text" id="folderPath" class="form-control" 
                                           placeholder="Enter folder path (e.g., C:\\Documents\\HTMLFiles or /home/user/html-files)"
                                           autocomplete="off">
                                    <button type="button" class="btn btn-outline-secondary" id="browseFolderBtn" title="Browse for folder">
                                        <i class="bi bi-three-dots"></i>
                                    </button>
                                </div>
                                <div class="form-text">
                                    <small class="text-muted">
                                        <i class="bi bi-info-circle"></i>
                                        Enter the full path to a folder containing HTML files. 
                                        Subfolders will be included if recursive option is enabled.
                                    </small>
                                </div>
                                <div id="folderValidationFeedback"></div>
                            </div>

                            <!-- Folder Options -->
                            <div class="mb-3">
                                <h6 class="mb-3">Folder Options</h6>
                                
                                <div class="row">
                                    <div class="col-md-6">
                                        <div class="form-check mb-2">
                                            <input class="form-check-input" type="checkbox" id="recursive" checked>
                                            <label class="form-check-label" for="recursive">
                                                <i class="bi bi-arrow-down-up"></i> Include subfolders
                                            </label>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="form-check mb-2">
                                            <input class="form-check-input" type="checkbox" id="skipHidden" checked>
                                            <label class="form-check-label" for="skipHidden">
                                                <i class="bi bi-eye-slash"></i> Skip hidden files
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div class="row">
                                    <div class="col-md-6">
                                        <label for="fileLimit" class="form-label">File limit (optional)</label>
                                        <input type="number" id="fileLimit" class="form-control form-control-sm" 
                                               placeholder="e.g., 1000" min="1" max="10000" value="1000">
                                    </div>
                                    <div class="col-md-6">
                                        <label for="maxFileSize" class="form-label">Max file size (MB)</label>
                                        <input type="number" id="maxFileSize" class="form-control form-control-sm" 
                                               placeholder="50" min="1" max="500" value="50">
                                    </div>
                                </div>
                            </div>

                            <!-- Processing Options -->
                            <div class="mb-3">
                                <button class="btn btn-outline-secondary btn-sm" type="button" data-bs-toggle="collapse" data-bs-target="#folderAdvancedOptions">
                                    <i class="bi bi-gear"></i> Processing Options
                                </button>

                                <div class="collapse mt-3" id="folderAdvancedOptions">
                                    <div class="card card-body bg-light">
                                        <div class="mb-3">
                                            <h6 class="mb-3">Content Processing</h6>
                                            
                                            <div class="mb-3">
                                                <label for="folderExtractionMode" class="form-label">
                                                    <i class="bi bi-gear"></i> Extraction Mode
                                                </label>
                                                <div class="extraction-mode-slider-container">
                                                    <input 
                                                        type="range" 
                                                        id="folderExtractionMode" 
                                                        class="extraction-mode-slider" 
                                                        min="0" 
                                                        max="3" 
                                                        value="1" 
                                                        step="1"
                                                        data-mode="content"
                                                    />
                                                    <div class="slider-labels">
                                                        <span class="slider-label" data-value="0">Basic</span>
                                                        <span class="slider-label" data-value="1">Content</span>
                                                        <span class="slider-label" data-value="2">Actions</span>
                                                        <span class="slider-label" data-value="3">Full</span>
                                                    </div>
                                                    <div class="slider-ticks">
                                                        <span class="slider-tick" data-value="0"></span>
                                                        <span class="slider-tick" data-value="1"></span>
                                                        <span class="slider-tick" data-value="2"></span>
                                                        <span class="slider-tick" data-value="3"></span>
                                                    </div>
                                                </div>
                                                <small class="text-muted">
                                                    <span id="folderModeDescription">AI-powered content analysis with entity and topic extraction</span>
                                                </small>
                                            </div>
                                            </div>

                                            <div class="form-check mb-2">
                                                <input class="form-check-input" type="checkbox" id="preserveStructure" checked>
                                                <label class="form-check-label" for="preserveStructure">
                                                    <i class="bi bi-diagram-3"></i> Preserve folder structure
                                                </label>
                                                <small class="text-muted d-block ms-4">
                                                    Maintain original folder organization and metadata
                                                </small>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Path Examples -->
                            <div class="mb-3">
                                <details class="text-muted">
                                    <summary class="btn btn-link btn-sm p-0 text-decoration-none">
                                        <i class="bi bi-question-circle"></i> Path Examples
                                    </summary>
                                    <div class="mt-2 small">
                                        <strong>Windows:</strong><br>
                                        <code>C:\\Users\\YourName\\Documents\\HTMLFiles</code><br>
                                        <code>D:\\Projects\\WebsiteArchive</code><br><br>
                                        <strong>macOS/Linux:</strong><br>
                                        <code>/Users/yourname/Documents/HTMLFiles</code><br>
                                        <code>/home/user/website-archive</code><br><br>
                                        <strong>Network paths:</strong><br>
                                        <code>\\\\server\\share\\htmlfiles</code>
                                    </div>
                                </details>
                            </div>

                            <!-- Import Controls -->
                            <div class="d-flex gap-2">
                                <button id="startFolderImport" class="btn btn-success" disabled>
                                    <i class="bi bi-folder-plus"></i> Start Import
                                </button>
                                <button id="cancelFolderImport" class="btn btn-outline-secondary d-none">
                                    <i class="bi bi-x-circle"></i> Cancel
                                </button>
                            </div>
                        </div>

                        <!-- Progress Display -->
                        <div id="importProgress" class="d-none">
                            <div class="progress-container">
                                <div class="text-center">
                                    <div class="spinner-border text-success mb-3" role="status">
                                        <span class="visually-hidden">Processing folder...</span>
                                    </div>
                                    <div>
                                        <span class="fw-semibold">Processing Folder...</span>
                                    </div>
                                    <small id="importStatusMessage" class="text-muted d-block mt-2">
                                        Validating folder...
                                    </small>
                                    <div class="progress mt-3" style="height: 6px;">
                                        <div id="importProgressBar" class="progress-bar bg-success" role="progressbar" 
                                             style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"></div>
                                    </div>
                                    <small id="importProgressText" class="text-muted d-block mt-1">0 / 0 files</small>
                                </div>

                                <div class="mt-4 text-center">
                                    <button id="cancelImportProgress" class="btn btn-outline-danger btn-sm">
                                        <i class="bi bi-x-circle"></i> Cancel Import
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modalDiv);
        this.setupFolderImportEventListeners();
    }

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
        const extractionSlider = modal.querySelector("#extractionMode") as HTMLInputElement;
        if (extractionSlider) {
            this.setupSliderEventListeners(extractionSlider, "#webModeDescription");
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

        if (selectedType) {
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
        const browseFolderBtn = modal.querySelector("#browseFolderBtn");
        const startButton = modal.querySelector(
            "#startFolderImport",
        ) as HTMLButtonElement;

        // Folder path input validation
        if (folderPathInput) {
            folderPathInput.addEventListener("input", async () => {
                this.updateFolderImportState();

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
                }
            });
        }

        // Browse folder button (note: actual folder browsing would require native file system access)
        if (browseFolderBtn) {
            browseFolderBtn.addEventListener("click", () => {
                // Show helpful message since we can't actually browse folders in browser extension
                const helpModal = `
                    <div class="alert alert-info">
                        <strong>Tip:</strong> Copy the folder path from your file manager and paste it here.<br>
                        <strong>Windows:</strong> Right-click folder → Properties → Copy location<br>
                        <strong>Mac:</strong> Right-click folder → Get Info → Copy path<br>
                        <strong>Linux:</strong> Right-click folder → Properties → Copy path
                    </div>
                `;

                const feedbackContainer = modal.querySelector(
                    "#folderValidationFeedback",
                );
                if (feedbackContainer) {
                    feedbackContainer.innerHTML = helpModal;
                    setTimeout(() => {
                        feedbackContainer.innerHTML = "";
                    }, 5000);
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
        const folderExtractionSlider = modal.querySelector("#folderExtractionMode") as HTMLInputElement;
        if (folderExtractionSlider) {
            this.setupSliderEventListeners(folderExtractionSlider, "#folderModeDescription");
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
    private setupSliderEventListeners(slider: HTMLInputElement, descriptionSelector: string): void {
        const modal = slider.closest('.modal');
        if (!modal) return;

        // Handle slider input
        slider.addEventListener('input', () => {
            const modeMap = ["basic", "content", "actions", "full"];
            const mode = modeMap[parseInt(slider.value)];
            slider.setAttribute("data-mode", mode);
            this.updateSliderLabels(slider);
            this.updateModeDescription(descriptionSelector, mode);
        });

        // Handle label clicks
        const labels = modal.querySelectorAll('.slider-label');
        labels.forEach((label, index) => {
            label.addEventListener('click', () => {
                const modeMap = ["basic", "content", "actions", "full"];
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
        const modal = slider.closest('.modal');
        if (!modal) return;

        const activeValue = parseInt(slider.value);
        const labels = modal.querySelectorAll('.slider-label');
        const ticks = modal.querySelectorAll('.slider-tick');
        
        labels.forEach((label, index) => {
            if (index === activeValue) {
                label.classList.add('active');
            } else {
                label.classList.remove('active');
            }
        });

        ticks.forEach((tick, index) => {
            if (index === activeValue) {
                tick.classList.add('active');
            } else {
                tick.classList.remove('active');
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
            "basic": "Fast metadata extraction without AI - perfect for bulk operations",
            "content": "AI-powered content analysis with entity and topic extraction",
            "actions": "AI analysis plus interaction detection for dynamic pages",
            "full": "Complete AI analysis with relationships and cross-references"
        };

        descriptionElement.textContent = descriptions[mode] || descriptions.content;
    }

    /**
     * Initialize component styles
     */
    private initializeStyles(): void {
        const styleId = "websiteImportUIStyles";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
                .import-option { 
                    border: 1px solid #e9ecef; 
                    border-radius: 0.375rem; 
                    padding: 1rem; 
                    margin-bottom: 1rem; 
                    transition: all 0.2s ease; 
                    cursor: pointer; 
                } 
                .import-option:hover { 
                    border-color: #667eea; 
                    background-color: #f8f9ff; 
                } 
                .import-option.selected { 
                    border-color: #667eea; 
                    background-color: #f0f2ff; 
                    box-shadow: 0 0 0 0.2rem rgba(102, 126, 234, 0.25);
                }
                
                .file-drop-zone {
                    position: relative;
                    border: 2px dashed #dee2e6;
                    border-radius: 0.5rem;
                    padding: 2rem;
                    text-align: center;
                    transition: all 0.2s ease;
                    background-color: #f8f9fa;
                }
                
                .file-drop-zone:hover {
                    border-color: #667eea;
                    background-color: #f0f2ff;
                }
                
                .file-drop-zone.drag-over {
                    border-color: #667eea;
                    background-color: #e3f2fd;
                    border-style: solid;
                    transform: scale(1.02);
                    box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
                    transition: all 0.2s ease;
                }
                
                .drop-zone-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(102, 126, 234, 0.1);
                    border-radius: 0.5rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 2px solid #667eea;
                }
                
                .overlay-content {
                    text-align: center;
                    color: #667eea;
                }
                
                .file-list-container {
                    max-height: 300px;
                    overflow-y: auto;
                    border: 1px solid #dee2e6;
                    border-radius: 0.375rem;
                }
                
                .file-item {
                    transition: background-color 0.15s ease;
                }
                
                .file-item:hover {
                    background-color: #f8f9fa;
                }
                
                .file-item:last-child {
                    border-bottom: none !important;
                }
                
                .progress-container {
                    padding: 2rem;
                }
                
                .modal-header {
                    border-bottom: none;
                }
                
                .form-check-label {
                    cursor: pointer;
                }
                
                .collapse .card {
                    border: none;
                    box-shadow: none;
                }
                
                .btn-outline-secondary:hover {
                    color: #495057;
                    background-color: #f8f9fa;
                    border-color: #dee2e6;
                }
                
                /* Enhanced Modal and Transition Animations */
                .modal-entering .modal-dialog {
                    animation: modalSlideIn 0.3s ease-out;
                }
                
                .modal-exiting .modal-dialog {
                    animation: modalSlideOut 0.3s ease-in;
                }
                
                @keyframes modalSlideIn {
                    from {
                        transform: translateY(-50px);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
                
                @keyframes modalSlideOut {
                    from {
                        transform: translateY(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateY(-30px);
                        opacity: 0;
                    }
                }
                
                .fade-out {
                    animation: fadeOut 0.3s ease-out forwards;
                }
                
                .fade-in {
                    animation: fadeIn 0.3s ease-out;
                }
                
                @keyframes fadeOut {
                    from { opacity: 1; transform: translateX(0); }
                    to { opacity: 0; transform: translateX(-20px); }
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateX(20px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                
                .progress-pulse {
                    animation: progressPulse 1.5s infinite;
                }
                
                @keyframes progressPulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.4); }
                    50% { box-shadow: 0 0 0 10px rgba(102, 126, 234, 0); }
                }
                
                .status-updating {
                    animation: statusUpdate 0.2s ease;
                }
                
                @keyframes statusUpdate {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                    100% { transform: scale(1); }
                }
                
                .file-item-enter {
                    animation: fileItemEnter 0.3s ease;
                }
                
                .file-item-exit {
                    animation: fileItemExit 0.3s ease forwards;
                }
                
                @keyframes fileItemEnter {
                    from { opacity: 0; transform: translateY(-20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                @keyframes fileItemExit {
                    from { opacity: 1; transform: translateX(0); }
                    to { opacity: 0; transform: translateX(100%); }
                }
                
                .drop-success {
                    animation: dropSuccess 0.5s ease;
                }
                
                @keyframes dropSuccess {
                    0% { background-color: inherit; }
                    50% { background-color: rgba(40, 167, 69, 0.1); }
                    100% { background-color: inherit; }
                }
                
                /* Respect user motion preferences */
                @media (prefers-reduced-motion: reduce) {
                    .modal-entering .modal-dialog,
                    .modal-exiting .modal-dialog,
                    .fade-out,
                    .fade-in,
                    .progress-pulse,
                    .status-updating,
                    .file-item-enter,
                    .file-item-exit,
                    .drop-success {
                        animation: none !important;
                    }
                    
                    .file-drop-zone.drag-over {
                        transform: none !important;
                    }
                    
                    .import-option:hover,
                    .file-item:hover {
                        transform: none !important;
                    }
                }

                /* Extraction Mode Slider Styles */
                .extraction-mode-slider-container {
                    position: relative;
                    margin: 0.5rem 0 1rem 0;
                }

                .extraction-mode-slider {
                    width: 100%;
                    height: 6px;
                    border-radius: 3px;
                    background: #e9ecef;
                    outline: none;
                    appearance: none;
                    cursor: pointer;
                    position: relative;
                    z-index: 2;
                }

                .extraction-mode-slider::-webkit-slider-thumb {
                    appearance: none;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #667eea;
                    cursor: pointer;
                    border: 2px solid white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    transition: all 0.2s ease;
                }

                .extraction-mode-slider::-webkit-slider-thumb:hover {
                    transform: scale(1.1);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                }

                .extraction-mode-slider::-moz-range-thumb {
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #667eea;
                    cursor: pointer;
                    border: 2px solid white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                    transition: all 0.2s ease;
                }

                .extraction-mode-slider::-moz-range-thumb:hover {
                    transform: scale(1.1);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                }

                .slider-labels {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 0.5rem;
                    position: relative;
                }

                .slider-label {
                    font-size: 0.7rem;
                    color: #6c757d;
                    text-align: center;
                    flex: 1;
                    cursor: pointer;
                    transition: color 0.2s ease;
                    user-select: none;
                }

                .slider-label.active {
                    color: #667eea;
                    font-weight: 600;
                }

                .slider-ticks {
                    position: absolute;
                    top: 50%;
                    left: 0;
                    right: 0;
                    height: 6px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    transform: translateY(-50%);
                    pointer-events: none;
                    z-index: 1;
                }

                .slider-tick {
                    width: 6px;
                    height: 6px;
                    background: #dee2e6;
                    border-radius: 50%;
                    border: 1px solid white;
                    transition: background-color 0.2s ease;
                }

                .slider-tick.active {
                    background: #667eea;
                }

                /* Slider mode colors */
                .extraction-mode-slider[data-mode="basic"] {
                    background: linear-gradient(to right, #28a745 0%, #28a745 33.33%, #e9ecef 33.33%, #e9ecef 100%);
                }

                .extraction-mode-slider[data-mode="basic"]::-webkit-slider-thumb {
                    background: #28a745;
                }

                .extraction-mode-slider[data-mode="basic"]::-moz-range-thumb {
                    background: #28a745;
                }

                .extraction-mode-slider[data-mode="content"] {
                    background: linear-gradient(to right, #28a745 0%, #28a745 33.33%, #667eea 33.33%, #667eea 66.66%, #e9ecef 66.66%, #e9ecef 100%);
                }

                .extraction-mode-slider[data-mode="content"]::-webkit-slider-thumb {
                    background: #667eea;
                }

                .extraction-mode-slider[data-mode="content"]::-moz-range-thumb {
                    background: #667eea;
                }

                .extraction-mode-slider[data-mode="actions"] {
                    background: linear-gradient(to right, #28a745 0%, #28a745 33.33%, #667eea 33.33%, #667eea 66.66%, #fd7e14 66.66%, #fd7e14 100%);
                }

                .extraction-mode-slider[data-mode="actions"]::-webkit-slider-thumb {
                    background: #fd7e14;
                }

                .extraction-mode-slider[data-mode="actions"]::-moz-range-thumb {
                    background: #fd7e14;
                }

                .extraction-mode-slider[data-mode="full"] {
                    background: linear-gradient(to right, #28a745 0%, #28a745 25%, #667eea 25%, #667eea 50%, #fd7e14 50%, #fd7e14 75%, #dc3545 75%, #dc3545 100%);
                }

                .extraction-mode-slider[data-mode="full"]::-webkit-slider-thumb {
                    background: #dc3545;
                }

                .extraction-mode-slider[data-mode="full"]::-moz-range-thumb {
                    background: #dc3545;
                }
            `;
            document.head.appendChild(style);
        }
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Main application script for the Web Plan Visualizer
 */
import cytoscape from "cytoscape";
import dagre from "dagre";
import cytoscapeDagre from "cytoscape-dagre";

import CONFIG from "./config.js";
import ApiService from "./apiService.js";
import Visualizer from "./visualizer.js";
import { WebPlanData, SSEEvent } from "../shared/types.js";

declare global {
    interface Window {
        visualizer?: Visualizer;
    }
}

document.addEventListener("DOMContentLoaded", function () {
    // Check if dagre and cytoscape-dagre are properly loaded
    if (typeof dagre === "undefined") {
        console.error("Dagre library not loaded properly");
        return;
    }

    if (typeof (cytoscape as any).layouts?.dagre === "undefined") {
        // Register dagre layout if not already registered
        try {
            // Make sure cytoscape-dagre has access to dagre
            window.dagre = dagre;
            cytoscape.use(cytoscapeDagre as any);
            console.log("Cytoscape-dagre registered successfully");
        } catch (e) {
            console.error("Failed to register cytoscape-dagre:", e);
            return;
        }
    }

    // SSE connection for real-time updates
    let eventSource: EventSource | null = null;
    let previousPlanData: WebPlanData | null = null;

    // Application state
    let currentViewMode: string = CONFIG.VIEW_MODES.DYNAMIC;
    let webPlanData: WebPlanData = {
        nodes: [],
        links: [],
        currentNode: null,
        title: "Dynamic Plan",
    };
    let visualizer: Visualizer | null = null;

    // DOM elements
    const cyContainer = document.getElementById("cy-container") as HTMLElement;
    const nodeSelect = document.getElementById(
        "node-select",
    ) as HTMLSelectElement;
    const zoomFitButton = document.getElementById(
        "zoom-fit-button",
    ) as HTMLButtonElement;
    const showPathButton = document.getElementById(
        "show-path-button",
    ) as HTMLButtonElement;
    const resetButton = document.getElementById(
        "reset-button",
    ) as HTMLButtonElement;

    const statusMessage = document.getElementById(
        "status-message",
    ) as HTMLDivElement;
    const tooltip = document.getElementById("tooltip") as HTMLDivElement;
    const viewModeToggle = document.getElementById(
        "view-mode-toggle",
    ) as HTMLInputElement;
    const formContainer = document.querySelector(
        ".form-container",
    ) as HTMLDivElement;

    const toggleFormButton = document.getElementById(
        "toggle-form-button",
    ) as HTMLButtonElement;
    const formFlyout = document.getElementById("form-flyout") as HTMLDivElement;
    const closeFlyoutButton = document.getElementById(
        "close-flyout-button",
    ) as HTMLButtonElement;
    const dynamicOnlyControls = document.querySelectorAll(
        ".dynamic-only-control",
    );

    const stateTab = document.getElementById("state-tab") as HTMLElement;
    const actionTab = document.getElementById("action-tab") as HTMLElement;
    const stateForm = document.getElementById("state-form") as HTMLFormElement;
    const actionForm = document.getElementById(
        "action-form",
    ) as HTMLFormElement;
    const activeStateName = document.getElementById(
        "active-state-name",
    ) as HTMLElement;

    const screenshotModeButton = document.getElementById(
        "screenshot-mode-button",
    ) as HTMLButtonElement;
    const screenshotUploadModal = document.getElementById(
        "screenshot-upload-modal",
    ) as HTMLDivElement;
    const uploadNodeName = document.getElementById(
        "upload-node-name",
    ) as HTMLElement;
    const screenshotFile = document.getElementById(
        "screenshot-file",
    ) as HTMLInputElement;
    const dropArea = document.getElementById("drop-area") as HTMLDivElement;
    const previewContainer = document.getElementById(
        "preview-container",
    ) as HTMLDivElement;
    const previewImage = document.getElementById(
        "preview-image",
    ) as HTMLImageElement;
    const uploadScreenshotButton = document.getElementById(
        "upload-screenshot-button",
    ) as HTMLButtonElement;
    const closeModalButtons = document.querySelectorAll(
        ".close-modal, .cancel-modal",
    );

    // Add application state for screenshot mode
    let isScreenshotMode = false;
    let currentBase64Screenshot: string | null = null;
    let currentUploadNodeId: string | null = null;

    /**
     * Show status message
     * @param {string} message - Message to display
     * @param {boolean} isError - Whether this is an error message
     * @param {number} duration - How long to show the message (ms)
     */
    function showStatus(
        message: string,
        isError: boolean = false,
        duration: number = 3000,
    ): void {
        // for now, only show errors
        if (!isError) return;

        statusMessage.textContent = message;
        statusMessage.className =
            "status-message " + (isError ? "error" : "success");
        statusMessage.style.display = "block";

        // Hide after specified duration
        setTimeout(() => {
            statusMessage.style.display = "none";
        }, duration);
    }

    function updateDynamicControls() {
        const isDynamic = viewModeToggle.checked;

        dynamicOnlyControls.forEach(function (element) {
            if (isDynamic) {
                element.classList.remove("hidden");
            } else {
                element.classList.add("hidden");
            }
        });
    }

    /**
     * Populate node selector dropdown
     */
    function populateNodeSelector(): void {
        nodeSelect.innerHTML = "";

        // If there are no nodes, add a message
        if (webPlanData.nodes.length === 0) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No nodes yet";
            option.disabled = true;
            option.selected = true;
            nodeSelect.appendChild(option);
            return;
        }

        webPlanData.nodes.forEach((node) => {
            const option = document.createElement("option");
            option.value = node.id;
            option.textContent = node.label;
            if (node.id === webPlanData.currentNode) {
                option.selected = true;
            }
            nodeSelect.appendChild(option);
        });
    }

    /**
     * Initialize the visualization
     */
    function initializeVisualization(): void {
        // Destroy existing visualizer if it exists
        if (visualizer) {
            visualizer.destroy();
        }

        // Create new visualizer
        visualizer = new Visualizer(cyContainer, webPlanData);
        visualizer.initialize();

        // Make visualizer accessible globally for resize handler
        window.visualizer = visualizer;

        // Set up event listeners
        visualizer.setupEventListeners((nodeId: string) => {
            nodeSelect.value = nodeId;
        }, tooltip);

        // Populate node selector
        populateNodeSelector();

        // Make sure animation is running if there are temporary nodes
        visualizer.startTemporaryNodeAnimation();

        updateCurrentStateIndicator();
    }

    /**
     * Load data from the server
     */
    async function loadData(): Promise<void> {
        try {
            webPlanData = await ApiService.getPlan(currentViewMode);

            // Initialize visualization
            initializeVisualization();

            // Update the title display
            const titleElement = document.getElementById("plan-title");
            if (titleElement && webPlanData.title) {
                titleElement.textContent = webPlanData.title;
            }

            updateDynamicControls();
        } catch (error) {
            console.log(error);
            showStatus(
                `Error loading plan data: ${(error as Error).message}`,
                true,
            );
        }
    }

    /**
     * Show the screenshot upload modal for a node
     * @param {string} nodeId - The ID of the node
     * @param {string} nodeLabel - The label of the node
     */
    function showScreenshotUploadModal(
        nodeId: string,
        nodeLabel: string,
    ): void {
        // Store the node ID in our global variable
        currentUploadNodeId = nodeId;

        // Get references to modal elements
        const screenshotUploadModal = document.getElementById(
            "screenshot-upload-modal",
        ) as HTMLDivElement;
        const uploadNodeName = document.getElementById(
            "upload-node-name",
        ) as HTMLElement;

        // Only proceed if elements exist
        if (!screenshotUploadModal || !uploadNodeName) {
            console.error("Screenshot upload modal elements not found");
            return;
        }

        // Set the node info in the modal
        uploadNodeName.textContent = nodeLabel || nodeId;

        // Reset the form
        const screenshotFile = document.getElementById(
            "screenshot-file",
        ) as HTMLInputElement;
        const previewContainer = document.getElementById(
            "preview-container",
        ) as HTMLDivElement;
        const uploadScreenshotButton = document.getElementById(
            "upload-screenshot-button",
        ) as HTMLButtonElement;

        if (screenshotFile) screenshotFile.value = "";
        currentBase64Screenshot = null;
        if (previewContainer) previewContainer.style.display = "none";
        if (uploadScreenshotButton) uploadScreenshotButton.disabled = true;

        // Show the modal
        screenshotUploadModal.classList.add("active");

        console.log(`Upload modal opened for node: ${nodeId}`);
    }

    /**
     * Handle file selection for screenshot upload
     * @param {FileList} files - The selected files
     */
    function handleFileSelect(files: FileList | null): void {
        if (!files || !files[0]) return;

        const file = files[0];

        // Validate file type
        if (!file.type.match("image.*")) {
            showStatus("Please select an image file", true);
            return;
        }

        // Get references to preview elements
        const previewContainer = document.getElementById(
            "preview-container",
        ) as HTMLDivElement;
        const previewImage = document.getElementById(
            "preview-image",
        ) as HTMLImageElement;
        const uploadScreenshotButton = document.getElementById(
            "upload-screenshot-button",
        ) as HTMLButtonElement;

        // Show preview
        const reader = new FileReader();
        reader.onload = function (e) {
            if (!e.target || !e.target.result) return;

            const result = e.target.result as string;
            if (previewImage) previewImage.src = result;
            if (previewContainer) previewContainer.style.display = "block";

            // Store the base64 data without the prefix
            currentBase64Screenshot = result.split(",")[1]; // Remove data URL prefix

            // Enable the upload button
            if (uploadScreenshotButton) uploadScreenshotButton.disabled = false;

            console.log("Screenshot preview loaded");
        };
        reader.readAsDataURL(file);
    }

    /**
     * Upload the screenshot to the server
     */
    function uploadScreenshot(): void {
        console.log(`Uploading screenshot for node: ${currentUploadNodeId}`);

        if (!currentUploadNodeId || !currentBase64Screenshot) {
            console.error("Missing node ID or screenshot data for upload");
            showStatus("Error: Missing upload data", true);
            return;
        }

        // Get the upload button to show loading state
        const uploadScreenshotButton = document.getElementById(
            "upload-screenshot-button",
        ) as HTMLButtonElement;
        if (uploadScreenshotButton) {
            uploadScreenshotButton.disabled = true;
            uploadScreenshotButton.textContent = "Uploading...";
        }

        // Send the screenshot to the server
        fetch("/api/screenshot", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                nodeId: currentUploadNodeId,
                screenshot: currentBase64Screenshot,
            }),
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then((data) => {
                // Update the visualization if needed
                if (window.webPlanData) {
                    window.webPlanData = data;
                }

                // If we have a visualizer instance, update the node
                if (visualizer) {
                    visualizer.updateNodeScreenshot(
                        currentUploadNodeId!,
                        currentBase64Screenshot!,
                    );
                }

                // Show success message
                showStatus("Screenshot uploaded successfully!");

                // Close the modal
                const screenshotUploadModal = document.getElementById(
                    "screenshot-upload-modal",
                ) as HTMLDivElement;
                if (screenshotUploadModal) {
                    screenshotUploadModal.classList.remove("active");
                }

                console.log("Screenshot uploaded successfully");
            })
            .catch((error) => {
                console.error("Error uploading screenshot:", error);
                showStatus(
                    `Error uploading screenshot: ${error.message}`,
                    true,
                );
            })
            .finally(() => {
                // Reset button state
                const uploadScreenshotButton = document.getElementById(
                    "upload-screenshot-button",
                ) as HTMLButtonElement;
                if (uploadScreenshotButton) {
                    uploadScreenshotButton.disabled = false;
                    uploadScreenshotButton.textContent = "Upload Screenshot";
                }
            });
    }

    /**
     * Set up all event listeners for the screenshot upload functionality
     */
    function setupScreenshotEventListeners(): void {
        console.log("Setting up screenshot event listeners");

        // Get references to elements
        const screenshotFile = document.getElementById(
            "screenshot-file",
        ) as HTMLInputElement;
        const dropArea = document.getElementById("drop-area") as HTMLDivElement;
        const uploadScreenshotButton = document.getElementById(
            "upload-screenshot-button",
        ) as HTMLButtonElement;
        const closeModalButtons = document.querySelectorAll(
            ".close-modal, .cancel-modal",
        );
        const screenshotUploadModal = document.getElementById(
            "screenshot-upload-modal",
        ) as HTMLDivElement;

        // File input change
        if (screenshotFile) {
            screenshotFile.addEventListener("change", function () {
                handleFileSelect(this.files);
            });
        }

        // Drag and drop for file upload
        if (dropArea) {
            dropArea.addEventListener("click", function () {
                if (screenshotFile) screenshotFile.click();
            });

            ["dragenter", "dragover", "dragleave", "drop"].forEach(
                (eventName) => {
                    dropArea.addEventListener(
                        eventName,
                        (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        },
                        false,
                    );
                },
            );

            ["dragenter", "dragover"].forEach((eventName) => {
                dropArea.addEventListener(
                    eventName,
                    () => {
                        dropArea.classList.add("dragover");
                    },
                    false,
                );
            });

            ["dragleave", "drop"].forEach((eventName) => {
                dropArea.addEventListener(
                    eventName,
                    () => {
                        dropArea.classList.remove("dragover");
                    },
                    false,
                );
            });

            dropArea.addEventListener(
                "drop",
                (e) => {
                    handleFileSelect(e.dataTransfer?.files || null);
                },
                false,
            );
        }

        // Upload button
        if (uploadScreenshotButton) {
            uploadScreenshotButton.addEventListener("click", function (e) {
                e.preventDefault();
                uploadScreenshot();
            });
        }

        // Close modal buttons
        closeModalButtons.forEach((button) => {
            button.addEventListener("click", function () {
                if (screenshotUploadModal) {
                    screenshotUploadModal.classList.remove("active");
                }
            });
        });

        // Close modal when clicking outside
        if (screenshotUploadModal) {
            screenshotUploadModal.addEventListener("click", function (e) {
                if (e.target === screenshotUploadModal) {
                    screenshotUploadModal.classList.remove("active");
                }
            });
        }

        console.log("Screenshot event listeners setup complete");
    }

    // Toggle view mode
    viewModeToggle.addEventListener("change", function () {
        updateDynamicControls();

        currentViewMode = this.checked
            ? CONFIG.VIEW_MODES.DYNAMIC
            : CONFIG.VIEW_MODES.STATIC;
        loadData();

        // Update show path button - using icon now
        showPathButton.classList.remove("active");
        showPathButton.innerHTML = '<i class="fas fa-route"></i>';
        showPathButton.title = "Show Current Path";

        // Show a status message
        showStatus(`Switched to ${currentViewMode} plan view`);
    });

    // Handle node selection change via dropdown
    nodeSelect.addEventListener("change", (e) => {
        if (visualizer) {
            visualizer.updateCurrentNode((e.target as HTMLSelectElement).value);

            setTimeout(updateCurrentStateIndicator, 100);
        }
    });

    // Zoom fit button handler
    zoomFitButton.addEventListener("click", () => {
        if (visualizer) {
            visualizer.fitToView();
        }
    });

    // Show path button handler
    showPathButton.addEventListener("click", () => {
        if (!visualizer) return;

        if (!visualizer.pathHighlighted) {
            if (webPlanData.currentNode) {
                visualizer.highlightPath(webPlanData.currentNode);
            }
            // Update only the icon instead of the text
            showPathButton.classList.add("active");
            showPathButton.innerHTML = '<i class="fas fa-route"></i>';
            showPathButton.title = "Reset Path View";
        } else {
            visualizer.resetEdgeStyles();
            // Update only the icon instead of the text
            showPathButton.classList.remove("active");
            showPathButton.innerHTML = '<i class="fas fa-route"></i>';
            showPathButton.title = "Show Current Path";
        }
    });

    // Reset button handler
    resetButton.addEventListener("click", function () {
        if (currentViewMode === CONFIG.VIEW_MODES.STATIC) {
            showStatus(
                "Cannot reset static plan view. Switch to dynamic view to reset.",
                true,
            );
            return;
        }

        if (
            confirm(
                "Are you sure you want to reset the plan? This will delete all nodes and edges.",
            )
        ) {
            ApiService.resetPlan()
                .then((data) => {
                    webPlanData = data;
                    showStatus("Plan reset successfully!");
                    initializeVisualization();
                })
                .catch((error) => {
                    showStatus(
                        `Error resetting plan: ${(error as Error).message}`,
                        true,
                    );
                });
        }
    });

    toggleFormButton.addEventListener("click", function () {
        const isVisible = formFlyout.style.display === "block";

        if (isVisible) {
            formFlyout.style.display = "none";
            toggleFormButton.classList.remove("active");
        } else {
            formFlyout.style.display = "block";
            toggleFormButton.classList.add("active");

            // Position the flyout relative to the button
            positionFlyout();
        }
    });

    // Close flyout when close button is clicked
    closeFlyoutButton.addEventListener("click", function () {
        formFlyout.style.display = "none";
        toggleFormButton.classList.remove("active");
    });

    // Close flyout when clicking outside
    document.addEventListener("click", function (event) {
        if (
            !formFlyout.contains(event.target as Node) &&
            event.target !== toggleFormButton
        ) {
            formFlyout.style.display = "none";
            toggleFormButton.classList.remove("active");
        }
    });

    // Position the flyout based on button position
    function positionFlyout() {
        const buttonRect = toggleFormButton.getBoundingClientRect();
        const containerRect = document
            .querySelector(".container")
            ?.getBoundingClientRect();
        if (containerRect) {
            // Calculate position relative to container
            const top = buttonRect.bottom - containerRect.top + 10;
            const right = containerRect.right - buttonRect.right;

            formFlyout.style.top = `${top}px`;
            formFlyout.style.right = `${right}px`;
        }
    }

    // Tab switching functionality
    stateTab.addEventListener("click", function () {
        stateTab.classList.add("active");
        actionTab.classList.remove("active");
        stateForm.style.display = "block";
        actionForm.style.display = "none";
    });

    actionTab.addEventListener("click", function () {
        actionTab.classList.add("active");
        stateTab.classList.remove("active");
        actionForm.style.display = "block";
        stateForm.style.display = "none";
    });

    // Update the current state indicator whenever a node is selected
    function updateCurrentStateIndicator() {
        if (webPlanData.currentNode) {
            const currentNode = webPlanData.nodes.find(
                (node) => node.id === webPlanData.currentNode,
            );

            if (currentNode) {
                // Display the label or a placeholder for temporary nodes
                const displayName = currentNode.isTemporary
                    ? "(Temporary Node)"
                    : currentNode.label || "(Unnamed)";

                activeStateName.textContent = displayName;

                // Auto-switch to action tab if we've just set a state
                actionTab.click();
            } else {
                activeStateName.textContent = "None";
            }
        } else {
            activeStateName.textContent = "None";
        }
    }

    // Set State form handler
    stateForm.addEventListener("submit", function (e) {
        e.preventDefault();

        if (currentViewMode === CONFIG.VIEW_MODES.STATIC) {
            showStatus(
                "Cannot add states in static view. Switch to dynamic view.",
                true,
            );
            return;
        }

        const currentState = (
            document.getElementById("current-state") as HTMLInputElement
        ).value;

        const nodeType = (
            document.getElementById("node-type") as HTMLSelectElement
        ).value;

        // Get screenshot if in screenshot mode
        let screenshotData = undefined;
        if (isScreenshotMode && currentBase64Screenshot) {
            screenshotData = currentBase64Screenshot;
        }

        const formData = {
            currentState: currentState,
            action: "", // No action for this request
            nodeType: nodeType,
            screenshot: screenshotData, // Add screenshot if available
        };

        ApiService.addTransition(formData)
            .then((result) => {
                const { oldData, newData } = result;

                // Clear the current screenshot data after successful submission
                currentBase64Screenshot = null;

                // Update the reference data
                if (
                    !visualizer ||
                    !visualizer.updateWithoutRedraw(oldData, newData)
                ) {
                    webPlanData = newData;
                    initializeVisualization();

                    // Focus on current node
                    if (visualizer && webPlanData.currentNode) {
                        visualizer._focusOnNodeContext(webPlanData.currentNode);
                    }
                }

                // Update the state indicator
                updateCurrentStateIndicator();

                // Clear the state input
                (
                    document.getElementById("current-state") as HTMLInputElement
                ).value = "";

                // Show success message
                showStatus("State set successfully", false);
            })
            .catch((error) => {
                showStatus(
                    `Error setting state: ${(error as Error).message}`,
                    true,
                );
                console.error(error);
            });
    });

    // Add Action form handler
    actionForm.addEventListener("submit", function (e) {
        e.preventDefault();

        if (currentViewMode === CONFIG.VIEW_MODES.STATIC) {
            showStatus(
                "Cannot add actions in static view. Switch to dynamic view.",
                true,
            );
            return;
        }

        const action = (
            document.getElementById("action-name") as HTMLInputElement
        ).value;

        // Validate we have a current node
        if (!webPlanData.currentNode) {
            showStatus(
                "Please set a state first before adding an action.",
                true,
            );

            // Switch to state tab
            stateTab.click();
            return;
        }

        // Get screenshot if in screenshot mode
        let screenshotData = undefined;
        if (isScreenshotMode && currentBase64Screenshot) {
            screenshotData = currentBase64Screenshot;
        }

        const formData = {
            currentState: "", // No state name for this request
            action: action,
            nodeType: "action", // Default type for new nodes
            screenshot: screenshotData, // Add screenshot if available
        };

        ApiService.addTransition(formData)
            .then((result) => {
                const { oldData, newData } = result;

                // Clear the current screenshot data after successful submission
                currentBase64Screenshot = null;

                // Update the reference data
                if (
                    !visualizer ||
                    !visualizer.updateWithoutRedraw(oldData, newData)
                ) {
                    webPlanData = newData;
                    initializeVisualization();

                    // Focus on current node
                    if (visualizer && webPlanData.currentNode) {
                        visualizer._focusOnNodeContext(webPlanData.currentNode);
                    }
                }

                // Update the state indicator
                updateCurrentStateIndicator();

                // Clear the action input
                (
                    document.getElementById("action-name") as HTMLInputElement
                ).value = "";

                // Show success message
                showStatus("Action added successfully", false);
            })
            .catch((error) => {
                showStatus(
                    `Error adding action: ${(error as Error).message}`,
                    true,
                );
                console.error(error);
            });
    });

    function addScreenshotAttachmentUI() {
        // Add screenshot preview and control to state form
        const stateFormControls = document.querySelector(
            "#state-form .form-controls",
        );
        if (stateFormControls) {
            const screenshotControl = document.createElement("div");
            screenshotControl.className = "form-group screenshot-control";
            screenshotControl.innerHTML = `
                <label for="state-screenshot">Attach Screenshot:</label>
                <input type="file" id="state-screenshot" accept="image/*" class="screenshot-input">
                <div class="screenshot-preview" id="state-screenshot-preview" style="display: none;">
                    <img id="state-preview-img" src="" alt="Preview">
                    <button type="button" class="clear-screenshot">Clear</button>
                </div>
            `;
            stateFormControls.appendChild(screenshotControl);
        }

        // Add screenshot preview and control to action form
        const actionFormControls = document.querySelector(
            "#action-form .form-controls",
        );
        if (actionFormControls) {
            const screenshotControl = document.createElement("div");
            screenshotControl.className = "form-group screenshot-control";
            screenshotControl.innerHTML = `
                <label for="action-screenshot">Attach Screenshot:</label>
                <input type="file" id="action-screenshot" accept="image/*" class="screenshot-input">
                <div class="screenshot-preview" id="action-screenshot-preview" style="display: none;">
                    <img id="action-preview-img" src="" alt="Preview">
                    <button type="button" class="clear-screenshot">Clear</button>
                </div>
            `;
            actionFormControls.appendChild(screenshotControl);
        }

        // Set up event listeners for screenshot inputs
        const screenshotInputs = document.querySelectorAll(".screenshot-input");
        screenshotInputs.forEach((input) => {
            input.addEventListener("change", function (e) {
                const files = (e.target as HTMLInputElement).files;
                if (!files || !files[0]) return;

                const file = files[0];
                const reader = new FileReader();

                // Get the associated preview elements
                const formId = (e.target as HTMLInputElement).id.includes(
                    "state",
                )
                    ? "state"
                    : "action";
                const previewContainer = document.getElementById(
                    `${formId}-screenshot-preview`,
                );
                const previewImg = document.getElementById(
                    `${formId}-preview-img`,
                ) as HTMLImageElement;

                reader.onload = function (e) {
                    if (!e.target || !e.target.result) return;

                    const dataURL = e.target.result as string;
                    if (previewImg) previewImg.src = dataURL;
                    if (previewContainer)
                        previewContainer.style.display = "block";

                    // Store the base64 screenshot data
                    currentBase64Screenshot = dataURL.split(",")[1]; // Remove the data URL prefix
                };

                reader.readAsDataURL(file);
            });
        });

        // Clear screenshot buttons
        const clearButtons = document.querySelectorAll(".clear-screenshot");
        clearButtons.forEach((button) => {
            button.addEventListener("click", function (e) {
                const formId = (e.target as HTMLElement)
                    .closest(".screenshot-preview")
                    ?.id.includes("state")
                    ? "state"
                    : "action";
                const previewContainer = document.getElementById(
                    `${formId}-screenshot-preview`,
                );
                const fileInput = document.getElementById(
                    `${formId}-screenshot`,
                ) as HTMLInputElement;

                if (previewContainer) previewContainer.style.display = "none";
                if (fileInput) fileInput.value = "";

                // Clear the stored screenshot data
                currentBase64Screenshot = null;
            });
        });
    }

    /**
     * Toggle screenshot mode
     */
    function toggleScreenshotMode() {
        isScreenshotMode = !isScreenshotMode;

        if (isScreenshotMode) {
            screenshotModeButton.classList.add("active");
            screenshotModeButton.title = "Disable Screenshot Mode";
        } else {
            screenshotModeButton.classList.remove("active");
            screenshotModeButton.title = "Enable Screenshot Mode";
        }

        // Update visualization to show/hide screenshots
        if (visualizer) {
            visualizer.setScreenshotMode(isScreenshotMode);
        }
    }

    /**
     * Adjusts the canvas height based on window size and content
     * This ensures the canvas resizes both horizontally and vertically
     */
    function adjustCanvasHeight(): void {
        const cyContainer = document.getElementById("cy-container");
        const containerParent = document.querySelector(
            ".container",
        ) as HTMLElement;

        if (!cyContainer || !containerParent) return;

        // Get available height in the window
        const windowHeight = window.innerHeight;

        // Calculate offset from top of window to top of container
        const containerTop = containerParent.getBoundingClientRect().top;

        // Calculate height of other UI elements below container (footer, etc.)
        // Adjust this based on your layout - padding for bottom elements
        const bottomPadding = 40;

        // Calculate available height (subtract footer or other elements if needed)
        const availableHeight = windowHeight - containerTop - bottomPadding;

        // Set minimum height (don't let it get too small)
        const minHeight = 400;

        // Set the container height to the calculated height or minimum
        const newHeight = Math.max(availableHeight, minHeight);
        cyContainer.style.height = `${newHeight}px`;

        // If visualizer instance exists, fit to view after resize
        if (
            window.visualizer &&
            typeof window.visualizer.fitToView === "function"
        ) {
            window.visualizer.fitToView();
        }
    }

    /**
     * Initialize the SSE connection
     */
    function initializeSSE(): void {
        // Close existing connection if any
        if (eventSource) {
            eventSource.close();
        }

        // Create new EventSource
        eventSource = new EventSource("/api/events");

        // Handle connection open
        eventSource.onopen = () => {
            console.log("SSE connection established");
        };

        // Handle connection error
        eventSource.onerror = (error) => {
            console.error("SSE connection error:", error);
            // Try to reconnect after 5 seconds
            setTimeout(() => {
                console.log("Attempting to reconnect SSE...");
                initializeSSE();
            }, 5000);
        };

        // Handle incoming messages
        eventSource.onmessage = (event) => {
            try {
                const eventData = JSON.parse(event.data) as SSEEvent;
                handleSSEEvent(eventData);
            } catch (error) {
                console.error("Error parsing SSE data:", error);
            }
        };
    }

    /**
     * Handle SSE events
     * @param {SSEEvent} eventData - The event data
     */
    function handleSSEEvent(eventData: SSEEvent): void {
        console.log("Received SSE event:", eventData.type);

        // Only process events for the current view mode (dynamic)
        if (currentViewMode !== CONFIG.VIEW_MODES.DYNAMIC) {
            // Still update our local data so it's current when we switch modes
            if (eventData.data) {
                webPlanData = eventData.data;
            }
            return;
        }

        switch (eventData.type) {
            case "connected":
                // Just log the connection, no action needed
                break;

            case "transition":
                if (eventData.data) {
                    handleTransitionUpdate(eventData.data);
                }
                break;

            case "reset":
                // Complete reset needs full redraw
                if (eventData.data) {
                    webPlanData = eventData.data;
                    previousPlanData = null;

                    // Update visualization
                    if (visualizer) {
                        visualizer.destroy();
                    }

                    // Create new visualizer
                    visualizer = new Visualizer(cyContainer, webPlanData);
                    visualizer.initialize();

                    // Setup event listeners
                    visualizer.setupEventListeners((nodeId: string) => {
                        nodeSelect.value = nodeId;
                    }, tooltip);

                    // Populate node selector
                    populateNodeSelector();

                    // Update title
                    updateTitle(webPlanData.title);

                    showStatus(`Plan reset via SSE`);
                }
                break;

            case "title":
                // Just update the title
                if (eventData.data) {
                    updateTitle(eventData.data.title);

                    // Update our data reference
                    if (webPlanData) {
                        webPlanData.title = eventData.data.title;
                    }
                }
                break;

            default:
                console.log("Unknown event type:", eventData.type);
        }
    }

    /**
     * Handle transition update with optimized animation
     * @param {WebPlanData} newPlanData - The updated plan data
     */
    function handleTransitionUpdate(newPlanData: WebPlanData): void {
        if (!newPlanData || !newPlanData.nodes) {
            console.error("Invalid plan data received:", newPlanData);
            return;
        }

        // Store reference to old data for animation purposes
        const oldData: WebPlanData = previousPlanData || {
            nodes: [],
            links: [],
            currentNode: null,
            title: "Dynamic Plan",
        };

        console.log("Previous data: " + JSON.stringify(oldData, null, 2));
        console.log("New data: " + JSON.stringify(newPlanData, null, 2));

        // Validate old data structure to prevent errors
        if (!oldData.nodes) oldData.nodes = [];
        if (!oldData.links) oldData.links = [];

        // Update our reference to the current data
        webPlanData = newPlanData;

        // Initialize visualizer if it doesn't exist
        if (!visualizer) {
            visualizer = new Visualizer(cyContainer, webPlanData);
            visualizer.initialize();

            // Setup event listeners
            visualizer.setupEventListeners((nodeId: string) => {
                updateNodeSelect(nodeId);
            }, tooltip);

            // Populate node selector
            populateNodeSelector();

            // Store the data for future animations
            previousPlanData = JSON.parse(JSON.stringify(webPlanData));
            return;
        }

        // Try to use optimized update without redraw
        let updatedSuccessfully = false;

        try {
            updatedSuccessfully = visualizer.updateWithoutRedraw(
                oldData,
                newPlanData,
            );
        } catch (error) {
            console.error("Error during incremental update:", error);
            // Continue to fallback approach
        }

        // Fall back to full redraw if needed
        if (!updatedSuccessfully) {
            console.log("Falling back to full redraw");

            // Re-initialize visualization
            if (visualizer) {
                visualizer.destroy();
            }

            visualizer = new Visualizer(cyContainer, webPlanData);
            visualizer.initialize();
            stateForm;

            // Setup event listeners
            visualizer.setupEventListeners((nodeId: string) => {
                updateNodeSelect(nodeId);
            }, tooltip);
        }

        // Always update the node selector
        populateNodeSelector();

        // Show subtle notification of update
        showStatus(`Plan updated via SSE`, false, 1000); // Shorter, less intrusive notification

        // Store the data for future animations
        try {
            previousPlanData = JSON.parse(JSON.stringify(webPlanData));
        } catch (e) {
            console.warn("Unable to clone plan data for animation:", e);
            previousPlanData = null;
        }
    }

    /**
     * Safely update the node select dropdown
     * @param {string} nodeId - The ID of the node to select
     */
    function updateNodeSelect(nodeId: string): void {
        try {
            if (nodeSelect && nodeId) {
                nodeSelect.value = nodeId;
            }
        } catch (error) {
            console.warn("Error updating node select:", error);
        }
    }

    /**
     * Update the plan title in the UI
     * @param {string} title - The new title
     */
    function updateTitle(title: string): void {
        const titleElement = document.getElementById("plan-title");
        if (titleElement && title) {
            titleElement.textContent = title;
        }
    }

    // Initial load
    loadData();

    adjustCanvasHeight();

    updateDynamicControls();

    updateCurrentStateIndicator();

    initializeSSE();

    // Setup screenshot functionality
    setupScreenshotEventListeners();
    addScreenshotAttachmentUI();

    // Make the functions available globally
    (window as any).showScreenshotUploadModal = showScreenshotUploadModal;
    (window as any).uploadScreenshot = uploadScreenshot;
    (window as any).handleFileSelect = handleFileSelect;

    // Make sure to close the connection when the page unloads
    window.addEventListener("beforeunload", () => {
        if (eventSource) {
            eventSource.close();
        }
    });

    window.addEventListener("resize", function () {
        if (formFlyout.style.display === "block") {
            positionFlyout();
        }

        adjustCanvasHeight();
    });
});

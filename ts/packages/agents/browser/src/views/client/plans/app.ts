// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Main application script for the Web Plan Visualizer
 */
import cytoscape from "cytoscape";
import dagre from "dagre";
import cytoscapeDagre from "cytoscape-dagre";

import ApiService from "./apiService.js";
import Visualizer from "./visualizer.js";
import { WebPlanData } from "../../shared/types.js";

declare global {
    interface Window {
        visualizer?: Visualizer;
        handleFileSelect?: (files: FileList | null) => void;
        webPlanData?: any;
    }
}

document.addEventListener("DOMContentLoaded", function () {
    // Check for action view mode
    const urlParams = new URLSearchParams(window.location.search);
    const actionId = urlParams.get("actionId");
    const mode = urlParams.get("mode");

    if (mode === "viewAction" && actionId) {
        initializeActionView(actionId);
        return;
    }

    // Original initialization for normal mode
    initializeNormalMode();
});

async function initializeActionView(actionId: string): Promise<void> {
    try {
        // Configure UI for action view
        hideUIControlsForActionView();
        showCloseButtonForActionView();

        // Add iframe mode class to body for CSS styling
        document.body.classList.add("iframe-mode");

        // Load action data
        const actionData = await ApiService.getActionData(actionId);

        // Set up the plan data
        const webPlanData = actionData.planData;

        // Update title and description
        const titleElement = document.getElementById("plan-title");
        if (titleElement) {
            titleElement.textContent =
                webPlanData.title || actionData.action.name;
        }

        const descriptionElement = document.getElementById("plan-description");
        if (descriptionElement && webPlanData.description) {
            descriptionElement.textContent = webPlanData.description;
            descriptionElement.style.display = "block";
        }

        // Initialize visualization for action view
        initializeActionVisualization(webPlanData);
    } catch (error) {
        console.error("Error loading action:", error);
        showErrorMessage("Failed to load action: " + (error as Error).message);
    }
}

function hideUIControlsForActionView(): void {
    // Hide view mode toggle
    const viewModeToggle = document.querySelector(".view-mode-toggle");
    if (viewModeToggle) {
        (viewModeToggle as HTMLElement).style.display = "none";
    }

    // Hide node selector
    const nodeSelector = document.querySelector(".node-selector");
    if (nodeSelector) {
        (nodeSelector as HTMLElement).style.display = "none";
    }

    // Hide export/tools group in floating controls
    const exportGroup = document.querySelector(
        ".plan-floating-controls .plan-control-group:nth-child(3)",
    );
    if (exportGroup) {
        (exportGroup as HTMLElement).style.display = "none";
    }

    // Keep essential floating controls visible (zoom, path controls)
}

function initializeActionVisualization(webPlanData: WebPlanData): void {
    // Set up cytoscape
    if (typeof dagre === "undefined") {
        console.error("Dagre library not loaded properly");
        return;
    }

    if (typeof (cytoscape as any).layouts?.dagre === "undefined") {
        try {
            window.dagre = dagre;
            cytoscape.use(cytoscapeDagre as any);
        } catch (e) {
            console.error("Failed to register cytoscape-dagre:", e);
            return;
        }
    }

    const cyContainer = document.getElementById("cy-container") as HTMLElement;
    if (!cyContainer) {
        console.error("Cytoscape container not found");
        return;
    }

    // Check if we're in an iframe
    const isInIframe = window.parent !== window;

    // Create visualizer
    const visualizer = new Visualizer(cyContainer, webPlanData);

    if (isInIframe) {
        // When in iframe, wait for container to be properly sized before initializing
        setTimeout(() => {
            visualizer.initialize();
            // Add additional delay to ensure layout is complete before fitting
            setTimeout(() => {
                visualizer.fitToView();
                // Send message to parent that visualization is ready (optional)
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage(
                        { type: "visualizationReady" },
                        "*",
                    );
                }
            }, 300);
        }, 100);
    } else {
        // Normal initialization for standalone mode
        visualizer.initialize();
    }

    // Store globally
    window.visualizer = visualizer;
    window.webPlanData = webPlanData;

    // Set up event listeners for action view controls
    setupActionViewEventListeners(visualizer, webPlanData);
}

function setupActionViewEventListeners(
    visualizer: Visualizer,
    webPlanData: WebPlanData,
): void {
    // Zoom controls
    const zoomInButton = document.getElementById(
        "zoom-in-button",
    ) as HTMLButtonElement;
    const zoomOutButton = document.getElementById(
        "zoom-out-button",
    ) as HTMLButtonElement;
    const zoomFitButton = document.getElementById(
        "zoom-fit-button",
    ) as HTMLButtonElement;
    const centerButton = document.getElementById(
        "center-button",
    ) as HTMLButtonElement;

    if (zoomInButton) {
        zoomInButton.addEventListener("click", () => {
            if (visualizer) {
                visualizer.zoomIn();
            }
        });
    }

    if (zoomOutButton) {
        zoomOutButton.addEventListener("click", () => {
            if (visualizer) {
                visualizer.zoomOut();
            }
        });
    }

    if (zoomFitButton) {
        zoomFitButton.addEventListener("click", () => {
            if (visualizer) {
                visualizer.fitToView();
            }
        });
    }

    if (centerButton) {
        centerButton.addEventListener("click", () => {
            if (visualizer) {
                visualizer.centerGraph();
            }
        });
    }

    // Path and navigation controls
    const showPathButton = document.getElementById(
        "show-path-button",
    ) as HTMLButtonElement;
    const goToCurrentButton = document.getElementById(
        "go-to-current-button",
    ) as HTMLButtonElement;
    const resetViewButton = document.getElementById(
        "reset-view-button",
    ) as HTMLButtonElement;

    if (showPathButton) {
        showPathButton.addEventListener("click", () => {
            if (!visualizer) return;

            if (!visualizer.pathHighlighted) {
                if (webPlanData.currentNode) {
                    visualizer.highlightPath(webPlanData.currentNode);
                }
                showPathButton.classList.add("active");
                showPathButton.title = "Reset Path View";
            } else {
                visualizer.resetEdgeStyles();
                showPathButton.classList.remove("active");
                showPathButton.title = "Show Current Path";
            }
        });
    }

    if (goToCurrentButton) {
        goToCurrentButton.addEventListener("click", () => {
            if (visualizer && webPlanData.currentNode) {
                visualizer.updateCurrentNode(webPlanData.currentNode);
            }
        });
    }

    if (resetViewButton) {
        resetViewButton.addEventListener("click", () => {
            if (visualizer) {
                visualizer.fitToView();
                visualizer.resetEdgeStyles();
                if (showPathButton) {
                    showPathButton.classList.remove("active");
                    showPathButton.title = "Show Current Path";
                }
            }
        });
    }
}

function showCloseButtonForActionView(): void {
    const closeButton = document.getElementById("close-modal-button");
    if (closeButton) {
        closeButton.style.display = "block";
        closeButton.addEventListener("click", closeActionViewModal);
    }
}

function closeActionViewModal(): void {
    // Send message to parent window to close the modal
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "closeModal" }, "*");
    }
}

function showErrorMessage(message: string): void {
    const statusMessage = document.getElementById("status-message");
    if (statusMessage) {
        statusMessage.textContent = message;
        statusMessage.className = "status-message error";
        statusMessage.style.display = "block";
    }
}

function initializeNormalMode(): void {
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
    let currentViewMode: string = "dynamic";
    let webPlanData: WebPlanData = {
        nodes: [],
        links: [],
        currentNode: null,
        title: "Dynamic Plan",
    };
    let visualizer: Visualizer | null = null;
    let floatingControlsInitialized = false; // Track if floating controls are set up

    // DOM elements
    const cyContainer = document.getElementById("cy-container") as HTMLElement;
    const nodeSelect = document.getElementById(
        "node-select",
    ) as HTMLSelectElement;

    const statusMessage = document.getElementById(
        "status-message",
    ) as HTMLDivElement;
    const tooltip = document.getElementById("tooltip") as HTMLDivElement;

    // Add application state for screenshot mode
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
        // Dynamic controls functionality can be managed through the view mode buttons
        // The node selector and other dynamic-only controls are handled in the view mode toggle handlers
        console.log(`Dynamic controls updated for ${currentViewMode} mode`);
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
        if (visualizer) {
            visualizer.destroy();
        }

        visualizer = new Visualizer(cyContainer, webPlanData);
        visualizer.initialize();

        // Make visualizer accessible globally for resize handler
        window.visualizer = visualizer;

        visualizer.setupEventListeners((nodeId: string) => {
            nodeSelect.value = nodeId;
        }, tooltip);

        populateNodeSelector();
        visualizer.startTemporaryNodeAnimation();
    }

    /**
     * Load data from the server
     */
    async function loadData(): Promise<void> {
        try {
            webPlanData = await ApiService.getPlan(currentViewMode);

            initializeVisualization();

            const titleElement = document.getElementById("plan-title");
            if (titleElement && webPlanData.title) {
                titleElement.textContent = webPlanData.title;
            }

            updateDynamicControls();

            // Initialize floating controls only once
            if (!floatingControlsInitialized) {
                setupFloatingControlsEventHandlers(
                    visualizer,
                    webPlanData,
                    null,
                );
                floatingControlsInitialized = true;
            }
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
        currentUploadNodeId = nodeId;

        // Get references to modal elements
        const screenshotUploadModal = document.getElementById(
            "screenshot-upload-modal",
        ) as HTMLDivElement;
        const uploadNodeName = document.getElementById(
            "upload-node-name",
        ) as HTMLElement;

        if (!screenshotUploadModal || !uploadNodeName) {
            console.error("Screenshot upload modal elements not found");
            return;
        }

        uploadNodeName.textContent = nodeLabel || nodeId;

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

        if (!file.type.match("image.*")) {
            showStatus("Please select an image file", true);
            return;
        }

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
        ApiService.uploadScreenshot(
            currentUploadNodeId,
            currentBase64Screenshot,
        )
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
     * Set up floating controls event handlers
     */
    function setupFloatingControlsEventHandlers(
        initialVisualizer: Visualizer | null,
        initialWebPlanData: WebPlanData,
        showPathButton: HTMLButtonElement | null,
    ): void {
        // Function to get current visualizer (handles updates)
        const getCurrentVisualizer = () => visualizer;
        const getCurrentWebPlanData = () => webPlanData;

        // Zoom controls
        const zoomInButton = document.getElementById(
            "zoom-in-button",
        ) as HTMLButtonElement;
        const zoomOutButton = document.getElementById(
            "zoom-out-button",
        ) as HTMLButtonElement;
        const zoomFitButton = document.getElementById(
            "zoom-fit-button",
        ) as HTMLButtonElement;
        const centerButton = document.getElementById(
            "center-button",
        ) as HTMLButtonElement;

        if (zoomInButton) {
            zoomInButton.addEventListener("click", () => {
                const currentVisualizer = getCurrentVisualizer();
                if (currentVisualizer) {
                    currentVisualizer.zoomIn();
                }
            });
        }

        if (zoomOutButton) {
            zoomOutButton.addEventListener("click", () => {
                const currentVisualizer = getCurrentVisualizer();
                if (currentVisualizer) {
                    currentVisualizer.zoomOut();
                }
            });
        }

        if (zoomFitButton) {
            zoomFitButton.addEventListener("click", () => {
                const currentVisualizer = getCurrentVisualizer();
                if (currentVisualizer) {
                    currentVisualizer.fitToView();
                }
            });
        }

        if (centerButton) {
            centerButton.addEventListener("click", () => {
                const currentVisualizer = getCurrentVisualizer();
                if (currentVisualizer) {
                    currentVisualizer.centerGraph();
                }
            });
        }

        // Path and navigation controls
        const showPathButtonFloating = document.getElementById(
            "show-path-button",
        ) as HTMLButtonElement;
        const goToCurrentButton = document.getElementById(
            "go-to-current-button",
        ) as HTMLButtonElement;
        const resetViewButton = document.getElementById(
            "reset-view-button",
        ) as HTMLButtonElement;

        if (showPathButtonFloating) {
            showPathButtonFloating.addEventListener("click", () => {
                const currentVisualizer = getCurrentVisualizer();
                const currentData = getCurrentWebPlanData();
                if (!currentVisualizer) return;

                if (!currentVisualizer.pathHighlighted) {
                    if (currentData.currentNode) {
                        currentVisualizer.highlightPath(
                            currentData.currentNode,
                        );
                    }
                    showPathButtonFloating.classList.add("active");
                    showPathButtonFloating.title = "Reset Path View";
                } else {
                    currentVisualizer.resetEdgeStyles();
                    showPathButtonFloating.classList.remove("active");
                    showPathButtonFloating.title = "Show Current Path";
                }
            });
        }

        if (goToCurrentButton) {
            goToCurrentButton.addEventListener("click", () => {
                const currentVisualizer = getCurrentVisualizer();
                const currentData = getCurrentWebPlanData();
                if (currentVisualizer && currentData.currentNode) {
                    currentVisualizer.updateCurrentNode(
                        currentData.currentNode,
                    );
                    // Update node selector to match
                    const nodeSelect = document.getElementById(
                        "node-select",
                    ) as HTMLSelectElement;
                    if (nodeSelect) {
                        nodeSelect.value = currentData.currentNode;
                    }
                }
            });
        }

        if (resetViewButton) {
            resetViewButton.addEventListener("click", () => {
                const currentVisualizer = getCurrentVisualizer();
                if (currentVisualizer) {
                    currentVisualizer.fitToView();
                    currentVisualizer.resetEdgeStyles();
                    if (showPathButtonFloating) {
                        showPathButtonFloating.classList.remove("active");
                        showPathButtonFloating.title = "Show Current Path";
                    }
                }
            });
        }

        // Export and tools controls
        const screenshotButton = document.getElementById(
            "screenshot-button",
        ) as HTMLButtonElement;
        const exportButton = document.getElementById(
            "export-button",
        ) as HTMLButtonElement;

        if (screenshotButton) {
            screenshotButton.addEventListener("click", () => {
                const currentVisualizer = getCurrentVisualizer();
                if (currentVisualizer) {
                    const cy = currentVisualizer.getCytoscape();
                    if (cy) {
                        // Take screenshot of the graph
                        const png64 = cy.png({
                            output: "base64uri",
                            bg: "white",
                            full: true,
                            scale: 2,
                        });

                        // Create download link
                        const link = document.createElement("a");
                        link.download = `plan-screenshot-${new Date().toISOString().slice(0, 10)}.png`;
                        link.href = png64;
                        link.click();

                        showStatus("Screenshot saved successfully!");
                    }
                }
            });
        }

        if (exportButton) {
            exportButton.addEventListener("click", () => {
                const currentData = getCurrentWebPlanData();
                if (currentData) {
                    // Export plan data as JSON
                    const dataStr = JSON.stringify(currentData, null, 2);
                    const dataBlob = new Blob([dataStr], {
                        type: "application/json",
                    });

                    // Create download link
                    const link = document.createElement("a");
                    link.download = `plan-data-${new Date().toISOString().slice(0, 10)}.json`;
                    link.href = URL.createObjectURL(dataBlob);
                    link.click();

                    showStatus("Plan data exported successfully!");
                }
            });
        }
    }

    /**
     * Set up all event listeners for the screenshot upload functionality
     */
    function setupScreenshotEventListeners(): void {
        console.log("Setting up screenshot event listeners");

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

    // Enhanced view mode toggle handlers
    const viewModeDynamic = document.getElementById(
        "view-mode-dynamic",
    ) as HTMLButtonElement;
    const viewModeStatic = document.getElementById(
        "view-mode-static",
    ) as HTMLButtonElement;

    function updateViewModeButtons(mode: string) {
        if (viewModeDynamic && viewModeStatic) {
            viewModeDynamic.classList.toggle("active", mode === "dynamic");
            viewModeStatic.classList.toggle("active", mode === "static");
        }
    }

    if (viewModeDynamic) {
        viewModeDynamic.addEventListener("click", function () {
            if (currentViewMode !== "dynamic") {
                currentViewMode = "dynamic";
                updateViewModeButtons("dynamic");
                updateDynamicControls();
                loadData();

                // Reset path button state
                const showPathButton =
                    document.getElementById("show-path-button");
                if (showPathButton) {
                    showPathButton.classList.remove("active");
                    showPathButton.title = "Show Current Path";
                }

                showStatus("Switched to dynamic plan view");
            }
        });
    }

    if (viewModeStatic) {
        viewModeStatic.addEventListener("click", function () {
            if (currentViewMode !== "static") {
                currentViewMode = "static";
                updateViewModeButtons("static");
                updateDynamicControls();
                loadData();

                // Reset path button state
                const showPathButton =
                    document.getElementById("show-path-button");
                if (showPathButton) {
                    showPathButton.classList.remove("active");
                    showPathButton.title = "Show Current Path";
                }

                showStatus("Switched to static plan view");
            }
        });
    }

    // Handle node selection change via dropdown
    if (nodeSelect) {
        nodeSelect.addEventListener("change", (e) => {
            if (visualizer) {
                visualizer.updateCurrentNode(
                    (e.target as HTMLSelectElement).value,
                );
            }
        });
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
        eventSource = new EventSource("/api/plans/events");

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
                const eventData = JSON.parse(event.data);
                handleSSEEvent(eventData);
            } catch (error) {
                console.error("Error parsing SSE data:", error);
            }
        };
    }

    /**
     * Handle SSE events
     * @param {any} eventData - The event data
     */
    function handleSSEEvent(eventData: any): void {
        console.log("Received SSE event:", eventData.type);

        // Only process events for the current view mode (dynamic)
        if (currentViewMode !== "dynamic") {
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

    initializeSSE();

    // Setup screenshot functionality
    setupScreenshotEventListeners();

    // Make the functions available globally
    window.showScreenshotUploadModal = showScreenshotUploadModal;
    window.uploadScreenshot = uploadScreenshot;
    window.handleFileSelect = handleFileSelect;

    // Make sure to close the connection when the page unloads
    window.addEventListener("beforeunload", () => {
        if (eventSource) {
            eventSource.close();
        }
    });

    window.addEventListener("resize", function () {
        adjustCanvasHeight();
    });
}

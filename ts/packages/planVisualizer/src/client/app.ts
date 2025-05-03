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

// Ensure the window.webPlanData is accessible globally
declare global {
    interface Window {
        webPlanData?: WebPlanData;
        dagre: any;
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
    const transitionForm = document.getElementById(
        "transition-form",
    ) as HTMLFormElement;
    const originalSubmitHandler = transitionForm.onsubmit;

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

        // Set up event listeners
        visualizer.setupEventListeners((nodeId: string) => {
            nodeSelect.value = nodeId;
        }, tooltip);

        // Populate node selector
        populateNodeSelector();

        // Make sure animation is running if there are temporary nodes
        visualizer.startTemporaryNodeAnimation();
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

    // Handle form submission
    transitionForm.addEventListener("submit", function (e) {
        e.preventDefault();

        if (currentViewMode === CONFIG.VIEW_MODES.STATIC) {
            showStatus(
                "Cannot add transitions in static view. Switch to dynamic view.",
                true,
            );
            return;
        }

        const currentState = (
            document.getElementById("current-state") as HTMLInputElement
        ).value;
        const action = (
            document.getElementById("action-name") as HTMLInputElement
        ).value;
        const nodeType = (
            document.getElementById("node-type") as HTMLSelectElement
        ).value;

        const formData = {
            currentState: currentState, // Can be empty
            action: action, // Can be empty
            nodeType: nodeType,
        };

        ApiService.addTransition(formData)
            .then((result) => {
                const { oldData, newData } = result;

                // Only need to update reference if visualization doesn't do it
                if (
                    !visualizer ||
                    !visualizer.updateWithoutRedraw(oldData, newData)
                ) {
                    webPlanData = newData;

                    // If visualization update failed, reinitialize completely
                    initializeVisualization();

                    // Focus on current node - but don't animate again
                    if (visualizer && webPlanData.currentNode) {
                        visualizer._focusOnNodeContext(webPlanData.currentNode);
                    }
                }

                // Clear the form for the next entry
                (
                    document.getElementById("current-state") as HTMLInputElement
                ).value = "";
                (
                    document.getElementById("action-name") as HTMLInputElement
                ).value = "";

                formFlyout.style.display = "none";
                toggleFormButton.classList.remove("active");
            })
            .catch((error) => {
                showStatus(
                    `Error adding transition: ${(error as Error).message}`,
                    true,
                );
                console.error(error);
            });
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

    updateDynamicControls();

    initializeSSE();

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
    });
});

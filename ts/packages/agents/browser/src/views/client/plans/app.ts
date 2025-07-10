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
    const actionId = urlParams.get('actionId');
    const mode = urlParams.get('mode');
    
    if (mode === 'viewAction' && actionId) {
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
        
        // Load action data
        const actionData = await ApiService.getActionData(actionId);
        
        // Set up the plan data
        const webPlanData = actionData.planData;
        
        // Update title and description
        const titleElement = document.getElementById("plan-title");
        if (titleElement) {
            titleElement.textContent = webPlanData.title || actionData.action.name;
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
    // Hide toggle container
    const toggleContainer = document.querySelector('.toggle-container');
    if (toggleContainer) {
        (toggleContainer as HTMLElement).style.display = 'none';
    }
    
    // Hide dynamic-only controls
    const dynamicControls = document.querySelectorAll('.dynamic-only-control');
    dynamicControls.forEach(control => {
        (control as HTMLElement).style.display = 'none';
    });
    
    // Hide node selector
    const nodeSelector = document.querySelector('.node-selector');
    if (nodeSelector) {
        (nodeSelector as HTMLElement).style.display = 'none';
    }
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
    
    // Create visualizer
    const visualizer = new Visualizer(cyContainer, webPlanData);
    visualizer.initialize();
    
    // Store globally
    window.visualizer = visualizer;
    window.webPlanData = webPlanData;
}

function showCloseButtonForActionView(): void {
    const closeButton = document.getElementById('close-modal-button');
    if (closeButton) {
        closeButton.style.display = 'block';
        closeButton.addEventListener('click', closeActionViewModal);
    }
}

function closeActionViewModal(): void {
    // Send message to parent window to close the modal
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'closeModal' }, '*');
    }
}

function showErrorMessage(message: string): void {
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
        statusMessage.textContent = message;
        statusMessage.className = "status-message error";
        statusMessage.style.display = "block";
    }
}

function initializeNormalMode(): void {
    // This would contain the original app initialization
    // For now, just show a message that normal mode is not implemented in this version
    console.log("Normal mode initialization - would contain original app.ts code");
    
    // Show a simple message
    const titleElement = document.getElementById("plan-title");
    if (titleElement) {
        titleElement.textContent = "Plan Viewer - Action View Only";
    }
}

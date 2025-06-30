// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ScreenshotData } from "./ScreenshotSelector";

/**
 * Screenshot Toolbar Component
 * Shows contextual actions after screenshot selection
 */

export interface ScreenshotAction {
    id: string;
    label: string;
    icon: string;
    action: (screenshotData: ScreenshotData) => void;
}

export class ScreenshotToolbar {
    private element: HTMLElement | null = null;
    private isVisible = false;
    private currentScreenshot: ScreenshotData | null = null;
    private actions: ScreenshotAction[] = [];
    private documentClickHandler: ((event: Event) => void) | null = null;
    private ignoreDocumentClicks = false;

    constructor() {
        this.createToolbarElement();
        this.setupEventListeners();
        this.setupDefaultActions();
    }

    /**
     * Show toolbar for screenshot
     */
    show(screenshotData: ScreenshotData): void {
        this.currentScreenshot = screenshotData;

        if (!this.element) {
            this.createToolbarElement();
        }

        this.updateToolbarContent();
        this.positionToolbar(screenshotData);

        if (this.element) {
            this.element.classList.add("visible");
            this.isVisible = true;
        }

        // Temporarily ignore document clicks to prevent immediate closing
        this.ignoreDocumentClicks = true;
        setTimeout(() => {
            this.ignoreDocumentClicks = false;
        }, 500); // Give user time to interact with toolbar
    }

    /**
     * Hide the toolbar
     */
    hide(): void {
        if (this.element) {
            this.element.classList.remove("visible");
        }
        this.isVisible = false;
        this.currentScreenshot = null;

        // Clear the selection outline when toolbar is hidden
        // We'll need the app to handle this via a callback
        if ((window as any).TypeAgentPDFViewer?.screenshotSelector) {
            (
                window as any
            ).TypeAgentPDFViewer.screenshotSelector.clearSelection();
        }
    }

    /**
     * Add custom action (replace if exists)
     */
    addAction(action: ScreenshotAction): void {
        // Remove existing action with same ID
        this.actions = this.actions.filter((a) => a.id !== action.id);

        // Add the action
        this.actions.push(action);
    }

    /**
     * Remove action
     */
    removeAction(actionId: string): void {
        this.actions = this.actions.filter((action) => action.id !== actionId);
    }

    /**
     * Check if toolbar is visible
     */
    isToolbarVisible(): boolean {
        return this.isVisible;
    }

    /**
     * Set up default actions
     */
    private setupDefaultActions(): void {
        this.actions = [];

        this.actions.push({
            id: "note",
            label: "Add Note",
            icon: "fas fa-sticky-note",
            action: () => {},
        });

        this.actions.push({
            id: "question",
            label: "Ask Question",
            icon: "fas fa-comments",
            action: () => {},
        });
    }

    /**
     * Create the toolbar DOM element
     */
    private createToolbarElement(): void {
        this.element = document.createElement("div");
        this.element.className = "screenshot-toolbar";

        const toolbarContent = document.createElement("div");
        toolbarContent.className = "toolbar-content";
        this.element.appendChild(toolbarContent);

        document.body.appendChild(this.element);
    }

    /**
     * Update toolbar content with icon-only buttons and separators
     */
    private updateToolbarContent(): void {
        if (!this.element || !this.currentScreenshot) return;

        const content = this.element.querySelector(".toolbar-content");
        if (!content) return;

        // Clear existing content
        content.innerHTML = "";

        // Create action buttons with separators (icon-only like contextual toolbar)
        this.actions.forEach((action, index) => {
            // Add vertical separator before each action (except the first)
            if (index > 0) {
                const separator = document.createElement("div");
                separator.className = "toolbar-separator";
                content.appendChild(separator);
            }

            // Create button (icon-only)
            const button = document.createElement("button");
            button.type = "button";
            button.className = "toolbar-action";
            button.setAttribute("data-action-id", action.id);
            button.title = action.label; // Show label in tooltip

            // Icon only (no text label)
            const icon = document.createElement("i");
            icon.className = action.icon;
            button.appendChild(icon);

            // Add click handler
            button.addEventListener("click", this.handleActionClick);

            content.appendChild(button);
        });
    }

    /**
     * Handle action button clicks
     */
    private handleActionClick = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();

        const button = event.currentTarget as HTMLElement;
        const actionId = button.getAttribute("data-action-id");

        console.log("📸 Toolbar action clicked:", actionId);

        if (!actionId || !this.currentScreenshot) {
            console.error("📸 Missing actionId or screenshot data:", {
                actionId,
                hasScreenshot: !!this.currentScreenshot,
            });
            return;
        }

        const action = this.actions.find((a) => a.id === actionId);
        if (action) {
            console.log("📸 Executing action:", actionId);
            try {
                action.action(this.currentScreenshot);
            } catch (error) {
                console.error(
                    `📸 Error executing screenshot action ${actionId}:`,
                    error,
                );
            }
        } else {
            console.error(
                "📸 Action not found:",
                actionId,
                "Available actions:",
                this.actions.map((a) => a.id),
            );
        }
    };

    /**
     * Position the toolbar relative to the screenshot region
     */
    private positionToolbar(screenshotData: ScreenshotData): void {
        if (!this.element) return;

        const { region } = screenshotData;
        const pageRect = region.pageElement.getBoundingClientRect();

        // Calculate position relative to the selected region
        const regionLeft = pageRect.left + region.x;
        const regionTop = pageRect.top + region.y;
        const regionRight = regionLeft + region.width;
        const regionBottom = regionTop + region.height;

        // Get toolbar dimensions
        const toolbarRect = this.element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const padding = 10;
        const arrowOffset = 20;

        // Calculate optimal position
        let left = regionLeft + region.width / 2 - toolbarRect.width / 2;
        let top: number;
        let arrowPosition: "top" | "bottom";

        // Keep toolbar within viewport horizontally
        if (left < padding) {
            left = padding;
        } else if (left + toolbarRect.width > viewportWidth - padding) {
            left = viewportWidth - toolbarRect.width - padding;
        }

        // Try to position below the selection first
        if (
            regionBottom + toolbarRect.height + arrowOffset <
            viewportHeight - padding
        ) {
            top = regionBottom + arrowOffset;
            arrowPosition = "top";
        }
        // If not enough space below, position above
        else if (regionTop - toolbarRect.height - arrowOffset > padding) {
            top = regionTop - toolbarRect.height - arrowOffset;
            arrowPosition = "bottom";
        }
        // Fallback: position below anyway
        else {
            top = regionBottom + arrowOffset;
            arrowPosition = "top";
        }

        this.element.style.top = `${top}px`;
        this.element.style.left = `${left}px`;
    }

    /**
     * Set up event listeners
     */
    private setupEventListeners(): void {
        // Create the document click handler
        this.documentClickHandler = (event: Event) => {
            // Ignore clicks if we're in the ignore period
            if (this.ignoreDocumentClicks) {
                console.log("📸 Ignoring document click during ignore period");
                return;
            }

            const target = event.target as Element;

            // Don't hide if clicking within the toolbar
            if (this.element?.contains(target)) {
                return;
            }

            // Hide toolbar on outside clicks
            console.log("📸 Document click detected, hiding toolbar");
            this.hide();
        };

        // Handle clicks outside toolbar
        document.addEventListener("click", this.documentClickHandler);

        // Handle escape key
        document.addEventListener("keydown", this.handleKeyDown);
    }

    /**
     * Handle keyboard events
     */
    private handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape" && this.isVisible) {
            this.hide();
        }
    };

    /**
     * Clean up and remove toolbar
     */
    destroy(): void {
        if (this.documentClickHandler) {
            document.removeEventListener("click", this.documentClickHandler);
        }
        document.removeEventListener("keydown", this.handleKeyDown);

        if (this.element) {
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }

        this.element = null;
        this.actions = [];
        this.currentScreenshot = null;
        this.isVisible = false;
        this.documentClickHandler = null;
    }
}

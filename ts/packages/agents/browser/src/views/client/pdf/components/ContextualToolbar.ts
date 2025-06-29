// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SelectionInfo } from "../core/textSelectionManager";
import { HighlightColor } from "./ColorPicker";

/**
 * Interface for contextual toolbar actions
 */
export interface ToolbarAction {
    id: string;
    label: string;
    icon: string;
    action: (selection: SelectionInfo, context?: any) => void;
    condition?: (selection: SelectionInfo, context?: any) => boolean;
    hasDropdown?: boolean;
}

/**
 * Context for toolbar - indicates what the user is interacting with
 */
export interface ToolbarContext {
    type: "selection" | "highlight" | "note";
    highlightId?: string;
    annotationId?: string;
    data?: any;
}

/**
 * Interface for toolbar positioning
 */
interface ToolbarPosition {
    top: number;
    left: number;
    arrowPosition: "top" | "bottom" | "left" | "right";
}

/**
 * Interface for selection bounds
 */
interface SelectionBounds {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/**
 * ContextualToolbar - Shows action buttons for text selections
 * Refactored to use persistent elements and avoid recreation
 */
export class ContextualToolbar {
    private element: HTMLElement | null = null;
    private colorDropdown: HTMLElement | null = null;
    private actions: ToolbarAction[] = [];
    private currentSelection: SelectionInfo | null = null;
    private currentContext: ToolbarContext | null = null;
    private isVisible: boolean = false;
    private colorDropdownVisible: boolean = false;
    private highlightColorCallback:
        | ((color: HighlightColor, selection: SelectionInfo) => void)
        | null = null;
    private deleteCallback: ((context: ToolbarContext) => void) | null = null;

    private readonly availableColors: HighlightColor[] = [
        {
            id: "yellow",
            name: "Yellow",
            color: "#ffff00",
            textColor: "#000000",
        },
        { id: "green", name: "Green", color: "#00ff00", textColor: "#000000" },
        { id: "blue", name: "Blue", color: "#0080ff", textColor: "#ffffff" },
        { id: "pink", name: "Pink", color: "#ff69b4", textColor: "#000000" },
        {
            id: "orange",
            name: "Orange",
            color: "#ffa500",
            textColor: "#000000",
        },
        {
            id: "purple",
            name: "Purple",
            color: "#9370db",
            textColor: "#ffffff",
        },
        { id: "red", name: "Red", color: "#ff4444", textColor: "#ffffff" },
        { id: "cyan", name: "Cyan", color: "#00ffff", textColor: "#000000" },
    ];

    constructor() {
        this.createPersistentElements();
        this.setupEventListeners();
    }

    /**
     * Set callback for highlight color selection
     */
    setHighlightColorCallback(
        callback: (color: HighlightColor, selection: SelectionInfo) => void,
    ): void {
        this.highlightColorCallback = callback;
    }

    /**
     * Set callback for delete action
     */
    setDeleteCallback(callback: (context: ToolbarContext) => void): void {
        this.deleteCallback = callback;
    }

    /**
     * Add an action to the toolbar
     */
    addAction(action: ToolbarAction): void {
        this.actions.push(action);
        this.updateToolbarContent(); // Update the persistent toolbar content
    }

    /**
     * Remove an action from the toolbar
     */
    removeAction(actionId: string): void {
        this.actions = this.actions.filter((action) => action.id !== actionId);
        this.updateToolbarContent(); // Update the persistent toolbar content
    }

    /**
     * Show the toolbar for a given selection with context
     */
    show(selection: SelectionInfo, context?: ToolbarContext): void {
        if (!selection || !selection.isValid) {
            this.hide();
            return;
        }

        this.currentSelection = selection;
        this.currentContext = context || { type: "selection" };

        if (!this.element) {
            console.error("❌ Toolbar element not created");
            return;
        }

        // Update toolbar content based on context
        this.updateToolbarContent();

        // Calculate position
        const bounds = this.calculateSelectionBounds(selection);
        const position = this.calculatePosition(bounds);

        // Position and show the toolbar
        this.element.style.top = `${position.top}px`;
        this.element.style.left = `${position.left}px`;
        this.element.style.display = "block";
        this.element.classList.remove("hiding");
        this.element.classList.add("visible");

        this.isVisible = true;
    }

    /**
     * Hide the toolbar
     */
    hide(): void {
        if (!this.isVisible || !this.element) {
            return;
        }

        this.element.style.display = "none";
        this.element.classList.remove("visible");
        this.element.classList.add("hiding");

        this.hideColorDropdown();
        this.isVisible = false;
        this.currentSelection = null;
        this.currentContext = null;
    }

    /**
     * Check if color dropdown is visible (for selection manager)
     */
    isColorDropdownVisible(): boolean {
        return this.colorDropdownVisible;
    }

    /**
     * Create persistent DOM elements that will be reused
     */
    private createPersistentElements(): void {
        // Create main toolbar element using CSS classes
        this.element = document.createElement("div");
        this.element.id = "contextual-toolbar";
        this.element.className = "contextual-toolbar";

        // Create toolbar content container
        const toolbarContent = document.createElement("div");
        toolbarContent.className = "toolbar-content";
        this.element.appendChild(toolbarContent);

        // Create color dropdown element
        this.colorDropdown = document.createElement("div");
        this.colorDropdown.className = "color-dropdown";

        // Create color options
        this.availableColors.forEach((color) => {
            const colorOption = document.createElement("div");
            colorOption.className = "color-option";
            colorOption.setAttribute("data-color-id", color.id);
            colorOption.title = color.name;
            colorOption.style.backgroundColor = color.color; // Only set the background color

            // Add click handler (only attached once!)
            colorOption.addEventListener(
                "click",
                (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation(); // Stop all other handlers
                    this.handleColorSelection(event);
                },
                true,
            ); // Use capture phase to run before document handler

            this.colorDropdown.appendChild(colorOption);
        });

        // Add elements to document
        document.body.appendChild(this.element);
        document.body.appendChild(this.colorDropdown);

        // Initial content update
        this.updateToolbarContent();
    }

    /**
     * Update the toolbar content without recreating elements
     */
    private updateToolbarContent(): void {
        if (!this.element) return;

        const toolbarContent = this.element.querySelector(".toolbar-content");
        if (!toolbarContent) return;

        const availableActions = this.actions.filter(
            (action) =>
                !action.condition ||
                !this.currentSelection ||
                action.condition(this.currentSelection, this.currentContext),
        );

        // Clear existing content but preserve the element
        toolbarContent.innerHTML = "";

        // Create action buttons with separators
        availableActions.forEach((action, index) => {
            // Add vertical separator before each action (except the first)
            if (index > 0) {
                const separator = document.createElement("div");
                separator.className = "toolbar-separator";
                toolbarContent.appendChild(separator);
            }

            // Create button container for highlight action (to hold dropdown)
            if (action.id === "highlight") {
                const container = document.createElement("div");
                container.className = "toolbar-action-container";

                const button = document.createElement("button");
                button.type = "button";
                button.className = "toolbar-action highlight-action";
                button.setAttribute("data-action-id", action.id);
                button.title = action.label;

                // Icon only
                const icon = document.createElement("i");
                icon.className = action.icon;
                button.appendChild(icon);

                // Dropdown arrow
                const arrow = document.createElement("i");
                arrow.className = "fas fa-chevron-down dropdown-arrow";
                button.appendChild(arrow);

                // Add click handler
                button.addEventListener("click", this.handleActionClick);

                container.appendChild(button);
                toolbarContent.appendChild(container);
            } else {
                // Regular action button
                const button = document.createElement("button");
                button.type = "button";
                button.className = "toolbar-action";
                button.setAttribute("data-action-id", action.id);
                button.title = action.label;

                // Icon only
                const icon = document.createElement("i");
                icon.className = action.icon;
                button.appendChild(icon);

                // Add click handler
                button.addEventListener("click", this.handleActionClick);

                toolbarContent.appendChild(button);
            }
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

        if (!actionId || !this.currentSelection) {
            return;
        }

        if (actionId === "highlight") {
            // Show color dropdown
            this.showColorDropdown(button);
        } else if (actionId === "delete") {
            // Execute delete action
            if (this.deleteCallback && this.currentContext) {
                try {
                    this.deleteCallback(this.currentContext);
                    this.hide(); // Hide toolbar after delete
                } catch (error) {
                    console.error(`Failed to execute delete action:`, error);
                }
            }
        } else {
            // Execute normal action
            const action = this.actions.find((a) => a.id === actionId);
            if (action) {
                try {
                    action.action(this.currentSelection, this.currentContext);
                } catch (error) {
                    console.error(
                        `Failed to execute action ${actionId}:`,
                        error,
                    );
                }
            }
        }
    };

    /**
     * Handle color selection from dropdown
     */
    private handleColorSelection = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation(); // Prevent any other handlers

        const colorOption = event.currentTarget as HTMLElement;
        const colorId = colorOption.getAttribute("data-color-id");

        if (colorId && this.highlightColorCallback && this.currentSelection) {
            const color = this.availableColors.find((c) => c.id === colorId);
            if (color) {
                // Call the callback immediately
                this.highlightColorCallback(color, this.currentSelection);

                // Hide after a small delay to ensure callback completes
                setTimeout(() => {
                    this.hideColorDropdown();
                    this.hide();
                }, 10);
            }
        }
    };

    /**
     * Show color dropdown positioned relative to button
     */
    private showColorDropdown(button: HTMLElement): void {
        if (!this.colorDropdown) {
            console.error("❌ Color dropdown element not found");
            return;
        }

        // Position dropdown below the button
        const buttonRect = button.getBoundingClientRect();
        const dropdownTop = buttonRect.bottom + 5;
        const dropdownLeft = buttonRect.left;

        this.colorDropdown.style.top = `${dropdownTop}px`;
        this.colorDropdown.style.left = `${dropdownLeft}px`;
        this.colorDropdown.style.display = "flex";

        this.colorDropdownVisible = true;
    }

    /**
     * Hide color dropdown
     */
    private hideColorDropdown(): void {
        if (!this.colorDropdown) return;

        this.colorDropdown.style.display = "none";
        this.colorDropdownVisible = false;
    }

    /**
     * Calculate selection bounds
     */
    private calculateSelectionBounds(
        selection: SelectionInfo,
    ): SelectionBounds {
        const rects = selection.rects;
        if (rects.length === 0) {
            return {
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: 0,
                height: 0,
            };
        }

        let minLeft = rects[0].left;
        let maxRight = rects[0].right;
        let minTop = rects[0].top;
        let maxBottom = rects[0].bottom;

        for (const rect of rects) {
            minLeft = Math.min(minLeft, rect.left);
            maxRight = Math.max(maxRight, rect.right);
            minTop = Math.min(minTop, rect.top);
            maxBottom = Math.max(maxBottom, rect.bottom);
        }

        return {
            top: minTop,
            left: minLeft,
            right: maxRight,
            bottom: maxBottom,
            width: maxRight - minLeft,
            height: maxBottom - minTop,
        };
    }

    /**
     * Calculate toolbar position
     */
    private calculatePosition(bounds: SelectionBounds): ToolbarPosition {
        const toolbarHeight = 40; // Approximate toolbar height
        const margin = 10;

        let top = bounds.top - toolbarHeight - margin;
        let arrowPosition: "top" | "bottom" | "left" | "right" = "bottom";

        // If toolbar would be off-screen at top, position below selection
        if (top < margin) {
            top = bounds.bottom + margin;
            arrowPosition = "top";
        }

        // Center horizontally on selection
        let left = bounds.left + bounds.width / 2 - 100; // Approximate half toolbar width

        // Keep toolbar on screen horizontally
        const viewportWidth = window.innerWidth;
        if (left < margin) {
            left = margin;
        } else if (left + 200 > viewportWidth - margin) {
            // Approximate toolbar width
            left = viewportWidth - 200 - margin;
        }

        return { top, left, arrowPosition };
    }

    /**
     * Setup global event listeners (attached once)
     */
    private setupEventListeners(): void {
        // Handle clicks outside toolbar/dropdown - ONLY hiding mechanism
        document.addEventListener("click", this.handleDocumentClick);

        // Handle escape key - ONLY other hiding mechanism
        document.addEventListener("keydown", this.handleKeyDown);

        // NO mouse enter/leave events - these cause the show/hide cycling
    }

    /**
     * Handle clicks outside the toolbar/dropdown
     */
    private handleDocumentClick = (event: Event): void => {
        const target = event.target as Element;

        // If we're clicking on a color option, let the color handler deal with it
        if (
            target.classList.contains("color-option") ||
            target.getAttribute("data-color-id")
        ) {
            return;
        }

        // Don't hide if clicking within toolbar or dropdown
        if (
            this.element?.contains(target) ||
            this.colorDropdown?.contains(target)
        ) {
            return;
        }

        // Hide dropdown first, then toolbar
        if (this.colorDropdownVisible) {
            this.hideColorDropdown();
        } else if (this.isVisible) {
            this.hide();
        }
    };

    /**
     * Handle keyboard events
     */
    private handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
            if (this.colorDropdownVisible) {
                this.hideColorDropdown();
            } else if (this.isVisible) {
                this.hide();
            }
        }
    };

    /**
     * Cleanup resources
     */
    destroy(): void {
        // Remove event listeners
        document.removeEventListener("click", this.handleDocumentClick);
        document.removeEventListener("keydown", this.handleKeyDown);

        // Remove elements from DOM
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }

        if (this.colorDropdown && this.colorDropdown.parentNode) {
            this.colorDropdown.parentNode.removeChild(this.colorDropdown);
        }

        // Reset state
        this.element = null;
        this.colorDropdown = null;
        this.currentSelection = null;
        this.currentContext = null;
        this.isVisible = false;
        this.colorDropdownVisible = false;
    }
}

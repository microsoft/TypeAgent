import { SelectionInfo } from "../core/textSelectionManager";

/**
 * Interface for contextual toolbar actions
 */
export interface ToolbarAction {
    id: string;
    label: string;
    icon: string;
    action: (selection: SelectionInfo) => void;
    condition?: (selection: SelectionInfo) => boolean;
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
 */
export class ContextualToolbar {
    private element: HTMLElement | null = null;
    private actions: ToolbarAction[] = [];
    private currentSelection: SelectionInfo | null = null;
    private isVisible: boolean = false;
    private hideTimeout: number | null = null;

    constructor() {
        this.createToolbarElement();
        this.setupEventListeners();
    }

    /**
     * Add an action to the toolbar
     */
    addAction(action: ToolbarAction): void {
        this.actions.push(action);
    }

    /**
     * Remove an action from the toolbar
     */
    removeAction(actionId: string): void {
        this.actions = this.actions.filter(action => action.id !== actionId);
    }

    /**
     * Show the toolbar for a given selection
     */
    show(selection: SelectionInfo): void {
        if (!selection || !selection.isValid) {
            this.hide();
            return;
        }

        this.currentSelection = selection;
        
        if (!this.element) {
            this.createToolbarElement();
        }

        this.updateToolbarContent();
        this.positionToolbar(selection);
        
        if (this.element) {
            this.element.classList.add("visible");
            this.isVisible = true;
        }

        // Cancel any pending hide
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    /**
     * Hide the toolbar
     */
    hide(): void {
        if (this.element) {
            this.element.classList.remove("visible");
        }
        this.isVisible = false;
        this.currentSelection = null;
    }

    /**
     * Hide the toolbar with a delay
     */
    hideWithDelay(delay: number = 300): void {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }

        this.hideTimeout = window.setTimeout(() => {
            this.hide();
            this.hideTimeout = null;
        }, delay);
    }

    /**
     * Cancel delayed hide
     */
    cancelHide(): void {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    /**
     * Check if toolbar is currently visible
     */
    isToolbarVisible(): boolean {
        return this.isVisible;
    }

    /**
     * Create the toolbar DOM element
     */
    private createToolbarElement(): void {
        this.element = document.createElement("div");
        this.element.className = "contextual-toolbar";
        this.element.innerHTML = `
            <div class="toolbar-arrow"></div>
            <div class="toolbar-content">
                <!-- Actions will be populated dynamically -->
            </div>
        `;

        // Add to document body
        document.body.appendChild(this.element);
    }

    /**
     * Update toolbar content based on current actions and selection
     */
    private updateToolbarContent(): void {
        if (!this.element || !this.currentSelection) return;

        const content = this.element.querySelector(".toolbar-content");
        if (!content) return;

        // Filter actions based on conditions
        const availableActions = this.actions.filter(action => 
            !action.condition || action.condition(this.currentSelection!)
        );

        // Create action buttons
        content.innerHTML = availableActions.map(action => `
            <button 
                type="button"
                class="toolbar-action" 
                data-action-id="${action.id}"
                title="${action.label}"
            >
                <i class="${action.icon}"></i>
                <span class="action-label">${action.label}</span>
            </button>
        `).join("");

        // Add click handlers
        content.querySelectorAll(".toolbar-action").forEach(button => {
            button.addEventListener("click", this.handleActionClick);
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
        
        if (!actionId || !this.currentSelection) return;

        const action = this.actions.find(a => a.id === actionId);
        if (action) {
            try {
                action.action(this.currentSelection);
            } catch (error) {
                console.error(`Error executing action ${actionId}:`, error);
            }
        }
    };

    /**
     * Position the toolbar relative to the selection
     */
    private positionToolbar(selection: SelectionInfo): void {
        if (!this.element) return;

        const bounds = this.getSelectionBounds(selection);
        const position = this.calculateOptimalPosition(bounds);
        
        this.element.style.top = `${position.top}px`;
        this.element.style.left = `${position.left}px`;
        
        // Update arrow position
        this.updateArrowPosition(position.arrowPosition);
    }

    /**
     * Get selection bounds in viewport coordinates
     */
    private getSelectionBounds(selection: SelectionInfo): SelectionBounds {
        const rects = selection.rects;
        if (rects.length === 0) {
            return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
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
     * Calculate optimal position for the toolbar
     */
    private calculateOptimalPosition(bounds: SelectionBounds): ToolbarPosition {
        if (!this.element) {
            return { top: 0, left: 0, arrowPosition: "bottom" };
        }

        const toolbarRect = this.element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        const padding = 10; // Minimum distance from viewport edges
        const arrowOffset = 20; // Space for arrow

        // Calculate horizontal position
        let left = bounds.left + (bounds.width / 2) - (toolbarRect.width / 2);
        
        // Keep toolbar within viewport horizontally
        if (left < padding) {
            left = padding;
        } else if (left + toolbarRect.width > viewportWidth - padding) {
            left = viewportWidth - toolbarRect.width - padding;
        }

        // Calculate vertical position
        let top: number;
        let arrowPosition: "top" | "bottom" | "left" | "right";

        // Try to position above selection first
        if (bounds.top - toolbarRect.height - arrowOffset > padding) {
            top = bounds.top - toolbarRect.height - arrowOffset;
            arrowPosition = "bottom";
        }
        // If not enough space above, position below
        else if (bounds.bottom + toolbarRect.height + arrowOffset < viewportHeight - padding) {
            top = bounds.bottom + arrowOffset;
            arrowPosition = "top";
        }
        // If not enough space above or below, position to the side
        else {
            top = bounds.top + (bounds.height / 2) - (toolbarRect.height / 2);
            
            // Keep toolbar within viewport vertically when positioned to side
            if (top < padding) {
                top = padding;
            } else if (top + toolbarRect.height > viewportHeight - padding) {
                top = viewportHeight - toolbarRect.height - padding;
            }

            // Determine left or right side
            if (bounds.left - toolbarRect.width - arrowOffset > padding) {
                left = bounds.left - toolbarRect.width - arrowOffset;
                arrowPosition = "right";
            } else {
                left = bounds.right + arrowOffset;
                arrowPosition = "left";
            }
        }

        return { top, left, arrowPosition };
    }

    /**
     * Update arrow position and styling
     */
    private updateArrowPosition(position: "top" | "bottom" | "left" | "right"): void {
        if (!this.element) return;

        const arrow = this.element.querySelector(".toolbar-arrow") as HTMLElement;
        if (!arrow) return;

        // Reset all arrow classes
        arrow.className = "toolbar-arrow";
        arrow.classList.add(`arrow-${position}`);
    }

    /**
     * Set up event listeners
     */
    private setupEventListeners(): void {
        if (!this.element) return;

        // Prevent toolbar from disappearing when user interacts with it
        this.element.addEventListener("mouseenter", this.cancelHide);
        this.element.addEventListener("mouseleave", () => this.hideWithDelay());

        // Handle clicks outside toolbar
        document.addEventListener("click", this.handleDocumentClick);
        
        // Handle escape key
        document.addEventListener("keydown", this.handleKeyDown);
    }

    /**
     * Handle clicks outside the toolbar
     */
    private handleDocumentClick = (event: Event): void => {
        const target = event.target as Element;
        
        // Don't hide if clicking within the toolbar
        if (this.element?.contains(target)) {
            return;
        }

        // Hide toolbar on outside clicks
        this.hide();
    };

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
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }

        if (this.element) {
            document.removeEventListener("click", this.handleDocumentClick);
            document.removeEventListener("keydown", this.handleKeyDown);
            
            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }

        this.element = null;
        this.actions = [];
        this.currentSelection = null;
        this.isVisible = false;
    }
}

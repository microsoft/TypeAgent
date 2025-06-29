import { SelectionInfo } from "../core/textSelectionManager";
import { HighlightColor } from "./ColorPicker";

/**
 * Interface for contextual toolbar actions
 */
export interface ToolbarAction {
    id: string;
    label: string;
    icon: string;
    action: (selection: SelectionInfo) => void;
    condition?: (selection: SelectionInfo) => boolean;
    hasDropdown?: boolean;
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
    private colorDropdownVisible: boolean = false;
    private highlightColorCallback: ((color: HighlightColor) => void) | null = null;
    private dropdownJustOpened: boolean = false;

    private readonly availableColors: HighlightColor[] = [
        { id: "yellow", name: "Yellow", color: "#ffff00", textColor: "#000000" },
        { id: "green", name: "Green", color: "#00ff00", textColor: "#000000" },
        { id: "blue", name: "Blue", color: "#0080ff", textColor: "#ffffff" },
        { id: "pink", name: "Pink", color: "#ff69b4", textColor: "#000000" },
        { id: "orange", name: "Orange", color: "#ffa500", textColor: "#000000" },
        { id: "purple", name: "Purple", color: "#9370db", textColor: "#ffffff" },
        { id: "red", name: "Red", color: "#ff4444", textColor: "#ffffff" },
        { id: "cyan", name: "Cyan", color: "#00ffff", textColor: "#000000" },
    ];

    constructor() {
        this.createToolbarElement();
        this.setupEventListeners();
    }

    /**
     * Set callback for highlight color selection
     */
    setHighlightColorCallback(callback: (color: HighlightColor) => void): void {
        this.highlightColorCallback = callback;
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

        // Only update toolbar content if dropdown is not currently visible
        // This prevents destroying the open dropdown during re-render
        if (!this.colorDropdownVisible) {
            console.log("🔄 Updating toolbar content (dropdown not visible)");
            this.updateToolbarContent();
        } else {
            console.log("🔄 Skipping toolbar content update (dropdown is visible)");
        }
        
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
        this.hideColorDropdown();
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
     * Check if color dropdown is currently visible
     */
    isColorDropdownVisible(): boolean {
        return this.colorDropdownVisible;
    }

    /**
     * Create the toolbar DOM element
     */
    private createToolbarElement(): void {
        this.element = document.createElement("div");
        this.element.className = "contextual-toolbar";
        this.element.innerHTML = `
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

        // Store current dropdown state before re-rendering
        const wasDropdownVisible = this.colorDropdownVisible;
        console.log("🔄 Updating toolbar content, dropdown was visible:", wasDropdownVisible);

        // Filter actions based on conditions
        const availableActions = this.actions.filter(action => 
            !action.condition || action.condition(this.currentSelection!)
        );

        // Create action buttons
        content.innerHTML = availableActions.map(action => {
            if (action.id === "highlight") {
                return `
                    <div class="toolbar-action-container">
                        <button 
                            type="button"
                            class="toolbar-action highlight-action" 
                            data-action-id="${action.id}"
                            title="${action.label}"
                        >
                            <i class="${action.icon}"></i>
                            <span class="action-label">${action.label}</span>
                            <i class="fas fa-chevron-down dropdown-arrow"></i>
                        </button>
                        <div class="color-dropdown" style="display: ${wasDropdownVisible ? 'flex' : 'none'};">
                            ${this.availableColors.map(color => `
                                <div class="color-option" 
                                     data-color-id="${color.id}" 
                                     title="${color.name}"
                                     style="background-color: ${color.color};">
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                return `
                    <button 
                        type="button"
                        class="toolbar-action" 
                        data-action-id="${action.id}"
                        title="${action.label}"
                    >
                        <i class="${action.icon}"></i>
                        <span class="action-label">${action.label}</span>
                    </button>
                `;
            }
        }).join("");

        // Add click handlers
        content.querySelectorAll(".toolbar-action").forEach(button => {
            button.addEventListener("click", this.handleActionClick);
        });

        // Add color dropdown handlers
        content.querySelectorAll(".color-option").forEach(colorOption => {
            colorOption.addEventListener("click", this.handleColorSelection);
            // Prevent color option clicks from bubbling
            colorOption.addEventListener("click", (e) => {
                e.stopPropagation();
            });
            
            // Add debugging for color options
            console.log("🎨 Added click handler to color option:", colorOption.getAttribute("data-color-id"));
        });

        // Restore dropdown state after re-rendering
        if (wasDropdownVisible) {
            console.log("🔄 Restoring dropdown visibility after re-render");
            this.colorDropdownVisible = true;
        }
    }

    /**
     * Handle action button clicks
     */
    private handleActionClick = (event: Event): void => {
        console.log("🔘 Action click detected:", event.target);
        
        // For ALL actions, stop the event from bubbling to document
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const button = event.currentTarget as HTMLElement;
        const actionId = button.getAttribute("data-action-id");
        
        console.log("🔘 Action ID:", actionId);
        
        if (!actionId || !this.currentSelection) {
            console.log("🔘 Missing actionId or selection");
            return;
        }

        if (actionId === "highlight") {
            console.log("🔘 Highlight action - toggling dropdown");
            
            // Set flag to prevent immediate closure
            this.dropdownJustOpened = true;
            
            // Toggle dropdown immediately
            this.toggleColorDropdown(button);
            
            // Use requestAnimationFrame to ensure dropdown is rendered before allowing clicks
            requestAnimationFrame(() => {
                setTimeout(() => {
                    this.dropdownJustOpened = false;
                    console.log("🎨 Dropdown protection flag cleared");
                }, 50);
            });
            
        } else {
            console.log("🔘 Executing normal action:", actionId);
            // Execute normal action
            const action = this.actions.find(a => a.id === actionId);
            if (action) {
                try {
                    action.action(this.currentSelection);
                } catch (error) {
                    console.error(`Error executing action ${actionId}:`, error);
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

        const colorOption = event.currentTarget as HTMLElement;
        const colorId = colorOption.getAttribute("data-color-id");
        
        console.log("🎨 Color selected:", colorId);
        
        if (colorId && this.highlightColorCallback) {
            const color = this.availableColors.find(c => c.id === colorId);
            if (color) {
                console.log("🎨 Executing highlight with color:", color);
                this.highlightColorCallback(color);
                this.hideColorDropdown();
                this.hide();
            }
        }
    };

    /**
     * Toggle color dropdown visibility
     */
    private toggleColorDropdown(button: HTMLElement): void {
        console.log("🎨 Toggle dropdown called, current state:", this.colorDropdownVisible);
        
        const container = button.closest(".toolbar-action-container");
        const dropdown = container?.querySelector(".color-dropdown") as HTMLElement;
        
        console.log("🎨 Container found:", !!container);
        console.log("🎨 Dropdown found:", !!dropdown);
        
        if (!dropdown) {
            console.error("🎨 Dropdown element not found!");
            return;
        }

        if (this.colorDropdownVisible) {
            console.log("🎨 Hiding dropdown");
            this.hideColorDropdown();
        } else {
            console.log("🎨 Showing dropdown");
            this.showColorDropdown(dropdown);
        }
    }

    /**
     * Show color dropdown
     */
    private showColorDropdown(dropdown: HTMLElement): void {
        console.log("🎨 showColorDropdown called");
        
        // Cancel any pending hide of the toolbar
        this.cancelHide();
        
        // Hide any other dropdowns first (if we had multiple)
        this.hideColorDropdown();
        
        // Show the dropdown
        dropdown.style.display = "flex";
        this.colorDropdownVisible = true;
        console.log("🎨 Dropdown display set to flex, visible flag set to true");
        
        // Add mouse event handlers to prevent toolbar hiding when interacting with dropdown
        dropdown.addEventListener("mouseenter", this.cancelHide);
        dropdown.addEventListener("mouseleave", () => {
            console.log("🎨 Mouse left dropdown - starting hide timer");
            this.hideWithDelay();
        });
        
        // Ensure dropdown is properly positioned and visible
        // Force a reflow to ensure the style is applied
        dropdown.offsetHeight;
        
        console.log("🎨 Dropdown should now be visible, computed display:", 
            window.getComputedStyle(dropdown).display);
    }

    /**
     * Hide color dropdown
     */
    private hideColorDropdown(): void {
        console.log("🎨 hideColorDropdown called");
        
        if (!this.element) return;
        
        const dropdown = this.element.querySelector(".color-dropdown") as HTMLElement;
        if (dropdown) {
            console.log("🎨 Setting dropdown display to none");
            dropdown.style.display = "none";
        } else {
            console.log("🎨 No dropdown found to hide");
        }
        this.colorDropdownVisible = false;
        console.log("🎨 Dropdown visible flag set to false");
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
     * Set up event listeners
     */
    private setupEventListeners(): void {
        if (!this.element) return;

        // Prevent toolbar from disappearing when user interacts with it
        this.element.addEventListener("mouseenter", this.cancelHide);
        this.element.addEventListener("mouseleave", () => {
            // Don't start hide timer if dropdown is open
            if (this.colorDropdownVisible) {
                console.log("🖱️ Mouseleave detected but dropdown is open - not hiding");
                return;
            }
            console.log("🖱️ Mouseleave detected - starting hide timer");
            this.hideWithDelay();
        });

        // Handle clicks outside toolbar
        document.addEventListener("click", this.handleDocumentClick);
        
        // Handle escape key
        document.addEventListener("keydown", this.handleKeyDown);
    }

    /**
     * Handle clicks outside the toolbar
     */
    private handleDocumentClick = (event: Event): void => {
        console.log("📄 Document click detected, dropdown just opened:", this.dropdownJustOpened);
        
        // Don't handle document clicks if dropdown was just opened
        if (this.dropdownJustOpened) {
            console.log("📄 Ignoring document click - dropdown just opened");
            return;
        }
        
        const target = event.target as Element;
        console.log("📄 Click target:", target);
        
        // Don't hide if clicking within the toolbar (including dropdowns)
        if (this.element?.contains(target)) {
            console.log("📄 Click is within toolbar, ignoring");
            return;
        }

        console.log("📄 Click is outside toolbar, dropdown visible:", this.colorDropdownVisible);

        // If color dropdown is visible, only hide the dropdown on outside clicks
        if (this.colorDropdownVisible) {
            console.log("📄 Hiding color dropdown");
            this.hideColorDropdown();
            return;
        }

        // Hide toolbar on outside clicks
        console.log("📄 Hiding entire toolbar");
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
        this.dropdownJustOpened = false;
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Color Picker Component for highlighting
 * Provides predefined highlight colors with preview
 */

export interface HighlightColor {
    id: string;
    name: string;
    color: string;
    textColor?: string;
}

export type ColorSelectCallback = (color: HighlightColor) => void;

export class ColorPicker {
    private element: HTMLElement | null = null;
    private isVisible = false;
    private callback: ColorSelectCallback | null = null;

    private readonly defaultColors: HighlightColor[] = [
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
        this.createColorPickerElement();
        this.setupEventListeners();
    }

    /**
     * Show color picker at specified position
     */
    show(x: number, y: number, callback: ColorSelectCallback): void {
        if (!this.element) return;

        this.callback = callback;
        this.positionPicker(x, y);

        this.element.classList.add("visible");
        this.isVisible = true;
    }

    /**
     * Hide the color picker
     */
    hide(): void {
        if (!this.element || !this.isVisible) return;

        this.element.classList.remove("visible");
        this.isVisible = false;
        this.callback = null;
    }

    /**
     * Check if color picker is visible
     */
    isPickerVisible(): boolean {
        return this.isVisible;
    }

    /**
     * Get all available colors
     */
    getColors(): HighlightColor[] {
        return [...this.defaultColors];
    }

    /**
     * Get color by ID
     */
    getColorById(id: string): HighlightColor | null {
        return this.defaultColors.find((color) => color.id === id) || null;
    }

    /**
     * Create the color picker DOM element
     */
    private createColorPickerElement(): void {
        this.element = document.createElement("div");
        this.element.className = "color-picker";

        this.element.innerHTML = `
            <div class="color-picker-header">
                <span class="picker-title">Choose highlight color</span>
            </div>
            <div class="color-grid">
                ${this.defaultColors
                    .map(
                        (color) => `
                    <button 
                        type="button"
                        class="color-option" 
                        data-color-id="${color.id}"
                        title="${color.name}"
                        style="background-color: ${color.color}; color: ${color.textColor || "#000000"};"
                    >
                        <div class="color-preview" style="background-color: ${color.color};"></div>
                        <span class="color-name">${color.name}</span>
                    </button>
                `,
                    )
                    .join("")}
            </div>
        `;

        // Add to document body
        document.body.appendChild(this.element);
    }

    /**
     * Position the color picker
     */
    private positionPicker(x: number, y: number): void {
        if (!this.element) return;

        const rect = this.element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const padding = 10;

        // Adjust position to keep picker within viewport
        let left = x;
        let top = y;

        if (left + rect.width > viewportWidth - padding) {
            left = viewportWidth - rect.width - padding;
        }

        if (left < padding) {
            left = padding;
        }

        if (top + rect.height > viewportHeight - padding) {
            top = y - rect.height - 10; // Position above if no space below
        }

        if (top < padding) {
            top = padding;
        }

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
    }

    /**
     * Set up event listeners
     */
    private setupEventListeners(): void {
        if (!this.element) return;

        // Handle color selection
        this.element.addEventListener("click", this.handleColorClick);

        // Handle clicks outside picker
        document.addEventListener("click", this.handleDocumentClick);

        // Handle escape key
        document.addEventListener("keydown", this.handleKeyDown);
    }

    /**
     * Handle color selection clicks
     */
    private handleColorClick = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();

        const target = event.target as Element;
        const colorButton = target.closest(".color-option") as HTMLElement;

        if (!colorButton) return;

        const colorId = colorButton.getAttribute("data-color-id");
        if (!colorId) return;

        const color = this.getColorById(colorId);
        if (color && this.callback) {
            this.callback(color);
            this.hide();
        }
    };

    /**
     * Handle clicks outside the picker
     */
    private handleDocumentClick = (event: Event): void => {
        const target = event.target as Element;

        // Don't hide if clicking within the picker
        if (this.element?.contains(target)) {
            return;
        }

        // Hide picker on outside clicks
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
     * Clean up and remove picker
     */
    destroy(): void {
        if (this.element) {
            document.removeEventListener("click", this.handleDocumentClick);
            document.removeEventListener("keydown", this.handleKeyDown);

            if (this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }
        }

        this.element = null;
        this.isVisible = false;
        this.callback = null;
    }
}

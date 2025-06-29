// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Text Selection Manager for PDF viewer
 * Handles text selection events and provides selection information
 */

export interface SelectionInfo {
    text: string;
    pageNumber: number;
    rects: DOMRect[];
    range: Range;
    isValid: boolean;
}

export interface SelectionBounds {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export type SelectionChangeCallback = (selection: SelectionInfo | null) => void;

export class TextSelectionManager {
    private callbacks: SelectionChangeCallback[] = [];
    private currentSelection: SelectionInfo | null = null;
    private selectionTimeout: number | null = null;
    private pdfViewer: any;
    private contextualToolbar: any = null;

    constructor(pdfViewer: any) {
        this.pdfViewer = pdfViewer;
        this.setupEventListeners();
    }

    /**
     * Register a callback for selection changes
     */
    onSelectionChange(callback: SelectionChangeCallback): void {
        this.callbacks.push(callback);
    }

    /**
     * Set reference to contextual toolbar for dropdown state checking
     */
    setContextualToolbar(toolbar: any): void {
        this.contextualToolbar = toolbar;
    }

    /**
     * Remove a selection change callback
     */
    removeSelectionCallback(callback: SelectionChangeCallback): void {
        const index = this.callbacks.indexOf(callback);
        if (index > -1) {
            this.callbacks.splice(index, 1);
        }
    }

    /**
     * Get current selection information
     */
    getCurrentSelection(): SelectionInfo | null {
        return this.currentSelection;
    }

    /**
     * Clear current selection
     */
    clearSelection(): void {
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
        }
        this.updateSelection(null);
    }

    /**
     * Calculate the bounding box for a selection across multiple text elements
     */
    getSelectionBounds(selection: SelectionInfo): SelectionBounds {
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
     * Set up event listeners for text selection
     */
    private setupEventListeners(): void {
        // Listen for selection changes
        document.addEventListener(
            "selectionchange",
            this.handleSelectionChange,
        );

        // Listen for mouse up events to catch selection completion
        document.addEventListener("mouseup", this.handleMouseUp);

        // Listen for key events that might change selection
        document.addEventListener("keyup", this.handleKeyUp);
    }

    /**
     * Handle selection change events
     */
    private handleSelectionChange = (): void => {
        // Debounce selection changes to avoid excessive processing
        if (this.selectionTimeout) {
            clearTimeout(this.selectionTimeout);
        }

        this.selectionTimeout = window.setTimeout(() => {
            this.processSelectionChange();
        }, 100);
    };

    /**
     * Handle mouse up events
     */
    private handleMouseUp = (event: MouseEvent): void => {
        // Check if color dropdown is open before processing selection
        if (
            this.contextualToolbar &&
            this.contextualToolbar.isColorDropdownVisible()
        ) {
            return;
        }

        // Small delay to ensure selection is complete
        setTimeout(() => {
            this.processSelectionChange();
        }, 50);
    };

    /**
     * Handle key up events
     */
    private handleKeyUp = (event: KeyboardEvent): void => {
        // Handle keyboard shortcuts that might affect selection
        if (event.key === "Escape") {
            this.clearSelection();
        }
    };

    /**
     * Process the current selection and update state
     */
    private processSelectionChange(): void {
        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
            this.updateSelection(null);
            return;
        }

        const range = selection.getRangeAt(0);

        // Check if selection is empty or collapsed
        if (range.collapsed || selection.toString().trim().length === 0) {
            this.updateSelection(null);
            return;
        }

        // Check if selection is within PDF viewer
        const viewerContainer = document.getElementById("viewerContainer");
        if (
            !viewerContainer ||
            !this.isSelectionInPDF(range, viewerContainer)
        ) {
            this.updateSelection(null);
            return;
        }

        // Get page number from selection
        const pageNumber = this.getPageNumberFromSelection(range);
        if (pageNumber === -1) {
            this.updateSelection(null);
            return;
        }

        // Get selection rectangles
        const rects = this.getSelectionRects(range);

        const selectionInfo: SelectionInfo = {
            text: selection.toString().trim(),
            pageNumber,
            rects,
            range: range.cloneRange(),
            isValid: true,
        };

        this.updateSelection(selectionInfo);
    }

    /**
     * Check if selection is within the PDF viewer
     */
    private isSelectionInPDF(range: Range, viewerContainer: Element): boolean {
        const startContainer = range.startContainer;
        const endContainer = range.endContainer;

        // Check if both start and end are within viewer
        return (
            viewerContainer.contains(startContainer) &&
            viewerContainer.contains(endContainer)
        );
    }

    /**
     * Get page number from selection range
     */
    private getPageNumberFromSelection(range: Range): number {
        // Find the page element that contains the selection
        let element = range.startContainer;

        // If it's a text node, get its parent
        if (element.nodeType === Node.TEXT_NODE) {
            element = element.parentElement || element.parentNode;
        }

        // Traverse up to find the page element
        while (element && element !== document.body) {
            if ((element as Element).classList?.contains("page")) {
                const pageAttr = (element as Element).getAttribute(
                    "data-page-number",
                );
                return pageAttr ? parseInt(pageAttr) : -1;
            }
            element = element.parentElement || element.parentNode;
        }

        return -1;
    }

    /**
     * Get all rectangles for the current selection
     */
    private getSelectionRects(range: Range): DOMRect[] {
        const rects: DOMRect[] = [];

        try {
            // Get all client rectangles for the selection
            const clientRects = range.getClientRects();

            for (let i = 0; i < clientRects.length; i++) {
                const rect = clientRects[i];
                // Filter out zero-width/height rectangles
                if (rect.width > 0 && rect.height > 0) {
                    rects.push(rect);
                }
            }
        } catch (error) {
            console.error("Error getting selection rectangles:", error);
        }

        return rects;
    }

    /**
     * Update current selection and notify callbacks
     */
    private updateSelection(selection: SelectionInfo | null): void {
        this.currentSelection = selection;

        // Notify all callbacks
        this.callbacks.forEach((callback) => {
            try {
                callback(selection);
            } catch (error) {
                console.error("Error in selection callback:", error);
            }
        });
    }

    /**
     * Clean up event listeners
     */
    destroy(): void {
        document.removeEventListener(
            "selectionchange",
            this.handleSelectionChange,
        );
        document.removeEventListener("mouseup", this.handleMouseUp);
        document.removeEventListener("keyup", this.handleKeyUp);

        if (this.selectionTimeout) {
            clearTimeout(this.selectionTimeout);
        }

        this.callbacks = [];
        this.currentSelection = null;
    }
}

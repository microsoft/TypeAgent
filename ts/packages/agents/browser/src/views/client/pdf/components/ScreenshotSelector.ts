// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Screenshot Selector Component
 * Allows users to select a region of the document for clipping
 */

export interface ScreenshotRegion {
    x: number;
    y: number;
    width: number;
    height: number;
    pageElement: HTMLElement;
    pageNumber: number;
}

export interface ScreenshotData {
    region: ScreenshotRegion;
    imageData: string; // base64 data URL
    timestamp: string;
}

export type ScreenshotSelectCallback = (data: ScreenshotData) => void;
export type ScreenshotCancelCallback = () => void;

export class ScreenshotSelector {
    private isActive = false;
    private overlay: HTMLElement | null = null;
    private selectionBox: HTMLElement | null = null;
    private startPoint: { x: number; y: number } | null = null;
    private currentRegion: ScreenshotRegion | null = null;
    private selectCallback: ScreenshotSelectCallback | null = null;
    private cancelCallback: ScreenshotCancelCallback | null = null;

    constructor() {
        this.createOverlay();
        this.setupEventListeners();
    }

    /**
     * Start screenshot selection mode
     */
    startSelection(
        onSelect: ScreenshotSelectCallback,
        onCancel: ScreenshotCancelCallback,
    ): void {
        if (this.isActive) return;

        this.selectCallback = onSelect;
        this.cancelCallback = onCancel;
        this.isActive = true;

        // Show overlay
        if (this.overlay) {
            this.overlay.style.display = "block";
            document.body.style.cursor = "crosshair";
        }

        // Add keyboard listener for escape
        document.addEventListener("keydown", this.handleKeyDown);
    }

    /**
     * Stop screenshot selection mode
     */
    stopSelection(): void {
        if (!this.isActive) return;

        this.isActive = false;
        this.startPoint = null;
        // Don't clear currentRegion - keep it for toolbar positioning
        // Don't hide selection box - keep it visible while toolbar is shown

        // Hide overlay but keep selection box visible
        if (this.overlay) {
            this.overlay.style.display = "none";
        }

        // Reset cursor
        document.body.style.cursor = "";

        // Remove keyboard listener
        document.removeEventListener("keydown", this.handleKeyDown);

        // Clear callbacks but don't reset selection box yet
        this.selectCallback = null;
        this.cancelCallback = null;
    }

    /**
     * Clear the selection completely (called when toolbar is hidden)
     */
    clearSelection(): void {
        this.currentRegion = null;
        this.hideSelectionBox();
    }

    /**
     * Check if selector is active
     */
    isSelectionActive(): boolean {
        return this.isActive;
    }

    /**
     * Create overlay element
     */
    private createOverlay(): void {
        this.overlay = document.createElement("div");
        this.overlay.className = "screenshot-overlay";
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.3);
            z-index: 9999;
            display: none;
            cursor: crosshair;
        `;

        // Create selection box as a separate element (not child of overlay)
        // This way it stays visible when overlay is hidden
        this.selectionBox = document.createElement("div");
        this.selectionBox.className = "screenshot-selection-box";
        this.selectionBox.style.cssText = `
            position: fixed;
            border: 2px dashed #007acc;
            background: rgba(0, 122, 204, 0.1);
            display: none;
            pointer-events: none;
            z-index: 10000;
        `;

        // Add overlay to body
        document.body.appendChild(this.overlay);
        // Add selection box to body separately
        document.body.appendChild(this.selectionBox);
    }

    /**
     * Set up event listeners
     */
    private setupEventListeners(): void {
        if (!this.overlay) return;

        this.overlay.addEventListener("mousedown", this.handleMouseDown);
        this.overlay.addEventListener("mousemove", this.handleMouseMove);
        this.overlay.addEventListener("mouseup", this.handleMouseUp);
    }

    /**
     * Handle mouse down event
     */
    private handleMouseDown = (event: MouseEvent): void => {
        if (!this.isActive) return;

        event.preventDefault();
        event.stopPropagation();

        this.startPoint = { x: event.clientX, y: event.clientY };
        this.showSelectionBox(event.clientX, event.clientY, 0, 0);
    };

    /**
     * Handle mouse move event
     */
    private handleMouseMove = (event: MouseEvent): void => {
        if (!this.isActive || !this.startPoint) return;

        event.preventDefault();
        event.stopPropagation();

        const width = Math.abs(event.clientX - this.startPoint.x);
        const height = Math.abs(event.clientY - this.startPoint.y);
        const left = Math.min(event.clientX, this.startPoint.x);
        const top = Math.min(event.clientY, this.startPoint.y);

        this.showSelectionBox(left, top, width, height);
    };

    /**
     * Handle mouse up event
     */
    private handleMouseUp = (event: MouseEvent): void => {
        if (!this.isActive || !this.startPoint) return;

        // Prevent this mouse event from bubbling and triggering document click handlers
        event.preventDefault();
        event.stopPropagation();

        const width = Math.abs(event.clientX - this.startPoint.x);
        const height = Math.abs(event.clientY - this.startPoint.y);

        console.log("📸 Screenshot selection:", { width, height });

        // Minimum selection size
        if (width < 10 || height < 10) {
            console.log("📸 Selection too small, ignoring");
            this.hideSelectionBox();
            this.startPoint = null;
            return;
        }

        const left = Math.min(event.clientX, this.startPoint.x);
        const top = Math.min(event.clientY, this.startPoint.y);

        console.log("📸 Selection coordinates:", { left, top, width, height });

        // Find the page element under the selection
        const pageElement = this.findPageElementInRegion(
            left,
            top,
            width,
            height,
        );
        if (!pageElement) {
            console.warn("📸 No page element found for selection");
            this.hideSelectionBox();
            this.startPoint = null;
            return;
        }

        console.log("📸 Page element found:", pageElement);

        // Calculate region relative to page
        const pageRect = pageElement.getBoundingClientRect();
        const pageNumber = this.getPageNumber(pageElement);

        console.log("📸 Page info:", { pageNumber, pageRect });

        const region: ScreenshotRegion = {
            x: left - pageRect.left,
            y: top - pageRect.top,
            width,
            height,
            pageElement,
            pageNumber,
        };

        this.currentRegion = region;
        console.log("📸 Starting capture for region:", region);

        // Add a small delay to ensure the mouse event has fully processed
        setTimeout(() => {
            this.captureRegion(region);
        }, 10);
    };

    /**
     * Handle keyboard events
     */
    private handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
            this.cancel();
        }
    };

    /**
     * Show selection box
     */
    private showSelectionBox(
        left: number,
        top: number,
        width: number,
        height: number,
    ): void {
        if (!this.selectionBox) return;

        this.selectionBox.style.left = `${left}px`;
        this.selectionBox.style.top = `${top}px`;
        this.selectionBox.style.width = `${width}px`;
        this.selectionBox.style.height = `${height}px`;
        this.selectionBox.style.display = "block";
    }

    /**
     * Hide selection box
     */
    private hideSelectionBox(): void {
        if (this.selectionBox) {
            this.selectionBox.style.display = "none";
        }
    }

    /**
     * Find page element in the selection region
     */
    private findPageElementInRegion(
        left: number,
        top: number,
        width: number,
        height: number,
    ): HTMLElement | null {
        const centerX = left + width / 2;
        const centerY = top + height / 2;

        console.log("📸 Looking for element at:", { centerX, centerY });

        // Temporarily hide the overlay to get the element underneath
        const overlay = this.overlay;
        if (overlay) overlay.style.display = "none";

        const element = document.elementFromPoint(centerX, centerY);

        // Restore overlay
        if (overlay) overlay.style.display = "block";

        if (!element) {
            console.warn("📸 No element found at point");
            return null;
        }

        console.log("📸 Element at point:", element.tagName, element.className);

        // Find the page element - try multiple strategies
        let pageElement: HTMLElement | null = null;

        // Strategy 1: Look for data-page-number attribute
        pageElement = element.closest("[data-page-number]") as HTMLElement;
        if (pageElement) {
            console.log("📸 Found page via data-page-number:", pageElement);
            return pageElement;
        }

        // Strategy 2: Look for .page class
        pageElement = element.closest(".page") as HTMLElement;
        if (pageElement) {
            console.log("📸 Found page via .page class:", pageElement);
            return pageElement;
        }

        // Strategy 3: Look for PDF.js page structure
        pageElement = element.closest(".pdfViewer .page") as HTMLElement;
        if (pageElement) {
            console.log("📸 Found page via .pdfViewer .page:", pageElement);
            return pageElement;
        }

        // Strategy 4: Look within viewerContainer
        const viewerContainer = document.getElementById("viewerContainer");
        if (viewerContainer && viewerContainer.contains(element)) {
            // Get first child that might be a page
            const pages = viewerContainer.querySelectorAll(
                "[data-page-number], .page",
            );
            if (pages.length > 0) {
                console.log("📸 Using first page as fallback:", pages[0]);
                return pages[0] as HTMLElement;
            }
        }

        console.warn("📸 No page element found using any strategy");
        return null;
    }

    /**
     * Get page number from page element
     */
    private getPageNumber(pageElement: HTMLElement): number {
        const pageAttr = pageElement.getAttribute("data-page-number");
        if (pageAttr) {
            return parseInt(pageAttr);
        }

        // Fallback: try to find page number from page class or siblings
        const pages = document.querySelectorAll("[data-page-number], .page");
        for (let i = 0; i < pages.length; i++) {
            if (pages[i] === pageElement) {
                return i + 1;
            }
        }

        return 1; // Default to page 1
    }

    /**
     * Capture the selected region as an image
     */
    private async captureRegion(region: ScreenshotRegion): Promise<void> {
        try {
            console.log("📸 Starting screenshot capture...");

            // Use html2canvas to capture the specific region
            const html2canvas = await this.loadHtml2Canvas();
            console.log("📸 html2canvas loaded successfully");

            console.log("📸 Capturing region:", {
                element: region.pageElement.tagName,
                x: region.x,
                y: region.y,
                width: region.width,
                height: region.height,
            });

            const canvas = await html2canvas(region.pageElement, {
                x: region.x,
                y: region.y,
                width: region.width,
                height: region.height,
                useCORS: true,
                allowTaint: true,
                scale: 1,
                backgroundColor: null, // Preserve transparency
            });

            console.log("📸 Canvas created:", canvas);
            const imageData = canvas.toDataURL("image/png");
            console.log("📸 Image data generated, length:", imageData.length);

            const screenshotData: ScreenshotData = {
                region,
                imageData,
                timestamp: new Date().toISOString(),
            };

            console.log("📸 Calling selectCallback with data");
            if (this.selectCallback) {
                this.selectCallback(screenshotData);
            } else {
                console.error("📸 No selectCallback available!");
            }
        } catch (error) {
            console.error("📸 Failed to capture screenshot:", error);

            // Fallback to placeholder if html2canvas fails
            console.log("📸 Using placeholder fallback");
            const screenshotData: ScreenshotData = {
                region,
                imageData: this.createPlaceholderImage(
                    region.width,
                    region.height,
                ),
                timestamp: new Date().toISOString(),
            };

            if (this.selectCallback) {
                this.selectCallback(screenshotData);
            }
        }
    }

    /**
     * Create a placeholder image for testing
     */
    private createPlaceholderImage(width: number, height: number): string {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(width, 300);
        canvas.height = Math.min(height, 200);

        const ctx = canvas.getContext("2d");
        if (ctx) {
            // Create a simple placeholder
            ctx.fillStyle = "#f0f0f0";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.fillStyle = "#007acc";
            ctx.font = "16px Arial";
            ctx.textAlign = "center";
            ctx.fillText(
                "Screenshot Placeholder",
                canvas.width / 2,
                canvas.height / 2 - 10,
            );
            ctx.fillText(
                `${width}×${height}px`,
                canvas.width / 2,
                canvas.height / 2 + 10,
            );
        }

        return canvas.toDataURL("image/png");
    }

    /**
     * Load html2canvas library dynamically
     */
    private async loadHtml2Canvas(): Promise<any> {
        if ((window as any).html2canvas) {
            return (window as any).html2canvas;
        }

        // Load html2canvas from CDN
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src =
                "https://html2canvas.hertzen.com/dist/html2canvas.min.js";
            script.onload = () => {
                resolve((window as any).html2canvas);
            };
            script.onerror = () => {
                reject(new Error("Failed to load html2canvas"));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * Cancel selection
     */
    private cancel(): void {
        if (this.cancelCallback) {
            this.cancelCallback();
        }
        this.stopSelection();
    }

    /**
     * Clean up
     */
    destroy(): void {
        this.stopSelection();

        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }

        if (this.selectionBox && this.selectionBox.parentNode) {
            this.selectionBox.parentNode.removeChild(this.selectionBox);
        }

        this.overlay = null;
        this.selectionBox = null;
    }
}

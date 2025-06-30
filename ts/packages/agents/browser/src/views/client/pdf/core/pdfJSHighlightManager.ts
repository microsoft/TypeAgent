// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SelectionInfo } from "./textSelectionManager";
import { HighlightColor } from "../components/ColorPicker";
import { PDFApiService } from "../services/pdfApiService";

/**
 * Simplified PDF.js Highlight Manager
 * Creates highlights using a hybrid approach: PDF.js coordination with custom rendering
 */
export class PDFJSHighlightManager {
    private pdfViewer: any;
    private eventBus: any;
    private apiService: PDFApiService;
    private documentId: string | null = null;
    private highlights: Map<string, any> = new Map();
    private highlightClickCallback:
        | ((highlightId: string, highlightData: any, event: MouseEvent) => void)
        | null = null;

    constructor(pdfViewer: any, eventBus: any, apiService: PDFApiService) {
        this.pdfViewer = pdfViewer;
        this.eventBus = eventBus;
        this.apiService = apiService;
        this.setupEventListeners();

        console.log("🎨 PDF.js Highlight Manager initialized");
    }

    /**
     * Set callback for highlight click events
     */
    setHighlightClickCallback(
        callback: (
            highlightId: string,
            highlightData: any,
            event: MouseEvent,
        ) => void,
    ): void {
        this.highlightClickCallback = callback;
    }

    /**
     * Set the current document ID for API persistence
     */
    setDocumentId(documentId: string): void {
        this.documentId = documentId;
        console.log("📄 Document ID set:", documentId);
    }

    /**
     * Create a highlight annotation
     */
    async createHighlight(
        selection: SelectionInfo,
        color: HighlightColor,
    ): Promise<string | null> {
        if (!this.documentId) {
            console.error("No document ID set for creating PDF.js highlight");
            return null;
        }

        try {
            console.log(
                "🎨 Creating PDF.js highlight with selection:",
                selection,
            );
            console.log("🎨 Color:", color);

            // Generate unique ID
            const highlightId = this.generateAnnotationId();

            // Convert selection to coordinates
            const coordinates = this.convertSelectionToCoordinates(selection);
            if (!coordinates) {
                throw new Error("Failed to convert selection to coordinates");
            }

            console.log("📐 Calculated coordinates:", coordinates);

            // Create highlight data for rendering
            const highlightData = {
                id: highlightId,
                selection,
                color: color.color,
                coordinates,
                pageNumber: selection.pageNumber,
                text: selection.text,
                creationScale: this.pdfViewer.currentScale || 1, // Store scale at creation time
            };

            // Store highlight
            this.highlights.set(highlightId, highlightData);

            // Render highlight on page
            this.renderHighlight(highlightData);

            // Persist to API
            await this.persistHighlightToAPI(highlightData);

            console.log(
                "✅ PDF.js highlight created successfully:",
                highlightId,
            );
            return highlightId;
        } catch (error) {
            console.error("❌ Failed to create PDF.js highlight:", error);
            return null;
        }
    }

    /**
     * Load highlights from API and render them
     */
    async loadHighlights(): Promise<void> {
        if (!this.documentId) {
            console.warn("No document ID set for loading highlights");
            return;
        }

        try {
            // Get highlights from API (filter for PDF.js storage type)
            const annotations = await this.apiService.getAnnotations(
                this.documentId,
            );
            const highlights = annotations.filter(
                (ann) => ann.type === "highlight" && ann.storage === "pdfjs",
            );

            // Clear existing highlights
            this.clearAllHighlights();

            // Load and render each highlight
            for (const highlight of highlights) {
                const highlightData =
                    this.convertAPIDataToHighlightData(highlight);
                this.highlights.set(highlight.id, highlightData);
                this.renderHighlight(highlightData);
            }
        } catch (error) {
            console.error("❌ Failed to load PDF.js highlights:", error);
        }
    }

    /**
     * Delete a highlight by ID
     */
    async deleteHighlight(annotationId: string): Promise<void> {
        try {
            // Remove from local storage
            this.highlights.delete(annotationId);

            // Remove from DOM
            this.removeHighlightFromDOM(annotationId);

            // Delete from API
            if (this.documentId) {
                await this.apiService.deleteAnnotation(
                    this.documentId,
                    annotationId,
                );
            }

            console.log("✅ PDF.js highlight deleted:", annotationId);
        } catch (error) {
            console.error("❌ Failed to delete PDF.js highlight:", error);
        }
    }

    /**
     * Convert selection to coordinates using PDF.js viewport
     */
    private convertSelectionToCoordinates(
        selection: SelectionInfo,
    ): any | null {
        try {
            const pageView = this.pdfViewer.getPageView(
                selection.pageNumber - 1,
            );
            if (!pageView) {
                console.error(
                    "Page view not found for page:",
                    selection.pageNumber,
                );
                return null;
            }

            const viewport = pageView.viewport;
            const pageElement = pageView.div;

            if (!pageElement) {
                console.error("Page element not found");
                return null;
            }

            const pageRect = pageElement.getBoundingClientRect();

            // Calculate bounds from selection rectangles relative to page
            let minLeft = Infinity;
            let maxRight = -Infinity;
            let minTop = Infinity;
            let maxBottom = -Infinity;

            for (const rect of selection.rects) {
                const relativeLeft = rect.left - pageRect.left;
                const relativeTop = rect.top - pageRect.top;
                const relativeRight = rect.right - pageRect.left;
                const relativeBottom = rect.bottom - pageRect.top;

                minLeft = Math.min(minLeft, relativeLeft);
                maxRight = Math.max(maxRight, relativeRight);
                minTop = Math.min(minTop, relativeTop);
                maxBottom = Math.max(maxBottom, relativeBottom);
            }

            return {
                x: minLeft,
                y: minTop,
                width: maxRight - minLeft,
                height: maxBottom - minTop,
                pageRect: {
                    width: pageRect.width,
                    height: pageRect.height,
                },
            };
        } catch (error) {
            console.error("Failed to convert selection to coordinates:", error);
            return null;
        }
    }

    /**
     * Render highlight on the page using DOM overlay with scale-aware positioning
     */
    private renderHighlight(highlightData: any): void {
        try {
            const pageView = this.pdfViewer.getPageView(
                highlightData.pageNumber - 1,
            );
            if (!pageView || !pageView.div) {
                console.error("Page view or div not found for rendering");
                return;
            }

            const pageElement = pageView.div;

            // Create or get highlight layer
            let highlightLayer = pageElement.querySelector(
                ".pdfjs-highlight-layer",
            );
            if (!highlightLayer) {
                highlightLayer = document.createElement("div");
                highlightLayer.className = "pdfjs-highlight-layer";
                highlightLayer.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 1;
                `;
                pageElement.appendChild(highlightLayer);
            }

            // Create highlight element
            const highlightElement = document.createElement("div");
            highlightElement.className = "pdfjs-highlight";
            highlightElement.setAttribute(
                "data-highlight-id",
                highlightData.id,
            );

            // Get current scale and calculate scaled coordinates
            const currentScale = this.pdfViewer.currentScale || 1;
            const creationScale = highlightData.creationScale || 1;
            const coords = highlightData.coordinates;

            // Scale the coordinates: (original coordinates / creation scale) * current scale
            const scaleRatio = currentScale / creationScale;
            const scaledCoords = {
                x: coords.x * scaleRatio,
                y: coords.y * scaleRatio,
                width: coords.width * scaleRatio,
                height: coords.height * scaleRatio,
            };

            highlightElement.style.cssText = `
                position: absolute;
                left: ${scaledCoords.x}px;
                top: ${scaledCoords.y}px;
                width: ${scaledCoords.width}px;
                height: ${scaledCoords.height}px;
                background-color: ${highlightData.color};
                opacity: 0.3;
                pointer-events: auto;
                border-radius: 2px;
                transition: opacity 0.15s ease;
            `;

            // Add hover effect
            highlightElement.addEventListener("mouseenter", () => {
                highlightElement.style.opacity = "0.5";
            });

            highlightElement.addEventListener("mouseleave", () => {
                highlightElement.style.opacity = "0.3";
            });

            // Add click handler for highlight interaction
            highlightElement.addEventListener("click", (event: MouseEvent) => {
                event.stopPropagation();
                event.preventDefault();

                if (this.highlightClickCallback) {
                    this.highlightClickCallback(
                        highlightData.id,
                        highlightData,
                        event,
                    );
                }
            });

            // Add to layer
            highlightLayer.appendChild(highlightElement);
        } catch (error) {
            console.error("❌ Failed to render highlight:", error);
        }
    }

    /**
     * Remove highlight from DOM
     */
    private removeHighlightFromDOM(highlightId: string): void {
        const highlightElement = document.querySelector(
            `[data-highlight-id="${highlightId}"]`,
        );
        if (highlightElement && highlightElement.parentNode) {
            highlightElement.parentNode.removeChild(highlightElement);
        }
    }

    /**
     * Get highlight data by ID
     */
    getHighlightData(highlightId: string): any | null {
        return this.highlights.get(highlightId) || null;
    }

    /**
     * Clear all highlights from display
     */
    private clearAllHighlights(): void {
        // Remove all highlight elements
        const highlightElements = document.querySelectorAll(".pdfjs-highlight");
        highlightElements.forEach((element) => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
        });

        // Clear local storage
        this.highlights.clear();
    }

    /**
     * Persist highlight to API for backend storage
     */
    private async persistHighlightToAPI(highlightData: any): Promise<void> {
        if (!this.documentId) return;

        try {
            const apiAnnotation = {
                id: highlightData.id,
                documentId: this.documentId,
                page: highlightData.pageNumber,
                type: "highlight" as const,
                coordinates: {
                    x: highlightData.coordinates.x,
                    y: highlightData.coordinates.y,
                    width: highlightData.coordinates.width,
                    height: highlightData.coordinates.height,
                },
                color: highlightData.color,
                opacity: 0.3,
                content: highlightData.text,
                storage: "pdfjs" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            await this.apiService.addAnnotation(this.documentId, apiAnnotation);
        } catch (error) {
            console.error("❌ Failed to persist highlight to API:", error);
            // Don't throw - highlight is still created locally
        }
    }

    /**
     * Convert API annotation data to highlight data format
     */
    private convertAPIDataToHighlightData(apiAnnotation: any): any {
        return {
            id: apiAnnotation.id,
            color: apiAnnotation.color,
            coordinates: apiAnnotation.coordinates,
            pageNumber: apiAnnotation.page,
            text: apiAnnotation.content || "",
            creationScale: 1, // Assume existing highlights were created at 1x scale
        };
    }

    /**
     * Generate unique annotation ID
     */
    private generateAnnotationId(): string {
        return `pdfjs_highlight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Setup event listeners for PDF.js events
     */
    private setupEventListeners(): void {
        // Listen for page rendering to re-render highlights
        this.eventBus.on("pagerendered", (evt: any) => {
            this.reRenderHighlightsOnPage(evt.pageNumber);
        });

        // Listen for scale changes to re-position highlights
        this.eventBus.on("scalechanging", (evt: any) => {
            setTimeout(() => {
                this.reRenderAllHighlights();
            }, 100); // Small delay to ensure page is re-rendered
        });
    }

    /**
     * Re-render highlights on a specific page
     */
    private reRenderHighlightsOnPage(pageNumber: number): void {
        try {
            for (const [id, highlightData] of this.highlights) {
                if (highlightData.pageNumber === pageNumber) {
                    // Remove existing element
                    this.removeHighlightFromDOM(id);
                    // Re-render
                    this.renderHighlight(highlightData);
                }
            }
        } catch (error) {
            console.error(
                `❌ Failed to re-render highlights on page ${pageNumber}:`,
                error,
            );
        }
    }

    /**
     * Re-render all highlights (useful after zoom/scale changes)
     */
    private reRenderAllHighlights(): void {
        try {
            for (const [id, highlightData] of this.highlights) {
                // Remove existing element
                this.removeHighlightFromDOM(id);
                // Re-render with updated coordinates
                this.renderHighlight(highlightData);
            }
        } catch (error) {
            console.error("❌ Failed to re-render all highlights:", error);
        }
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        this.clearAllHighlights();
        this.documentId = null;
    }
}

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
                coordinateScale: coordinates.coordinateScale, // Store the scale at which coordinates were calculated
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
     * Convert selection to coordinates using PDF.js text layer
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

            const pageElement = pageView.div;
            if (!pageElement) {
                console.error("Page element not found");
                return null;
            }

            // Find the text layer within the page
            const textLayer = pageElement.querySelector(".textLayer");
            if (!textLayer) {
                console.error(
                    "Text layer not found for page:",
                    selection.pageNumber,
                );
                return null;
            }

            const textLayerRect = textLayer.getBoundingClientRect();
            const currentScale = this.pdfViewer.currentScale || 1;

            console.log("🔍 Text layer rect:", textLayerRect);
            console.log("🔍 Current scale:", currentScale);

            // Calculate bounds from selection rectangles relative to text layer
            let minLeft = Infinity;
            let maxRight = -Infinity;
            let minTop = Infinity;
            let maxBottom = -Infinity;

            for (const rect of selection.rects) {
                console.log("🔍 Selection rect:", rect);

                // Calculate position relative to text layer
                const relativeLeft = rect.left - textLayerRect.left;
                const relativeTop = rect.top - textLayerRect.top;
                const relativeRight = rect.right - textLayerRect.left;
                const relativeBottom = rect.bottom - textLayerRect.top;

                minLeft = Math.min(minLeft, relativeLeft);
                maxRight = Math.max(maxRight, relativeRight);
                minTop = Math.min(minTop, relativeTop);
                maxBottom = Math.max(maxBottom, relativeBottom);
            }

            const coordinates = {
                x: minLeft,
                y: minTop,
                width: maxRight - minLeft,
                height: maxBottom - minTop,
                pageRect: {
                    width: textLayerRect.width,
                    height: textLayerRect.height,
                },
                // Store coordinates are relative to text layer at current scale
                coordinateScale: currentScale,
                coordinateSystem: "textLayer", // Mark that these coordinates are relative to text layer
            };

            console.log("🔍 Calculated coordinates:", coordinates);
            return coordinates;
        } catch (error) {
            console.error("Failed to convert selection to coordinates:", error);
            return null;
        }
    }

    /**
     * Render highlight on the page using text layer positioning
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

            // Find the text layer within the page
            const textLayer = pageElement.querySelector(".textLayer");
            if (!textLayer) {
                console.error("Text layer not found for rendering highlight");
                return;
            }

            // Create or get highlight layer within the text layer
            let highlightLayer = textLayer.querySelector(
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
                textLayer.appendChild(highlightLayer);
            }

            // Create highlight element
            const highlightElement = document.createElement("div");
            highlightElement.className = "pdfjs-highlight";
            highlightElement.setAttribute(
                "data-highlight-id",
                highlightData.id,
            );

            const coords = highlightData.coordinates;
            const currentScale = this.pdfViewer.currentScale || 1;

            // For text layer coordinates, we don't need to apply additional scaling
            // since the text layer itself scales with PDF.js
            let finalCoords = {
                x: coords.x,
                y: coords.y,
                width: coords.width,
                height: coords.height,
            };

            // Only apply scaling if coordinates were stored with a different coordinate system
            if (coords.coordinateSystem !== "textLayer") {
                // Legacy coordinates or coordinates from page-relative system
                const coordinateScale =
                    coords.coordinateScale ||
                    highlightData.coordinateScale ||
                    1;
                const scaleRatio = currentScale / coordinateScale;
                finalCoords = {
                    x: coords.x * scaleRatio,
                    y: coords.y * scaleRatio,
                    width: coords.width * scaleRatio,
                    height: coords.height * scaleRatio,
                };
            }

            console.log("🎨 Rendering highlight with coords:", finalCoords);

            highlightElement.style.cssText = `
                position: absolute;
                left: ${finalCoords.x}px;
                top: ${finalCoords.y}px;
                width: ${finalCoords.width}px;
                height: ${finalCoords.height}px;
                background-color: ${highlightData.color};
                opacity: 0.8;
                pointer-events: auto;
                border-radius: 2px;
                transition: opacity 0.15s ease;
            `;

            // Add hover effect
            highlightElement.addEventListener("mouseenter", () => {
                highlightElement.style.opacity = "1";
            });

            highlightElement.addEventListener("mouseleave", () => {
                highlightElement.style.opacity = "0.8";
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
                    coordinateScale: highlightData.coordinates.coordinateScale,
                    coordinateSystem:
                        highlightData.coordinates.coordinateSystem ||
                        "textLayer",
                },
                color: highlightData.color,
                opacity: 0.8,
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
            coordinates: {
                ...apiAnnotation.coordinates,
                // For legacy data without coordinateSystem, assume page-based coordinates
                coordinateSystem:
                    apiAnnotation.coordinates?.coordinateSystem || "page",
                coordinateScale:
                    apiAnnotation.coordinates?.coordinateScale || 1,
            },
            pageNumber: apiAnnotation.page,
            text: apiAnnotation.content || "",
            coordinateScale: apiAnnotation.coordinates?.coordinateScale || 1,
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

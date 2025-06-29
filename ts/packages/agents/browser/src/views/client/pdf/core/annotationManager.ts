// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PDFAnnotation } from "../../server/features/pdf/pdfTypes";
import { SelectionInfo } from "./textSelectionManager";
import { PDFApiService } from "../services/pdfApiService";
import { HighlightColor } from "../components/ColorPicker";

/**
 * Annotation Manager for PDF highlighting and annotation management
 * Handles creating, updating, and rendering annotations in PDF.js
 */

export interface AnnotationCreationData {
    type: "highlight" | "note" | "question";
    selection: SelectionInfo;
    color?: HighlightColor;
    content?: string;
    blockquoteContent?: string; // For notes with blockquote content
    screenshotData?: any; // For screenshot-based annotations
}

export interface RenderedAnnotation {
    id: string;
    annotation: PDFAnnotation;
    elements: HTMLElement[];
}

export class AnnotationManager {
    private pdfViewer: any;
    private eventBus: any;
    private apiService: PDFApiService;
    private documentId: string | null = null;
    private annotations: Map<string, RenderedAnnotation> = new Map();
    private annotationLayer: HTMLElement | null = null;

    constructor(pdfViewer: any, apiService: PDFApiService, eventBus?: any) {
        this.pdfViewer = pdfViewer;
        this.eventBus = eventBus;
        this.apiService = apiService;

        // Set up event listeners for scale changes if event bus is available
        if (this.eventBus) {
            this.setupEventListeners();
        }
    }

    /**
     * Set up event listeners for PDF.js events
     */
    private setupEventListeners(): void {
        // Listen for page rendering to re-render annotations
        this.eventBus.on("pagerendered", (evt: any) => {
            this.reRenderAnnotationsOnPage(evt.pageNumber);
        });

        // Listen for scale changes to re-position annotations
        this.eventBus.on("scalechanging", (evt: any) => {
            setTimeout(() => {
                this.reRenderAllAnnotations();
            }, 100); // Small delay to ensure page is re-rendered
        });
    }

    /**
     * Set the current document ID
     */
    setDocumentId(documentId: string): void {
        this.documentId = documentId;
    }

    /**
     * Load annotations for the current document
     * Note: This now only loads custom annotations (notes, questions)
     * PDF.js highlights are handled by PDFJSHighlightManager
     */
    async loadAnnotations(): Promise<void> {
        if (!this.documentId) {
            console.warn("No document ID set for loading annotations");
            return;
        }

        try {
            const allAnnotations = await this.apiService.getAnnotations(
                this.documentId,
            );

            // Filter out PDF.js highlights - only load custom annotations
            const customAnnotations = allAnnotations.filter(
                (annotation) =>
                    annotation.storage !== "pdfjs" &&
                    (annotation.type === "note" ||
                        annotation.type === "question" ||
                        (annotation.type === "highlight" &&
                            annotation.storage !== "pdfjs")),
            );

            // Clear existing annotations
            this.clearAllAnnotations();

            // Render each custom annotation
            for (const annotation of customAnnotations) {
                await this.renderAnnotation(annotation);
            }

            console.log(
                `✅ Loaded ${customAnnotations.length} custom annotations (${allAnnotations.length - customAnnotations.length} PDF.js highlights handled separately)`,
            );
        } catch (error) {
            console.error("❌ Failed to load annotations:", error);
        }
    }

    /**
     * Create a new annotation from selection
     */
    async createAnnotation(
        data: AnnotationCreationData,
    ): Promise<PDFAnnotation | null> {
        if (!this.documentId) {
            console.error("No document ID set for creating annotation");
            return null;
        }

        try {
            // Convert selection to annotation data
            const annotationData = this.selectionToAnnotation(data);

            // Save annotation via API
            const savedAnnotation = await this.apiService.addAnnotation(
                this.documentId,
                annotationData,
            );

            // Render the annotation
            await this.renderAnnotation(savedAnnotation);

            console.log("✅ Created annotation:", savedAnnotation.id);
            return savedAnnotation;
        } catch (error) {
            console.error("❌ Failed to create annotation:", error);
            return null;
        }
    }

    /**
     * Update an existing annotation
     */
    async updateAnnotation(
        annotationId: string,
        updates: Partial<PDFAnnotation>,
    ): Promise<void> {
        if (!this.documentId) {
            console.error("No document ID set for updating annotation");
            return;
        }

        try {
            // Update via API
            const updatedAnnotation = await this.apiService.updateAnnotation(
                this.documentId,
                annotationId,
                updates,
            );

            // Re-render the annotation
            await this.removeAnnotation(annotationId);
            await this.renderAnnotation(updatedAnnotation);

            console.log("✅ Updated annotation:", annotationId);
        } catch (error) {
            console.error("❌ Failed to update annotation:", error);
        }
    }

    /**
     * Delete an annotation
     */
    async deleteAnnotation(annotationId: string): Promise<void> {
        if (!this.documentId) {
            console.error("No document ID set for deleting annotation");
            return;
        }

        try {
            // Delete via API
            await this.apiService.deleteAnnotation(
                this.documentId,
                annotationId,
            );

            // Remove from display
            await this.removeAnnotation(annotationId);

            console.log("✅ Deleted annotation:", annotationId);
        } catch (error) {
            console.error("❌ Failed to delete annotation:", error);
        }
    }

    /**
     * Get annotation at specific coordinates
     */
    getAnnotationAtPoint(x: number, y: number): RenderedAnnotation | null {
        const element = document.elementFromPoint(x, y);
        if (!element) return null;

        // Check if the element or its parent is an annotation
        const annotationElement = element.closest(
            "[data-annotation-id]",
        ) as HTMLElement;
        if (!annotationElement) return null;

        const annotationId =
            annotationElement.getAttribute("data-annotation-id");
        if (!annotationId) return null;

        return this.annotations.get(annotationId) || null;
    }

    /**
     * Convert selection to annotation data
     */
    private selectionToAnnotation(
        data: AnnotationCreationData,
    ): Partial<PDFAnnotation> {
        const {
            selection,
            type,
            color,
            content,
            blockquoteContent,
            screenshotData,
        } = data;

        // For screenshot-based annotations, use the screenshot region coordinates directly
        let bounds;
        if (screenshotData && screenshotData.region) {
            // Screenshot coordinates are already relative to the page
            bounds = {
                x: screenshotData.region.x,
                y: screenshotData.region.y,
                width: screenshotData.region.width,
                height: screenshotData.region.height,
            };
        } else {
            // For text selections, calculate coordinates from selection rectangles
            bounds = this.calculateSelectionBounds(selection);
        }

        const annotation: Partial<PDFAnnotation> = {
            documentId: this.documentId!,
            page: selection.pageNumber,
            type,
            coordinates: bounds,
            storage: "custom", // Mark as custom annotation (not PDF.js)
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // Add type-specific properties
        if (type === "highlight" && color) {
            annotation.color = color.color;
            annotation.opacity = 0.3;
        }

        if (content) {
            annotation.content = content;
        }

        // Store additional metadata for notes
        if (type === "note" || type === "question") {
            annotation.metadata = {
                blockquoteContent,
                screenshotData,
                hasScreenshot: !!screenshotData,
                hasBlockquote: !!blockquoteContent,
                creationScale: this.pdfViewer.currentScale || 1, // Store creation scale
            };
        }

        return annotation;
    }

    /**
     * Calculate bounds from selection rectangles
     */
    private calculateSelectionBounds(selection: SelectionInfo): {
        x: number;
        y: number;
        width: number;
        height: number;
    } {
        const rects = selection.rects;
        if (rects.length === 0) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }

        // Find the page element to get relative coordinates
        const pageElement = this.getPageElement(selection.pageNumber);
        if (!pageElement) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }

        const pageRect = pageElement.getBoundingClientRect();

        // Calculate bounds relative to page
        let minLeft = Infinity;
        let maxRight = -Infinity;
        let minTop = Infinity;
        let maxBottom = -Infinity;

        for (const rect of rects) {
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
        };
    }

    /**
     * Render an annotation on the page
     */
    private async renderAnnotation(annotation: PDFAnnotation): Promise<void> {
        const pageElement = this.getPageElement(annotation.page);
        if (!pageElement) {
            console.warn(
                `Page ${annotation.page} not found for annotation ${annotation.id}`,
            );
            return;
        }

        // Create annotation element based on type
        let annotationElement: HTMLElement;

        switch (annotation.type) {
            case "highlight":
                annotationElement = this.createHighlightElement(annotation);
                break;
            case "note":
                annotationElement = this.createNoteElement(annotation);
                break;
            case "question":
                annotationElement = this.createQuestionElement(annotation);
                break;
            default:
                console.warn(`Unknown annotation type: ${annotation.type}`);
                return;
        }

        // Position the annotation
        this.positionAnnotationElement(
            annotationElement,
            annotation,
            pageElement,
        );

        // Add to annotation layer
        const annotationLayer = this.getOrCreateAnnotationLayer(pageElement);
        annotationLayer.appendChild(annotationElement);

        // Store rendered annotation
        this.annotations.set(annotation.id, {
            id: annotation.id,
            annotation,
            elements: [annotationElement],
        });
    }

    /**
     * Create highlight element
     */
    private createHighlightElement(annotation: PDFAnnotation): HTMLElement {
        const element = document.createElement("div");
        element.className = "pdf-highlight";
        element.setAttribute("data-annotation-id", annotation.id);
        element.style.backgroundColor = annotation.color || "#ffff00";
        element.style.opacity = (annotation.opacity || 0.3).toString();
        element.style.cursor = "pointer";

        // Add tooltip if there's content
        if (annotation.content) {
            element.title = annotation.content;
        }

        return element;
    }

    /**
     * Create note element with enhanced hover support
     */
    private createNoteElement(annotation: PDFAnnotation): HTMLElement {
        const element = document.createElement("div");
        element.className = "pdf-note";
        element.setAttribute("data-annotation-id", annotation.id);

        // Create tooltip content for hover
        const tooltipContent = this.createNoteTooltipContent(annotation);

        element.innerHTML = `
            <div class="note-icon">
                <i class="fas fa-sticky-note"></i>
            </div>
            <div class="note-tooltip" style="display: none;">
                ${tooltipContent}
            </div>
        `;

        // Add hover handlers for tooltip (only tooltip, no click flyout)
        this.addNoteHoverHandlers(element, annotation);

        return element;
    }

    /**
     * Create tooltip content for note/question hover
     */
    private createNoteTooltipContent(annotation: PDFAnnotation): string {
        let content = "";

        // Add blockquote if available
        if (annotation.metadata?.blockquoteContent) {
            content += `
                <div class="tooltip-blockquote">
                    <blockquote>${this.escapeHtml(annotation.metadata.blockquoteContent)}</blockquote>
                </div>
            `;
        }

        // Add screenshot if available
        if (annotation.metadata?.screenshotData) {
            content += `
                <div class="tooltip-screenshot">
                    <img src="${annotation.metadata.screenshotData.imageData}" alt="Screenshot" />
                </div>
            `;
        }

        // Add content rendered from markdown (works for both notes and questions)
        if (annotation.content) {
            const contentType =
                annotation.type === "question" ? "question" : "note";
            content += `
                <div class="tooltip-${contentType}-content">
                    ${this.markdownToHtml(annotation.content)}
                </div>
            `;
        }

        return content;
    }

    /**
     * Add hover handlers for note tooltips
     */
    private addNoteHoverHandlers(
        element: HTMLElement,
        annotation: PDFAnnotation,
    ): void {
        const tooltip = element.querySelector(".note-tooltip") as HTMLElement;
        if (!tooltip) return;

        let hoverTimeout: NodeJS.Timeout;

        element.addEventListener("mouseenter", () => {
            hoverTimeout = setTimeout(() => {
                // Position tooltip
                const rect = element.getBoundingClientRect();
                tooltip.style.position = "fixed";
                tooltip.style.left = `${rect.right + 10}px`;
                tooltip.style.top = `${rect.top}px`;
                tooltip.style.zIndex = "10001";
                tooltip.style.display = "block";
            }, 500); // Show after 500ms
        });

        element.addEventListener("mouseleave", () => {
            clearTimeout(hoverTimeout);
            tooltip.style.display = "none";
        });
    }

    /**
     * Create question element
     */
    private createQuestionElement(annotation: PDFAnnotation): HTMLElement {
        const element = document.createElement("div");
        element.className = "pdf-question";
        element.setAttribute("data-annotation-id", annotation.id);

        // Create tooltip content for hover (similar to notes)
        const tooltipContent = this.createNoteTooltipContent(annotation);

        element.innerHTML = `
            <div class="question-icon">
                <i class="fas fa-comments"></i>
            </div>
            <div class="note-tooltip" style="display: none;">
                ${tooltipContent}
            </div>
        `;

        // Add hover handlers for tooltip (consistent with notes)
        this.addNoteHoverHandlers(element, annotation);

        return element;
    }

    /**
     * Position annotation element on page with scale awareness
     */
    private positionAnnotationElement(
        element: HTMLElement,
        annotation: PDFAnnotation,
        pageElement: HTMLElement,
    ): void {
        const { x, y, width, height } = annotation.coordinates;

        // Get current scale for proper positioning
        const currentScale = this.pdfViewer.currentScale || 1;
        const creationScale = annotation.metadata?.creationScale || 1;
        const scaleRatio = currentScale / creationScale;

        element.style.position = "absolute";
        element.style.pointerEvents = "auto";
        element.style.zIndex = "10";

        if (annotation.type === "note" || annotation.type === "question") {
            // Position note/question icon in the top-right corner of the selected area
            // Base size that scales with zoom
            const baseIconSize = 20; // Base size at 1x scale
            const baseMargin = 2; // Base margin at 1x scale

            const scaledIconSize = baseIconSize * scaleRatio;
            const scaledMargin = baseMargin * scaleRatio;

            // Calculate position: top-right corner with scaled positioning
            const scaledX = x * scaleRatio;
            const scaledY = y * scaleRatio;
            const scaledWidth = width * scaleRatio;

            element.style.left = `${scaledX + scaledWidth - scaledIconSize - scaledMargin}px`;
            element.style.top = `${scaledY + scaledMargin}px`;
            element.style.width = `${scaledIconSize}px`;
            element.style.height = `${scaledIconSize}px`;
        } else {
            // For other annotation types (highlights, questions), use full area with scaling
            element.style.left = `${x * scaleRatio}px`;
            element.style.top = `${y * scaleRatio}px`;
            element.style.width = `${width * scaleRatio}px`;
            element.style.height = `${height * scaleRatio}px`;
        }
    }

    /**
     * Get or create annotation layer for a page
     */
    private getOrCreateAnnotationLayer(pageElement: HTMLElement): HTMLElement {
        let annotationLayer = pageElement.querySelector(
            ".custom-annotation-layer",
        ) as HTMLElement;

        if (!annotationLayer) {
            annotationLayer = document.createElement("div");
            annotationLayer.className = "custom-annotation-layer";
            annotationLayer.style.position = "absolute";
            annotationLayer.style.top = "0";
            annotationLayer.style.left = "0";
            annotationLayer.style.width = "100%";
            annotationLayer.style.height = "100%";
            annotationLayer.style.pointerEvents = "none";
            annotationLayer.style.zIndex = "5";

            pageElement.style.position = "relative";
            pageElement.appendChild(annotationLayer);
        }

        return annotationLayer;
    }

    /**
     * Escape HTML to prevent XSS
     */
    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Simple markdown to HTML converter
     */
    private markdownToHtml(markdown: string): string {
        let html = markdown;

        // Convert basic markdown formatting
        html = html
            // Headers
            .replace(/^### (.*$)/gim, "<h3>$1</h3>")
            .replace(/^## (.*$)/gim, "<h2>$1</h2>")
            .replace(/^# (.*$)/gim, "<h1>$1</h1>")
            // Bold
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            // Italic
            .replace(/\*(.*?)\*/g, "<em>$1</em>")
            // Code
            .replace(/`(.*?)`/g, "<code>$1</code>")
            // Links
            .replace(
                /\[([^\]]+)\]\(([^)]+)\)/g,
                '<a href="$2" target="_blank">$1</a>',
            )
            // Line breaks
            .replace(/\n/g, "<br>");

        // Handle lists
        html = html.replace(/^- (.*)$/gim, "<li>$1</li>");
        html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

        return html;
    }
    private getPageElement(pageNumber: number): HTMLElement | null {
        return document.querySelector(
            `[data-page-number="${pageNumber}"]`,
        ) as HTMLElement;
    }

    /**
     * Remove annotation from display
     */
    private async removeAnnotation(annotationId: string): Promise<void> {
        const rendered = this.annotations.get(annotationId);
        if (!rendered) return;

        // Remove DOM elements
        rendered.elements.forEach((element) => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
        });

        // Remove from map
        this.annotations.delete(annotationId);
    }

    /**
     * Clear all annotations
     */
    private clearAllAnnotations(): void {
        for (const [id] of this.annotations) {
            this.removeAnnotation(id);
        }
    }

    /**
     * Re-render annotations on a specific page
     */
    private reRenderAnnotationsOnPage(pageNumber: number): void {
        try {
            for (const [id, renderedAnnotation] of this.annotations) {
                if (renderedAnnotation.annotation.page === pageNumber) {
                    // Remove existing elements
                    this.removeAnnotationFromDOM(id);
                    // Re-render
                    this.renderAnnotation(renderedAnnotation.annotation);
                }
            }
        } catch (error) {
            console.error(
                `❌ Failed to re-render annotations on page ${pageNumber}:`,
                error,
            );
        }
    }

    /**
     * Re-render all annotations (useful after zoom/scale changes)
     */
    private reRenderAllAnnotations(): void {
        try {
            for (const [id, renderedAnnotation] of this.annotations) {
                // Remove existing elements
                this.removeAnnotationFromDOM(id);
                // Re-render with updated positioning
                this.renderAnnotation(renderedAnnotation.annotation);
            }
        } catch (error) {
            console.error("❌ Failed to re-render all annotations:", error);
        }
    }

    /**
     * Remove annotation elements from DOM (helper for re-rendering)
     */
    private removeAnnotationFromDOM(annotationId: string): void {
        const rendered = this.annotations.get(annotationId);
        if (!rendered) return;

        // Remove DOM elements
        rendered.elements.forEach((element) => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
        });

        // Update the rendered annotation to clear elements array
        rendered.elements = [];
    }

    /**
     * Clean up and remove all annotations
     */
    destroy(): void {
        this.clearAllAnnotations();
        this.annotations.clear();
        this.documentId = null;
    }
}

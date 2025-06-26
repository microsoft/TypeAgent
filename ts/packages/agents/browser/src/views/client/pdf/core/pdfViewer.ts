// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Core PDF Viewer Implementation
 * Handles PDF.js integration and document rendering
 */

export class PDFViewerCore {
    private pdfDocument: any = null;
    private currentPageNumber = 1;
    private currentScale = "auto";
    private totalPages = 0;
    private initialized = false;

    constructor() {
        console.log("📄 Initializing PDF Viewer Core...");
    }

    /**
     * Initialize the PDF viewer core
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Ensure PDF.js is available
            if (!window.pdfjsLib) {
                throw new Error("PDF.js library not available");
            }

            console.log("✅ PDF Viewer Core initialized");
            this.initialized = true;
        } catch (error) {
            console.error("❌ Failed to initialize PDF viewer core:", error);
            throw error;
        }
    }

    /**
     * Load a PDF document from ArrayBuffer
     */
    async loadDocument(data: ArrayBuffer): Promise<void> {
        try {
            console.log("📄 Loading PDF document from ArrayBuffer...");

            // Show loading state
            this.showLoadingState();

            // Load the PDF document
            const loadingTask = window.pdfjsLib.getDocument({ data });
            this.pdfDocument = await loadingTask.promise;

            this.totalPages = this.pdfDocument.numPages;
            this.currentPageNumber = 1;

            console.log(
                `✅ PDF loaded successfully. Pages: ${this.totalPages}`,
            );

            // Update UI
            this.updatePageInfo();

            // Render first page
            await this.renderPage(1);

            // Hide loading state
            this.hideLoadingState();
        } catch (error) {
            console.error("❌ Error loading PDF document:", error);
            this.hideLoadingState();
            throw error;
        }
    }

    /**
     * Load a PDF document from URL
     */
    async loadDocumentFromURL(url: string): Promise<void> {
        try {
            console.log("📄 Loading PDF document from URL:", url);

            // Show loading state
            this.showLoadingState();

            // Load the PDF document
            const loadingTask = window.pdfjsLib.getDocument(url);
            this.pdfDocument = await loadingTask.promise;

            this.totalPages = this.pdfDocument.numPages;
            this.currentPageNumber = 1;

            console.log(
                `✅ PDF loaded successfully. Pages: ${this.totalPages}`,
            );

            // Update UI
            this.updatePageInfo();

            // Render first page
            await this.renderPage(1);

            // Hide loading state
            this.hideLoadingState();
        } catch (error) {
            console.error("❌ Error loading PDF from URL:", error);
            this.hideLoadingState();
            throw error;
        }
    }

    /**
     * Render a specific page
     */
    async renderPage(pageNumber: number): Promise<void> {
        if (
            !this.pdfDocument ||
            pageNumber < 1 ||
            pageNumber > this.totalPages
        ) {
            return;
        }

        try {
            console.log(`🎨 Rendering page ${pageNumber}`);

            const page = await this.pdfDocument.getPage(pageNumber);

            // Calculate viewport
            const scale = this.calculateScale();
            const viewport = page.getViewport({ scale });

            // Create canvas
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // Create page container
            const pageDiv = document.createElement("div");
            pageDiv.className = "page";
            pageDiv.setAttribute("data-page-number", pageNumber.toString());
            pageDiv.style.width = viewport.width + "px";
            pageDiv.style.height = viewport.height + "px";
            pageDiv.appendChild(canvas);

            // Clear viewer and add page
            const viewer = document.getElementById("viewer");
            if (viewer) {
                viewer.innerHTML = "";
                viewer.appendChild(pageDiv);
            }

            // Render page
            const renderContext = {
                canvasContext: context,
                viewport: viewport,
            };

            await page.render(renderContext).promise;

            this.currentPageNumber = pageNumber;
            this.updatePageInfo();

            console.log(`✅ Page ${pageNumber} rendered successfully`);
        } catch (error) {
            console.error(`❌ Error rendering page ${pageNumber}:`, error);
            throw error;
        }
    }

    /**
     * Navigate to next page
     */
    async nextPage(): Promise<void> {
        if (this.currentPageNumber < this.totalPages) {
            await this.renderPage(this.currentPageNumber + 1);
        }
    }

    /**
     * Navigate to previous page
     */
    async previousPage(): Promise<void> {
        if (this.currentPageNumber > 1) {
            await this.renderPage(this.currentPageNumber - 1);
        }
    }

    /**
     * Go to specific page
     */
    async goToPage(pageNumber: number): Promise<void> {
        if (pageNumber >= 1 && pageNumber <= this.totalPages) {
            await this.renderPage(pageNumber);
        }
    }

    /**
     * Zoom in
     */
    async zoomIn(): Promise<void> {
        const currentScale = this.calculateScale();
        const newScale = Math.min(currentScale * 1.25, 4.0);
        await this.setScale(newScale.toString());
    }

    /**
     * Zoom out
     */
    async zoomOut(): Promise<void> {
        const currentScale = this.calculateScale();
        const newScale = Math.max(currentScale * 0.8, 0.25);
        await this.setScale(newScale.toString());
    }

    /**
     * Set scale
     */
    async setScale(scale: string): Promise<void> {
        this.currentScale = scale;

        // Update scale select
        const scaleSelect = document.getElementById(
            "scaleSelect",
        ) as HTMLSelectElement;
        if (scaleSelect) {
            scaleSelect.value = scale;
        }

        // Re-render current page with new scale
        if (this.pdfDocument) {
            await this.renderPage(this.currentPageNumber);
        }
    }

    /**
     * Search for text in the document
     */
    async search(query: string): Promise<void> {
        if (!query.trim() || !this.pdfDocument) return;

        console.log("🔍 Searching for:", query);
        // TODO: Implement text search functionality
        // This would involve:
        // 1. Getting text content from all pages
        // 2. Finding matches
        // 3. Highlighting results
        // 4. Updating find results counter
    }

    /**
     * Find next search result
     */
    findNext(): void {
        console.log("⏭️ Find next");
        // TODO: Implement find next
    }

    /**
     * Find previous search result
     */
    findPrevious(): void {
        console.log("⏮️ Find previous");
        // TODO: Implement find previous
    }

    /**
     * Print the document
     */
    print(): void {
        console.log("🖨️ Printing document");
        window.print();
    }

    /**
     * Download the document
     */
    download(): void {
        console.log("💾 Downloading document");
        // TODO: Implement download functionality
        // This would trigger a download of the original PDF file
    }

    /**
     * Calculate current scale based on scale setting
     */
    private calculateScale(): number {
        const viewerContainer = document.getElementById("viewerContainer");
        if (!viewerContainer || !this.pdfDocument) return 1.0;

        const containerWidth = viewerContainer.clientWidth;
        const containerHeight = viewerContainer.clientHeight;

        switch (this.currentScale) {
            case "auto":
                return (
                    Math.min(containerWidth / 816, containerHeight / 1056) * 0.9
                );
            case "page-fit":
                return Math.min(containerWidth / 816, containerHeight / 1056);
            case "page-width":
                return (containerWidth / 816) * 0.95;
            case "page-actual":
                return 1.0;
            default:
                return parseFloat(this.currentScale) || 1.0;
        }
    }

    /**
     * Update page information in UI
     */
    private updatePageInfo(): void {
        const pageNumberInput = document.getElementById(
            "pageNumber",
        ) as HTMLInputElement;
        const numPagesSpan = document.getElementById("numPages");

        if (pageNumberInput) {
            pageNumberInput.value = this.currentPageNumber.toString();
            pageNumberInput.max = this.totalPages.toString();
        }

        if (numPagesSpan) {
            numPagesSpan.textContent = `of ${this.totalPages}`;
        }
    }

    /**
     * Show loading state
     */
    private showLoadingState(): void {
        document.body.classList.add("loadingInProgress");

        const viewer = document.getElementById("viewer");
        if (viewer) {
            viewer.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; height: 400px; color: #999;">
                    <div style="text-align: center;">
                        <div style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #007acc; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div>
                        <p>Loading PDF...</p>
                    </div>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;
        }
    }

    /**
     * Hide loading state
     */
    private hideLoadingState(): void {
        document.body.classList.remove("loadingInProgress");
    }

    /**
     * Get current document info
     */
    getDocumentInfo(): {
        currentPage: number;
        totalPages: number;
        scale: string;
    } {
        return {
            currentPage: this.currentPageNumber,
            totalPages: this.totalPages,
            scale: this.currentScale,
        };
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PDFApiService } from "./services/pdfApiService";
import { PDFSSEClient } from "./services/pdfSSEClient";

// PDF.js types
declare global {
    interface Window {
        pdfjsLib: any;
    }
}

/**
 * Basic TypeAgent PDF Viewer Application
 */
export class TypeAgentPDFViewerApp {
    private pdfDoc: any = null;
    private currentPage = 1;
    private scale = 1.0;
    private pdfApiService: PDFApiService;
    private sseClient: PDFSSEClient | null = null;
    private documentId: string | null = null;

    constructor() {
        this.pdfApiService = new PDFApiService();
    }

    /**
     * Initialize the PDF viewer application
     */
    async initialize(): Promise<void> {
        console.log("🚀 Initializing TypeAgent PDF Viewer...");

        try {
            // Set up PDF.js worker
            await this.setupPDFJS();

            // Set up UI event handlers
            this.setupEventHandlers();

            // Extract document ID from URL if present
            this.extractDocumentId();

            // Load document if we have an ID
            if (this.documentId) {
                await this.loadDocument(this.documentId);
            } else {
                await this.loadSampleDocument();
            }

            console.log("✅ PDF Viewer initialized successfully");
        } catch (error) {
            console.error("❌ Failed to initialize PDF viewer:", error);
            this.showError(
                "Failed to initialize PDF viewer: " +
                    (error instanceof Error ? error.message : String(error)),
            );
        }
    }

    /**
     * Set up PDF.js library
     */
    private async setupPDFJS(): Promise<void> {
        // PDF.js should be available from CDN
        if (typeof window.pdfjsLib === "undefined") {
            throw new Error("PDF.js library not loaded");
        }

        // Set up worker
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";
    }

    /**
     * Set up UI event handlers
     */
    private setupEventHandlers(): void {
        console.log("🔧 Setting up event handlers...");

        const prevBtn = document.getElementById("prevPage");
        const nextBtn = document.getElementById("nextPage");
        const pageNumInput = document.getElementById(
            "pageNum",
        ) as HTMLInputElement;
        const zoomInBtn = document.getElementById("zoomIn");
        const zoomOutBtn = document.getElementById("zoomOut");
        const openBtn = document.getElementById("openFile");
        const fileInput = document.getElementById(
            "fileInput",
        ) as HTMLInputElement;

        console.log("🔍 Found elements:", {
            prevBtn: !!prevBtn,
            nextBtn: !!nextBtn,
            pageNumInput: !!pageNumInput,
            zoomInBtn: !!zoomInBtn,
            zoomOutBtn: !!zoomOutBtn,
            openBtn: !!openBtn,
            fileInput: !!fileInput,
        });

        if (
            !prevBtn ||
            !nextBtn ||
            !pageNumInput ||
            !zoomInBtn ||
            !zoomOutBtn ||
            !openBtn ||
            !fileInput
        ) {
            console.error(
                "❌ Some UI elements not found! Retrying in 100ms...",
            );
            setTimeout(() => this.setupEventHandlers(), 100);
            return;
        }

        // Navigation events
        prevBtn.addEventListener("click", () => this.goToPreviousPage());
        nextBtn.addEventListener("click", () => this.goToNextPage());
        pageNumInput.addEventListener("change", (e) => {
            const target = e.target as HTMLInputElement;
            const pageNum = parseInt(target.value);
            if (
                pageNum &&
                pageNum >= 1 &&
                pageNum <= (this.pdfDoc?.numPages || 1)
            ) {
                this.goToPage(pageNum);
            } else {
                // Reset to current page if invalid input
                target.value = this.currentPage.toString();
            }
        });

        // Also handle Enter key
        pageNumInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                const target = e.target as HTMLInputElement;
                const pageNum = parseInt(target.value);
                if (
                    pageNum &&
                    pageNum >= 1 &&
                    pageNum <= (this.pdfDoc?.numPages || 1)
                ) {
                    this.goToPage(pageNum);
                } else {
                    target.value = this.currentPage.toString();
                }
            }
        });

        // Zoom events
        zoomInBtn.addEventListener("click", () => this.zoomIn());
        zoomOutBtn.addEventListener("click", () => this.zoomOut());

        // File open events
        openBtn.addEventListener("click", () => this.openFileDialog());
        fileInput.addEventListener("change", (e) => this.handleFileSelect(e));

        console.log("✅ Event handlers set up successfully");
    }

    /**
     * Open file dialog
     */
    private openFileDialog(): void {
        const fileInput = document.getElementById(
            "fileInput",
        ) as HTMLInputElement;
        if (fileInput) {
            fileInput.click();
        }
    }

    /**
     * Handle file selection from dialog
     */
    private async handleFileSelect(event: Event): Promise<void> {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];

        if (!file) {
            return;
        }

        if (file.type !== "application/pdf") {
            this.showError("Please select a valid PDF file.");
            return;
        }

        try {
            console.log("📁 Loading selected file:", file.name);
            this.showLoading(`Loading ${file.name}...`);

            // Read file as array buffer
            const arrayBuffer = await file.arrayBuffer();

            // Load PDF from array buffer
            const loadingTask = window.pdfjsLib.getDocument(arrayBuffer);
            this.pdfDoc = await loadingTask.promise;

            console.log(
                "📄 PDF loaded from file. Pages:",
                this.pdfDoc.numPages,
            );

            // Update UI
            this.updatePageCount();
            this.currentPage = 1;
            await this.renderPage(this.currentPage);

            // Clear the file input for next use
            target.value = "";
        } catch (error) {
            console.error("❌ Failed to load PDF file:", error);
            this.showError(
                "Failed to load PDF file. Please make sure it is a valid PDF document.",
            );
            target.value = "";
        }
    }

    /**
     * Extract document ID or URL from path and query parameters
     */
    private extractDocumentId(): void {
        const path = window.location.pathname;
        const urlParams = new URLSearchParams(window.location.search);

        // Check for URL parameter (for direct PDF URLs)
        const fileUrl = urlParams.get("url") || urlParams.get("file");
        if (fileUrl) {
            this.documentId = fileUrl;
            console.log("📄 PDF URL from query parameter:", this.documentId);
            return;
        }

        // Check for document ID in path
        const match = path.match(/\/pdf\/(.+)/);
        if (match && match[1]) {
            this.documentId = match[1];
            console.log("📄 Document ID from URL:", this.documentId);
        }
    }

    /**
     * Load a PDF document
     */
    async loadDocument(documentId: string): Promise<void> {
        try {
            this.showLoading("Loading document...");

            // Check if documentId is a direct URL
            if (this.isUrl(documentId)) {
                console.log("📄 Loading PDF from direct URL:", documentId);
                await this.loadPDFFromUrl(documentId);
                return;
            }

            // Otherwise, treat as document ID and get from API
            console.log("📄 Loading document via API:", documentId);

            // Get document metadata from API
            const docInfo = await this.pdfApiService.getDocument(documentId);
            console.log("📋 Document info:", docInfo);

            // For now, load a sample PDF since we don't have upload implemented
            await this.loadSampleDocument();

            // Set up SSE connection for real-time features
            this.setupSSEConnection(documentId);
        } catch (error) {
            console.error("❌ Failed to load document:", error);
            this.showError(
                "Failed to load document: " +
                    (error instanceof Error ? error.message : String(error)),
            );
        }
    }

    /**
     * Check if a string is a valid URL
     */
    private isUrl(str: string): boolean {
        try {
            new URL(str);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Load PDF directly from a URL
     */
    async loadPDFFromUrl(url: string): Promise<void> {
        try {
            this.showLoading("Loading PDF from URL...");

            const loadingTask = window.pdfjsLib.getDocument(url);
            this.pdfDoc = await loadingTask.promise;

            console.log("📄 PDF loaded from URL. Pages:", this.pdfDoc.numPages);

            // Update UI
            this.updatePageCount();
            this.currentPage = 1;
            await this.renderPage(this.currentPage);
        } catch (error) {
            console.error("❌ Failed to load PDF from URL:", error);
            this.showError(
                "Failed to load PDF from URL. Please check if the URL is accessible and points to a valid PDF file.",
            );
        }
    }

    /**
     * Load a sample PDF document for demonstration
     */
    async loadSampleDocument(): Promise<void> {
        try {
            this.showLoading("Loading sample document...");

            // Use a sample PDF URL - you can replace this with your own
            const samplePdfUrl =
                "https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/web/compressed.tracemonkey-pldi-09.pdf";

            const loadingTask = window.pdfjsLib.getDocument(samplePdfUrl);
            this.pdfDoc = await loadingTask.promise;

            console.log("📄 PDF loaded. Pages:", this.pdfDoc.numPages);

            // Update UI
            this.updatePageCount();
            this.currentPage = 1;
            await this.renderPage(this.currentPage);
        } catch (error) {
            console.error("❌ Failed to load sample document:", error);
            this.showError("Failed to load PDF document");
        }
    }

    /**
     * Render a specific page
     */
    async renderPage(pageNum: number): Promise<void> {
        if (!this.pdfDoc) {
            throw new Error("No PDF document loaded");
        }

        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: this.scale });

            // Create canvas
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.className = "page";

            // Render page
            const renderContext = {
                canvasContext: context,
                viewport: viewport,
            };

            await page.render(renderContext).promise;

            // Update viewer container
            const container = document.getElementById("viewerContainer");
            if (container) {
                container.innerHTML = "";
                container.appendChild(canvas);
            }

            // Update current page indicator
            this.updateCurrentPageIndicator();
        } catch (error) {
            console.error("❌ Failed to render page:", error);
            this.showError("Failed to render page " + pageNum);
        }
    }

    /**
     * Navigate to previous page
     */
    async goToPreviousPage(): Promise<void> {
        if (this.currentPage > 1) {
            this.currentPage--;
            await this.renderPage(this.currentPage);
        }
    }

    /**
     * Navigate to next page
     */
    async goToNextPage(): Promise<void> {
        if (this.pdfDoc && this.currentPage < this.pdfDoc.numPages) {
            this.currentPage++;
            await this.renderPage(this.currentPage);
        }
    }

    /**
     * Go to specific page
     */
    async goToPage(pageNum: number): Promise<void> {
        if (this.pdfDoc && pageNum >= 1 && pageNum <= this.pdfDoc.numPages) {
            this.currentPage = pageNum;
            await this.renderPage(this.currentPage);
        }
    }

    /**
     * Zoom in
     */
    async zoomIn(): Promise<void> {
        this.scale = Math.min(this.scale * 1.2, 3.0);
        await this.renderPage(this.currentPage);
        this.updateScaleIndicator();
    }

    /**
     * Zoom out
     */
    async zoomOut(): Promise<void> {
        this.scale = Math.max(this.scale / 1.2, 0.3);
        await this.renderPage(this.currentPage);
        this.updateScaleIndicator();
    }

    /**
     * Update page count display
     */
    private updatePageCount(): void {
        const pageCountElement = document.getElementById("pageCount");
        if (pageCountElement && this.pdfDoc) {
            pageCountElement.textContent = this.pdfDoc.numPages.toString();
        }
    }

    /**
     * Update current page indicator and navigation buttons
     */
    private updateCurrentPageIndicator(): void {
        const pageNumInput = document.getElementById(
            "pageNum",
        ) as HTMLInputElement;
        const prevBtn = document.getElementById(
            "prevPage",
        ) as HTMLButtonElement;
        const nextBtn = document.getElementById(
            "nextPage",
        ) as HTMLButtonElement;

        if (pageNumInput) {
            pageNumInput.value = this.currentPage.toString();
        }

        // Update navigation button states
        if (prevBtn) {
            prevBtn.disabled = this.currentPage <= 1;
        }

        if (nextBtn && this.pdfDoc) {
            nextBtn.disabled = this.currentPage >= this.pdfDoc.numPages;
        }
    }

    /**
     * Update scale indicator
     */
    private updateScaleIndicator(): void {
        const scaleElement = document.getElementById("scale");
        if (scaleElement) {
            scaleElement.textContent = Math.round(this.scale * 100) + "%";
        }
    }

    /**
     * Set up SSE connection for real-time features
     */
    private setupSSEConnection(documentId: string): void {
        try {
            this.sseClient = new PDFSSEClient(documentId);
            this.sseClient.on("annotation-added", (data: any) => {
                console.log("📝 Annotation added:", data);
            });
            this.sseClient.on("annotation-updated", (data: any) => {
                console.log("📝 Annotation updated:", data);
            });
            this.sseClient.on("user-joined", (data: any) => {
                console.log("👤 User joined:", data);
            });
        } catch (error) {
            console.warn("⚠️ Failed to set up SSE connection:", error);
        }
    }

    /**
     * Show loading message
     */
    private showLoading(message: string): void {
        const container = document.getElementById("viewerContainer");
        if (container) {
            container.innerHTML = `
                <div class="loading">
                    <div>🔄 ${message}</div>
                </div>
            `;
        }
    }

    /**
     * Show error message
     */
    private showError(message: string): void {
        const container = document.getElementById("viewerContainer");
        if (container) {
            container.innerHTML = `
                <div class="error">
                    <div>❌ Error</div>
                    <p>${message}</p>
                    <button onclick="window.location.reload()" 
                            style="margin-top: 20px; padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Reload Page
                    </button>
                </div>
            `;
        }
    }
}

// Initialize the application when DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
    console.log("🚀 TypeAgent PDF Viewer starting...");
    console.log("📄 DOM ready state:", document.readyState);

    // Double-check DOM is ready
    if (document.readyState === "loading") {
        console.log("⏳ DOM still loading, waiting...");
        return;
    }

    try {
        const app = new TypeAgentPDFViewerApp();
        (window as any).TypeAgentPDFViewer = app;
        await app.initialize();
    } catch (error) {
        console.error("❌ Failed to start PDF viewer:", error);
    }
});

// Fallback in case DOMContentLoaded already fired
if (document.readyState !== "loading") {
    console.log("🔄 DOM already ready, initializing immediately...");
    document.dispatchEvent(new Event("DOMContentLoaded"));
}

// Export for global access
export default TypeAgentPDFViewerApp;

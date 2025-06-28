// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as pdfjsLib from "pdfjs-dist";
// Import the viewer as a global script
import "pdfjs-dist/web/pdf_viewer.mjs";
import { PDFApiService } from "./services/pdfApiService";
import { PDFSSEClient } from "./services/pdfSSEClient";
import "./pdf-viewer.css";

// PDF.js library types
declare global {
    interface Window {
        pdfjsLib: any;
        pdfjsViewer: any;
    }
}

// Configure PDF.js worker
if (typeof window !== "undefined") {
    // Ensure pdfjsLib is available globally
    window.pdfjsLib = pdfjsLib;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url,
).toString();

/**
 * Enhanced TypeAgent PDF Viewer using npm pdfjs-dist package
 */
export class TypeAgentPDFViewerApp {
    private pdfDoc: any = null;
    private pdfViewer: any = null;
    private eventBus: any = null;
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
        console.log(
            "🚀 Initializing TypeAgent PDF Viewer with npm pdfjs-dist...",
        );

        try {
            // Set up PDF.js viewer components
            await this.setupPDFJSViewer();

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
     * Set up PDF.js viewer components
     */
    private async setupPDFJSViewer(): Promise<void> {
        console.log("🔧 Setting up PDF.js viewer components...");

        // Wait for PDF.js to be available
        if (!window.pdfjsLib || !window.pdfjsViewer) {
            throw new Error("PDF.js not loaded");
        }

        // Create event bus
        this.eventBus = new window.pdfjsViewer.EventBus();

        // Get viewer container
        const viewerContainer = document.getElementById("viewerContainer");
        if (!viewerContainer) {
            throw new Error("Viewer container not found");
        }

        // Create the specific structure that PDF.js expects
        viewerContainer.innerHTML = `
            <div id="viewer" class="pdfViewer"></div>
        `;

        // Ensure the container has absolute positioning (PDF.js requirement)
        // Position it below the toolbar
        const toolbar = document.querySelector(".toolbar") as HTMLElement;
        const toolbarHeight = toolbar ? toolbar.offsetHeight : 56; // Default fallback

        console.log("📄 Toolbar height:", toolbarHeight, "px");

        viewerContainer.style.position = "absolute";
        viewerContainer.style.top = `${toolbarHeight}px`;
        viewerContainer.style.left = "0";
        viewerContainer.style.right = "0";
        viewerContainer.style.bottom = "0";
        viewerContainer.style.overflow = "auto";

        const viewerElement = document.getElementById("viewer");
        if (!viewerElement) {
            throw new Error("PDF viewer element not found");
        }

        // Wait for container to be properly rendered
        await new Promise((resolve) => {
            const checkDimensions = () => {
                const rect = viewerContainer.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    console.log(
                        "✅ Container has proper dimensions:",
                        rect.width,
                        "x",
                        rect.height,
                    );
                    resolve(true);
                } else {
                    console.log("⏳ Waiting for container dimensions...");
                    setTimeout(checkDimensions, 100);
                }
            };
            checkDimensions();
        });

        // Create PDF link service
        const linkService = new window.pdfjsViewer.PDFLinkService({
            eventBus: this.eventBus,
        });

        // Create PDF viewer with the correct container structure
        this.pdfViewer = new window.pdfjsViewer.PDFViewer({
            container: viewerContainer,
            viewer: viewerElement,
            eventBus: this.eventBus,
            linkService: linkService,
            renderer: "canvas", // Use canvas renderer for better compatibility
            textLayerMode: 2, // Enable text selection
            annotationMode: 2, // Enable annotations
            removePageBorders: false,
            l10n: window.pdfjsViewer.NullL10n, // Use NullL10n for simplicity
        });

        // Link the link service to the viewer
        linkService.setViewer(this.pdfViewer);

        // Set up event listeners for the PDF viewer
        this.eventBus.on("pagesinit", () => {
            console.log("📄 Pages initialized");

            // Check container layout for debugging
            const container = document.getElementById("viewerContainer");
            const viewer = document.getElementById("viewer");

            if (container && viewer) {
                const containerRect = container.getBoundingClientRect();
                const viewerRect = viewer.getBoundingClientRect();
                console.log(
                    "📄 Container rect:",
                    containerRect.width,
                    "x",
                    containerRect.height,
                );
                console.log(
                    "📄 Viewer rect:",
                    viewerRect.width,
                    "x",
                    viewerRect.height,
                );
                console.log(
                    "📄 Container offsetParent:",
                    container.offsetParent,
                );
                console.log("📄 Viewer offsetParent:", viewer.offsetParent);

                // Check if pages are actually being rendered
                const pages = viewer.querySelectorAll(".page");
                console.log("📄 Number of rendered pages:", pages.length);

                if (pages.length > 0) {
                    console.log(
                        "📄 First page dimensions:",
                        pages[0].getBoundingClientRect(),
                    );
                }
            }

            // Hide loading overlay when pages are initialized
            this.hideLoadingState();

            console.log("📄 Letting PDF.js handle initial scale naturally");
        });

        this.eventBus.on("pagechanging", (evt: any) => {
            console.log("📄 Page changing to:", evt.pageNumber);
            this.currentPage = evt.pageNumber;
            this.updateCurrentPageIndicator();
        });

        this.eventBus.on("scalechanging", (evt: any) => {
            console.log("🔍 Scale changing to:", evt.scale);
            this.scale = evt.scale;
            this.updateScaleIndicator();
        });

        console.log("✅ PDF.js viewer components set up successfully");
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

        if (
            !prevBtn ||
            !nextBtn ||
            !pageNumInput ||
            !zoomInBtn ||
            !zoomOutBtn
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

        // Custom zoom handling for Ctrl+scroll wheel
        this.setupCustomZoomHandling();

        console.log("✅ Event handlers set up successfully");
    }

    /**
     * Load PDF document from ArrayBuffer
     */
    private async loadPDFDocument(data: ArrayBuffer | string): Promise<void> {
        try {
            console.log("📄 Loading PDF document...");
            console.log("📄 Data type:", typeof data);

            if (data instanceof ArrayBuffer) {
                console.log("📄 ArrayBuffer size:", data.byteLength, "bytes");
            } else {
                console.log(
                    "📄 String/URL data:",
                    typeof data === "string" ? data.substring(0, 100) : data,
                );
            }

            // Validate the data before passing to PDF.js
            if (data instanceof ArrayBuffer && data.byteLength === 0) {
                throw new Error("PDF data is empty");
            }

            // Load the PDF document using pdfjs-dist
            const loadingTask = window.pdfjsLib.getDocument({
                data: data,
                cMapUrl:
                    "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.3.31/cmaps/",
                cMapPacked: true,
                enableXfa: true,
                verbosity: 1, // Enable some debugging
            });

            // Add progress tracking
            loadingTask.onProgress = (progress: any) => {
                console.log(
                    "📄 PDF loading progress:",
                    progress.loaded,
                    "/",
                    progress.total,
                );
            };

            this.pdfDoc = await loadingTask.promise;

            console.log(
                "📄 PDF loaded successfully. Pages:",
                this.pdfDoc.numPages,
            );

            // Set the document in the PDF viewer
            if (this.pdfViewer) {
                console.log("📄 Setting document in PDF viewer");
                this.pdfViewer.setDocument(this.pdfDoc);

                // Wait for pages to initialize and viewer to be ready
                await new Promise((resolve) => {
                    const checkInit = () => {
                        if (this.pdfViewer.pagesCount > 0) {
                            console.log(
                                "📄 PDF viewer pages initialized, count:",
                                this.pdfViewer.pagesCount,
                            );

                            // Additional check for container dimensions
                            const container =
                                document.getElementById("viewerContainer");
                            if (container) {
                                const rect = container.getBoundingClientRect();
                                console.log(
                                    "📄 Container dimensions:",
                                    rect.width,
                                    "x",
                                    rect.height,
                                );

                                if (rect.width > 0 && rect.height > 0) {
                                    resolve(true);
                                } else {
                                    console.log(
                                        "⏳ Container not ready, waiting...",
                                    );
                                    setTimeout(checkInit, 100);
                                }
                            } else {
                                resolve(true);
                            }
                        } else {
                            setTimeout(checkInit, 100);
                        }
                    };
                    checkInit();
                });
            }

            // Update UI
            this.updatePageCount();
            this.currentPage = 1;

            // Hide loading state
            this.hideLoadingState();

            console.log("✅ PDF document loaded successfully");
        } catch (error) {
            console.error("❌ Failed to load PDF document:", error);

            // Provide more specific error messages
            if (error instanceof Error) {
                if (error.name === "InvalidPDFException") {
                    this.showError(
                        "Invalid PDF file. Please check that the file is a valid PDF document.",
                    );
                } else if (error.name === "PasswordException") {
                    this.showError(
                        "This PDF is password protected. Password-protected PDFs are not currently supported.",
                    );
                } else {
                    this.showError(`Failed to load PDF: ${error.message}`);
                }
            }

            throw error;
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
            console.log("📄 Loading PDF from URL:", url);

            // First, get or create a document ID for this URL
            this.showLoading("Getting document ID...");
            const urlMapping =
                await this.pdfApiService.getDocumentIdFromUrl(url);
            this.documentId = urlMapping.documentId;

            console.log("📄 Document ID for URL:", this.documentId);

            // Now fetch the PDF data
            this.showLoading("Fetching PDF data...");
            console.log("📄 Fetching PDF from URL:", url);

            const response = await fetch(url, {
                method: "GET",
                headers: {
                    Accept: "application/pdf",
                },
            });

            if (!response.ok) {
                throw new Error(
                    `Failed to fetch PDF: ${response.status} ${response.statusText}`,
                );
            }

            const contentType = response.headers.get("content-type");
            console.log("📄 Response content-type:", contentType);

            const arrayBuffer = await response.arrayBuffer();
            console.log(
                "📄 Downloaded PDF size:",
                arrayBuffer.byteLength,
                "bytes",
            );

            // Validate that we got some data
            if (arrayBuffer.byteLength === 0) {
                throw new Error("Downloaded PDF file is empty");
            }

            // Check for PDF header
            const uint8Array = new Uint8Array(arrayBuffer);
            const pdfHeader = String.fromCharCode.apply(
                null,
                Array.from(uint8Array.slice(0, 4)),
            );
            console.log("📄 PDF header:", pdfHeader);

            if (!pdfHeader.startsWith("%PDF")) {
                console.error(
                    "📄 Invalid PDF header. First 20 bytes:",
                    String.fromCharCode.apply(
                        null,
                        Array.from(uint8Array.slice(0, 20)),
                    ),
                );
                throw new Error(
                    "Downloaded file is not a valid PDF (missing PDF header)",
                );
            }

            // Load the validated PDF data
            this.showLoading("Loading PDF document...");
            await this.loadPDFDocument(arrayBuffer);

            // Set up SSE connection for real-time features using the document ID
            if (this.documentId) {
                this.setupSSEConnection(this.documentId);
            }

            console.log(
                "✅ PDF loaded from URL successfully with document ID:",
                this.documentId,
            );
        } catch (error) {
            console.error("❌ Failed to load PDF from URL:", error);

            if (error instanceof Error) {
                this.showError(`Failed to load PDF from URL: ${error.message}`);
            } else {
                this.showError(
                    "Failed to load PDF from URL. Please check if the URL is accessible and points to a valid PDF file.",
                );
            }
            throw error;
        }
    }

    /**
     * Load a sample PDF document for demonstration
     */
    async loadSampleDocument(): Promise<void> {
        try {
            this.showLoading("Loading sample document...");

            // Use a known working sample PDF URL
            const samplePdfUrl =
                "https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/web/compressed.tracemonkey-pldi-09.pdf";

            // Use the same flow as loading from URL to get a document ID
            await this.loadPDFFromUrl(samplePdfUrl);

            console.log("✅ Sample document loaded successfully");
        } catch (error) {
            console.error("❌ Failed to load sample document:", error);
            this.showError("Failed to load sample PDF document");
        }
    }

    /**
     * Get the current document ID
     */
    getCurrentDocumentId(): string | null {
        return this.documentId;
    }

    /**
     * Navigate to previous page
     */
    async goToPreviousPage(): Promise<void> {
        if (this.pdfViewer && this.currentPage > 1) {
            this.pdfViewer.currentPageNumber = this.currentPage - 1;
        }
    }

    /**
     * Navigate to next page
     */
    async goToNextPage(): Promise<void> {
        if (
            this.pdfViewer &&
            this.pdfDoc &&
            this.currentPage < this.pdfDoc.numPages
        ) {
            this.pdfViewer.currentPageNumber = this.currentPage + 1;
        }
    }

    /**
     * Go to specific page
     */
    async goToPage(pageNum: number): Promise<void> {
        if (
            this.pdfViewer &&
            this.pdfDoc &&
            pageNum >= 1 &&
            pageNum <= this.pdfDoc.numPages
        ) {
            this.pdfViewer.currentPageNumber = pageNum;
        }
    }

    /**
     * Zoom in
     */
    async zoomIn(): Promise<void> {
        if (this.pdfViewer) {
            const currentScale = this.pdfViewer.currentScale;
            this.pdfViewer.currentScale = Math.min(currentScale * 1.2, 3.0);
        }
    }

    /**
     * Zoom out
     */
    async zoomOut(): Promise<void> {
        if (this.pdfViewer) {
            const currentScale = this.pdfViewer.currentScale;
            this.pdfViewer.currentScale = Math.max(currentScale / 1.2, 0.3);
        }
    }

    /**
     * Set up custom zoom handling for Ctrl+scroll wheel
     */
    private setupCustomZoomHandling(): void {
        console.log(
            "🔧 Setting up custom zoom handling for Ctrl+scroll wheel...",
        );

        // Add wheel event listener to the viewer container
        const viewerContainer = document.getElementById("viewerContainer");
        if (!viewerContainer) {
            console.warn("⚠️ Viewer container not found for zoom handling");
            return;
        }

        viewerContainer.addEventListener(
            "wheel",
            (event: WheelEvent) => {
                // Only handle Ctrl+scroll events
                if (!event.ctrlKey) {
                    return;
                }

                // Prevent the default browser zoom behavior
                event.preventDefault();
                event.stopPropagation();

                // Determine zoom direction based on wheel delta
                const zoomDirection = event.deltaY < 0 ? "in" : "out";

                // Apply zoom with more granular control than button clicks
                this.performCustomZoom(zoomDirection, event);
            },
            { passive: false },
        ); // passive: false allows preventDefault

        // Also handle the document level to catch any events that bubble up
        document.addEventListener(
            "wheel",
            (event: WheelEvent) => {
                // Only handle Ctrl+scroll when we're in the PDF viewer area
                if (!event.ctrlKey) {
                    return;
                }

                // Check if the event target is within our PDF viewer
                const target = event.target as Element;
                const viewerContainer =
                    document.getElementById("viewerContainer");

                if (
                    viewerContainer &&
                    (viewerContainer.contains(target) ||
                        target === viewerContainer)
                ) {
                    // Prevent default browser zoom
                    event.preventDefault();
                    event.stopPropagation();
                }
            },
            { passive: false },
        );

        console.log("✅ Custom zoom handling set up successfully");
    }

    /**
     * Perform custom zoom with more granular control
     */
    private async performCustomZoom(
        direction: "in" | "out",
        event?: WheelEvent,
    ): Promise<void> {
        if (!this.pdfViewer) {
            return;
        }

        const currentScale = this.pdfViewer.currentScale;
        let newScale: number;

        // Use smaller zoom increments for smoother scrolling experience
        const zoomFactor = 1.1; // Smaller than button clicks (1.2) for smoother scrolling
        const minScale = 0.25; // Allow zooming out more than button clicks
        const maxScale = 5.0; // Allow zooming in more than button clicks

        if (direction === "in") {
            newScale = Math.min(currentScale * zoomFactor, maxScale);
        } else {
            newScale = Math.max(currentScale / zoomFactor, minScale);
        }

        // Only apply zoom if the scale actually changes
        if (Math.abs(newScale - currentScale) > 0.001) {
            this.pdfViewer.currentScale = newScale;

            // Show temporary zoom indicator
            this.showZoomIndicator(newScale);

            // Optional: Log zoom changes for debugging
            console.log(
                `🔍 Custom zoom ${direction}: ${Math.round(currentScale * 100)}% → ${Math.round(newScale * 100)}%`,
            );
        }
    }

    /**
     * Show temporary zoom level indicator
     */
    private showZoomIndicator(scale: number): void {
        const zoomPercentage = Math.round(scale * 100);

        // Update the existing zoom display
        this.updateScaleIndicator();

        // Create or update temporary zoom overlay
        let zoomOverlay = document.getElementById(
            "zoom-overlay",
        ) as HTMLElement;

        if (!zoomOverlay) {
            zoomOverlay = document.createElement("div");
            zoomOverlay.id = "zoom-overlay";
            document.body.appendChild(zoomOverlay);
        }

        zoomOverlay.textContent = `${zoomPercentage}%`;
        zoomOverlay.className = "zoom-in"; // Trigger animation
        zoomOverlay.style.opacity = "1";

        // Clear any existing timeout
        if ((zoomOverlay as any).hideTimeout) {
            clearTimeout((zoomOverlay as any).hideTimeout);
        }

        // Hide overlay after a short delay
        (zoomOverlay as any).hideTimeout = setTimeout(() => {
            zoomOverlay.style.opacity = "0";
            setTimeout(() => {
                if (zoomOverlay.parentNode) {
                    zoomOverlay.parentNode.removeChild(zoomOverlay);
                }
            }, 300); // Match CSS transition duration
        }, 1200);
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
            // Remove any existing loading overlay
            const existingOverlay = container.querySelector(".loading-overlay");
            if (existingOverlay) {
                existingOverlay.remove();
            }

            // Create loading overlay (don't replace container content)
            const loadingOverlay = document.createElement("div");
            loadingOverlay.className = "loading-overlay";
            loadingOverlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(50, 54, 57, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            `;

            loadingOverlay.innerHTML = `
                <div class="loading">
                    <div>🔄 ${message}</div>
                </div>
            `;

            container.appendChild(loadingOverlay);
        }
    }

    /**
     * Hide loading state
     */
    private hideLoadingState(): void {
        const container = document.getElementById("viewerContainer");
        if (container) {
            // Remove loading overlay
            const loadingOverlay = container.querySelector(".loading-overlay");
            if (loadingOverlay) {
                loadingOverlay.remove();
            }
        }

        console.log("📄 Loading state hidden");
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
    console.log("🚀 TypeAgent PDF Viewer starting with npm pdfjs-dist...");
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

// Export for global access
export default TypeAgentPDFViewerApp;

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:pdfView");
const debugError = registerDebug("typeagent:browser:pdfView:error");

/**
 * PDF View Page Controller
 * Manages the PDF viewer page that hosts the TypeAgent PDF reader in an iframe
 */
class PDFViewPage {
    private pdfFrame!: HTMLIFrameElement;
    private loadingContainer!: HTMLElement;
    private errorContainer!: HTMLElement;
    private errorMessage!: HTMLElement;
    private pdfUrlDisplay!: HTMLElement;
    private urlInfo!: HTMLElement;
    private openOriginalBtn!: HTMLButtonElement;
    private downloadBtn!: HTMLButtonElement;
    private retryBtn!: HTMLButtonElement;
    private openInNewTabBtn!: HTMLButtonElement;
    
    private pdfUrl: string | null = null;
    private viewerUrl: string | null = null;
    private retryCount: number = 0;
    private maxRetries: number = 3;

    constructor() {
        this.initializeElements();
        this.setupEventListeners();
    }

    /**
     * Initialize DOM elements
     */
    private initializeElements(): void {
        this.pdfFrame = document.getElementById('pdfFrame') as HTMLIFrameElement;
        this.loadingContainer = document.getElementById('loadingContainer') as HTMLElement;
        this.errorContainer = document.getElementById('errorContainer') as HTMLElement;
        this.errorMessage = document.getElementById('errorMessage') as HTMLElement;
        this.pdfUrlDisplay = document.getElementById('pdfUrlDisplay') as HTMLElement;
        this.urlInfo = document.getElementById('urlInfo') as HTMLElement;
        this.openOriginalBtn = document.getElementById('openOriginalBtn') as HTMLButtonElement;
        this.downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
        this.retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;
        this.openInNewTabBtn = document.getElementById('openInNewTabBtn') as HTMLButtonElement;
    }

    /**
     * Set up event listeners
     */
    private setupEventListeners(): void {
        this.retryBtn.addEventListener('click', () => this.retry());
        this.openInNewTabBtn.addEventListener('click', () => this.openInNewTab());
        this.openOriginalBtn.addEventListener('click', () => this.openInNewTab());
        this.downloadBtn.addEventListener('click', () => this.downloadPDF());

        // Set up iframe error handling
        this.pdfFrame.addEventListener('error', () => {
            this.showError('Failed to load PDF viewer', 'IFRAME_ERROR');
        });

        // Set up iframe load success
        this.pdfFrame.addEventListener('load', () => {
            this.onIframeLoad();
        });
    }

    /**
     * Initialize the PDF viewer
     */
    async initialize(): Promise<void> {
        debug("Initializing PDF view page");

        try {
            // Show loading state
            this.showLoading("Initializing PDF viewer...");

            // Extract PDF URL from query parameters
            this.pdfUrl = this.extractPDFUrl();
            if (!this.pdfUrl) {
                throw new Error('No PDF URL provided in query parameters');
            }

            // Update URL info in header
            this.updateUrlInfo(this.pdfUrl);
            this.updateActionButtons();

            // Get view host URL and load PDF
            await this.loadPDFViewer();

        } catch (error) {
            debugError("Failed to initialize PDF view page:", error);
            this.showError(
                error instanceof Error ? error.message : 'Unknown initialization error',
                'INIT_ERROR'
            );
        }
    }

    /**
     * Extract PDF URL from query parameters
     */
    private extractPDFUrl(): string | null {
        const urlParams = new URLSearchParams(window.location.search);
        const url = urlParams.get('url');
        
        if (!url) {
            return null;
        }

        try {
            // Validate URL format
            new URL(url);
            return url;
        } catch (error) {
            debugError("Invalid PDF URL format:", url, error);
            return null;
        }
    }

    /**
     * Update URL info display
     */
    private updateUrlInfo(url: string): void {
        try {
            const urlObj = new URL(url);
            const displayUrl = `${urlObj.hostname}${urlObj.pathname}`;
            this.urlInfo.textContent = displayUrl;
            this.urlInfo.title = url;
            this.pdfUrlDisplay.textContent = url;
        } catch (error) {
            this.urlInfo.textContent = url;
            this.pdfUrlDisplay.textContent = url;
        }
    }

    /**
     * Update action buttons visibility and functionality
     */
    private updateActionButtons(): void {
        if (this.pdfUrl) {
            this.openOriginalBtn.style.display = 'flex';
            this.downloadBtn.style.display = 'flex';
        }
    }

    /**
     * Load the PDF viewer
     */
    private async loadPDFViewer(): Promise<void> {
        debug("Loading PDF viewer for URL:", this.pdfUrl);

        if (!this.pdfUrl) {
            throw new Error('No PDF URL available');
        }

        this.showLoading("Connecting to TypeAgent PDF reader...");

        try {
            // Get view host URL from service worker
            const response = await this.getViewHostUrl();
            
            if (!response || !response.url) {
                throw new Error('Unable to get view host URL from TypeAgent service');
            }

            // Construct PDF reader URL
            this.viewerUrl = `${response.url}/pdf/?url=${encodeURIComponent(this.pdfUrl)}`;
            debug("Constructed viewer URL:", this.viewerUrl);

            // Load in iframe with timeout
            await this.loadIframeWithTimeout(this.viewerUrl, 30000);

        } catch (error) {
            debugError("Error loading PDF viewer:", error);
            
            if (error instanceof Error) {
                if (error.message.includes('timeout')) {
                    this.showError(
                        'The PDF viewer is taking too long to load. This might be due to a large file or slow connection.',
                        'TIMEOUT_ERROR'
                    );
                } else if (error.message.includes('view host')) {
                    this.showError(
                        'Unable to connect to the TypeAgent PDF service. Please ensure TypeAgent is running.',
                        'SERVICE_ERROR'
                    );
                } else {
                    this.showError(error.message, 'LOAD_ERROR');
                }
            } else {
                this.showError('Unknown error occurred while loading PDF viewer', 'UNKNOWN_ERROR');
            }
        }
    }

    /**
     * Get view host URL from service worker
     */
    private async getViewHostUrl(): Promise<{ url: string } | null> {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "getViewHostUrl"
            });

            if (response && response.url) {
                debug("Received view host URL:", response.url);
                return response;
            } else {
                debugError("Invalid response from getViewHostUrl:", response);
                return null;
            }
        } catch (error) {
            debugError("Error getting view host URL:", error);
            throw new Error('Failed to communicate with TypeAgent service worker');
        }
    }

    /**
     * Load iframe with timeout
     */
    private loadIframeWithTimeout(url: string, timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('PDF viewer load timeout'));
            }, timeoutMs);

            const onLoad = () => {
                clearTimeout(timeout);
                this.pdfFrame.removeEventListener('load', onLoad);
                this.pdfFrame.removeEventListener('error', onError);
                resolve();
            };

            const onError = () => {
                clearTimeout(timeout);
                this.pdfFrame.removeEventListener('load', onLoad);
                this.pdfFrame.removeEventListener('error', onError);
                reject(new Error('PDF viewer failed to load'));
            };

            this.pdfFrame.addEventListener('load', onLoad);
            this.pdfFrame.addEventListener('error', onError);
            
            // Start loading
            this.pdfFrame.src = url;
        });
    }

    /**
     * Handle iframe load success
     */
    private onIframeLoad(): void {
        // Check if iframe actually loaded content (not an error page)
        try {
            const iframeSrc = this.pdfFrame.src;
            if (iframeSrc && iframeSrc !== 'about:blank') {
                debug("PDF viewer loaded successfully");
                this.showPDFViewer();
                this.retryCount = 0; // Reset retry count on success
            }
        } catch (error) {
            debugError("Error checking iframe load:", error);
        }
    }

    /**
     * Show loading state
     */
    private showLoading(message: string = "Loading PDF viewer..."): void {
        const loadingText = document.querySelector('.loading-text') as HTMLElement;
        if (loadingText) {
            loadingText.textContent = message;
        }

        // Keep header hidden during loading - only show for errors
        // Use full viewport height for loading container
        this.loadingContainer.style.height = '100vh';
        this.loadingContainer.style.display = 'flex';
        this.errorContainer.style.display = 'none';
        this.pdfFrame.style.display = 'none';
    }

    /**
     * Show error state
     */
    private showError(message: string, errorType: string = 'UNKNOWN'): void {
        debugError(`PDF viewer error [${errorType}]:`, message);
        
        // Show extension header for error state
        const header = document.querySelector('.header') as HTMLElement;
        if (header) {
            header.style.display = 'flex';
        }
        
        // Adjust container height for header
        this.errorContainer.style.height = 'calc(100vh - 60px)';
        this.pdfFrame.style.height = 'calc(100vh - 60px)';
        
        this.errorMessage.textContent = message;
        this.errorContainer.style.display = 'flex';
        this.loadingContainer.style.display = 'none';
        this.pdfFrame.style.display = 'none';

        // Show retry button only for certain error types and if retries available
        if (this.retryCount < this.maxRetries && ['TIMEOUT_ERROR', 'LOAD_ERROR', 'IFRAME_ERROR'].includes(errorType)) {
            this.retryBtn.style.display = 'flex';
        } else {
            this.retryBtn.style.display = 'none';
        }
    }

    /**
     * Show PDF viewer (hide loading/error states)
     */
    private showPDFViewer(): void {
        // Hide extension header to give full height to iframe
        const header = document.querySelector('.header') as HTMLElement;
        if (header) {
            header.style.display = 'none';
        }
        
        // Give iframe full viewport height
        this.pdfFrame.style.height = '100vh';
        this.pdfFrame.style.display = 'block';
        this.loadingContainer.style.display = 'none';
        this.errorContainer.style.display = 'none';
    }

    /**
     * Retry loading the PDF viewer
     */
    private async retry(): Promise<void> {
        if (this.retryCount >= this.maxRetries) {
            this.showError('Maximum retry attempts reached', 'MAX_RETRIES');
            return;
        }

        this.retryCount++;
        debug(`Retrying PDF viewer load (attempt ${this.retryCount}/${this.maxRetries})`);
        
        // Reset iframe
        this.pdfFrame.src = 'about:blank';
        
        // Wait a moment before retrying
        setTimeout(() => {
            this.loadPDFViewer();
        }, 1000);
    }

    /**
     * Open PDF in new tab
     */
    private openInNewTab(): void {
        if (this.pdfUrl) {
            debug("Opening PDF in new tab:", this.pdfUrl);
            window.open(this.pdfUrl, '_blank');
        }
    }

    /**
     * Download PDF
     */
    private downloadPDF(): void {
        if (this.pdfUrl) {
            debug("Downloading PDF:", this.pdfUrl);
            const link = document.createElement('a');
            link.href = this.pdfUrl;
            link.download = this.extractFilenameFromUrl(this.pdfUrl);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    /**
     * Extract filename from URL
     */
    private extractFilenameFromUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop();
            
            if (filename && filename.includes('.')) {
                return filename;
            } else {
                return 'document.pdf';
            }
        } catch (error) {
            return 'document.pdf';
        }
    }

    /**
     * Get current status for debugging
     */
    public getStatus(): object {
        return {
            pdfUrl: this.pdfUrl,
            viewerUrl: this.viewerUrl,
            retryCount: this.retryCount,
            currentState: this.getCurrentState()
        };
    }

    /**
     * Get current display state
     */
    private getCurrentState(): string {
        if (this.loadingContainer.style.display !== 'none') return 'loading';
        if (this.errorContainer.style.display !== 'none') return 'error';
        if (this.pdfFrame.style.display !== 'none') return 'viewing';
        return 'unknown';
    }
}

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
    debugError('Uncaught error in PDF view page:', event.error);
});

// Global handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
    debugError('Unhandled promise rejection in PDF view page:', event.reason);
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    debug("DOM loaded, initializing PDF view page");
    const pdfViewPage = new PDFViewPage();
    pdfViewPage.initialize();

    // Make available globally for debugging
    (window as any).pdfViewPage = pdfViewPage;
});

// Handle beforeunload to cleanup if needed
window.addEventListener('beforeunload', () => {
    debug("PDF view page unloading");
});

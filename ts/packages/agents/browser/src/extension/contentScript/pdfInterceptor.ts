// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:pdfInterceptor");
const debugError = registerDebug("typeagent:browser:pdfInterceptor:error");

/**
 * PDF Link Interceptor
 * Detects PDF links and redirects to custom PDF viewer when WebSocket is connected
 */
export class PDFInterceptor {
    private isWebSocketConnected: boolean = false;
    private connectionCheckPromise: Promise<boolean> | null = null;
    private isInitialized: boolean = false;

    /**
     * Initialize the PDF interceptor
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        debug("Initializing PDF interceptor");

        try {
            // Check initial WebSocket connection
            await this.checkWebSocketConnection();

            // Set up event listeners
            this.setupClickInterceptor();
            this.setupNavigationInterceptor();

            // Monitor WebSocket connection changes
            this.monitorWebSocketConnection();

            this.isInitialized = true;
            debug("PDF interceptor initialized successfully");
        } catch (error) {
            debugError("Failed to initialize PDF interceptor:", error);
        }
    }

    /**
     * Check WebSocket connection status
     */
    private async checkWebSocketConnection(): Promise<boolean> {
        // Prevent multiple simultaneous connection checks
        if (this.connectionCheckPromise) {
            return this.connectionCheckPromise;
        }

        this.connectionCheckPromise = this.performConnectionCheck();
        const result = await this.connectionCheckPromise;
        this.connectionCheckPromise = null;
        return result;
    }

    /**
     * Perform actual connection check
     */
    private async performConnectionCheck(): Promise<boolean> {
        try {
            const response = await chrome.runtime.sendMessage({
                type: "checkWebSocketConnection",
            });
            this.isWebSocketConnected = response?.connected || false;
            debug(`WebSocket connection status: ${this.isWebSocketConnected}`);
            return this.isWebSocketConnected;
        } catch (error) {
            debugError("Error checking WebSocket connection:", error);
            this.isWebSocketConnected = false;
            return false;
        }
    }

    /**
     * Set up click event interceptor for PDF links
     */
    private setupClickInterceptor(): void {
        document.addEventListener("click", this.handleClick.bind(this), true);
        debug("Click interceptor set up");
    }

    /**
     * Handle click events on potential PDF links
     */
    private async handleClick(event: MouseEvent): Promise<void> {
        try {
            const target = event.target as HTMLElement;
            const link = this.findPDFLink(target);

            if (link && this.isPDFUrl(link.href)) {
                debug(`PDF link detected: ${link.href}`);

                // Check WebSocket before intercepting
                if (await this.checkWebSocketConnection()) {
                    debug(`Intercepting PDF link: ${link.href}`);
                    event.preventDefault();
                    event.stopPropagation();
                    await this.redirectToPDFViewer(link.href);
                } else {
                    debug(
                        `WebSocket not connected, allowing default PDF handling for: ${link.href}`,
                    );
                }
            }
        } catch (error) {
            debugError("Error handling click event:", error);
        }
    }

    /**
     * Find PDF link from clicked element (traverse up DOM tree)
     */
    private findPDFLink(element: HTMLElement): HTMLAnchorElement | null {
        let current = element;

        // Traverse up the DOM tree to find an anchor element
        while (current && current !== document.body) {
            if (current.tagName.toLowerCase() === "a") {
                return current as HTMLAnchorElement;
            }
            current = current.parentElement as HTMLElement;
        }

        return null;
    }

    /**
     * Check if URL points to a PDF file
     */
    private isPDFUrl(url: string): boolean {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname.toLowerCase();

            // Check file extension
            if (pathname.endsWith(".pdf")) {
                return true;
            }

            // Check content-type parameter
            if (urlObj.searchParams.get("content-type") === "application/pdf") {
                return true;
            }

            // Check for common PDF URL patterns
            const pdfPatterns = [
                /\.pdf(\?|#|$)/i,
                /\/pdf\//i,
                /content-type=application\/pdf/i,
            ];

            return pdfPatterns.some((pattern) => pattern.test(url));
        } catch (error) {
            debugError("Error checking PDF URL:", error);
            return false;
        }
    }

    /**
     * Redirect to custom PDF viewer
     */
    private async redirectToPDFViewer(pdfUrl: string): Promise<void> {
        try {
            const extensionUrl = chrome.runtime.getURL(
                `views/pdfView.html?url=${encodeURIComponent(pdfUrl)}`,
            );
            debug(`Redirecting to PDF viewer: ${extensionUrl}`);
            window.location.href = extensionUrl;
        } catch (error) {
            debugError("Error redirecting to PDF viewer:", error);
            // Fallback: open in new tab
            window.open(pdfUrl, "_blank");
        }
    }

    /**
     * Set up navigation interceptor for direct PDF URL access
     */
    private setupNavigationInterceptor(): void {
        // Check if current page is a PDF URL
        if (window.location.href && this.isPDFUrl(window.location.href)) {
            this.handleDirectPDFNavigation();
        }

        debug("Navigation interceptor set up");
    }

    /**
     * Handle direct PDF URL navigation
     */
    private async handleDirectPDFNavigation(): Promise<void> {
        try {
            debug(`Direct PDF navigation detected: ${window.location.href}`);

            if (await this.checkWebSocketConnection()) {
                const currentUrl = window.location.href;
                const extensionUrl = chrome.runtime.getURL(
                    `views/pdfView.html?url=${encodeURIComponent(currentUrl)}`,
                );
                debug(`Redirecting direct PDF navigation: ${extensionUrl}`);
                window.location.replace(extensionUrl);
            } else {
                debug(
                    "WebSocket not connected, allowing default PDF handling for direct navigation",
                );
            }
        } catch (error) {
            debugError("Error handling direct PDF navigation:", error);
        }
    }

    /**
     * Monitor WebSocket connection changes
     */
    private monitorWebSocketConnection(): void {
        // Check connection status periodically
        setInterval(async () => {
            await this.checkWebSocketConnection();
        }, 30000); // Check every 30 seconds

        debug("WebSocket connection monitoring started");
    }

    /**
     * Get current connection status (for debugging)
     */
    public getConnectionStatus(): boolean {
        return this.isWebSocketConnected;
    }
}

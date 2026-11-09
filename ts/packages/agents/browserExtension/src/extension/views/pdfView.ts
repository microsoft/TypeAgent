// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { createChromeRpcClient } from "./chromeRpcClient";
import { createElectronRpcClient } from "./electronRpcClient";
import {
    createPdfCorpusImport,
    type PdfImportContent,
} from "./pdfCorpusImport";

const debug = registerDebug("typeagent:browser:pdfView");
const debugError = registerDebug("typeagent:browser:pdfView:error");

let chromeRpcSingleton: ReturnType<typeof createChromeRpcClient> | undefined;
function getChromeRpc() {
    if (!chromeRpcSingleton)
        chromeRpcSingleton =
            createElectronRpcClient() ?? createChromeRpcClient();
    return chromeRpcSingleton;
}

/**
 * PDF View Page Controller
 * Manages the PDF viewer page that hosts the TypeAgent PDF reader in an iframe
 */
export class PDFViewPage {
    private corpusToken = crypto.randomUUID();
    private corpusImport = createPdfCorpusImport(undefined, getChromeRpc().rpc);
    private disposed = false;
    private corpusReady = false;
    private handshakeTimer: number | undefined;
    private pendingRequests = new Set<(error: Error) => void>();
    private onCorpusMessage = (event: MessageEvent<unknown>) => {
        if (!this.isViewerMessage(event)) return;
        const message = event.data as { type?: string };
        if (message.type === "pdf-corpus-initialized") {
            this.corpusReady = true;
            this.stopHandshake();
        } else if (message.type === "pdf-corpus-open") {
            void this.corpusImport.open((progress, signal) =>
                this.extractForCorpus(progress, signal),
            );
        }
    };
    private onPageHide = () => this.dispose();
    private pdfFrame!: HTMLIFrameElement;
    private loadingContainer!: HTMLElement;
    private errorContainer!: HTMLElement;
    private errorMessage!: HTMLElement;
    private pdfUrlDisplay!: HTMLElement;
    private urlInfo!: HTMLElement;
    private retryBtn!: HTMLButtonElement;
    private openInNewTabBtn!: HTMLButtonElement;

    private pdfUrl: string | null = null;
    private viewerUrl: string | null = null;
    private retryCount: number = 0;
    private maxRetries: number = 3;
    private loadingTimeout: number | null = null;

    constructor() {
        this.initializeElements();
        this.setupEventListeners();
    }

    /**
     * Initialize DOM elements
     */
    private initializeElements(): void {
        this.pdfFrame = document.getElementById(
            "pdfFrame",
        ) as HTMLIFrameElement;
        this.loadingContainer = document.getElementById(
            "loadingContainer",
        ) as HTMLElement;
        this.errorContainer = document.getElementById(
            "errorContainer",
        ) as HTMLElement;
        this.errorMessage = document.getElementById(
            "errorMessage",
        ) as HTMLElement;
        this.pdfUrlDisplay = document.getElementById(
            "pdfUrlDisplay",
        ) as HTMLElement;
        this.urlInfo = document.getElementById("urlInfo") as HTMLElement;
        this.retryBtn = document.getElementById(
            "retryBtn",
        ) as HTMLButtonElement;
        this.openInNewTabBtn = document.getElementById(
            "openInNewTabBtn",
        ) as HTMLButtonElement;
    }

    /**
     * Set up event listeners
     */
    private setupEventListeners(): void {
        window.addEventListener("message", this.onCorpusMessage);
        window.addEventListener("pagehide", this.onPageHide, { once: true });
        this.retryBtn.addEventListener("click", () => this.retry());
        this.openInNewTabBtn.addEventListener("click", () =>
            this.openInNewTab(),
        );

        // Set up iframe error handling
        this.pdfFrame.addEventListener("error", () => {
            this.showError("Failed to load PDF viewer", "IFRAME_ERROR");
        });

        // Set up iframe load success
        this.pdfFrame.addEventListener("load", () => {
            this.onIframeLoad();
        });
    }

    /**
     * Initialize the PDF viewer
     */
    async initialize(): Promise<void> {
        await this.initializeViewer();
    }

    private async initializeViewer(): Promise<void> {
        debug("Initializing PDF view page");

        try {
            // Show loading state
            this.showLoading("Initializing PDF viewer...");

            // Extract PDF URL from query parameters
            this.pdfUrl = this.extractPDFUrl();

            // Update URL info in header
            if (this.pdfUrl) this.updateUrlInfo(this.pdfUrl);
            else this.urlInfo.style.display = "none";

            // Get view host URL and load PDF
            await this.loadPDFViewer();
        } catch (error) {
            debugError("Failed to initialize PDF view page:", error);
            this.showError(
                error instanceof Error
                    ? error.message
                    : "Unknown initialization error",
                "INIT_ERROR",
            );
        }
    }

    /**
     * Extract PDF URL from query parameters
     */
    private extractPDFUrl(): string | null {
        const urlParams = new URLSearchParams(window.location.search);
        const url = urlParams.get("url");

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
     * Load the PDF viewer
     */
    private async loadPDFViewer(): Promise<void> {
        debug("Loading PDF viewer for URL:", this.pdfUrl);

        this.showLoading("Connecting to TypeAgent PDF reader...");

        try {
            // Get view host URL from service worker
            const response = await this.getViewHostUrl();

            if (!response || !response.url) {
                throw new Error(
                    "Unable to get view host URL from TypeAgent service",
                );
            }

            // Construct PDF reader URL
            const viewer = new URL(`${response.url}/pdf/`);
            if (this.pdfUrl) viewer.searchParams.set("url", this.pdfUrl);
            this.viewerUrl = viewer.toString();
            debug("Constructed viewer URL:", this.viewerUrl);

            // Load in iframe with timeout
            await this.loadIframeWithTimeout(this.viewerUrl, 30000);
        } catch (error) {
            debugError("Error loading PDF viewer:", error);

            if (error instanceof Error) {
                if (error.message.includes("timeout")) {
                    this.showError(
                        "The PDF viewer is taking too long to load. This might be due to a large file or slow connection.",
                        "TIMEOUT_ERROR",
                    );
                } else if (error.message.includes("view host")) {
                    this.showError(
                        "Unable to connect to the TypeAgent PDF service. Please ensure TypeAgent is running.",
                        "SERVICE_ERROR",
                    );
                } else {
                    this.showError(error.message, "LOAD_ERROR");
                }
            } else {
                this.showError(
                    "Unknown error occurred while loading PDF viewer",
                    "UNKNOWN_ERROR",
                );
            }
            throw error;
        }
    }

    /**
     * Get view host URL from service worker
     */
    private isViewerMessage(event: MessageEvent<unknown>): boolean {
        return (
            !this.disposed &&
            !!this.viewerUrl &&
            event.source === this.pdfFrame.contentWindow &&
            event.origin === new URL(this.viewerUrl).origin &&
            !!event.data &&
            typeof event.data === "object" &&
            "token" in event.data &&
            event.data.token === this.corpusToken
        );
    }

    private extractForCorpus(
        progress: (completed: number, total: number) => void,
        signal?: AbortSignal,
    ): Promise<PdfImportContent> {
        return this.requestViewer(
            { type: "pdf-corpus-extract" },
            (message) => {
                const result = message.result as PdfImportContent | undefined;
                if (message.type !== "pdf-corpus-result") return undefined;
                if (
                    !result ||
                    typeof result.markdown !== "string" ||
                    typeof result.title !== "string" ||
                    typeof result.canonicalUri !== "string" ||
                    typeof result.byteHash !== "string" ||
                    !/^[a-f0-9]{64}$/.test(result.byteHash) ||
                    !Number.isSafeInteger(result.pageCount) ||
                    result.pageCount < 1 ||
                    !Array.isArray(result.emptyPages) ||
                    result.emptyPages.some(
                        (page) =>
                            !Number.isSafeInteger(page) ||
                            page < 1 ||
                            page > result.pageCount,
                    )
                )
                    throw new Error("Invalid PDF extraction response.");
                return {
                    markdown: result.markdown,
                    title: result.title,
                    canonicalUri: result.canonicalUri,
                    byteHash: result.byteHash,
                    pageCount: result.pageCount,
                    emptyPages: result.emptyPages,
                };
            },
            signal,
            progress,
        );
    }

    private requestViewer<Result>(
        payload: Record<string, unknown>,
        readResult: (message: Record<string, unknown>) => Result | undefined,
        signal?: AbortSignal,
        progress?: (completed: number, total: number) => void,
    ): Promise<Result> {
        const frame = this.pdfFrame.contentWindow;
        if (this.disposed || !this.corpusReady || !this.viewerUrl || !frame)
            return Promise.reject(new Error("The PDF viewer is not ready."));
        const origin = new URL(this.viewerUrl).origin;
        const token = this.corpusToken;
        const requestId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            let settled = false;
            const timeout = window.setTimeout(
                () =>
                    finish(
                        new Error(
                            "PDF request timed out. Nothing was submitted.",
                        ),
                    ),
                10 * 60 * 1000,
            );
            const finish = (error?: Error, result?: Result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                window.removeEventListener("message", listener);
                signal?.removeEventListener("abort", cancel);
                this.pendingRequests.delete(fail);
                if (error)
                    frame.postMessage(
                        { type: "pdf-corpus-cancel", requestId, token },
                        origin,
                    );
                if (error) reject(error);
                else resolve(result!);
            };
            const fail = (error: Error) => finish(error);
            const cancel = () =>
                finish(new DOMException("PDF request cancelled", "AbortError"));
            const listener = (event: MessageEvent<unknown>) => {
                if (!this.isViewerMessage(event)) return;
                const message = event.data as Record<string, unknown>;
                if (message.requestId !== requestId) return;
                try {
                    if (
                        message.type === "pdf-corpus-progress" &&
                        typeof message.completed === "number" &&
                        typeof message.total === "number"
                    )
                        progress?.(message.completed, message.total);
                    else if (message.type === "pdf-corpus-error")
                        finish(
                            new Error(
                                typeof message.error === "string"
                                    ? message.error
                                    : "PDF request failed.",
                            ),
                        );
                    else {
                        const result = readResult(message);
                        if (result !== undefined) finish(undefined, result);
                    }
                } catch (error) {
                    finish(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    );
                }
            };
            this.pendingRequests.add(fail);
            window.addEventListener("message", listener);
            signal?.addEventListener("abort", cancel, { once: true });
            if (signal?.aborted) {
                cancel();
                return;
            }
            try {
                frame.postMessage({ ...payload, requestId, token }, origin);
            } catch (error) {
                finish(
                    error instanceof Error ? error : new Error(String(error)),
                );
            }
        });
    }

    private stopHandshake(): void {
        if (this.handshakeTimer !== undefined)
            window.clearInterval(this.handshakeTimer);
        this.handshakeTimer = undefined;
    }

    private resetCorpus(): void {
        this.stopHandshake();
        this.corpusReady = false;
        for (const fail of this.pendingRequests)
            fail(
                new DOMException("PDF viewer changed or closed", "AbortError"),
            );
    }

    public dispose(): void {
        this.resetCorpus();
        this.disposed = true;
        if (this.loadingTimeout !== null)
            window.clearTimeout(this.loadingTimeout);
        window.removeEventListener("message", this.onCorpusMessage);
        window.removeEventListener("pagehide", this.onPageHide);
    }

    private async getViewHostUrl(): Promise<{ url: string } | null> {
        try {
            const { rpc } = getChromeRpc();
            const response = await (rpc as any).invoke("getViewHostUrl", {
                type: "getViewHostUrl",
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
            throw new Error(
                "Failed to communicate with TypeAgent service worker",
            );
        }
    }

    /**
     * Load iframe with timeout
     */
    private loadIframeWithTimeout(
        url: string,
        timeoutMs: number,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("PDF viewer load timeout"));
            }, timeoutMs);

            const onLoad = () => {
                clearTimeout(timeout);
                this.pdfFrame.removeEventListener("load", onLoad);
                this.pdfFrame.removeEventListener("error", onError);
                resolve();
            };

            const onError = () => {
                clearTimeout(timeout);
                this.pdfFrame.removeEventListener("load", onLoad);
                this.pdfFrame.removeEventListener("error", onError);
                reject(new Error("PDF viewer failed to load"));
            };

            this.pdfFrame.addEventListener("load", onLoad);
            this.pdfFrame.addEventListener("error", onError);

            // Start loading
            this.pdfFrame.src = url;
        });
    }

    /**
     * Handle iframe load success
     */
    private onIframeLoad(): void {
        this.resetCorpus();
        if (
            this.disposed ||
            !this.viewerUrl ||
            this.pdfFrame.src === "about:blank"
        )
            return;
        this.corpusToken = crypto.randomUUID();
        let attempts = 0;
        const initialize = () => {
            if (++attempts > 40) {
                this.stopHandshake();
                return;
            }
            this.pdfFrame.contentWindow?.postMessage(
                { type: "pdf-corpus-init", token: this.corpusToken },
                new URL(this.viewerUrl!).origin,
            );
        };
        this.handshakeTimer = window.setInterval(initialize, 250);
        initialize();
        // Check if iframe actually loaded content (not an error page)
        try {
            const iframeSrc = this.pdfFrame.src;
            if (iframeSrc && iframeSrc !== "about:blank") {
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
        // Clear any existing loading timeout
        if (this.loadingTimeout) {
            clearTimeout(this.loadingTimeout);
            this.loadingTimeout = null;
        }

        // Keep header hidden during loading - only show for errors
        // Use full viewport height but initially hide loading content
        this.loadingContainer.style.height = "100vh";
        this.loadingContainer.style.display = "flex";
        this.loadingContainer.style.opacity = "0"; // Start hidden
        this.errorContainer.style.display = "none";
        this.pdfFrame.style.display = "none";

        // Delay showing loading indicator by 1 second
        this.loadingTimeout = window.setTimeout(() => {
            // Only show loading if we're still in loading state
            if (
                this.loadingContainer.style.display === "flex" &&
                this.pdfFrame.style.display === "none"
            ) {
                const loadingText = document.querySelector(
                    ".loading-text",
                ) as HTMLElement;
                if (loadingText) {
                    loadingText.textContent = message;
                }
                this.loadingContainer.style.opacity = "1"; // Show loading indicator
            }
            this.loadingTimeout = null;
        }, 1000);
    }

    /**
     * Show error state
     */
    private showError(message: string, errorType: string = "UNKNOWN"): void {
        debugError(`PDF viewer error [${errorType}]:`, message);

        // Clear loading timeout since we're showing an error
        if (this.loadingTimeout) {
            clearTimeout(this.loadingTimeout);
            this.loadingTimeout = null;
        }

        // Show extension header for error state
        const header = document.querySelector(".header") as HTMLElement;
        if (header) {
            header.style.display = "flex";
        }

        // Adjust container height for header
        this.errorContainer.style.height = "calc(100vh - 60px)";
        this.pdfFrame.style.height = "calc(100vh - 60px)";

        this.errorMessage.textContent = message;
        this.errorContainer.style.display = "flex";
        this.loadingContainer.style.display = "none";
        this.pdfFrame.style.display = "none";

        // Show retry button only for certain error types and if retries available
        if (
            this.retryCount < this.maxRetries &&
            ["TIMEOUT_ERROR", "LOAD_ERROR", "IFRAME_ERROR"].includes(errorType)
        ) {
            this.retryBtn.style.display = "flex";
        } else {
            this.retryBtn.style.display = "none";
        }
    }

    /**
     * Show PDF viewer (hide loading/error states)
     */
    private showPDFViewer(): void {
        // Clear loading timeout since content loaded successfully
        if (this.loadingTimeout) {
            clearTimeout(this.loadingTimeout);
            this.loadingTimeout = null;
        }

        // Hide extension header to give full height to iframe
        const header = document.querySelector(".header") as HTMLElement;
        if (header) {
            header.style.display = "none";
        }

        // Give iframe full viewport height
        this.pdfFrame.style.height = "100vh";
        this.pdfFrame.style.display = "block";
        this.loadingContainer.style.display = "none";
        this.errorContainer.style.display = "none";
    }

    /**
     * Retry loading the PDF viewer
     */
    private async retry(): Promise<void> {
        if (this.retryCount >= this.maxRetries) {
            this.showError("Maximum retry attempts reached", "MAX_RETRIES");
            return;
        }

        this.retryCount++;
        debug(
            `Retrying PDF viewer load (attempt ${this.retryCount}/${this.maxRetries})`,
        );

        // Reset iframe
        this.resetCorpus();
        this.pdfFrame.src = "about:blank";

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
            window.open(this.pdfUrl, "_blank");
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
            currentState: this.getCurrentState(),
        };
    }

    /**
     * Get current display state
     */
    private getCurrentState(): string {
        if (this.loadingContainer.style.display !== "none") return "loading";
        if (this.errorContainer.style.display !== "none") return "error";
        if (this.pdfFrame.style.display !== "none") return "viewing";
        return "unknown";
    }
}

// Global error handler for uncaught errors
window.addEventListener("error", (event) => {
    debugError("Uncaught error in PDF view page:", event.error);
});

// Global handler for unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
    debugError("Unhandled promise rejection in PDF view page:", event.reason);
});

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    debug("DOM loaded, initializing PDF view page");
    const pdfViewPage = new PDFViewPage();
    pdfViewPage.initialize();

    // Make available globally for debugging
    (window as any).pdfViewPage = pdfViewPage;
});

// Handle beforeunload to cleanup if needed
window.addEventListener("beforeunload", () => {
    debug("PDF view page unloading");
});

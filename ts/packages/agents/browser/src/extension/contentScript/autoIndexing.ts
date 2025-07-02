// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface AutoIndexingSettings {
    autoIndexing: boolean;
    indexingDelay: number;
    excludeSensitiveSites: boolean;
    indexingQuality: "fast" | "balanced" | "deep";
    indexOnlyTextContent: boolean;
}

class AutoIndexingManager {
    private indexingTimeout: number | null = null;
    private lastUrl: string = "";
    private isIndexing: boolean = false;
    private settings: AutoIndexingSettings = {
        autoIndexing: false,
        indexingDelay: 3,
        excludeSensitiveSites: true,
        indexingQuality: "balanced",
        indexOnlyTextContent: false,
    };

    async initialize() {
        console.log("Initializing AutoIndexingManager");

        // Load settings
        await this.loadSettings();

        // Listen for settings updates
        chrome.storage.onChanged.addListener((changes) => {
            if (this.settingsChanged(changes)) {
                this.loadSettings();
            }
        });

        // Setup navigation listeners
        this.setupNavigationListeners();

        // Check initial page
        await this.checkForAutoIndex();
    }

    private settingsChanged(changes: {
        [key: string]: chrome.storage.StorageChange;
    }): boolean {
        const relevantKeys = [
            "autoIndexing",
            "indexingDelay",
            "excludeSensitiveSites",
            "indexingQuality",
            "indexOnlyTextContent",
        ];
        return relevantKeys.some((key) => changes[key]);
    }

    private async loadSettings() {
        try {
            const result = await chrome.storage.sync.get([
                "autoIndexing",
                "indexingDelay",
                "excludeSensitiveSites",
                "indexingQuality",
                "indexOnlyTextContent",
            ]);

            this.settings = {
                autoIndexing: result.autoIndexing || false,
                indexingDelay: result.indexingDelay || 3,
                excludeSensitiveSites: result.excludeSensitiveSites !== false, // default true
                indexingQuality: result.indexingQuality || "balanced",
                indexOnlyTextContent: result.indexOnlyTextContent || false,
            };

            console.log("Auto-indexing settings loaded:", this.settings);
        } catch (error) {
            console.error("Error loading auto-indexing settings:", error);
        }
    }

    private setupNavigationListeners() {
        let currentUrl = window.location.href;

        // Watch for URL changes (SPA navigation)
        const observer = new MutationObserver(() => {
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                this.onNavigationChange();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        // Listen for history changes
        window.addEventListener("popstate", () => this.onNavigationChange());

        // Intercept pushState and replaceState for SPA navigation
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
            originalPushState.apply(history, args);
            window.dispatchEvent(new Event("pushstate"));
        };

        history.replaceState = function (...args) {
            originalReplaceState.apply(history, args);
            window.dispatchEvent(new Event("replacestate"));
        };

        window.addEventListener("pushstate", () => this.onNavigationChange());
        window.addEventListener("replacestate", () =>
            this.onNavigationChange(),
        );

        // Listen for page load complete
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                this.onPageLoad(),
            );
        } else {
            this.onPageLoad();
        }
    }

    private async onNavigationChange() {
        if (this.indexingTimeout) {
            clearTimeout(this.indexingTimeout);
            this.indexingTimeout = null;
        }

        await this.checkForAutoIndex();
    }

    private async onPageLoad() {
        // Check for auto-index after page loads
        await this.checkForAutoIndex();
    }

    private async checkForAutoIndex() {
        if (!this.settings.autoIndexing) {
            return;
        }

        const currentUrl = window.location.href;
        if (currentUrl === this.lastUrl) {
            return;
        }

        this.lastUrl = currentUrl;

        // Check if we should exclude this site
        if (
            this.settings.excludeSensitiveSites &&
            this.isSensitiveSite(currentUrl)
        ) {
            console.log(
                "Skipping auto-indexing for sensitive site:",
                currentUrl,
            );
            return;
        }

        // Check if URL should be indexed
        if (!this.shouldIndexUrl(currentUrl)) {
            console.log("Skipping auto-indexing for URL:", currentUrl);
            return;
        }

        const delay = this.settings.indexingDelay * 1000;

        this.indexingTimeout = window.setTimeout(async () => {
            if (!this.isIndexing && this.isPageReady()) {
                await this.performAutoIndex();
            }
        }, delay);
    }

    private isSensitiveSite(url: string): boolean {
        const sensitivePatterns = [
            // Banking and financial
            /banking/i,
            /bank\./i,
            /credit.*union/i,
            /paypal/i,
            /payment/i,
            /checkout/i,
            /billing/i,
            /invoice/i,
            /financial/i,

            // Authentication and personal
            /login/i,
            /signin/i,
            /auth/i,
            /password/i,
            /reset/i,
            /account/i,
            /profile/i,
            /settings/i,
            /preferences/i,

            // Healthcare and medical
            /healthcare/i,
            /medical/i,
            /patient/i,
            /health/i,
            /doctor/i,
            /clinic/i,
            /hospital/i,
            /pharmacy/i,

            // Admin and internal
            /admin/i,
            /dashboard/i,
            /management/i,
            /internal/i,
            /intranet/i,
            /localhost/i,
            /127\.0\.0\.1/,
            /192\.168\./,
            /\.local/i,
            /staging/i,
            /test/i,
            /dev/i,

            // Social media private areas
            /messages/i,
            /chat/i,
            /direct/i,
            /private/i,
        ];

        return sensitivePatterns.some((pattern) => pattern.test(url));
    }

    private shouldIndexUrl(url: string): boolean {
        // Don't index non-HTTP URLs
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return false;
        }

        // Don't index file downloads or media
        const mediaExtensions =
            /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|exe|dmg|pkg|mp4|mp3|avi|mov|jpg|jpeg|png|gif|svg)$/i;
        if (mediaExtensions.test(url)) {
            return false;
        }

        // Don't index search results or temporary pages
        const excludePatterns = [
            /\/search\?/i,
            /\/results\?/i,
            /\/temp\//i,
            /\/tmp\//i,
            /\/api\//i,
            /\/ajax\//i,
            /\/xhr\//i,
        ];

        if (excludePatterns.some((pattern) => pattern.test(url))) {
            return false;
        }

        return true;
    }

    private isPageReady(): boolean {
        return (
            document.readyState === "complete" &&
            document.body &&
            document.body.children.length > 0
        );
    }

    private async performAutoIndex() {
        if (this.isIndexing) return;

        this.isIndexing = true;

        try {
            console.log("Auto-indexing page:", window.location.href);

            // Send indexing request to background script
            const response = await chrome.runtime.sendMessage({
                type: "autoIndexPage",
                url: window.location.href,
                quality: this.settings.indexingQuality,
                textOnly: this.settings.indexOnlyTextContent,
            });

            if (response?.success) {
                console.log(
                    "Auto-indexing completed for:",
                    window.location.href,
                );
            } else {
                console.log("Auto-indexing failed for:", window.location.href);
            }
        } catch (error) {
            console.error("Auto-indexing error:", error);
        } finally {
            this.isIndexing = false;
        }
    }

    // Public method to manually trigger indexing
    async triggerManualIndex(): Promise<boolean> {
        if (this.isIndexing) {
            console.log("Indexing already in progress");
            return false;
        }

        try {
            await this.performAutoIndex();
            return true;
        } catch (error) {
            console.error("Manual indexing failed:", error);
            return false;
        }
    }

    // Public method to check if auto-indexing is enabled
    isAutoIndexingEnabled(): boolean {
        return this.settings.autoIndexing;
    }
}

// Initialize auto-indexing manager
let autoIndexingManager: AutoIndexingManager | null = null;

// Only initialize for HTTP/HTTPS pages
if (window.location.href.startsWith("http")) {
    autoIndexingManager = new AutoIndexingManager();

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            autoIndexingManager?.initialize();
        });
    } else {
        autoIndexingManager.initialize();
    }
}

// Listen for messages from extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "triggerManualIndex") {
        autoIndexingManager?.triggerManualIndex().then((result) => {
            sendResponse({ success: result });
        });
        return true; // Indicates we'll send response asynchronously
    }

    if (message.type === "getAutoIndexingStatus") {
        sendResponse({
            enabled: autoIndexingManager?.isAutoIndexingEnabled() || false,
            indexing: autoIndexingManager?.["isIndexing"] || false,
        });
    }
});

export { AutoIndexingManager };

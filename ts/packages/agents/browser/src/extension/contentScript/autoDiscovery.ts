// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

interface AutoDiscoverySettings {
    autoDiscovery: boolean;
    autoDiscoveryMode: "scope" | "content";
    excludeSensitiveSites: boolean;
}

class AutoDiscoveryManager {
    private discoveryTimeout: number | null = null;
    private lastUrl: string = "";
    private isDiscovering: boolean = false;
    private settings: AutoDiscoverySettings = {
        autoDiscovery: true,
        autoDiscoveryMode: "content",
        excludeSensitiveSites: true,
    };

    async initialize() {
        console.log("Initializing AutoDiscoveryManager");

        await this.loadSettings();

        chrome.storage.onChanged.addListener((changes) => {
            if (this.settingsChanged(changes)) {
                this.loadSettings();
            }
        });

        this.setupNavigationListeners();

        await this.checkForAutoDiscovery();
    }

    private settingsChanged(changes: {
        [key: string]: chrome.storage.StorageChange;
    }): boolean {
        const relevantKeys = [
            "autoDiscovery",
            "autoDiscoveryMode",
            "excludeSensitiveSites",
        ];
        return relevantKeys.some((key) => changes[key]);
    }

    private async loadSettings() {
        try {
            const result = await chrome.storage.sync.get([
                "autoDiscovery",
                "autoDiscoveryMode",
                "excludeSensitiveSites",
            ]);

            this.settings = {
                autoDiscovery: result.autoDiscovery !== false, // default true
                autoDiscoveryMode: result.autoDiscoveryMode || "content",
                excludeSensitiveSites: result.excludeSensitiveSites !== false, // default true
            };

            console.log("Auto-discovery settings loaded:", this.settings);
        } catch (error) {
            console.error("Error loading auto-discovery settings:", error);
        }
    }

    private setupNavigationListeners() {
        let currentUrl = window.location.href;

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

        window.addEventListener("popstate", () => this.onNavigationChange());

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

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                this.onPageLoad(),
            );
        } else {
            this.onPageLoad();
        }
    }

    private async onNavigationChange() {
        if (this.discoveryTimeout) {
            clearTimeout(this.discoveryTimeout);
            this.discoveryTimeout = null;
        }

        await this.checkForAutoDiscovery();
    }

    private async onPageLoad() {
        await this.checkForAutoDiscovery();
    }

    private async checkForAutoDiscovery() {
        if (!this.settings.autoDiscovery) {
            return;
        }

        const currentUrl = window.location.href;
        if (currentUrl === this.lastUrl) {
            return;
        }

        this.lastUrl = currentUrl;

        if (
            this.settings.excludeSensitiveSites &&
            this.isSensitiveSite(currentUrl)
        ) {
            console.log(
                "Skipping auto-discovery for sensitive site:",
                currentUrl,
            );
            return;
        }

        if (!this.shouldDiscoverUrl(currentUrl)) {
            return;
        }

        const delay = 300;

        this.discoveryTimeout = window.setTimeout(async () => {
            if (!this.isDiscovering && this.isPageReady()) {
                await this.performDiscovery();
            }
        }, delay);
    }

    private isSensitiveSite(url: string): boolean {
        const sensitivePatterns = [
            /banking/i,
            /bank\./i,
            /credit.*union/i,
            /paypal/i,
            /payment/i,
            /checkout/i,
            /billing/i,
            /financial/i,
            /login/i,
            /signin/i,
            /auth/i,
            /password/i,
            /healthcare/i,
            /medical/i,
            /patient/i,
            /pharmacy/i,
        ];

        return sensitivePatterns.some((pattern) => pattern.test(url));
    }

    private shouldDiscoverUrl(url: string): boolean {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return false;
        }

        const mediaExtensions =
            /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|exe|dmg|pkg|mp4|mp3|avi|mov|jpg|jpeg|png|gif|svg)$/i;
        if (mediaExtensions.test(url)) {
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

    private async performDiscovery() {
        if (this.isDiscovering) return;

        this.isDiscovering = true;

        try {
            const url = window.location.href;
            const domain = new URL(url).hostname;

            console.log("Auto-discovering actions for:", domain);

            const response = await chrome.runtime.sendMessage({
                type: "autoDiscoverActions",
                url,
                domain,
                mode: this.settings.autoDiscoveryMode,
            });

            if (response?.success) {
                console.log(
                    `Auto-discovery found ${response.flowCount ?? 0} actions for:`,
                    domain,
                );
            }
        } catch (error) {
            console.error("Auto-discovery error:", error);
        } finally {
            this.isDiscovering = false;
        }
    }

    isAutoDiscoveryEnabled(): boolean {
        return this.settings.autoDiscovery;
    }
}

let autoDiscoveryManager: AutoDiscoveryManager | null = null;

if (window.location.href.startsWith("http")) {
    autoDiscoveryManager = new AutoDiscoveryManager();

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            autoDiscoveryManager?.initialize();
        });
    } else {
        autoDiscoveryManager.initialize();
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "getAutoDiscoveryStatus") {
        sendResponse({
            enabled: autoDiscoveryManager?.isAutoDiscoveryEnabled() || false,
            discovering: autoDiscoveryManager?.["isDiscovering"] || false,
        });
    }
});

export { AutoDiscoveryManager };

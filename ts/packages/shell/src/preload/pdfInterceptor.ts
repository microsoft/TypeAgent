// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ipcRenderer } from "electron";
import registerDebug from "debug";

const debug = registerDebug("typeagent:shell:pdfInterceptor");
const debugError = registerDebug("typeagent:shell:pdfInterceptor:error");

export class ElectronPDFInterceptor {
    private isTypeAgentConnected: boolean = false;
    private connectionCheckPromise: Promise<boolean> | null = null;
    private isInitialized: boolean = false;

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        debug("Initializing Electron PDF interceptor");

        try {
            await this.checkTypeAgentConnection();
            this.setupClickInterceptor();
            this.setupNavigationInterceptor();
            this.monitorTypeAgentConnection();

            this.isInitialized = true;
            debug("Electron PDF interceptor initialized successfully");
        } catch (error) {
            debugError("Failed to initialize PDF interceptor:", error);
        }
    }

    private async checkTypeAgentConnection(): Promise<boolean> {
        if (this.connectionCheckPromise) {
            return this.connectionCheckPromise;
        }

        this.connectionCheckPromise = this.performConnectionCheck();
        const result = await this.connectionCheckPromise;
        this.connectionCheckPromise = null;
        return result;
    }

    private async performConnectionCheck(): Promise<boolean> {
        try {
            const response = await ipcRenderer.invoke(
                "check-typeagent-connection",
            );
            this.isTypeAgentConnected = response?.connected || false;
            debug(`TypeAgent connection status: ${this.isTypeAgentConnected}`);
            return this.isTypeAgentConnected;
        } catch (error) {
            debugError("Error checking TypeAgent connection:", error);
            this.isTypeAgentConnected = false;
            return false;
        }
    }

    private setupClickInterceptor(): void {
        document.addEventListener("click", this.handleClick.bind(this), true);
        debug("Click interceptor set up");
    }

    private async handleClick(event: MouseEvent): Promise<void> {
        try {
            const target = event.target as HTMLElement;
            const link = this.findPDFLink(target);

            if (link && this.isPDFUrl(link.href)) {
                debug(`PDF link detected: ${link.href}`);

                if (await this.checkTypeAgentConnection()) {
                    debug(`Intercepting PDF link: ${link.href}`);
                    event.preventDefault();
                    event.stopPropagation();
                    await this.openPDFViewer(link.href);
                } else {
                    debug(
                        `Browser Agent not connected, allowing default PDF handling for: ${link.href}`,
                    );
                }
            }
        } catch (error) {
            debugError("Error handling click event:", error);
        }
    }

    private findPDFLink(element: HTMLElement): HTMLAnchorElement | null {
        let current = element;

        while (current && current !== document.body) {
            if (current.tagName.toLowerCase() === "a") {
                return current as HTMLAnchorElement;
            }
            current = current.parentElement as HTMLElement;
        }

        return null;
    }

    private isPDFUrl(url: string): boolean {
        try {
            const urlObj = new URL(url);

            // Don't intercept PDF viewer URLs to avoid infinite loops
            if (
                urlObj.hostname === "localhost" &&
                urlObj.pathname.startsWith("/pdf")
            ) {
                return false;
            }

            const pathname = urlObj.pathname.toLowerCase();

            if (pathname.endsWith(".pdf")) {
                return true;
            }

            if (urlObj.searchParams.get("content-type") === "application/pdf") {
                return true;
            }

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

    private async openPDFViewer(pdfUrl: string): Promise<void> {
        try {
            debug(`Opening PDF viewer for: ${pdfUrl}`);
            await ipcRenderer.invoke("open-pdf-viewer", pdfUrl);
        } catch (error) {
            debugError("Error opening PDF viewer:", error);
            window.open(pdfUrl, "_blank");
        }
    }

    private setupNavigationInterceptor(): void {
        if (window.location.href && this.isPDFUrl(window.location.href)) {
            this.handleDirectPDFNavigation();
        }

        debug("Navigation interceptor set up");
    }

    private async handleDirectPDFNavigation(): Promise<void> {
        try {
            debug(`Direct PDF navigation detected: ${window.location.href}`);

            if (await this.checkTypeAgentConnection()) {
                const currentUrl = window.location.href;
                debug(`Redirecting direct PDF navigation: ${currentUrl}`);
                await this.openPDFViewer(currentUrl);
            } else {
                debug(
                    "Browser Agent not connected, allowing default PDF handling for direct navigation",
                );
            }
        } catch (error) {
            debugError("Error handling direct PDF navigation:", error);
        }
    }

    private monitorTypeAgentConnection(): void {
        setInterval(async () => {
            await this.checkTypeAgentConnection();
        }, 30000);

        debug("Browser Agent connection monitoring started");
    }

    public getConnectionStatus(): boolean {
        return this.isTypeAgentConnected;
    }
}

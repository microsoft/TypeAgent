// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getActiveTab } from "./tabManager";

/**
 * Coordinates high-frequency screenshot capture using offscreen documents
 * Manages stream lifecycle and provides a drop-in replacement for captureVisibleTab
 */

interface ScreenshotOptions {
    format?: 'jpeg' | 'png';  // Default: 'png' to match current behavior
    quality?: number;  // 0-1 for JPEG (only used when format is 'jpeg')
    tabId?: number;    // Optional, uses active tab if not provided
}

interface StreamInfo {
    streamId: string;
    tabId: number;
    createdAt: number;
}

// Feature flag for rollback - default to new high-frequency capture
const USE_LOW_FREQUENCY_CAPTURE = false;

class ScreenshotCoordinator {
    private static instance: ScreenshotCoordinator;
    private offscreenDocumentReady: boolean = false;
    private activeStreams: Map<number, StreamInfo> = new Map();

    // Optional rate limiting (can be disabled since we're not hitting limits)
    // Set to 0 to disable, or ~16ms for ~60 FPS max
    private lastCaptureTime: number = 0;
    private readonly MIN_CAPTURE_INTERVAL = 0; // Disabled by default

    private constructor() {
        this.setupTabListeners();
    }

    public static getInstance(): ScreenshotCoordinator {
        if (!ScreenshotCoordinator.instance) {
            ScreenshotCoordinator.instance = new ScreenshotCoordinator();
        }
        return ScreenshotCoordinator.instance;
    }

    /**
     * Capture screenshot - drop-in replacement for chrome.tabs.captureVisibleTab
     */
    public async captureScreenshot(options: ScreenshotOptions = {}): Promise<string> {
        // Feature flag: use old method if enabled
        if (USE_LOW_FREQUENCY_CAPTURE) {
            return await this.captureLowFrequency(options);
        }

        try {
            const tabId = options.tabId || (await this.getActiveTabId());

            // Ensure offscreen document exists
            await this.ensureOffscreenDocument();

            // Get or create stream for this tab
            const streamInfo = await this.getOrCreateStream(tabId);

            // Optional rate limiting
            if (this.MIN_CAPTURE_INTERVAL > 0) {
                const now = Date.now();
                const timeSinceLastCapture = now - this.lastCaptureTime;
                if (timeSinceLastCapture < this.MIN_CAPTURE_INTERVAL) {
                    await this.delay(this.MIN_CAPTURE_INTERVAL - timeSinceLastCapture);
                }
                this.lastCaptureTime = Date.now();
            }

            // Send capture request to offscreen document
            const response = await chrome.runtime.sendMessage({
                type: 'CAPTURE_FRAME',
                streamId: streamInfo.streamId,
                tabId: tabId,
                format: options.format || 'png',
                quality: options.quality || 0.8
            });

            if (!response.success) {
                throw new Error(response.error || 'Screenshot capture failed');
            }

            return response.dataUrl;
        } catch (error: any) {
            console.error('High-frequency capture failed:', error);
            // Fallback to low-frequency capture on error
            console.log('Falling back to low-frequency capture');
            return await this.captureLowFrequency(options);
        }
    }

    /**
     * Fallback to old chrome.tabs.captureVisibleTab method
     */
    private async captureLowFrequency(options: ScreenshotOptions): Promise<string> {
        const format = options.format || 'png';
        const quality = options.quality;

        if (options.tabId) {
            // Get the window ID for the tab
            const tab = await chrome.tabs.get(options.tabId);
            if (!tab.windowId) {
                throw new Error('Tab has no window ID');
            }
            return await chrome.tabs.captureVisibleTab(tab.windowId, {
                format: format as 'png' | 'jpeg',
                ...(format === 'jpeg' && quality !== undefined ? { quality: Math.round(quality * 100) } : {})
            });
        } else {
            return await chrome.tabs.captureVisibleTab({
                format: format as 'png' | 'jpeg',
                ...(format === 'jpeg' && quality !== undefined ? { quality: Math.round(quality * 100) } : {})
            });
        }
    }

    /**
     * Ensure offscreen document exists for screenshot capture
     */
    private async ensureOffscreenDocument(): Promise<void> {
        if (this.offscreenDocumentReady) {
            return;
        }

        // Check if offscreen document already exists
        // Using hasDocument API if available, otherwise just try to create
        try {
            const hasDocument = await (chrome.offscreen as any).hasDocument?.();
            if (hasDocument) {
                this.offscreenDocumentReady = true;
                return;
            }
        } catch (e) {
            // hasDocument not available, will try to create
        }

        // Try to create offscreen document
        try {
            await chrome.offscreen.createDocument({
                url: 'offscreen/screenshotCapture.html',
                reasons: ['USER_MEDIA' as any],
                justification: 'Capturing tab video stream for high-frequency screenshots'
            });

            // Wait for initialization
            await this.delay(100);
            this.offscreenDocumentReady = true;
        } catch (error: any) {
            // Document might already exist, that's ok
            if (error.message?.includes('Only a single offscreen')) {
                this.offscreenDocumentReady = true;
            } else {
                throw error;
            }
        }
    }

    /**
     * Get or create media stream for a tab
     */
    private async getOrCreateStream(tabId: number): Promise<StreamInfo> {
        // Return existing stream if available
        const existing = this.activeStreams.get(tabId);
        if (existing) {
            return existing;
        }

        // Get new stream ID from Chrome
        const streamId = await new Promise<string>((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId(
                { targetTabId: tabId },
                (streamId) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(streamId);
                    }
                }
            );
        });

        const streamInfo: StreamInfo = {
            streamId,
            tabId,
            createdAt: Date.now()
        };

        this.activeStreams.set(tabId, streamInfo);
        return streamInfo;
    }

    /**
     * Stop stream for a tab (called when tab closes or navigates)
     */
    private async stopStreamForTab(tabId: number): Promise<void> {
        const streamInfo = this.activeStreams.get(tabId);
        if (streamInfo) {
            try {
                await chrome.runtime.sendMessage({
                    type: 'STOP_STREAM',
                    streamId: streamInfo.streamId
                });
            } catch (error) {
                console.warn('Failed to stop stream:', error);
            }
            this.activeStreams.delete(tabId);
        }
    }

    /**
     * Setup listeners for tab lifecycle events
     */
    private setupTabListeners(): void {
        // Clean up stream when tab closes
        chrome.tabs.onRemoved.addListener((tabId) => {
            this.stopStreamForTab(tabId);
        });

        // Clean up stream when tab navigates to new URL
        chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
            if (changeInfo.url) {
                this.stopStreamForTab(tabId);
            }
        });

        // Clean up all streams when extension unloads
        if (chrome.runtime.onSuspend) {
            chrome.runtime.onSuspend.addListener(() => {
                this.activeStreams.forEach((_, tabId) => {
                    this.stopStreamForTab(tabId);
                });
            });
        }
    }

    /**
     * Get active tab ID using the existing tabManager implementation
     */
    private async getActiveTabId(): Promise<number> {
        const tab = await getActiveTab();
        if (!tab || !tab.id) {
            throw new Error('No active tab found');
        }
        return tab.id;
    }

    /**
     * Utility delay function
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get stream status (for debugging)
     */
    public async getStreamStatus(): Promise<any> {
        if (!this.offscreenDocumentReady) {
            return { ready: false };
        }

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'GET_STREAM_STATUS'
            });
            return response;
        } catch (error: any) {
            return { error: error.message };
        }
    }
}

// Export singleton instance
export const screenshotCoordinator = ScreenshotCoordinator.getInstance();

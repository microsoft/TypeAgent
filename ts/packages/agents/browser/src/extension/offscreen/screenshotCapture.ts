// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Screenshot capture handler for offscreen document
 * Handles video stream capture and frame extraction
 */

interface CaptureFrameRequest {
    type: "CAPTURE_FRAME";
    streamId: string;
    tabId: number;
    quality?: number; // JPEG quality 0-1, default 0.8 (only used when format is 'jpeg')
    format?: "jpeg" | "png"; // Default png to match current behavior
}

interface CaptureFrameResponse {
    success: boolean;
    dataUrl?: string;
    error?: string;
    metadata?: {
        width: number;
        height: number;
        format: string;
        captureTime: number;
    };
}

interface StopStreamRequest {
    type: "STOP_STREAM";
    streamId: string;
}

interface GetStreamStatusRequest {
    type: "GET_STREAM_STATUS";
}

interface StreamState {
    stream: MediaStream;
    tabId: number;
    startTime: number;
    lastCapture: number;
    captureCount: number;
}

class ScreenshotCaptureHandler {
    private videoElement: HTMLVideoElement;
    private canvas: HTMLCanvasElement;
    private context: CanvasRenderingContext2D;
    private statusElement: HTMLElement;
    private metadataElements: {
        activeStreams: HTMLElement;
        totalCaptures: HTMLElement;
        lastCapture: HTMLElement;
    };

    // Track active streams by streamId
    private activeStreams: Map<string, StreamState> = new Map();
    private totalCaptures: number = 0;

    // Stream cleanup timeout (5 minutes of inactivity)
    private readonly STREAM_TIMEOUT = 5 * 60 * 1000;
    private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.videoElement = document.getElementById(
            "stream-video",
        ) as HTMLVideoElement;
        this.canvas = document.getElementById(
            "capture-canvas",
        ) as HTMLCanvasElement;
        this.context = this.canvas.getContext("2d", {
            willReadFrequently: true,
            alpha: false,
        })!;
        this.statusElement = document.getElementById("status")!;
        this.metadataElements = {
            activeStreams: document.getElementById("activeStreams")!,
            totalCaptures: document.getElementById("totalCaptures")!,
            lastCapture: document.getElementById("lastCapture")!,
        };

        this.setupMessageHandler();
        this.updateStatus("Ready");
        this.updateMetadata();
    }

    private setupMessageHandler(): void {
        chrome.runtime.onMessage.addListener(
            (
                message:
                    | CaptureFrameRequest
                    | StopStreamRequest
                    | GetStreamStatusRequest,
                sender,
                sendResponse,
            ) => {
                if (message.type === "CAPTURE_FRAME") {
                    this.handleCaptureFrame(message as CaptureFrameRequest)
                        .then(sendResponse)
                        .catch((error) => {
                            console.error("Frame capture failed:", error);
                            sendResponse({
                                success: false,
                                error: error?.message || "Frame capture failed",
                            });
                        });
                    return true; // Async response
                } else if (message.type === "STOP_STREAM") {
                    this.stopStream((message as StopStreamRequest).streamId);
                    sendResponse({ success: true });
                    return false;
                } else if (message.type === "GET_STREAM_STATUS") {
                    sendResponse({
                        success: true,
                        activeStreams: this.activeStreams.size,
                        totalCaptures: this.totalCaptures,
                        streams: Array.from(this.activeStreams.entries()).map(
                            ([id, state]) => ({
                                streamId: id,
                                tabId: state.tabId,
                                uptime: Date.now() - state.startTime,
                                captureCount: state.captureCount,
                            }),
                        ),
                    });
                    return false;
                }
                return false;
            },
        );
    }

    private async handleCaptureFrame(
        request: CaptureFrameRequest,
    ): Promise<CaptureFrameResponse> {
        const startTime = Date.now();

        try {
            // Get or initialize stream
            let streamState = this.activeStreams.get(request.streamId);

            if (!streamState) {
                streamState = await this.initializeStream(
                    request.streamId,
                    request.tabId,
                );
            }

            // Reset cleanup timer
            this.resetCleanupTimer(request.streamId);

            // Capture frame
            const dataUrl = await this.captureFrame(
                streamState,
                request.format || "png",
                request.quality || 0.8,
            );

            // Update state
            streamState.lastCapture = Date.now();
            streamState.captureCount++;
            this.totalCaptures++;

            const captureTime = Date.now() - startTime;
            this.updateStatus(
                `Captured frame ${streamState.captureCount} for tab ${request.tabId} in ${captureTime}ms`,
            );
            this.updateMetadata();

            return {
                success: true,
                dataUrl,
                metadata: {
                    width: this.canvas.width,
                    height: this.canvas.height,
                    format: request.format || "png",
                    captureTime,
                },
            };
        } catch (error: any) {
            console.error("Capture frame error:", error);
            this.updateStatus(
                `Error: ${error?.message || "Unknown capture error"}`,
            );
            return {
                success: false,
                error: error?.message || "Unknown capture error",
            };
        }
    }

    private async initializeStream(
        streamId: string,
        tabId: number,
    ): Promise<StreamState> {
        this.updateStatus(`Initializing stream for tab ${tabId}...`);

        try {
            // Get media stream using the streamId from tabCapture
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    mandatory: {
                        chromeMediaSource: "tab",
                        chromeMediaSourceId: streamId,
                    },
                } as any,
            });

            // Attach to video element
            this.videoElement.srcObject = stream;

            // Wait for video to be ready
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("Video stream initialization timeout"));
                }, 10000);

                this.videoElement.onloadedmetadata = () => {
                    clearTimeout(timeout);
                    this.videoElement
                        .play()
                        .then(() => resolve())
                        .catch(reject);
                };

                this.videoElement.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error("Video stream initialization failed"));
                };
            });

            // Wait one more frame to ensure video is rendering
            await new Promise((resolve) => requestAnimationFrame(resolve));

            const streamState: StreamState = {
                stream,
                tabId,
                startTime: Date.now(),
                lastCapture: Date.now(),
                captureCount: 0,
            };

            this.activeStreams.set(streamId, streamState);
            this.resetCleanupTimer(streamId);

            this.updateStatus(`Stream initialized for tab ${tabId}`);
            this.updateMetadata();
            return streamState;
        } catch (error: any) {
            this.updateStatus(`Stream init failed: ${error?.message}`);
            throw new Error(`Failed to initialize stream: ${error?.message}`);
        }
    }

    private async captureFrame(
        streamState: StreamState,
        format: "jpeg" | "png",
        quality: number,
    ): Promise<string> {
        // Ensure video has dimensions
        if (
            this.videoElement.videoWidth === 0 ||
            this.videoElement.videoHeight === 0
        ) {
            throw new Error("Video stream has no dimensions");
        }

        // Resize canvas to match video dimensions
        if (
            this.canvas.width !== this.videoElement.videoWidth ||
            this.canvas.height !== this.videoElement.videoHeight
        ) {
            this.canvas.width = this.videoElement.videoWidth;
            this.canvas.height = this.videoElement.videoHeight;
        }

        // Draw current video frame to canvas
        this.context.drawImage(
            this.videoElement,
            0,
            0,
            this.canvas.width,
            this.canvas.height,
        );

        // Convert to data URL
        const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
        return this.canvas.toDataURL(mimeType, quality);
    }

    private resetCleanupTimer(streamId: string): void {
        // Clear existing timer
        const existingTimer = this.cleanupTimers.get(streamId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new cleanup timer
        const timer = setTimeout(() => {
            this.stopStream(streamId);
        }, this.STREAM_TIMEOUT);

        this.cleanupTimers.set(streamId, timer);
    }

    private stopStream(streamId: string): void {
        const streamState = this.activeStreams.get(streamId);
        if (streamState) {
            // Stop all tracks
            streamState.stream.getTracks().forEach((track) => track.stop());

            // Clear video element
            if (this.videoElement.srcObject === streamState.stream) {
                this.videoElement.srcObject = null;
            }

            // Remove from active streams
            this.activeStreams.delete(streamId);

            // Clear cleanup timer
            const timer = this.cleanupTimers.get(streamId);
            if (timer) {
                clearTimeout(timer);
                this.cleanupTimers.delete(streamId);
            }

            this.updateStatus(
                `Stream stopped for tab ${streamState.tabId} ` +
                    `(${streamState.captureCount} captures)`,
            );
            this.updateMetadata();
        }
    }

    private updateStatus(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this.statusElement.textContent = `[${timestamp}] ${message}`;
        console.log(`[ScreenshotCapture] ${message}`);
    }

    private updateMetadata(): void {
        this.metadataElements.activeStreams.textContent =
            this.activeStreams.size.toString();
        this.metadataElements.totalCaptures.textContent =
            this.totalCaptures.toString();
        this.metadataElements.lastCapture.textContent =
            new Date().toLocaleTimeString();
    }
}

// Initialize when document loads
if (typeof window !== "undefined" && window.document) {
    document.addEventListener("DOMContentLoaded", () => {
        new ScreenshotCaptureHandler();
    });
}

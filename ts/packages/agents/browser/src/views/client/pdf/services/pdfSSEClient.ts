// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * SSE Client for PDF real-time features
 */
export class PDFSSEClient {
    private eventSource: EventSource | null = null;
    private documentId: string;
    private listeners: { [eventType: string]: Function[] } = {};

    constructor(documentId: string) {
        this.documentId = documentId;
        this.connect();
    }

    /**
     * Connect to SSE endpoint
     */
    private connect(): void {
        try {
            const sseUrl = `/api/pdf/${this.documentId}/events`;
            this.eventSource = new EventSource(sseUrl);

            this.eventSource.onopen = () => {
                console.log(
                    "📡 SSE connection opened for document:",
                    this.documentId,
                );
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleEvent(data);
                } catch (error) {
                    console.error("❌ Failed to parse SSE message:", error);
                }
            };

            this.eventSource.onerror = (error) => {
                console.error("❌ SSE connection error:", error);

                // Attempt to reconnect after a delay
                setTimeout(() => {
                    if (this.eventSource?.readyState === EventSource.CLOSED) {
                        console.log("🔄 Attempting to reconnect SSE...");
                        this.connect();
                    }
                }, 5000);
            };
        } catch (error) {
            console.error("❌ Failed to connect to SSE:", error);
        }
    }

    /**
     * Handle incoming SSE events
     */
    private handleEvent(data: any): void {
        const { type, data: eventData } = data;

        console.log("📡 SSE event received:", type, eventData);

        // Emit to registered listeners
        if (this.listeners[type]) {
            this.listeners[type].forEach((listener) => {
                try {
                    listener(eventData);
                } catch (error) {
                    console.error("❌ Error in SSE event listener:", error);
                }
            });
        }
    }

    /**
     * Register event listener
     */
    on(eventType: string, listener: Function): void {
        if (!this.listeners[eventType]) {
            this.listeners[eventType] = [];
        }
        this.listeners[eventType].push(listener);
    }

    /**
     * Remove event listener
     */
    off(eventType: string, listener: Function): void {
        if (this.listeners[eventType]) {
            this.listeners[eventType] = this.listeners[eventType].filter(
                (l) => l !== listener,
            );
        }
    }

    /**
     * Close SSE connection
     */
    close(): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
            console.log(
                "📡 SSE connection closed for document:",
                this.documentId,
            );
        }
    }
}

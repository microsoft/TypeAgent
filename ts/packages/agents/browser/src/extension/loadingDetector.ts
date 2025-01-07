export interface DetectorConfig {
    // CSS selectors that identify skeleton elements
    skeletonSelectors: string[];
    // How long to wait after last skeleton disappears before confirming loading is complete
    stabilityThresholdMs: number;
    // Maximum time to wait before giving up
    timeoutMs: number;
}

const DEFAULT_CONFIG: DetectorConfig = {
    skeletonSelectors: [
        '[role="progressbar"]',
        ".skeleton",
        '[aria-busy="true"]',
    ],
    stabilityThresholdMs: 1000,
    timeoutMs: 30000,
};

export class SkeletonLoadingDetector {
    private config: DetectorConfig;
    private observer: MutationObserver | null;
    private stabilityTimeout: number | null;
    private maxTimeout: number | null;

    constructor(config: Partial<DetectorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.observer = null;
        this.stabilityTimeout = null;
        this.maxTimeout = null;
    }

    /**
     * Starts monitoring the page for skeleton elements
     * @returns Promise that resolves when loading is complete
     */
    public detect(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Set maximum timeout
            this.maxTimeout = window.setTimeout(() => {
                this.cleanup();
                reject(new Error("Skeleton detection timed out"));
            }, this.config.timeoutMs);

            // Check if there are any skeletons initially
            if (!this.hasSkeletons()) {
                this.cleanup();
                resolve();
                return;
            }

            // Start observing DOM changes
            this.observer = new MutationObserver(() => {
                if (!this.hasSkeletons()) {
                    // Clear any existing stability timeout
                    if (this.stabilityTimeout) {
                        window.clearTimeout(this.stabilityTimeout);
                    }

                    // Start stability timer
                    this.stabilityTimeout = window.setTimeout(() => {
                        // Double-check that no new skeletons appeared
                        if (!this.hasSkeletons()) {
                            this.cleanup();
                            resolve();
                        }
                    }, this.config.stabilityThresholdMs);
                }
            });

            // Start observing the entire document
            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["class", "role", "aria-busy", "aria-label"],
            });
        });
    }

    /**
     * Checks if any skeleton elements are currently present
     * @returns boolean indicating if skeletons are present
     */
    private hasSkeletons(): boolean {
        return this.config.skeletonSelectors.some((selector) => {
            const element = document.querySelector(selector);
            if (element) {
                var html = document.documentElement;
                var rect = element.getBoundingClientRect();

                return (
                    !!rect &&
                    rect.bottom >= 0 &&
                    rect.right >= 0 &&
                    rect.left <= html.clientWidth &&
                    rect.top <= html.clientHeight
                );
            } else {
                return false;
            }
        });
    }

    /**
     * Cleans up observers and timeouts
     */
    private cleanup(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.stabilityTimeout) {
            window.clearTimeout(this.stabilityTimeout);
            this.stabilityTimeout = null;
        }
        if (this.maxTimeout) {
            window.clearTimeout(this.maxTimeout);
            this.maxTimeout = null;
        }
    }
}

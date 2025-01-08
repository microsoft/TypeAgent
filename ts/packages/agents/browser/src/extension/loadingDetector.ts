// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface DetectorConfig {
    // CSS selectors that identify skeleton elements
    skeletonSelectors: string[];
    // How long to wait after last skeleton disappears before confirming loading is complete
    stabilityThresholdMs: number;
    // Maximum time to wait before giving up
    timeoutMs: number;
    // Margin around viewport for detection
    rootMargin?: string;
    // Intersection threshold for visibility detection
    intersectionThreshold?: number;
}

const DEFAULT_CONFIG: DetectorConfig = {
    skeletonSelectors: [
        '[role="progressbar"]',
        ".skeleton",
        ".placeholder",
        '[aria-busy="true"]',
    ],
    stabilityThresholdMs: 1000,
    timeoutMs: 30000,
    rootMargin: "50px",
    intersectionThreshold: 0,
};

class ViewportMutationObserver {
    private mutationObserver: MutationObserver;
    private intersectionObserver: IntersectionObserver;
    private visibleElements: Set<Element>;
    private callback: MutationCallback;
    private options: MutationObserverInit & {
        root?: Element | Document | null;
        rootMargin?: string;
        intersectionThreshold?: number | number[];
    };

    constructor(callback: MutationCallback, options = {}) {
        this.callback = callback;
        this.options = options;
        this.visibleElements = new Set();

        this.mutationObserver = new MutationObserver((mutations) => {
            const visibleMutations = mutations.filter((mutation) =>
                this.isElementOrParentVisible(mutation.target as Element),
            );
            if (visibleMutations.length > 0) {
                this.callback(visibleMutations, this.mutationObserver);
            }
        });

        this.intersectionObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        this.visibleElements.add(entry.target);
                    } else {
                        this.visibleElements.delete(entry.target);
                    }
                });
            },
            {
                root: this.options.root,
                rootMargin: this.options.rootMargin,
                threshold: this.options.intersectionThreshold,
            },
        );
    }

    public observe(targetNode: Element): void {
        this.mutationObserver.observe(targetNode, this.options);
        this.trackElementAndChildren(targetNode);
    }

    public disconnect(): void {
        this.mutationObserver.disconnect();
        this.intersectionObserver.disconnect();
        this.visibleElements.clear();
    }

    private trackElementAndChildren(element: Element): void {
        this.intersectionObserver.observe(element);
        element.querySelectorAll("*").forEach((child) => {
            this.intersectionObserver.observe(child);
        });
    }

    private isElementOrParentVisible(element: Element | null): boolean {
        while (element) {
            if (this.visibleElements.has(element)) {
                return true;
            }
            element = element.parentElement;
        }
        return false;
    }
}

export class SkeletonLoadingDetector {
    private config: DetectorConfig;
    private observer: ViewportMutationObserver | null;
    private stabilityTimeout: number | null;
    private maxTimeout: number | null;
    private intersectionObserver: IntersectionObserver | null;
    private visibleSkeletons: Set<Element>;

    constructor(config: Partial<DetectorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.observer = null;
        this.stabilityTimeout = null;
        this.maxTimeout = null;
        this.intersectionObserver = null;
        this.visibleSkeletons = new Set();
    }

    /**
     * Starts monitoring the page for skeleton elements in the viewport
     */
    public detect(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Set maximum timeout
            this.maxTimeout = window.setTimeout(() => {
                this.cleanup();
                reject(new Error("Skeleton detection timed out"));
            }, this.config.timeoutMs);

            // Initialize intersection observer for skeletons
            this.intersectionObserver = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            this.visibleSkeletons.add(entry.target);
                        } else {
                            this.visibleSkeletons.delete(entry.target);
                        }
                    });

                    // Check if all visible skeletons are gone
                    if (this.visibleSkeletons.size === 0) {
                        this.handleNoSkeletons(resolve);
                    }
                },
                {
                    rootMargin: this.config.rootMargin,
                    threshold: this.config.intersectionThreshold,
                },
            );

            // Start observing mutations and visibility
            this.observer = new ViewportMutationObserver(
                () => {
                    this.updateSkeletonTracking();
                },
                {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ["class", "role", "aria-busy"],
                    rootMargin: this.config.rootMargin,
                    intersectionThreshold: this.config.intersectionThreshold,
                },
            );

            // Start tracking existing skeletons
            this.updateSkeletonTracking();

            // Start observing DOM changes
            this.observer.observe(document.body);

            // Check initial state
            if (this.visibleSkeletons.size === 0) {
                this.handleNoSkeletons(resolve);
            }
        });
    }

    /**
     * Updates tracking of skeleton elements
     */
    private updateSkeletonTracking(): void {
        if (!this.intersectionObserver) return;

        // Find all skeleton elements
        this.config.skeletonSelectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((element) => {
                this.intersectionObserver!.observe(element);
            });
        });
    }

    /**
     * Handles the case when no skeletons are detected
     */
    private handleNoSkeletons(resolve: () => void): void {
        if (this.stabilityTimeout) {
            window.clearTimeout(this.stabilityTimeout);
        }

        this.stabilityTimeout = window.setTimeout(() => {
            // Double-check that no new skeletons appeared and are visible
            if (this.visibleSkeletons.size === 0) {
                this.cleanup();
                resolve();
            }
        }, this.config.stabilityThresholdMs);
    }

    /**
     * Cleans up observers and timeouts
     */
    private cleanup(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }
        if (this.stabilityTimeout) {
            window.clearTimeout(this.stabilityTimeout);
            this.stabilityTimeout = null;
        }
        if (this.maxTimeout) {
            window.clearTimeout(this.maxTimeout);
            this.maxTimeout = null;
        }
        this.visibleSkeletons.clear();
    }
}

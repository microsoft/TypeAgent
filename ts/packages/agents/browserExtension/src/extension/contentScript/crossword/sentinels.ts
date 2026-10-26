// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

type Sentinel = { read: () => string; text: string };

export class CrosswordSentinels {
    private readonly sentinels = new Map<Element, Sentinel>();
    private readonly observer: MutationObserver;

    constructor(private readonly changed: () => void) {
        this.observer = new MutationObserver(() => this.check());
        this.observer.observe(document, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
                "id",
                "role",
                "aria-label",
                "aria-hidden",
                "hidden",
                "style",
                "class",
            ],
        });
    }

    watch(
        node: Element,
        read = () => node.textContent?.replace(/\s+/g, " ").trim() ?? "",
    ): void {
        if (this.sentinels.has(node) || this.sentinels.size >= 5) return;
        this.sentinels.set(node, { read, text: read() });
    }

    check(): void {
        this.observer.takeRecords();
        for (const [node, sentinel] of this.sentinels) {
            if (
                node.ownerDocument !== document ||
                !node.isConnected ||
                sentinel.read() !== sentinel.text
            ) {
                this.clear();
                this.changed();
                return;
            }
        }
    }

    clear(): void {
        this.sentinels.clear();
        this.observer.takeRecords();
    }

    dispose(): void {
        this.clear();
        this.observer.disconnect();
    }
}

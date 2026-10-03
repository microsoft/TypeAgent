// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    BrowserCapturePage,
    BrowserCaptureSnapshot,
} from "@typeagent/browser-control-rpc/types";
import type { ContentScriptRpc } from "@typeagent/browser-control-rpc/contentScriptRpc/types";

type CaptureTarget = {
    tabId: number;
    documentId: string;
    page: BrowserCapturePage;
};

async function awaitCapture<T>(capture: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () =>
                reject(
                    new Error(
                        "Explicit-page capture is unavailable: the selected document did not respond.",
                    ),
                ),
            10000,
        );
    });
    try {
        return await Promise.race([capture, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export function createPageCapture(
    getDocumentRpc: (tabId: number, documentId: string) => ContentScriptRpc,
) {
    const targets = new Map<string, CaptureTarget>();
    const revisions = new Map<number, number>();

    function invalidate(tabId: number) {
        revisions.set(tabId, (revisions.get(tabId) ?? 0) + 1);
        for (const [pageId, target] of targets) {
            if (target.tabId === tabId) targets.delete(pageId);
        }
    }
    chrome.tabs.onRemoved.addListener(invalidate);
    chrome.tabs.onUpdated.addListener((tabId, change) => {
        if (change.status === "loading" || change.url !== undefined) {
            invalidate(tabId);
        }
    });

    async function listTab(tab: chrome.tabs.Tab) {
        if (
            tab.id === undefined ||
            tab.incognito ||
            !/^https?:\/\//i.test(tab.url ?? "") ||
            tab.status === "loading"
        ) {
            return undefined;
        }
        const tabId = tab.id;
        const revision = revisions.get(tabId);
        try {
            // Chrome supplies the documentId, which cannot be chosen by page JS.
            const results = await chrome.scripting.executeScript({
                target: { tabId, frameIds: [0] },
                func: () => ({ url: document.URL, title: document.title }),
            });
            // The pinned Chrome API types predate InjectionResult.documentId.
            const result = results[0] as
                | (chrome.scripting.InjectionResult<{
                      url: string;
                      title: string;
                  }> & {
                      documentId?: string;
                  })
                | undefined;
            if (result && !result.documentId) {
                throw new Error(
                    "Explicit-page capture is unavailable: document binding is not supported.",
                );
            }
            if (
                !result?.documentId ||
                !result.result ||
                result.result.url !== tab.url ||
                revisions.get(tabId) !== revision
            ) {
                return undefined;
            }
            const page: BrowserCapturePage = {
                pageId: crypto.randomUUID(),
                ...result.result,
            };
            targets.set(page.pageId, {
                tabId,
                documentId: result.documentId,
                page,
            });
            return page;
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes("capture is unavailable")
            ) {
                throw error;
            }
            // Restricted pages/hosts without injection permission are not capturable.
            return undefined;
        }
    }

    return {
        async getCapturePages(): Promise<BrowserCapturePage[]> {
            if (!chrome.scripting?.executeScript) {
                throw new Error("Explicit-page capture is unavailable.");
            }
            targets.clear();
            const pages = await Promise.all(
                (await chrome.tabs.query({})).map(listTab),
            );
            return pages.filter(
                (page): page is BrowserCapturePage => page !== undefined,
            );
        },
        async capturePageSnapshot(
            pageId: string,
        ): Promise<BrowserCaptureSnapshot> {
            const target = targets.get(pageId);
            if (!target) {
                throw new Error(
                    "The selected page disappeared or navigated. Refresh the page list.",
                );
            }
            const tab = await chrome.tabs.get(target.tabId);
            if (
                tab.incognito ||
                tab.url !== target.page.url ||
                tab.status === "loading" ||
                targets.get(pageId) !== target
            ) {
                throw new Error(
                    "The selected page disappeared or navigated. Refresh the page list.",
                );
            }
            const snapshot = await awaitCapture(
                getDocumentRpc(
                    target.tabId,
                    target.documentId,
                ).capturePageSnapshot(target.page.url),
            );
            if (
                targets.get(pageId) !== target ||
                snapshot.url !== target.page.url
            ) {
                throw new Error(
                    "The selected page navigated. Refresh the page list.",
                );
            }
            return { ...snapshot, pageId };
        },
    };
}

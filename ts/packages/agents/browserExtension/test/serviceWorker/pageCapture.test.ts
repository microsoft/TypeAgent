// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createPageCapture } from "../../src/extension/serviceWorker/pageCapture";
import { captureDocumentSnapshot } from "../../src/extension/contentScript/captureDocument";
import type { ContentScriptRpc } from "@typeagent/browser-control-rpc/contentScriptRpc/types";

const article = {
    id: 7,
    url: "https://example.com/article",
    title: "Article",
    incognito: false,
    status: "complete",
};
const hub = {
    ...article,
    id: 9,
    url: "http://localhost:1234/memory-hub",
    title: "Memory Hub",
    active: true,
};

describe("explicit-page capture", () => {
    let getDocumentRpc: jest.Mock;
    let captureSnapshot: jest.Mock;
    let capture: ReturnType<typeof createPageCapture>;

    beforeEach(() => {
        jest.clearAllMocks();
        let nextId = 0;
        Object.defineProperty(crypto, "randomUUID", {
            configurable: true,
            value: () => `opaque-${++nextId}`,
        });
        captureSnapshot = jest.fn().mockResolvedValue({
            url: article.url,
            title: "Captured title",
            htmlFragments: [
                { frameId: "0", content: "<h1>Captured title</h1>" },
            ],
            warnings: [],
        });
        getDocumentRpc = jest.fn(
            () =>
                ({
                    capturePageSnapshot: captureSnapshot,
                }) as unknown as ContentScriptRpc,
        );
        (chrome.tabs.query as jest.Mock).mockResolvedValue([article, hub]);
        (chrome.tabs.get as jest.Mock).mockResolvedValue(article);
        (chrome.scripting.executeScript as jest.Mock).mockImplementation(
            ({ target }: { target: { tabId: number } }) => {
                const tab = target.tabId === article.id ? article : hub;
                return Promise.resolve([
                    {
                        frameId: 0,
                        documentId: `document-${tab.id}`,
                        result: { url: tab.url, title: tab.title },
                    },
                ]);
            },
        );
        capture = createPageCapture(getDocumentRpc);
    });

    function navigate(tabId = article.id, change = { status: "loading" }) {
        const listener = (chrome.tabs.onUpdated.addListener as jest.Mock).mock
            .calls[0][0];
        listener(tabId, change);
    }

    test("captures a non-active article while Hub remains active", async () => {
        const pages = await capture.getCapturePages();
        const selected = pages.find((page) => page.url === article.url)!;
        expect(selected.pageId).not.toBe(String(article.id));
        const snapshot = await capture.capturePageSnapshot(selected.pageId);
        expect(getDocumentRpc).toHaveBeenCalledWith(article.id, "document-7");
        expect(captureSnapshot).toHaveBeenCalledWith(article.url);
        expect(snapshot).toEqual({
            pageId: selected.pageId,
            url: article.url,
            title: "Captured title",
            htmlFragments: [
                { frameId: "0", content: "<h1>Captured title</h1>" },
            ],
            warnings: [],
        });
        expect(chrome.tabs.update).not.toHaveBeenCalled();
        expect(chrome.tabs.query).toHaveBeenCalledWith({});
    });

    test("active-tab changes cannot redirect capture", async () => {
        const [selected] = await capture.getCapturePages();
        navigate(hub.id, { status: "complete" });
        await capture.capturePageSnapshot(selected.pageId);
        expect(getDocumentRpc).toHaveBeenCalledWith(article.id, "document-7");
        expect(chrome.tabs.update).not.toHaveBeenCalled();
    });

    test("excludes incognito, non-HTTP(S), and loading tabs", async () => {
        (chrome.tabs.query as jest.Mock).mockResolvedValue([
            article,
            { ...article, id: 11, incognito: true },
            { ...article, id: 12, url: "chrome://settings" },
            { ...article, id: 13, status: "loading" },
        ]);
        expect(await capture.getCapturePages()).toHaveLength(1);
        expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
    });

    test("rejects disappeared tabs and arbitrary IDs", async () => {
        const [selected] = await capture.getCapturePages();
        const removed = (chrome.tabs.onRemoved.addListener as jest.Mock).mock
            .calls[0][0];
        removed(article.id);
        await expect(
            capture.capturePageSnapshot(selected.pageId),
        ).rejects.toThrow("disappeared or navigated");
        await expect(capture.capturePageSnapshot("7")).rejects.toThrow(
            "disappeared or navigated",
        );
        expect(getDocumentRpc).not.toHaveBeenCalled();
    });

    test("rejects navigation even when the URL returns to the same value", async () => {
        const [selected] = await capture.getCapturePages();
        navigate();
        await expect(
            capture.capturePageSnapshot(selected.pageId),
        ).rejects.toThrow("disappeared or navigated");
        expect(getDocumentRpc).not.toHaveBeenCalled();
    });

    test("rejects navigation during capture", async () => {
        const [selected] = await capture.getCapturePages();
        captureSnapshot.mockImplementation(async () => {
            navigate();
            return {
                url: article.url,
                title: "Wrong document",
                htmlFragments: [],
                warnings: [],
            };
        });
        await expect(
            capture.capturePageSnapshot(selected.pageId),
        ).rejects.toThrow("navigated");
    });

    test("rejects a replaced document and URL drift", async () => {
        const [selected] = await capture.getCapturePages();
        captureSnapshot.mockRejectedValue(
            new Error("Document document-7 no longer exists"),
        );
        await expect(
            capture.capturePageSnapshot(selected.pageId),
        ).rejects.toThrow("no longer exists");
        captureSnapshot.mockResolvedValue({
            url: hub.url,
            title: hub.title,
            htmlFragments: [],
            warnings: [],
        });
        await expect(
            capture.capturePageSnapshot(selected.pageId),
        ).rejects.toThrow("navigated");
    });

    test("does not list a document that navigated during enumeration", async () => {
        (chrome.scripting.executeScript as jest.Mock).mockImplementation(
            async () => {
                navigate();
                return [
                    {
                        documentId: "new-document",
                        result: { url: "https://other.test", title: "Other" },
                    },
                ];
            },
        );
        (chrome.tabs.query as jest.Mock).mockResolvedValue([article]);
        expect(await capture.getCapturePages()).toEqual([]);
    });

    test("reports unavailable when Chrome cannot bind a document", async () => {
        (chrome.scripting.executeScript as jest.Mock).mockResolvedValue([
            { frameId: 0, result: { url: article.url, title: article.title } },
        ]);
        await expect(capture.getCapturePages()).rejects.toThrow(
            "capture is unavailable",
        );
        expect(getDocumentRpc).not.toHaveBeenCalled();
    });

    test("reports unavailable rather than hanging when a document cannot respond", async () => {
        jest.useFakeTimers();
        try {
            const [selected] = await capture.getCapturePages();
            captureSnapshot.mockReturnValue(new Promise(() => {}));
            const result = expect(
                capture.capturePageSnapshot(selected.pageId),
            ).rejects.toThrow("selected document did not respond");
            await jest.advanceTimersByTimeAsync(10000);
            await result;
        } finally {
            jest.useRealTimers();
        }
    });

    test("same-document snapshot has coherent metadata/HTML and frame omission warning", () => {
        document.title = "Document title";
        document.body.innerHTML =
            '<h1>Document title</h1><iframe src="https://embedded.test"></iframe>';
        const snapshot = captureDocumentSnapshot(document, document.URL);
        expect(snapshot.url).toBe(document.URL);
        expect(snapshot.title).toBe("Document title");
        expect(snapshot.htmlFragments).toEqual([
            { frameId: "0", content: document.documentElement.outerHTML },
        ]);
        expect(snapshot.warnings).toEqual([
            "Embedded frames are omitted; only the root document was captured.",
        ]);
        expect(() => captureDocumentSnapshot(document, article.url)).toThrow(
            "navigated",
        );
    });
});

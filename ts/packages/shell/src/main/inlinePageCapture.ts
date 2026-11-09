// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type { WebContents, WebFrameMain } from "electron";
import type {
    BrowserCapturePage,
    BrowserCaptureSnapshot,
} from "@typeagent/browser-control-rpc/types";

type CaptureTarget = {
    page: BrowserCapturePage;
    contents: WebContents;
    frame: WebFrameMain;
    invalidated: boolean;
    cleanup: () => void;
};

function readMetadata(value: unknown): { url: string; title: string } {
    if (
        !value ||
        typeof value !== "object" ||
        !("url" in value) ||
        typeof value.url !== "string" ||
        !("title" in value) ||
        typeof value.title !== "string"
    ) {
        throw new Error(
            "Explicit-page capture is unavailable: invalid document metadata.",
        );
    }
    return { url: value.url, title: value.title };
}

function readSnapshot(value: unknown): Omit<BrowserCaptureSnapshot, "pageId"> {
    const metadata = readMetadata(value);
    if (
        !value ||
        typeof value !== "object" ||
        !("htmlFragments" in value) ||
        !Array.isArray(value.htmlFragments) ||
        !("warnings" in value) ||
        !Array.isArray(value.warnings)
    ) {
        throw new Error(
            "Explicit-page capture is unavailable: invalid document snapshot.",
        );
    }
    const htmlFragments = value.htmlFragments.map((fragment: unknown) => {
        if (
            !fragment ||
            typeof fragment !== "object" ||
            !("frameId" in fragment) ||
            fragment.frameId !== "0" ||
            !("content" in fragment) ||
            typeof fragment.content !== "string"
        ) {
            throw new Error(
                "Explicit-page capture is unavailable: invalid root fragment.",
            );
        }
        return { frameId: fragment.frameId, content: fragment.content };
    });
    const warnings = value.warnings.map((warning: unknown) => {
        if (typeof warning !== "string") {
            throw new Error(
                "Explicit-page capture is unavailable: invalid capture warning.",
            );
        }
        return warning;
    });
    return { ...metadata, htmlFragments, warnings };
}

export function createInlinePageCapture(getPages: () => WebContents[]) {
    const targets = new Map<string, CaptureTarget>();
    function clear() {
        for (const target of targets.values()) target.cleanup();
        targets.clear();
    }

    async function listPage(contents: WebContents) {
        if (
            contents.isDestroyed() ||
            !contents.session.isPersistent() ||
            contents.isLoadingMainFrame() ||
            !/^https?:\/\//i.test(contents.getURL())
        ) {
            return undefined;
        }
        const frame = contents.mainFrame;
        if (!frame?.executeJavaScript) {
            throw new Error("Explicit-page capture is unavailable.");
        }
        const target: CaptureTarget = {
            page: { pageId: randomUUID(), url: "", title: "" },
            contents,
            frame,
            invalidated: false,
            cleanup: () => {
                contents.removeListener("did-start-navigation", onNavigation);
                contents.removeListener("destroyed", onDestroyed);
            },
        };
        const onNavigation = (
            _event: Electron.Event,
            _url: string,
            _inPlace: boolean,
            isMainFrame: boolean,
        ) => {
            if (isMainFrame) target.invalidated = true;
        };
        const onDestroyed = () => {
            target.invalidated = true;
        };
        contents.on("did-start-navigation", onNavigation);
        contents.on("destroyed", onDestroyed);
        try {
            const metadata = readMetadata(
                await frame.executeJavaScript(
                    "({url: document.URL, title: document.title})",
                ),
            );
            if (
                target.invalidated ||
                metadata.url !== contents.getURL() ||
                !/^https?:\/\//i.test(metadata.url)
            ) {
                target.cleanup();
                return undefined;
            }
            target.page = { ...target.page, ...metadata };
            targets.set(target.page.pageId, target);
            return target.page;
        } catch {
            target.cleanup();
            return undefined;
        }
    }

    function assertCurrent(target: CaptureTarget | undefined) {
        if (
            !target ||
            target.invalidated ||
            target.contents.isDestroyed() ||
            !getPages().includes(target.contents) ||
            target.contents.mainFrame !== target.frame ||
            target.contents.getURL() !== target.page.url ||
            target.contents.isLoadingMainFrame()
        ) {
            throw new Error(
                "The selected page disappeared or navigated. Refresh the page list.",
            );
        }
        return target;
    }

    return {
        async getCapturePages(): Promise<BrowserCapturePage[]> {
            clear();
            const pages = await Promise.all(getPages().map(listPage));
            return pages.filter(
                (page): page is BrowserCapturePage => page !== undefined,
            );
        },
        async capturePageSnapshot(
            pageId: string,
        ): Promise<BrowserCaptureSnapshot> {
            const target = assertCurrent(targets.get(pageId));
            // One synchronous evaluation, pinned to the listed WebContents frame.
            const snapshot = readSnapshot(
                await target.frame.executeJavaScript(`(() => {
                    const url = document.URL;
                    if (url !== ${JSON.stringify(target.page.url)}) {
                        throw new Error("The selected page navigated. Refresh the page list.");
                    }
                    return {
                        url, title: document.title,
                        htmlFragments: [{frameId: "0", content: document.documentElement.outerHTML}],
                        warnings: document.querySelector("iframe,frame,object,embed")
                            ? ["Embedded frames are omitted; only the root document was captured."]
                            : []
                    };
                })()`),
            );
            assertCurrent(targets.get(pageId));
            if (snapshot.url !== target.page.url) {
                throw new Error(
                    "The selected page navigated. Refresh the page list.",
                );
            }
            return { ...snapshot, pageId };
        },
        close: clear,
    };
}

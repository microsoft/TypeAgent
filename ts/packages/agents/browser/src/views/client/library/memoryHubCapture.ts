// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { BrowserCapturePage } from "@typeagent/browser-control-rpc/types";
import type { MemoryHubFunctions } from "@typeagent/browser-control-rpc/viewRpc";
import { invokeView } from "./viewClient";

type CaptureResult = Awaited<
    ReturnType<MemoryHubFunctions["memoryHubCapturePage"]>
>;

export function mountMemoryHubCapture(
    host: HTMLElement,
    options: {
        onError: (error: unknown) => void;
        onComplete: (result: CaptureResult) => Promise<void>;
    },
) {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Capture an open browser page");
    dialog.innerHTML = `
        <div class="hub-dialog-head"><h2>Capture an open browser page</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close" title="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
        <p>Target corpus: TypeAgent Browser Memory (fixed). Choose the source page explicitly; capture does not switch the active tab.</p>
        <div class="phase2-controls"><label>Source page<select aria-label="Source page"></select></label></div>
        <p class="phase2-text" data-target></p>
        <p role="status" class="phase2-status"></p>
        <details class="hub-help-block"><summary>How capture works</summary>
        <p>Capture cannot be cancelled once started. Embedded frame omissions are reported in the result.</p></details>
        <button type="button" class="primary" data-capture>Capture selected page</button>
        <button type="button" class="icon-btn" data-refresh aria-label="Refresh page list" title="Refresh page list"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>`;
    host.append(dialog);
    const selector = dialog.querySelector<HTMLSelectElement>("select")!;
    const target = dialog.querySelector<HTMLElement>("[data-target]")!;
    const status = dialog.querySelector<HTMLElement>('[role="status"]')!;
    const capture = dialog.querySelector<HTMLButtonElement>("[data-capture]")!;
    const refresh = dialog.querySelector<HTMLButtonElement>("[data-refresh]")!;
    const close = dialog.querySelector<HTMLButtonElement>("[data-close]")!;
    let pages: BrowserCapturePage[] = [];
    let generation = 0;
    let busy = false;
    let disposed = false;

    function selected() {
        return pages.find((page) => page.pageId === selector.value);
    }
    function controls() {
        capture.disabled = busy || !selected();
        selector.disabled = busy || !pages.length;
        refresh.disabled = busy;
        close.disabled = busy;
        target.textContent = selected()?.url ?? "";
    }
    async function load() {
        const version = ++generation;
        pages = [];
        selector.replaceChildren(new Option("Choose a source page", ""));
        status.textContent = "Loading open pages...";
        controls();
        try {
            const result = await invokeView("memoryHubCapturePages", {});
            if (disposed || version !== generation || !dialog.open) return;
            pages = result.pages;
            for (const page of pages)
                selector.append(
                    new Option(page.title || page.url, page.pageId),
                );
            status.textContent = pages.length
                ? "Choose a page and review its URL before capturing."
                : "No eligible pages. Open a source webpage, then refresh. Local Memory views and private tabs are excluded.";
            controls();
            selector.focus();
        } catch (error) {
            if (disposed || version !== generation || !dialog.open) return;
            status.textContent = `Page capture unavailable: ${error instanceof Error ? error.message : String(error)}`;
            options.onError(error);
        }
    }
    async function save() {
        const page = selected();
        if (busy || !page) return;
        busy = true;
        status.textContent =
            "Capturing selected page into durable browser memory...";
        controls();
        let saved = false;
        try {
            const result = await invokeView("memoryHubCapturePage", {
                pageId: page.pageId,
                expectedUrl: page.url,
            });
            saved = true;
            if (disposed) return;
            busy = false;
            dialog.close();
            await options.onComplete(result);
        } catch (error) {
            if (disposed) return;
            status.textContent = `${saved ? "Capture saved, but refresh failed" : "Capture failed"}: ${error instanceof Error ? error.message : String(error)}`;
            options.onError(error);
        } finally {
            busy = false;
            if (!disposed) controls();
        }
    }
    selector.addEventListener("change", controls);
    capture.addEventListener("click", () => {
        void save();
    });
    refresh.addEventListener("click", () => {
        void load();
    });
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", (event) => {
        if (busy) event.preventDefault();
    });
    dialog.addEventListener("close", () => {
        generation++;
    });
    controls();
    return {
        open() {
            if (disposed || dialog.open) return;
            dialog.showModal();
            void load();
        },
        dispose() {
            disposed = true;
            generation++;
            dialog.remove();
        },
    };
}

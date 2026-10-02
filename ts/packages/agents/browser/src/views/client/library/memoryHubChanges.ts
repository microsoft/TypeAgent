// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryHubChangeReceipt,
    MemoryHubError,
} from "@typeagent/browser-control-rpc/viewRpc";
import type { MemoryCenterPage } from "@typeagent/browser-control-rpc/serviceTypes";
import { invokeView } from "./viewClient";
import "./memoryHubPhase2.css";

export type MemoryHubChangesOptions = {
    scope: () => string | undefined;
    onError: (error: unknown) => void;
};
function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    value?: string,
    className?: string,
): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag);
    if (value !== undefined) result.textContent = value;
    if (className) result.className = className;
    return result;
}

export function mountMemoryHubChanges(
    host: HTMLElement,
    options: MemoryHubChangesOptions,
) {
    const root = element("section", undefined, "memory-phase2 memory-changes");
    root.setAttribute("aria-label", "Memory changes");
    const title = element("h3", "Committed changes");
    const explanation = element(
        "p",
        "Metadata-only receipts retained for 90 days. Source and revision references are domain-hashed opaque references, not navigation IDs. Forgetting a source purges its earlier receipts. No source text or confirmation tokens are retained here.",
    );
    const status = element(
        "p",
        "Refresh to load committed change receipts.",
        "phase2-status",
    );
    status.setAttribute("role", "status");
    const warning = element("div", undefined, "phase2-warning");
    warning.hidden = true;
    warning.setAttribute("role", "status");
    const rows = element("div", undefined, "phase2-results");
    const controls = element("div", undefined, "phase2-controls");
    const refreshButton = element("button", "Refresh changes");
    const previous = element("button", "Previous changes");
    const next = element("button", "Next changes");
    for (const button of [refreshButton, previous, next])
        button.type = "button";
    previous.disabled = next.disabled = true;
    controls.append(refreshButton, previous, next);
    root.append(title, explanation, status, warning, rows, controls);
    host.append(root);
    let page:
        | (MemoryCenterPage<MemoryHubChangeReceipt> & {
              errors: MemoryHubError[];
          })
        | undefined;
    let tokens: Array<string | undefined> = [undefined];
    let pageIndex = 0;
    let requestVersion = 0;
    let disposed = false;
    let lastScope = options.scope();

    function receipt(receipt: MemoryHubChangeReceipt) {
        const row = element("article");
        row.append(
            element("h4", `${receipt.operation} · committed`),
            element("p", new Date(receipt.createdAt).toLocaleString()),
            element(
                "p",
                `${receipt.counts.sources} sources · ${receipt.counts.revisions} revisions · ${receipt.counts.knowledge} knowledge items`,
            ),
            element(
                "p",
                options.scope() ? "Selected corpus" : "Corpus-specific change",
            ),
        );
        const references = [
            `Receipt: ${receipt.changeId}`,
            `Corpus ID: ${receipt.corpusId}`,
            receipt.sourceId
                ? `Opaque source reference: ${receipt.sourceId}`
                : "",
            receipt.previousRevisionId
                ? `Opaque previous revision reference: ${receipt.previousRevisionId}`
                : "",
            receipt.revisionId
                ? `Opaque revision reference: ${receipt.revisionId}`
                : "",
        ].filter(Boolean);
        row.append(
            element("p", references.join("\n"), "phase2-inspector phase2-text"),
        );
        return row;
    }
    function render() {
        if (!page) return;
        rows.replaceChildren(
            ...page.items
                .filter((item) => item.outcome === "committed")
                .map(receipt),
        );
        warning.hidden = !page.errors.length;
        warning.textContent = page.errors.length
            ? `Partial change history:\n${page.errors.map((error) => `${error.corpusId} · ${error.operation}: ${error.message}`).join("\n")}`
            : "";
        status.textContent = `Page ${pageIndex + 1} · ${page.total} receipts${page.errors.length ? " from available corpora; totals may be incomplete" : ""}`;
        if (!page.items.length)
            rows.append(
                element(
                    "p",
                    page.errors.length
                        ? "Change history is unavailable for some corpora. This is not a successful empty history."
                        : "No committed changes in the retained 90-day history.",
                ),
            );
        previous.disabled = pageIndex === 0;
        next.disabled = !page.nextContinuationToken;
    }
    async function load() {
        const version = ++requestVersion;
        const scope = options.scope();
        if (scope !== lastScope) {
            lastScope = scope;
            pageIndex = 0;
            tokens = [undefined];
            page = undefined;
            rows.replaceChildren();
        }
        refreshButton.disabled = previous.disabled = next.disabled = true;
        status.textContent = "Loading committed change receipts…";
        try {
            const result = await invokeView("memoryHubChanges", {
                corpusId: scope,
                pageSize: 25,
                continuationToken: tokens[pageIndex],
            });
            if (
                disposed ||
                version !== requestVersion ||
                scope !== options.scope()
            )
                return;
            page = result;
            if (result.nextContinuationToken)
                tokens[pageIndex + 1] = result.nextContinuationToken;
            render();
        } catch (error) {
            if (
                disposed ||
                version !== requestVersion ||
                scope !== options.scope()
            )
                return;
            status.textContent = `Change history unavailable: ${error instanceof Error ? error.message : String(error)}`;
            options.onError(error);
            previous.disabled = pageIndex === 0;
            next.disabled = true;
        } finally {
            if (version === requestVersion) refreshButton.disabled = false;
        }
    }
    async function refresh() {
        if (disposed) return;
        pageIndex = 0;
        tokens = [undefined];
        await load();
    }
    refreshButton.addEventListener("click", () => {
        void refresh();
    });
    previous.addEventListener("click", () => {
        if (pageIndex > 0) {
            pageIndex--;
            void load();
        }
    });
    next.addEventListener("click", () => {
        if (page?.nextContinuationToken) {
            pageIndex++;
            void load();
        }
    });
    return {
        refresh,
        dispose() {
            disposed = true;
            requestVersion++;
            root.remove();
        },
    };
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { rbButton, rbNode } from "./memoryHubDocumentUi";

export function viewSheet(
    host: HTMLElement,
    title: string,
    canClose: () => boolean = () => true,
) {
    const previous = document.activeElement;
    const dialog = rbNode("dialog", undefined, "hub-view-sheet");
    dialog.setAttribute("aria-label", title);
    const body = rbNode("div", undefined, "hub-view-sheet-body");
    const close = () => {
        if (!canClose()) return;
        dialog.remove();
        if (previous instanceof HTMLElement && previous.isConnected)
            previous.focus();
    };
    dialog.append(rbNode("h2", title), body, rbButton("Close", close));
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        close();
    });
    host.append(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.tabIndex = -1;
    dialog.focus();
    return { element: dialog, body, close };
}

export function viewTimestamp(value: string): string | undefined {
    if (!value.trim()) return undefined;
    const timestamp = value.trim();
    if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
            timestamp,
        ) ||
        !Number.isFinite(Date.parse(timestamp))
    )
        throw new Error(
            "Enter a valid ISO timestamp with Z or an explicit timezone offset",
        );
    const [year, month, day] = timestamp.slice(0, 10).split("-").map(Number);
    if (
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
        Number(timestamp.slice(11, 13)) > 23 ||
        Number(timestamp.slice(14, 16)) > 59 ||
        (timestamp[16] === ":" && Number(timestamp.slice(17, 19)) > 59)
    )
        throw new Error("Enter a valid calendar date and clock time");
    return new Date(timestamp).toISOString();
}

export function viewRevisionTime(value: string | undefined): HTMLTimeElement[] {
    if (value === undefined) return [];
    const timestamp = viewTimestamp(value);
    if (!timestamp) throw new Error("View revision timestamp is missing");
    const time = rbNode("time", `Revision created: ${timestamp}`);
    time.dateTime = timestamp;
    return [time];
}

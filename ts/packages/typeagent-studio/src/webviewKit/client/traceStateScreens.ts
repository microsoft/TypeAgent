// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The Trace Viewer's non-pipeline screens: the centered placeholder shown while
 * a trace is loading, missing, evicted, or malformed, and the transient note
 * banner surfaced when a source open/compare couldn't complete.
 */

import { el } from "./traceViewerDom.js";

/** A full-panel centered message (with a spinner while loading) for the states
 *  where there's no pipeline to draw: loading, error, evicted, or missing. */
export function centeredState(message: string, kind: string): HTMLElement {
    const box = el("div", "state-screen");
    box.classList.add(`state-${kind}`);
    const inner = el("div", "state-inner");
    if (kind === "loading") {
        inner.appendChild(el("div", "spinner"));
    }
    const text = el("div", "state-text");
    text.textContent = message;
    inner.appendChild(text);
    box.appendChild(inner);
    return box;
}

/** A one-line banner under the header carrying the last source open/compare note
 *  (e.g. a file that couldn't be located). */
export function noteBanner(message: string): HTMLElement {
    const banner = el("div", "note-banner");
    banner.textContent = message;
    return banner;
}

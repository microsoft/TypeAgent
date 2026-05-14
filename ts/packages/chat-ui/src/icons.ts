// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Inline SVG icons used by the feedback widget. Kept local so chat-ui has
 * no icon-library dependency — mirrors the shell's icon.ts.
 */

function fromSvg(svg: string): HTMLElement {
    const wrapper = document.createElement("i");
    const empty = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
    );
    wrapper.appendChild(empty);
    empty.outerHTML = svg;
    return wrapper;
}

// When `filled` is true the interior is tinted with the current color at
// reduced opacity so the full-opacity stroke stays visible as an outline.
const FILL_OPACITY = "0.35";

export function iconThumbsUp(filled = false) {
    const fillAttrs = filled
        ? `fill="currentColor" fill-opacity="${FILL_OPACITY}"`
        : `fill="none"`;
    return fromSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" ${fillAttrs} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>`,
    );
}

export function iconThumbsDown(filled = false) {
    const fillAttrs = filled
        ? `fill="currentColor" fill-opacity="${FILL_OPACITY}"`
        : `fill="none"`;
    return fromSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" ${fillAttrs} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path></svg>`,
    );
}

export function iconCopy() {
    return fromSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
    );
}

export function iconCheck() {
    return fromSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    );
}

export function iconMore() {
    return fromSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg>`,
    );
}

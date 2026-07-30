// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tiny DOM construction helpers shared across every webview client bundle
 * (wizard, impact report, trace viewer). The CSP forbids inline styles, so a
 * node's look is always a CSS class passed here rather than a style attribute.
 *
 * Keep this module dependency-free and browser-only (no `vscode`, `ws`, or node
 * built-ins) so it bundles cleanly into each webview.
 */

/** Create an element, optionally setting its class and text content in one
 *  call — the building block every render helper leans on. */
export function el(
    tag: string,
    className?: string,
    text?: string,
): HTMLElement {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

/** Detach every child of a node so it can be re-rendered from scratch. */
export function clear(node: HTMLElement): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

/** Create a `wz-btn` styled button wired to a click handler. A disabled button
 *  gets no listener so it can't fire. */
export function button(
    label: string,
    onClick: () => void,
    opts: { variant?: "primary" | "secondary"; disabled?: boolean } = {},
): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `wz-btn wz-btn-${opts.variant ?? "secondary"}`;
    btn.textContent = label;
    btn.disabled = opts.disabled ?? false;
    if (!btn.disabled) {
        btn.addEventListener("click", onClick);
    }
    return btn;
}

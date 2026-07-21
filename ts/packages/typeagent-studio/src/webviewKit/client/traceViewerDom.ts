// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tiny DOM construction helpers shared by every Trace Viewer render module. The
 * CSP forbids inline styles, so a node's look is always a CSS class passed here.
 */

/** Create an element with a class in one call — the building block every render
 *  helper leans on. */
export function el(tag: string, className: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

/** Detach every child of a node so it can be re-rendered from scratch. */
export function clear(node: HTMLElement): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

/** Upper-case the first character, leaving the rest as-is (empty stays empty). */
export function capitalize(value: string): string {
    return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

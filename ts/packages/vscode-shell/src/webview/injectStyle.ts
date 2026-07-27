// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/** Append a `<style>` element with the given CSS to the document head. */
export function injectStyle(css: string): void {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * Side-by-side grammar diff view.
 * @element gt-diff-view
 */
@customElement("gt-diff-view")
export class GtDiffView extends LitElement {
    static override styles = css`
        :host {
            display: block;
            font-family: var(--gt-font-family, var(--vscode-font-family, sans-serif));
            font-size: var(--gt-font-size, var(--vscode-font-size, 13px));
            color: var(--gt-foreground, var(--vscode-foreground, #cccccc));
            background: var(--gt-background, var(--vscode-editor-background, #1e1e1e));
        }
    `;

    override render() {
        return html`<div class="container">
            <slot></slot>
        </div>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "gt-diff-view": GtDiffView;
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * Read-only source view with syntax highlighting and diagnostics.
 * @element gt-source-view
 */
@customElement("gt-source-view")
export class GtSourceView extends LitElement {
    static override styles = css`
        :host {
            display: block;
            font-family: var(
                --gt-font-family,
                var(--vscode-font-family, sans-serif)
            );
            font-size: var(--gt-font-size, var(--vscode-font-size, 13px));
            color: var(--gt-foreground, var(--vscode-foreground, #cccccc));
            background: var(
                --gt-background,
                var(--vscode-editor-background, #1e1e1e)
            );
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
        "gt-source-view": GtSourceView;
    }
}

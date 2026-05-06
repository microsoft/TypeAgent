// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css } from "lit";
import { customElement } from "lit/decorators.js";

/**
 * Interactive completion preview panel.
 * @element gt-completion-panel
 */
@customElement("gt-completion-panel")
export class GtCompletionPanel extends LitElement {
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
        "gt-completion-panel": GtCompletionPanel;
    }
}

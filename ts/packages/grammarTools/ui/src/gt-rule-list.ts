// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LoadedGrammar, SourceLocation } from "grammar-tools-core";
import { baseStyles } from "./styles.js";

/**
 * Displays grammar rules as a navigable list.
 * @element gt-rule-list
 */
@customElement("gt-rule-list")
export class GtRuleList extends LitElement {
    static override styles = [
        baseStyles,
        css`
            .rule-item {
                padding: 4px 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .rule-item:hover {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            .rule-item.selected {
                background: var(
                    --vscode-list-activeSelectionBackground,
                    #094771
                );
                color: var(--vscode-list-activeSelectionForeground, #ffffff);
            }
            .rule-name {
                flex: 1;
                font-family: var(
                    --gt-mono-font-family,
                    var(--vscode-editor-font-family, monospace)
                );
            }
            .rule-location {
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
        `,
    ];

    @property({ attribute: false })
    grammar: LoadedGrammar | undefined;

    @property({ attribute: false })
    onRuleClick:
        | ((ruleId: string, loc?: SourceLocation) => void)
        | undefined;

    @state()
    private _selectedRule: string = "";

    override render() {
        const g = this.grammar;
        if (!g) {
            return html`<div class="empty-state">No grammar loaded</div>`;
        }

        const ruleIds = g.identifiers.ruleIds;
        if (ruleIds.length === 0) {
            return html`<div class="empty-state">No rules found</div>`;
        }

        return html`
            ${ruleIds.map((ruleId) => {
                const loc = g.debugInfo?.rules.get(ruleId);
                return html`
                    <div
                        class="rule-item ${this._selectedRule === ruleId
                            ? "selected"
                            : ""}"
                        @click=${() => {
                            this._selectedRule = ruleId;
                            this.onRuleClick?.(ruleId, loc);
                        }}
                    >
                        <span class="rule-name">&lt;${ruleId}&gt;</span>
                        ${loc
                            ? html`<span class="rule-location"
                                  >${loc.displayPath}:${loc.range.start.line +
                                  1}</span
                              >`
                            : nothing}
                    </div>
                `;
            })}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "gt-rule-list": GtRuleList;
    }
}

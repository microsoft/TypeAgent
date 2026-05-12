// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GrammarDiff, SourceLocation } from "grammar-tools-core";
import { baseStyles } from "./styles.js";

/**
 * Side-by-side grammar rule diff view.
 * @element gt-diff-view
 */
@customElement("gt-diff-view")
export class GtDiffView extends LitElement {
    static override styles = [
        baseStyles,
        css`
            .summary-bar {
                display: flex;
                gap: 16px;
                padding: 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }
            .summary-bar .added {
                color: #4ec9b0;
            }
            .summary-bar .removed {
                color: var(--vscode-errorForeground, #f48771);
            }
            .summary-bar .changed {
                color: var(--vscode-editorWarning-foreground, #cca700);
            }

            .diff-header {
                padding: 6px 8px;
                font-size: 0.9em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .rule-entry {
                padding: 4px 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .rule-entry:hover {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            .rule-entry .badge {
                font-weight: bold;
                width: 1.5em;
                text-align: center;
            }
            .rule-entry.added-entry .badge {
                color: #4ec9b0;
            }
            .rule-entry.removed-entry .badge {
                color: var(--vscode-errorForeground, #f48771);
            }
            .rule-entry.changed-entry .badge {
                color: var(--vscode-editorWarning-foreground, #cca700);
            }
            .rule-entry .label {
                flex: 1;
            }
            .rule-entry .tag {
                font-size: 0.8em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }

            .side-by-side {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 1px;
                margin: 4px 8px 8px 24px;
                border: 1px solid var(--vscode-panel-border, #80808059);
            }
            .side-pane {
                padding: 8px;
                font-family: var(
                    --gt-mono-font-family,
                    var(--vscode-editor-font-family, monospace)
                );
                font-size: 0.85em;
                white-space: pre-wrap;
                word-break: break-word;
                background: var(--vscode-editor-background, #1e1e1e);
            }
            .side-pane.before-pane {
                border-right: 1px solid var(--vscode-panel-border, #80808059);
            }
            .pane-header {
                font-size: 0.8em;
                padding: 4px 8px;
                color: var(--vscode-descriptionForeground, #9d9d9d);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                background: var(--vscode-editorWidget-background, #252526);
            }

            .section-divider {
                border-top: 1px solid
                    var(--vscode-panel-border, rgba(128, 128, 128, 0.15));
                margin-top: 4px;
            }
        `,
    ];

    @property({ attribute: false })
    diff: GrammarDiff | undefined;

    @property({ type: String, attribute: "label-a" })
    labelA: string = "before";

    @property({ type: String, attribute: "label-b" })
    labelB: string = "after";

    @property({ attribute: false })
    onSourceClick: ((loc: SourceLocation) => void) | undefined;

    @property({ type: Boolean, attribute: "expand-all" })
    expandAll: boolean = false;

    @state()
    private _expandedRules: Set<string> = new Set();

    override connectedCallback(): void {
        super.connectedCallback();
        if (this.expandAll && this.diff) {
            this._expandedRules = new Set(this.diff.changed.map((c) => c.rule));
        }
    }

    private _toggleExpand(rule: string): void {
        const next = new Set(this._expandedRules);
        if (next.has(rule)) {
            next.delete(rule);
        } else {
            next.add(rule);
        }
        this._expandedRules = next;
    }

    override render() {
        const d = this.diff;
        if (!d) {
            return html`<div class="empty-state">No diff loaded</div>`;
        }

        const hasContent =
            d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0;

        if (!hasContent) {
            return html`<div class="empty-state">No differences found</div>`;
        }

        return html`
            <div class="summary-bar">
                <span> Diff: ${this.labelA} vs ${this.labelB} </span>
                ${d.added.length > 0
                    ? html`<span class="added">+${d.added.length} added</span>`
                    : nothing}
                ${d.removed.length > 0
                    ? html`<span class="removed"
                          >-${d.removed.length} removed</span
                      >`
                    : nothing}
                ${d.changed.length > 0
                    ? html`<span class="changed"
                          >~${d.changed.length} changed</span
                      >`
                    : nothing}
            </div>

            ${d.added.length > 0
                ? html`
                      <div class="diff-header">Added</div>
                      ${d.added.map(
                          (rule) => html`
                              <div class="rule-entry added-entry">
                                  <span class="badge">+</span>
                                  <span class="label">${rule}</span>
                                  <span class="tag">(new rule)</span>
                              </div>
                          `,
                      )}
                  `
                : nothing}
            ${d.removed.length > 0
                ? html`
                      <div class="section-divider"></div>
                      <div class="diff-header">Removed</div>
                      ${d.removed.map(
                          (rule) => html`
                              <div class="rule-entry removed-entry">
                                  <span class="badge">&minus;</span>
                                  <span class="label">${rule}</span>
                                  <span class="tag">(removed)</span>
                              </div>
                          `,
                      )}
                  `
                : nothing}
            ${d.changed.length > 0
                ? html`
                      <div class="section-divider"></div>
                      <div class="diff-header">Changed</div>
                      ${d.changed.map(
                          (change) => html`
                              <div
                                  class="rule-entry changed-entry"
                                  @click=${() =>
                                      this._toggleExpand(change.rule)}
                              >
                                  <span class="badge">~</span>
                                  <span class="label">${change.rule}</span>
                                  <span class="tag">(${change.reason})</span>
                              </div>
                              ${this._expandedRules.has(change.rule)
                                  ? html`
                                        <div class="side-by-side">
                                            <div class="pane-header">
                                                ${this.labelA}
                                            </div>
                                            <div class="pane-header">
                                                ${this.labelB}
                                            </div>
                                            <div class="side-pane before-pane">
                                                ${change.before}
                                            </div>
                                            <div class="side-pane">
                                                ${change.after}
                                            </div>
                                        </div>
                                    `
                                  : nothing}
                          `,
                      )}
                  `
                : nothing}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "gt-diff-view": GtDiffView;
    }
}

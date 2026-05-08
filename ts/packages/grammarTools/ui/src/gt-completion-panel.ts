// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LoadedGrammar, CompletionPreview } from "grammar-tools-core";
import type { GrammarBackend } from "./backend.js";
import { baseStyles } from "./styles.js";

/**
 * Interactive completion preview panel. Types partial input and shows
 * live completions grouped by separator mode.
 * @element gt-completion-panel
 */
@customElement("gt-completion-panel")
export class GtCompletionPanel extends LitElement {
    static override styles = [
        baseStyles,
        css`
            .input-row {
                display: flex;
                gap: 8px;
                margin-bottom: 8px;
            }
            .input-row input {
                flex: 1;
            }
            .status-bar {
                display: flex;
                gap: 12px;
                padding: 4px 8px;
                font-size: 0.9em;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }
            .status-bar .warning {
                color: var(--vscode-editorWarning-foreground, #cca700);
            }
            .groups {
                padding: 8px 0;
            }
            .group-header {
                padding: 4px 8px;
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .completion-item {
                padding: 2px 8px 2px 20px;
                cursor: pointer;
                font-family: var(
                    --gt-mono-font-family,
                    var(
                        --vscode-editor-font-family,
                        "Cascadia Code",
                        Consolas,
                        monospace
                    )
                );
            }
            .completion-item:hover,
            .completion-item.selected {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            .completion-item::before {
                content: "\\25B8 ";
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .property-bar {
                padding: 6px 8px;
                border-top: 1px solid var(--vscode-panel-border, #80808059);
                font-size: 0.9em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .matched-highlight {
                color: var(--vscode-editorInfo-foreground, #3794ff);
                text-decoration: underline;
            }
        `,
    ];

    @property({ attribute: false })
    backend: GrammarBackend | undefined;

    @property({ attribute: false })
    grammar: LoadedGrammar | undefined;

    @property({ type: String, attribute: "initial-input" })
    initialInput: string = "";

    @property({ type: Number, attribute: "debounce-ms" })
    debounceMs: number = 150;

    @state()
    private _input: string = "";

    @state()
    private _preview: CompletionPreview | undefined;

    @state()
    private _error: string = "";

    @state()
    private _loading: boolean = false;

    @state()
    private _selectedIndex: number = -1;

    private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private _initialized = false;

    override connectedCallback(): void {
        super.connectedCallback();
        if (!this._initialized && this.initialInput) {
            this._input = this.initialInput;
            this._initialized = true;
            this._queryCompletion();
        }
    }

    private _onInput(e: Event): void {
        const target = e.target as HTMLInputElement;
        this._input = target.value;
        this._selectedIndex = -1;

        if (this._debounceTimer !== undefined) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(
            () => this._queryCompletion(),
            this.debounceMs,
        );
    }

    private _onKeydown(e: KeyboardEvent): void {
        const items = this._allCompletions();
        if (items.length === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            this._selectedIndex = Math.min(
                this._selectedIndex + 1,
                items.length - 1,
            );
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            this._selectedIndex = Math.max(this._selectedIndex - 1, -1);
        } else if (e.key === "Enter" && this._selectedIndex >= 0) {
            e.preventDefault();
            this._appendCompletion(items[this._selectedIndex]);
        } else if (e.key === "Escape") {
            this._selectedIndex = -1;
        }
    }

    private _allCompletions(): string[] {
        if (!this._preview) return [];
        return this._preview.groups.flatMap((g) => g.completions);
    }

    private _appendCompletion(text: string): void {
        this._input = this._input + " " + text;
        this._selectedIndex = -1;
        this._queryCompletion();
        // Re-focus input after click
        const input = this.renderRoot.querySelector("input");
        input?.focus();
    }

    private async _queryCompletion(): Promise<void> {
        if (!this.backend || !this.grammar) return;
        this._loading = true;
        this._error = "";
        try {
            this._preview = await this.backend.previewCompletion(
                this.grammar,
                this._input,
            );
        } catch (e: unknown) {
            this._error = e instanceof Error ? e.message : String(e);
            this._preview = undefined;
        } finally {
            this._loading = false;
        }
    }

    override render() {
        const p = this._preview;
        const matchLen = p?.matchedPrefixLength ?? 0;
        const matchedText = this._input.slice(0, matchLen);
        const unmatchedText = this._input.slice(matchLen);

        let flatIndex = 0;

        return html`
            <div class="input-row">
                <input
                    type="text"
                    placeholder="Type to see completions..."
                    .value=${this._input}
                    @input=${this._onInput}
                    @keydown=${this._onKeydown}
                />
            </div>

            ${p
                ? html`
                      <div class="status-bar">
                          <span
                              >Matched:
                              <span class="matched-highlight">${matchLen}</span>
                              chars</span
                          >
                          <span
                              >Wildcard:
                              ${p.afterWildcard}${p.afterWildcard !== "none"
                                  ? html` <span class="warning">&#9888;</span>`
                                  : nothing}</span
                          >
                          ${p.directionSensitive
                              ? html`<span class="info-text"
                                    >direction-sensitive</span
                                >`
                              : nothing}
                      </div>
                  `
                : nothing}
            ${this._error
                ? html`<div class="error-text" style="padding: 8px">
                      ${this._error}
                  </div>`
                : nothing}
            ${this._loading
                ? html`<div class="muted" style="padding: 8px">Loading...</div>`
                : nothing}
            ${p && p.groups.length > 0
                ? html`
                      <div class="groups">
                          ${p.groups.map((group) => {
                              const groupStart = flatIndex;
                              flatIndex += group.completions.length;
                              return html`
                                  <div class="group-header">
                                      ${group.separatorMode}
                                  </div>
                                  ${group.completions.map((c, i) => {
                                      const idx = groupStart + i;
                                      return html`<div
                                          class="completion-item ${idx ===
                                          this._selectedIndex
                                              ? "selected"
                                              : ""}"
                                          @click=${() =>
                                              this._appendCompletion(c)}
                                      >
                                          ${c}
                                      </div>`;
                                  })}
                              `;
                          })}
                      </div>
                  `
                : p && p.groups.length === 0 && this._input.length > 0
                  ? html`<div class="empty-state">No completions</div>`
                  : !p && !this._error && !this._loading
                    ? html`<div class="empty-state">
                          Type to see completions
                      </div>`
                    : nothing}
            ${p?.properties && p.properties.length > 0
                ? html`
                      <div class="property-bar">
                          Properties:
                          ${p.properties
                              .flatMap((pp) => pp.propertyNames)
                              .join(", ")}
                      </div>
                  `
                : nothing}

            <div style="display:none">
                <span class="matched-highlight">${matchedText}</span
                >${unmatchedText}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "gt-completion-panel": GtCompletionPanel;
    }
}

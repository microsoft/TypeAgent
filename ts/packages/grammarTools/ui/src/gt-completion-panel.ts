// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
    LoadedGrammar,
    CompletionPreview,
    SeparatorMode,
    CompletionDirection,
    CompletionOptions,
    WildcardPolicy,
    OptionalPolicy,
    RepeatPolicy,
} from "grammar-tools-core";
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
            .input-stack {
                flex: 1;
                position: relative;
            }
            .input-stack input[type="text"] {
                /* In normal flow, sets the container size */
                width: 100%;
                background: transparent;
                color: transparent;
                caret-color: var(--vscode-input-foreground, #cccccc);
                position: relative;
                z-index: 1;
            }
            .input-stack .input-colors {
                /* Absolutely positioned behind the input */
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: var(--vscode-input-background, #3c3c3c);
                color: var(--vscode-input-foreground, #cccccc);
                padding: 4px 8px;
                border: 1px solid var(--vscode-input-border, #3c3c3c);
                font: inherit;
                box-sizing: border-box;
                white-space: nowrap;
                overflow: hidden;
                pointer-events: none;
            }
            .input-stack input[type="text"]::placeholder {
                color: var(--vscode-input-placeholderForeground, #8c8c8c);
            }
            .input-stack .input-colors .matched {
                color: var(--vscode-testing-iconPassed, #73c991);
            }
            .input-stack .input-colors .unmatched {
                text-decoration: wavy underline
                    var(--vscode-editorWarning-foreground, #cca700);
                text-underline-offset: 3px;
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
            .group-selector {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }
            .group-detail {
                padding: 4px 8px;
            }
            .group-detail .label {
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
                margin-top: 4px;
            }
            .group-detail .label:first-child {
                margin-top: 0;
            }
            .group-detail .value {
                padding-left: 8px;
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
            .matched-highlight {
                color: var(--vscode-editorInfo-foreground, #3794ff);
                text-decoration: underline;
            }
            .options-bar {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
                padding: 4px 8px;
                font-size: 0.85em;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }
            .options-bar label {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .options-bar select {
                font-size: inherit;
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

    @state()
    private _selectedGroupIndex: number = 0;

    @state()
    private _groupByMode: boolean = true;

    @state()
    private _direction: CompletionDirection = "forward";

    @state()
    private _wildcardPolicy: WildcardPolicy = "shortest";

    @state()
    private _optionalPolicy: OptionalPolicy = "exhaustive";

    @state()
    private _repeatPolicy: RepeatPolicy = "exhaustive";

    private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private _querySeq: number = 0;

    override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has("grammar") || changed.has("backend")) {
            // Cancel any pending debounced query
            if (this._debounceTimer !== undefined) {
                clearTimeout(this._debounceTimer);
                this._debounceTimer = undefined;
            }
            // Re-query completions when the grammar or backend changes
            // (including the initial load with empty input).
            this._selectedGroupIndex = 0;
            this._selectedIndex = -1;
            this._queryCompletion();
        }
    }

    override connectedCallback(): void {
        super.connectedCallback();
        if (this.initialInput) {
            this._input = this.initialInput;
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
        const items = this._allCompletionItems();
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
            const item = items[this._selectedIndex];
            this._applyCompletion(item.text, item.sep);
        } else if (e.key === "Escape") {
            this._selectedIndex = -1;
        }
    }

    private _allCompletionItems(): { text: string; sep: SeparatorMode }[] {
        if (!this._preview) return [];
        if (!this._groupByMode) {
            return this._preview.groups.flatMap((g) =>
                g.completions.map((c) => ({ text: c, sep: g.separatorMode })),
            );
        }
        const group = this._activeGroup();
        if (!group) return [];
        return group.completions.map((c) => ({
            text: c,
            sep: group.separatorMode,
        }));
    }

    private _activeGroup() {
        if (!this._preview || this._preview.groups.length === 0)
            return undefined;
        const idx = Math.min(
            this._selectedGroupIndex,
            this._preview.groups.length - 1,
        );
        return this._preview.groups[idx];
    }

    private _applyCompletion(text: string, sep: SeparatorMode): void {
        const anchor = this._input.slice(
            0,
            this._preview?.matchedPrefixLength ?? this._input.length,
        );
        const needsSpace =
            sep !== "none" && anchor.length > 0 && !/\s$/.test(anchor);
        this._input = anchor + (needsSpace ? " " : "") + text;
        this._selectedIndex = -1;
        this._queryCompletion();
        // Re-focus input after click
        const input = this.renderRoot.querySelector("input");
        input?.focus();
    }

    private _getCompletionOptions(): CompletionOptions | undefined {
        const opts: CompletionOptions = {};
        if (this._direction !== "forward") opts.direction = this._direction;
        if (this._wildcardPolicy !== "exhaustive")
            opts.wildcardPolicy = this._wildcardPolicy;
        if (this._optionalPolicy !== "exhaustive")
            opts.optionalPolicy = this._optionalPolicy;
        if (this._repeatPolicy !== "exhaustive")
            opts.repeatPolicy = this._repeatPolicy;
        return Object.keys(opts).length > 0 ? opts : undefined;
    }

    private async _queryCompletion(): Promise<void> {
        if (!this.backend || !this.grammar) return;
        const seq = ++this._querySeq;
        this._loading = true;
        this._error = "";
        try {
            const result = await this.backend.previewCompletion(
                this.grammar,
                this._input,
                this._getCompletionOptions(),
            );
            if (seq !== this._querySeq) return; // stale response
            this._preview = result;
        } catch (e: unknown) {
            if (seq !== this._querySeq) return;
            this._error = e instanceof Error ? e.message : String(e);
            this._preview = undefined;
        } finally {
            if (seq === this._querySeq) {
                this._loading = false;
            }
        }
    }

    private _renderActiveGroup(p: CompletionPreview) {
        const group = this._activeGroup();
        if (!group) return nothing;

        const props = p.properties?.filter(
            (pp) => pp.separatorMode === group.separatorMode,
        );
        const propNames = props?.flatMap((pp) => pp.propertyNames);

        return html`
            <div class="group-detail">
                <div class="label">
                    <strong>Separator:</strong> ${group.separatorMode}
                </div>
                ${propNames && propNames.length > 0
                    ? html`<div class="label">
                          <strong>Properties:</strong>
                          ${propNames.join(", ")}
                      </div>`
                    : nothing}
                <div class="label">
                    <strong>Completions</strong>
                    (${group.completions.length}):
                </div>
                ${group.completions.map(
                    (c, i) =>
                        html`<div
                            class="completion-item ${i === this._selectedIndex
                                ? "selected"
                                : ""}"
                            @click=${() =>
                                this._applyCompletion(c, group.separatorMode)}
                        >
                            ${c}
                        </div>`,
                )}
            </div>
        `;
    }

    private _renderFlat(p: CompletionPreview) {
        const allItems = p.groups.flatMap((g) =>
            g.completions.map((c) => ({ text: c, sep: g.separatorMode })),
        );
        const allPropNames = [
            ...new Set(p.properties?.flatMap((pp) => pp.propertyNames) ?? []),
        ];
        return html`
            <div class="group-detail">
                ${allPropNames.length > 0
                    ? html`<div class="label">
                          <strong>Properties:</strong>
                          ${allPropNames.join(", ")}
                      </div>`
                    : nothing}
                <div class="label">
                    <strong>Completions</strong> (${allItems.length}):
                </div>
                ${allItems.map(
                    (item, i) =>
                        html`<div
                            class="completion-item ${i === this._selectedIndex
                                ? "selected"
                                : ""}"
                            @click=${() =>
                                this._applyCompletion(item.text, item.sep)}
                        >
                            ${item.text}
                        </div>`,
                )}
            </div>
        `;
    }

    override render() {
        const p = this._preview;
        const matchLen = p?.matchedPrefixLength ?? 0;
        const matchedText = this._input.slice(0, matchLen);
        const unmatchedText = this._input.slice(matchLen);
        const hasInput = this._input.length > 0;

        return html`
            <div class="input-row">
                <div class="input-stack">
                    <input
                        type="text"
                        placeholder="Type to see completions..."
                        .value=${this._input}
                        @input=${this._onInput}
                        @keydown=${this._onKeydown}
                    />
                    <div class="input-colors">
                        ${hasInput && p
                            ? html`<span class="matched">${matchedText}</span
                                  ><span class="unmatched"
                                      >${unmatchedText}</span
                                  >`
                            : this._input}
                    </div>
                </div>
            </div>

            <div class="options-bar">
                <label
                    ><strong>Direction:</strong>
                    <select
                        @change=${(e: Event) => {
                            this._direction = (e.target as HTMLSelectElement)
                                .value as CompletionDirection;
                            this._queryCompletion();
                        }}
                    >
                        <option
                            value="forward"
                            ?selected=${this._direction === "forward"}
                        >
                            forward
                        </option>
                        <option
                            value="backward"
                            ?selected=${this._direction === "backward"}
                        >
                            backward
                        </option>
                    </select></label
                >
                <label
                    ><strong>Wildcard:</strong>
                    <select
                        @change=${(e: Event) => {
                            this._wildcardPolicy = (
                                e.target as HTMLSelectElement
                            ).value as WildcardPolicy;
                            this._queryCompletion();
                        }}
                    >
                        <option
                            value="exhaustive"
                            ?selected=${this._wildcardPolicy === "exhaustive"}
                        >
                            exhaustive
                        </option>
                        <option
                            value="shortest"
                            ?selected=${this._wildcardPolicy === "shortest"}
                        >
                            shortest
                        </option>
                    </select></label
                >
                <label
                    ><strong>Optional:</strong>
                    <select
                        @change=${(e: Event) => {
                            this._optionalPolicy = (
                                e.target as HTMLSelectElement
                            ).value as OptionalPolicy;
                            this._queryCompletion();
                        }}
                    >
                        <option
                            value="exhaustive"
                            ?selected=${this._optionalPolicy === "exhaustive"}
                        >
                            exhaustive
                        </option>
                        <option
                            value="preferTake"
                            ?selected=${this._optionalPolicy === "preferTake"}
                        >
                            preferTake
                        </option>
                        <option
                            value="preferSkip"
                            ?selected=${this._optionalPolicy === "preferSkip"}
                        >
                            preferSkip
                        </option>
                    </select></label
                >
                <label
                    ><strong>Repeat:</strong>
                    <select
                        @change=${(e: Event) => {
                            this._repeatPolicy = (e.target as HTMLSelectElement)
                                .value as RepeatPolicy;
                            this._queryCompletion();
                        }}
                    >
                        <option
                            value="exhaustive"
                            ?selected=${this._repeatPolicy === "exhaustive"}
                        >
                            exhaustive
                        </option>
                        <option
                            value="greedy"
                            ?selected=${this._repeatPolicy === "greedy"}
                        >
                            greedy
                        </option>
                        <option
                            value="nonGreedy"
                            ?selected=${this._repeatPolicy === "nonGreedy"}
                        >
                            nonGreedy
                        </option>
                    </select></label
                >
            </div>

            ${p
                ? html`
                      <div class="status-bar">
                          <span
                              ><strong>Matched:</strong>
                              <span class="matched-highlight">${matchLen}</span>
                              / ${this._input.length} chars</span
                          >
                          <span
                              ><strong>Wildcard:</strong>
                              ${p.afterWildcard}</span
                          >
                          ${p.directionSensitive
                              ? html`<span
                                    ><strong>Direction:</strong> sensitive</span
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
                          ${p.groups.length > 1
                              ? html`<div class="group-selector">
                                    <label
                                        ><input
                                            type="checkbox"
                                            .checked=${this._groupByMode}
                                            @change=${(e: Event) => {
                                                this._groupByMode = (
                                                    e.target as HTMLInputElement
                                                ).checked;
                                                this._selectedIndex = -1;
                                            }}
                                        />
                                        Group by separator</label
                                    >
                                    ${this._groupByMode
                                        ? html`<select
                                              @change=${(e: Event) => {
                                                  this._selectedGroupIndex = (
                                                      e.target as HTMLSelectElement
                                                  ).selectedIndex;
                                                  this._selectedIndex = -1;
                                              }}
                                          >
                                              ${p.groups.map(
                                                  (g, i) => html`
                                                      <option
                                                          ?selected=${i ===
                                                          this
                                                              ._selectedGroupIndex}
                                                      >
                                                          ${g.separatorMode}
                                                      </option>
                                                  `,
                                              )}
                                          </select>`
                                        : nothing}
                                </div>`
                              : nothing}
                          ${this._groupByMode
                              ? this._renderActiveGroup(p)
                              : this._renderFlat(p)}
                      </div>
                  `
                : p && p.groups.length === 0 && this._input.length > 0
                  ? html`<div class="empty-state">No completions</div>`
                  : !p && !this._error && !this._loading
                    ? html`<div class="empty-state">
                          Type to see completions
                      </div>`
                    : nothing}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "gt-completion-panel": GtCompletionPanel;
    }
}

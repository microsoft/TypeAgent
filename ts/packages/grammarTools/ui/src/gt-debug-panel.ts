// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
    LoadedGrammar,
    LoadResult,
    CoverageReport,
    GrammarDiff,
    SourceLocation,
} from "grammar-tools-core";
import type { GrammarBackend } from "./backend.js";
import { baseStyles } from "./styles.js";

// Ensure child components are registered
import "./gt-source-view.js";
import "./gt-completion-panel.js";
import "./gt-trace-timeline.js";
import "./gt-coverage-heatmap.js";
import "./gt-diff-view.js";

type TabId = "completions" | "trace" | "coverage" | "diff";

/**
 * Composite debug panel composing D.1-D.5 with a grammar picker
 * and tab bar. This is the component that hosts actually mount.
 * @element gt-debug-panel
 */
@customElement("gt-debug-panel")
export class GtDebugPanel extends LitElement {
    static override styles = [
        baseStyles,
        css`
            .panel {
                display: flex;
                flex-direction: column;
                height: 100%;
            }

            .picker-section {
                padding: 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }

            .tab-bar {
                display: flex;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
            }
            .tab {
                padding: 8px 16px;
                cursor: pointer;
                border: none;
                background: transparent;
                color: var(--vscode-descriptionForeground, #9d9d9d);
                font-size: inherit;
                font-family: inherit;
                border-bottom: 2px solid transparent;
            }
            .tab:hover {
                color: var(--vscode-foreground, #cccccc);
            }
            .tab.active {
                color: var(--vscode-foreground, #cccccc);
                border-bottom-color: var(--vscode-focusBorder, #007fd4);
            }

            .tab-content {
                flex: 1;
                overflow: auto;
                padding: 8px;
            }

            .corpus-input {
                margin-bottom: 8px;
            }
            .corpus-input textarea {
                width: 100%;
                min-height: 60px;
                resize: vertical;
            }
            .corpus-actions {
                display: flex;
                gap: 8px;
                margin-top: 4px;
            }

            .diff-pickers {
                display: flex;
                gap: 8px;
                align-items: center;
                margin-bottom: 8px;
                flex-wrap: wrap;
            }
            .diff-pickers input {
                flex: 1;
                min-width: 150px;
            }

            .notice {
                padding: 12px;
                text-align: center;
                color: var(--vscode-descriptionForeground, #9d9d9d);
                font-style: italic;
            }
        `,
    ];

    @property({ attribute: false })
    backend: GrammarBackend | undefined;

    @property({ type: Array })
    agents: string[] = [];

    @property({ type: Boolean, attribute: "live-available" })
    liveAvailable: boolean = false;

    @property({ type: Boolean, attribute: "show-picker" })
    showPicker: boolean = true;

    @property({ type: Array, attribute: "enabled-tabs" })
    enabledTabs: TabId[] = ["completions", "trace", "coverage", "diff"];

    @property({ attribute: false })
    onSourceClick: ((loc: SourceLocation) => void) | undefined;

    @state()
    private _grammar: LoadedGrammar | undefined;

    /** Allow external code to set the grammar directly. */
    set grammar(g: LoadedGrammar | undefined) {
        this._grammar = g;
        this._coverageReport = undefined;
        this._diffResult = undefined;
    }

    get grammar(): LoadedGrammar | undefined {
        return this._grammar;
    }

    @state()
    private _activeTab: TabId = "completions";

    @state()
    private _corpusText: string = "";

    @state()
    private _coverageReport: CoverageReport | undefined;

    @state()
    private _coverageLoading: boolean = false;

    @state()
    private _diffBeforePath: string = "";

    @state()
    private _diffResult: GrammarDiff | undefined;

    @state()
    private _diffLoading: boolean = false;

    private _onGrammarLoaded(result: LoadResult): void {
        if (result.ok) {
            this._grammar = result.grammar;
            // Reset dependent state
            this._coverageReport = undefined;
            this._diffResult = undefined;
        }
    }

    private async _runCoverage(): Promise<void> {
        if (!this.backend || !this._grammar || !this._corpusText) return;
        const inputs = this._corpusText
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
        if (inputs.length === 0) return;

        this._coverageLoading = true;
        try {
            this._coverageReport = await this.backend.computeCoverage(
                this._grammar,
                inputs,
            );
        } catch {
            // Coverage view will show empty state
            this._coverageReport = undefined;
        } finally {
            this._coverageLoading = false;
        }
    }

    private async _runDiff(): Promise<void> {
        if (!this.backend || !this._grammar || !this._diffBeforePath) return;
        this._diffLoading = true;
        try {
            const beforeResult = await this.backend.loadGrammarFromFile(
                this._diffBeforePath,
            );
            if (beforeResult.ok) {
                this._diffResult = await this.backend.diffGrammars(
                    beforeResult.grammar,
                    this._grammar,
                );
            }
        } catch {
            this._diffResult = undefined;
        } finally {
            this._diffLoading = false;
        }
    }

    override render() {
        const tabs = this.enabledTabs;
        if (!tabs.includes(this._activeTab) && tabs.length > 0) {
            this._activeTab = tabs[0];
        }

        return html`
            <div class="panel">
                ${this.showPicker
                    ? html`<div class="picker-section">
                          <gt-source-view
                              .backend=${this.backend}
                              .agents=${this.agents}
                              ?live-available=${this.liveAvailable}
                              .onLoad=${(r: LoadResult) =>
                                  this._onGrammarLoaded(r)}
                          ></gt-source-view>
                      </div>`
                    : nothing}

                <div class="tab-bar">
                    ${tabs.map(
                        (tab) => html`
                            <button
                                class="tab ${this._activeTab === tab
                                    ? "active"
                                    : ""}"
                                @click=${() => {
                                    this._activeTab = tab;
                                }}
                            >
                                ${this._tabLabel(tab)}
                            </button>
                        `,
                    )}
                </div>

                <div class="tab-content">${this._renderActiveTab()}</div>
            </div>
        `;
    }

    private _tabLabel(tab: TabId): string {
        switch (tab) {
            case "completions":
                return "Completions";
            case "trace":
                return "Trace";
            case "coverage":
                return "Coverage";
            case "diff":
                return "Diff";
        }
    }

    private _renderActiveTab() {
        if (!this._grammar) {
            return html`<div class="notice">
                ${this.showPicker
                    ? "Load a grammar to get started"
                    : "Waiting for grammar..."}
            </div>`;
        }

        switch (this._activeTab) {
            case "completions":
                return html`<gt-completion-panel
                    .backend=${this.backend}
                    .grammar=${this._grammar}
                ></gt-completion-panel>`;

            case "trace":
                if (!this._grammar.debugInfo) {
                    return html`<div class="notice">
                        Debug info not available for this grammar source. Load
                        from file or agent for full trace.
                    </div>`;
                }
                return html`<gt-trace-timeline
                    .backend=${this.backend}
                    .grammar=${this._grammar}
                    .onSourceClick=${this.onSourceClick}
                ></gt-trace-timeline>`;

            case "coverage":
                return html`
                    <div class="corpus-input">
                        <textarea
                            placeholder="Paste corpus inputs, one per line..."
                            .value=${this._corpusText}
                            @input=${(e: Event) => {
                                this._corpusText = (
                                    e.target as HTMLTextAreaElement
                                ).value;
                            }}
                        ></textarea>
                        <div class="corpus-actions">
                            <button
                                @click=${this._runCoverage}
                                ?disabled=${this._coverageLoading ||
                                !this._corpusText}
                            >
                                Run Coverage
                            </button>
                            ${this._coverageLoading
                                ? html`<span class="muted">Computing...</span>`
                                : nothing}
                        </div>
                    </div>
                    <gt-coverage-heatmap
                        .report=${this._coverageReport}
                        .onSourceClick=${this.onSourceClick}
                    ></gt-coverage-heatmap>
                `;

            case "diff":
                return html`
                    <div class="diff-pickers">
                        <span class="muted">Before:</span>
                        <input
                            type="text"
                            placeholder="Path to earlier grammar..."
                            .value=${this._diffBeforePath}
                            @input=${(e: Event) => {
                                this._diffBeforePath = (
                                    e.target as HTMLInputElement
                                ).value;
                            }}
                        />
                        <span class="muted">After: current</span>
                        <button
                            @click=${this._runDiff}
                            ?disabled=${this._diffLoading ||
                            !this._diffBeforePath}
                        >
                            Diff
                        </button>
                        ${this._diffLoading
                            ? html`<span class="muted">Computing...</span>`
                            : nothing}
                    </div>
                    <gt-diff-view
                        .diff=${this._diffResult}
                        .onSourceClick=${this.onSourceClick}
                    ></gt-diff-view>
                `;
        }
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "gt-debug-panel": GtDebugPanel;
    }
}

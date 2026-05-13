// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LoadResult } from "grammar-tools-core";
import type { GrammarBackend } from "./backend.js";
import { baseStyles } from "./styles.js";

type SourceMode = "file" | "agent" | "live";

/**
 * Grammar source picker: file, agent, or live dispatcher snapshot.
 * @element gt-source-view
 */
@customElement("gt-source-view")
export class GtSourceView extends LitElement {
    static override styles = [
        baseStyles,
        css`
            .mode-row {
                display: flex;
                gap: 16px;
                padding: 8px 0;
                align-items: center;
            }
            .mode-row label {
                display: flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
            }
            .panel {
                padding: 8px 0;
            }
            .panel-row {
                display: flex;
                gap: 8px;
                align-items: center;
            }
            .panel-row input[type="text"] {
                flex: 1;
            }
            select {
                background: var(--vscode-input-background, #3c3c3c);
                color: var(--vscode-input-foreground, #cccccc);
                border: 1px solid var(--vscode-input-border, #3c3c3c);
                padding: 4px 8px;
                font-size: inherit;
                font-family: inherit;
                min-width: 160px;
            }
            select:focus {
                border-color: var(--vscode-focusBorder, #007fd4);
            }
            .status {
                padding: 4px 0;
                font-size: 0.9em;
            }
        `,
    ];

    @property({ attribute: false })
    backend: GrammarBackend | undefined;

    @property({ type: Array })
    agents: string[] = [];

    @property({ type: Boolean, attribute: "live-available" })
    liveAvailable: boolean = false;

    @property({ attribute: false })
    onLoad: ((result: LoadResult) => void) | undefined;

    @property({ attribute: false })
    onError: ((error: Error) => void) | undefined;

    @state()
    private _mode: SourceMode = "file";

    @state()
    private _filePath: string = "";

    @state()
    private _selectedAgent: string = "";

    @state()
    private _loading: boolean = false;

    @state()
    private _error: string = "";

    @state()
    private _status: string = "";

    private _setMode(mode: SourceMode): void {
        this._mode = mode;
        this._error = "";
        this._status = "";
    }

    private async _load(): Promise<void> {
        if (!this.backend) return;
        this._loading = true;
        this._error = "";
        this._status = "";

        try {
            let result: LoadResult;
            switch (this._mode) {
                case "file":
                    if (!this._filePath) {
                        this._error = "Enter a file path";
                        return;
                    }
                    result = await this.backend.loadGrammarFromFile(
                        this._filePath,
                    );
                    break;
                case "agent":
                    if (!this._selectedAgent) {
                        this._error = "Select an agent";
                        return;
                    }
                    result = await this.backend.loadGrammarFromAgent(
                        this._selectedAgent,
                    );
                    break;
                case "live":
                    result = await this.backend.loadGrammarFromSnapshot({
                        grammar: {},
                    });
                    break;
            }

            if (result.ok) {
                this._status = "Loaded successfully";
            } else {
                this._status = `${result.diagnostics.length} error(s)`;
            }
            this.onLoad?.(result);
        } catch (e: unknown) {
            const error = e instanceof Error ? e : new Error(String(e));
            this._error = error.message;
            this.onError?.(error);
        } finally {
            this._loading = false;
        }
    }

    private _onBrowse(): void {
        this.dispatchEvent(
            new CustomEvent("browse", {
                bubbles: true,
                composed: true,
            }),
        );
    }

    override render() {
        return html`
            <div class="mode-row">
                <span>Source:</span>
                ${this._radioButton("file", "File")}
                ${this._radioButton("agent", "Agent")}
                ${this.liveAvailable
                    ? this._radioButton("live", "Live")
                    : nothing}
            </div>

            ${this._mode === "file" ? this._renderFilePanel() : nothing}
            ${this._mode === "agent" ? this._renderAgentPanel() : nothing}
            ${this._mode === "live" ? this._renderLivePanel() : nothing}
            ${this._error
                ? html`<div class="status error-text">${this._error}</div>`
                : nothing}
            ${this._status
                ? html`<div class="status info-text">${this._status}</div>`
                : nothing}
        `;
    }

    private _radioButton(mode: SourceMode, label: string) {
        return html`
            <label>
                <input
                    type="radio"
                    name="source-mode"
                    .checked=${this._mode === mode}
                    @change=${() => this._setMode(mode)}
                />
                ${label}
            </label>
        `;
    }

    private _renderFilePanel() {
        return html`
            <div class="panel">
                <div class="panel-row">
                    <input
                        type="text"
                        placeholder="/path/to/grammar.agr"
                        .value=${this._filePath}
                        @input=${(e: Event) => {
                            this._filePath = (
                                e.target as HTMLInputElement
                            ).value;
                        }}
                        @keydown=${(e: KeyboardEvent) => {
                            if (e.key === "Enter") this._load();
                        }}
                    />
                    <button class="secondary" @click=${this._onBrowse}>
                        📂
                    </button>
                    <button @click=${this._load} ?disabled=${this._loading}>
                        Load
                    </button>
                </div>
            </div>
        `;
    }

    private _renderAgentPanel() {
        return html`
            <div class="panel">
                <div class="panel-row">
                    <select
                        @change=${(e: Event) => {
                            this._selectedAgent = (
                                e.target as HTMLSelectElement
                            ).value;
                        }}
                    >
                        <option value="">Select agent...</option>
                        ${this.agents.map(
                            (a) =>
                                html`<option
                                    value=${a}
                                    ?selected=${this._selectedAgent === a}
                                >
                                    ${a}
                                </option>`,
                        )}
                    </select>
                    <button @click=${this._load} ?disabled=${this._loading}>
                        Load
                    </button>
                </div>
            </div>
        `;
    }

    private _renderLivePanel() {
        return html`
            <div class="panel">
                <div class="panel-row">
                    <span class="muted"
                        >Session: current (requires running dispatcher)</span
                    >
                    <button @click=${this._load} ?disabled=${this._loading}>
                        Load
                    </button>
                </div>
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "gt-source-view": GtSourceView;
    }
}

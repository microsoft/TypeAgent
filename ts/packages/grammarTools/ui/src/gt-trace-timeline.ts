// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
    LoadedGrammar,
    MatchTrace,
    TraceEvent,
    PartMatchedEvent,
    SourceLocation,
} from "grammar-tools-core";
import type { GrammarBackend } from "./backend.js";
import { baseStyles } from "./styles.js";

type EventKindFilter =
    | "ruleEntered"
    | "ruleExited"
    | "partAttempted"
    | "partMatched"
    | "partFailed"
    | "backtrack";

const EVENT_ICONS: Record<string, string> = {
    ruleEntered: "\u25B6",
    ruleExited: "\u25C0",
    partAttempted: "\u25C6",
    partMatched: "\u2713",
    partFailed: "\u2717",
    backtrack: "\u21A9",
};

const EVENT_COLORS: Record<string, string> = {
    ruleEntered: "var(--vscode-editorInfo-foreground, #3794ff)",
    ruleExited: "var(--vscode-editorInfo-foreground, #3794ff)",
    partAttempted: "var(--vscode-descriptionForeground, #9d9d9d)",
    partMatched: "#4ec9b0",
    partFailed: "var(--vscode-errorForeground, #f48771)",
    backtrack: "var(--vscode-editorWarning-foreground, #cca700)",
};

/**
 * Step-by-step match trace table.
 * @element gt-trace-timeline
 */
@customElement("gt-trace-timeline")
export class GtTraceTimeline extends LitElement {
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
            .filter-bar {
                display: flex;
                gap: 4px;
                padding: 4px 0;
                flex-wrap: wrap;
            }
            .filter-btn {
                font-size: 0.8em;
                padding: 2px 8px;
                border-radius: 3px;
                cursor: pointer;
                border: 1px solid var(--vscode-panel-border, #80808059);
                background: transparent;
                color: inherit;
            }
            .filter-btn.active {
                background: var(--vscode-badge-background, #4d4d4d);
                color: var(--vscode-badge-foreground, #ffffff);
            }

            .input-display {
                padding: 6px 8px;
                font-family: var(
                    --gt-mono-font-family,
                    var(--vscode-editor-font-family, monospace)
                );
                background: var(--vscode-input-background, #3c3c3c);
                margin-bottom: 4px;
                white-space: pre;
                position: relative;
                min-height: 1.4em;
            }
            .input-display .highlight {
                background: rgba(55, 148, 255, 0.3);
            }

            table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.9em;
            }
            th {
                text-align: left;
                padding: 4px 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
                color: var(--vscode-descriptionForeground, #9d9d9d);
                font-weight: normal;
                font-size: 0.85em;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            td {
                padding: 2px 8px;
                vertical-align: top;
                border-bottom: 1px solid
                    var(--vscode-panel-border, rgba(128, 128, 128, 0.15));
            }
            tr:hover td {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            tr.selected td {
                background: var(
                    --vscode-list-activeSelectionBackground,
                    #094771
                );
            }
            .event-icon {
                font-weight: bold;
                width: 2em;
                text-align: center;
            }
            .rule-link {
                cursor: pointer;
                color: var(--vscode-textLink-foreground, #3794ff);
            }
            .rule-link:hover {
                text-decoration: underline;
            }
            .depth-indent {
                display: inline-block;
            }
            .slots {
                padding: 2px 8px 2px 40px;
                font-family: var(--gt-mono-font-family, monospace);
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .summary-bar {
                padding: 6px 8px;
                font-size: 0.9em;
                border-top: 1px solid var(--vscode-panel-border, #80808059);
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
        `,
    ];

    @property({ attribute: false })
    backend: GrammarBackend | undefined;

    @property({ attribute: false })
    grammar: LoadedGrammar | undefined;

    @property({ type: String, attribute: "initial-input" })
    initialInput: string = "";

    @property({ attribute: false })
    onSourceClick: ((loc: SourceLocation) => void) | undefined;

    @state()
    private _input: string = "";

    @state()
    private _trace: MatchTrace | undefined;

    @state()
    private _error: string = "";

    @state()
    private _loading: boolean = false;

    @state()
    private _selectedRow: number = -1;

    @state()
    private _hoveredRow: number = -1;

    @state()
    private _expandedRows: Set<number> = new Set();

    @state()
    private _hiddenKinds: Set<EventKindFilter> = new Set();

    private _initialized = false;

    override connectedCallback(): void {
        super.connectedCallback();
        if (!this._initialized && this.initialInput) {
            this._input = this.initialInput;
            this._initialized = true;
        }
    }

    private async _runTrace(): Promise<void> {
        if (!this.backend || !this.grammar || !this._input) return;
        this._loading = true;
        this._error = "";
        try {
            this._trace = await this.backend.traceMatch(
                this.grammar,
                this._input,
            );
        } catch (e: unknown) {
            this._error = e instanceof Error ? e.message : String(e);
            this._trace = undefined;
        } finally {
            this._loading = false;
        }
    }

    private _onInputKeydown(e: KeyboardEvent): void {
        if (e.key === "Enter") {
            e.preventDefault();
            this._runTrace();
        }
    }

    private _toggleKind(kind: EventKindFilter): void {
        const next = new Set(this._hiddenKinds);
        if (next.has(kind)) {
            next.delete(kind);
        } else {
            next.add(kind);
        }
        this._hiddenKinds = next;
    }

    private _toggleExpand(idx: number): void {
        const next = new Set(this._expandedRows);
        if (next.has(idx)) {
            next.delete(idx);
        } else {
            next.add(idx);
        }
        this._expandedRows = next;
    }

    private _visibleEvents(): Array<{ event: TraceEvent; index: number }> {
        if (!this._trace) return [];
        return this._trace.events
            .map((event, index) => ({ event, index }))
            .filter(
                ({ event }) =>
                    !this._hiddenKinds.has(event.kind as EventKindFilter),
            );
    }

    private _highlightRange(): { start: number; end: number } | undefined {
        if (!this._trace || this._hoveredRow < 0) return undefined;
        const event = this._trace.events[this._hoveredRow];
        if (!event) return undefined;
        const start = (event as { inputPos?: number }).inputPos ?? 0;
        const end = (event as { endPos?: number }).endPos ?? start;
        return { start, end };
    }

    private _renderInputDisplay() {
        const text = this._trace?.input ?? this._input;
        const range = this._highlightRange();
        if (!range || range.start === range.end) {
            return html`<div class="input-display">${text}</div>`;
        }
        const before = text.slice(0, range.start);
        const highlighted = text.slice(range.start, range.end);
        const after = text.slice(range.end);
        return html`<div class="input-display">
            ${before}<span class="highlight">${highlighted}</span>${after}
        </div>`;
    }

    private _eventDetail(event: TraceEvent): string {
        switch (event.kind) {
            case "ruleEntered":
                return `depth ${event.depth}`;
            case "ruleExited":
                return `result: ${event.result}`;
            case "partMatched":
                return `-> pos ${event.endPos}`;
            case "partAttempted":
                return event.partKind;
            default:
                return "";
        }
    }

    override render() {
        const visible = this._visibleEvents();
        const allKinds: EventKindFilter[] = [
            "ruleEntered",
            "ruleExited",
            "partAttempted",
            "partMatched",
            "partFailed",
            "backtrack",
        ];

        return html`
            <div class="input-row">
                <input
                    type="text"
                    placeholder="Enter input to trace..."
                    .value=${this._input}
                    @input=${(e: Event) => {
                        this._input = (e.target as HTMLInputElement).value;
                    }}
                    @keydown=${this._onInputKeydown}
                />
                <button
                    @click=${this._runTrace}
                    ?disabled=${this._loading || !this._input}
                >
                    Trace
                </button>
            </div>

            ${this._trace ? this._renderInputDisplay() : nothing}
            ${this._error
                ? html`<div class="error-text" style="padding: 8px">
                      ${this._error}
                  </div>`
                : nothing}
            ${this._loading
                ? html`<div class="muted" style="padding: 8px">Tracing...</div>`
                : nothing}
            ${this._trace
                ? html`
                      <div class="filter-bar">
                          ${allKinds.map(
                              (kind) => html`
                                  <button
                                      class="filter-btn ${this._hiddenKinds.has(
                                          kind,
                                      )
                                          ? ""
                                          : "active"}"
                                      @click=${() => this._toggleKind(kind)}
                                  >
                                      <span style="color: ${EVENT_COLORS[kind]}"
                                          >${EVENT_ICONS[kind]}</span
                                      >
                                      ${kind}
                                  </button>
                              `,
                          )}
                      </div>

                      <table>
                          <thead>
                              <tr>
                                  <th>#</th>
                                  <th>Event</th>
                                  <th>Rule</th>
                                  <th>Pos</th>
                                  <th>Detail</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${visible.map(({ event, index }) => {
                                  const depth =
                                      event.kind === "ruleEntered"
                                          ? event.depth
                                          : 0;
                                  const ruleName =
                                      event.kind !== "backtrack"
                                          ? event.rule
                                          : undefined;
                                  const hasSlots =
                                      event.kind === "partMatched" &&
                                      "slots" in event;
                                  return html`
                                      <tr
                                          class="${this._selectedRow === index
                                              ? "selected"
                                              : ""}"
                                          @mouseenter=${() => {
                                              this._hoveredRow = index;
                                          }}
                                          @mouseleave=${() => {
                                              this._hoveredRow = -1;
                                          }}
                                          @click=${() => {
                                              this._selectedRow = index;
                                              if (hasSlots)
                                                  this._toggleExpand(index);
                                          }}
                                      >
                                          <td>${index + 1}</td>
                                          <td>
                                              <span
                                                  class="event-icon"
                                                  style="color: ${EVENT_COLORS[
                                                      event.kind
                                                  ]}"
                                                  >${EVENT_ICONS[
                                                      event.kind
                                                  ]}</span
                                              >
                                              ${event.kind}
                                          </td>
                                          <td>
                                              <span
                                                  class="depth-indent"
                                                  style="width: ${depth * 12}px"
                                              ></span>
                                              ${this._renderRuleLink(
                                                  ruleName ?? "",
                                              )}
                                          </td>
                                          <td>${event.inputPos}</td>
                                          <td>${this._eventDetail(event)}</td>
                                      </tr>
                                      ${hasSlots &&
                                      this._expandedRows.has(index)
                                          ? html`<tr>
                                                <td colspan="5">
                                                    <div class="slots">
                                                        slots:
                                                        ${JSON.stringify(
                                                            (
                                                                event as PartMatchedEvent & {
                                                                    slots: unknown;
                                                                }
                                                            ).slots,
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>`
                                          : nothing}
                                  `;
                              })}
                          </tbody>
                      </table>

                      <div class="summary-bar">
                          ${this._trace.events.length} events,
                          ${this._trace.events.filter(
                              (e) => e.kind === "ruleEntered",
                          ).length}
                          rules entered,
                          ${this._trace.events.filter(
                              (e) => e.kind === "backtrack",
                          ).length}
                          backtracks, result:
                          <strong>${this._trace.result}</strong>
                      </div>
                  `
                : !this._loading && !this._error
                  ? html`<div class="empty-state">
                        Enter input and click Trace
                    </div>`
                  : nothing}
        `;
    }

    private _renderRuleLink(ruleName: string) {
        if (!this.onSourceClick || !this.grammar?.debugInfo) {
            return html`<span>${ruleName}</span>`;
        }
        const loc = this.grammar.debugInfo.rules.get(ruleName);
        if (!loc) return html`<span>${ruleName}</span>`;
        return html`<span
            class="rule-link"
            @click=${(e: Event) => {
                e.stopPropagation();
                this.onSourceClick!(loc);
            }}
            >${ruleName}</span
        >`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "gt-trace-timeline": GtTraceTimeline;
    }
}

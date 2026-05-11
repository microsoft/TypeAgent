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
    WildcardPolicy,
    OptionalPolicy,
    RepeatPolicy,
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

const EVENT_LABELS: Record<string, string> = {
    ruleEntered: "enter",
    ruleExited: "exit",
    partAttempted: "try",
    partMatched: "match",
    partFailed: "fail",
    backtrack: "back",
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
            .options-panel {
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
                font-size: 0.85em;
                margin-bottom: 8px;
            }
            .options-panel summary {
                padding: 4px 8px;
                cursor: pointer;
                user-select: none;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .options-panel summary:hover {
                color: var(--vscode-foreground, #cccccc);
            }
            .options-bar {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
                padding: 4px 8px 8px;
            }
            .options-bar label {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .options-bar select {
                font-size: inherit;
            }
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
            .filter-separator {
                width: 1px;
                align-self: stretch;
                background: var(--vscode-panel-border, #80808059);
                margin: 2px 4px;
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
            tr.row-matched:not(.selected):not(:hover) td {
                background: rgba(78, 201, 176, 0.06);
            }
            tr.row-failed:not(.selected):not(:hover) td {
                background: rgba(244, 135, 113, 0.06);
            }
            tr.row-backtrack:not(.selected):not(:hover) td {
                background: rgba(204, 167, 0, 0.04);
            }
            .matched-text {
                font-family: var(
                    --gt-mono-font-family,
                    var(--vscode-editor-font-family, monospace)
                );
                font-size: 0.9em;
                color: #4ec9b0;
                max-width: 20em;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                display: inline-block;
                vertical-align: bottom;
            }
            .part-label {
                color: var(--vscode-descriptionForeground, #9d9d9d);
                font-size: 0.9em;
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
            .group-toggle {
                display: inline-block;
                width: 1.2em;
                font-size: 1.3em;
                line-height: 1;
                vertical-align: middle;
                cursor: pointer;
                user-select: none;
                color: var(--vscode-descriptionForeground, #9d9d9d);
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
    private _collapsedGroups: Set<number> = new Set();

    @state()
    private _hiddenKinds: Set<EventKindFilter> = new Set();

    @state()
    private _wildcardPolicy: WildcardPolicy = "exhaustive";

    @state()
    private _optionalPolicy: OptionalPolicy = "exhaustive";

    @state()
    private _repeatPolicy: RepeatPolicy = "exhaustive";

    @state()
    private _pathFilter: "all" | "success" | "failure" = "all";

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

    private _toggleCollapse(idx: number): void {
        const next = new Set(this._collapsedGroups);
        if (next.has(idx)) {
            next.delete(idx);
        } else {
            next.add(idx);
        }
        this._collapsedGroups = next;
    }

    private _visibleEvents(): Array<{
        event: TraceEvent;
        index: number;
        depth: number;
        groupSize: number; // >0 for ruleEntered with children
        attemptPos?: number; // inputPos from preceding partAttempted
    }> {
        if (!this._trace) return [];
        const events = this._trace.events;
        const n = events.length;

        // Compute depth for every event.  ruleEntered carries an
        // explicit depth and sits at that level; events that follow
        // (partAttempted, partMatched, etc.) are *inside* the rule,
        // so they render one level deeper.
        const depths: number[] = new Array(n);
        let curDepth = 0;
        for (let i = 0; i < n; i++) {
            const e = events[i];
            if (e.kind === "ruleEntered") {
                curDepth = e.depth;
                depths[i] = curDepth;
            } else {
                depths[i] = curDepth + 1;
            }
        }

        // For each ruleEntered, compute how many events belong to
        // its group (events at a strictly greater depth).
        const groupSize: number[] = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            if (events[i].kind === "ruleEntered") {
                const d = depths[i];
                let j = i + 1;
                while (j < n && depths[j] > d) j++;
                groupSize[i] = j - i - 1;
            }
        }

        // Build the hidden set from collapsed groups.
        const hidden = new Set<number>();
        for (const gi of this._collapsedGroups) {
            const d = depths[gi];
            for (let j = gi + 1; j < n && depths[j] > d; j++) {
                hidden.add(j);
            }
        }

        // Track the inputPos from the most recent partAttempted per part,
        // so partMatched/partFailed rows can show the attempt start position.
        const attemptPositions: Map<number, number> = new Map();
        const attemptPosForEvent: number[] = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            const e = events[i];
            if (e.kind === "partAttempted") {
                attemptPositions.set(e.part, e.inputPos);
            } else if (e.kind === "partMatched" || e.kind === "partFailed") {
                attemptPosForEvent[i] = attemptPositions.get(e.part) ?? 0;
            }
        }

        // Compute success/failure path membership.
        // Success path: only events that directly contribute to the final
        // match result. ruleEntered only if its ruleExited is "matched";
        // partAttempted only if followed by partMatched (not partFailed).
        // Backtracks are never on the success path.
        const onSuccessPath = new Set<number>();
        const onFailurePath = new Set<number>();
        if (this._pathFilter !== "all") {
            // Pair ruleEntered <-> ruleExited using a stack.
            const ruleEntryStack: number[] = [];
            const ruleEntryFor: number[] = new Array(n).fill(-1);
            for (let i = 0; i < n; i++) {
                const e = events[i];
                if (e.kind === "ruleEntered") {
                    ruleEntryStack.push(i);
                } else if (e.kind === "ruleExited") {
                    const entryIdx = ruleEntryStack.pop();
                    if (entryIdx !== undefined) {
                        ruleEntryFor[i] = entryIdx;
                    }
                }
            }

            // Pair partAttempted <-> partMatched/partFailed.
            // The most recent partAttempted for a given partId is the
            // one that matches the next partMatched/partFailed for that id.
            const lastAttemptIdx: Map<number, number> = new Map();
            const attemptFor: number[] = new Array(n).fill(-1);
            for (let i = 0; i < n; i++) {
                const e = events[i];
                if (e.kind === "partAttempted") {
                    lastAttemptIdx.set(e.part, i);
                } else if (
                    e.kind === "partMatched" ||
                    e.kind === "partFailed"
                ) {
                    const ai = lastAttemptIdx.get(e.part);
                    if (ai !== undefined) {
                        attemptFor[i] = ai;
                    }
                }
            }

            // Mark success: matched rules and their entries, matched
            // parts and their attempts.
            for (let i = 0; i < n; i++) {
                const e = events[i];
                if (e.kind === "ruleExited" && e.result === "matched") {
                    onSuccessPath.add(i);
                    const entry = ruleEntryFor[i];
                    if (entry >= 0) onSuccessPath.add(entry);
                } else if (e.kind === "partMatched") {
                    onSuccessPath.add(i);
                    const attempt = attemptFor[i];
                    if (attempt >= 0) onSuccessPath.add(attempt);
                }
            }

            // Mark failure: everything not on success path. Also
            // explicitly mark backtracks, failed parts/rules, and
            // attempts that led to failure.
            for (let i = 0; i < n; i++) {
                if (!onSuccessPath.has(i)) {
                    onFailurePath.add(i);
                }
            }
        }

        return events
            .map((event, index) => ({
                event,
                index,
                depth: depths[index],
                groupSize: groupSize[index],
                attemptPos: attemptPosForEvent[index],
            }))
            .filter(
                ({ event, index }) =>
                    !hidden.has(index) &&
                    !this._hiddenKinds.has(event.kind as EventKindFilter) &&
                    (this._pathFilter === "all" ||
                        (this._pathFilter === "success"
                            ? !onFailurePath.has(index)
                            : onFailurePath.has(index))),
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

    private _eventDetail(
        event: TraceEvent,
        attemptPos?: number,
    ): string | ReturnType<typeof html> {
        switch (event.kind) {
            case "ruleEntered":
                return `depth ${event.depth}`;
            case "ruleExited":
                return event.result;
            case "partMatched": {
                const input = this._trace?.input ?? "";
                const start = attemptPos ?? 0;
                const end = event.endPos;
                const matchedSpan =
                    start < end && input
                        ? (() => {
                              let text = input.slice(start, end);
                              if (text.length > 30)
                                  text = text.slice(0, 29) + "\u2026";
                              return JSON.stringify(text);
                          })()
                        : undefined;
                const capStr = event.capturedValue
                    ? ` $${event.capturedValue.variable}=${JSON.stringify(event.capturedValue.value)}`
                    : "";
                if (matchedSpan) {
                    return html`<span class="matched-text">${matchedSpan}</span
                        >${capStr
                            ? html`<span class="part-label">${capStr}</span>`
                            : nothing}`;
                }
                return capStr
                    ? html`<span class="part-label">${capStr}</span>`
                    : "";
            }
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
            <details class="options-panel">
                <summary>Match Options</summary>
                <div class="options-bar">
                    <label
                        ><strong>Wildcard:</strong>
                        <select
                            @change=${(e: Event) => {
                                this._wildcardPolicy = (
                                    e.target as HTMLSelectElement
                                ).value as WildcardPolicy;
                            }}
                        >
                            <option
                                value="exhaustive"
                                ?selected=${this._wildcardPolicy ===
                                "exhaustive"}
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
                            }}
                        >
                            <option
                                value="exhaustive"
                                ?selected=${this._optionalPolicy ===
                                "exhaustive"}
                            >
                                exhaustive
                            </option>
                            <option
                                value="preferTake"
                                ?selected=${this._optionalPolicy ===
                                "preferTake"}
                            >
                                preferTake
                            </option>
                            <option
                                value="preferSkip"
                                ?selected=${this._optionalPolicy ===
                                "preferSkip"}
                            >
                                preferSkip
                            </option>
                        </select></label
                    >
                    <label
                        ><strong>Repeat:</strong>
                        <select
                            @change=${(e: Event) => {
                                this._repeatPolicy = (
                                    e.target as HTMLSelectElement
                                ).value as RepeatPolicy;
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
            </details>

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
                          <span class="filter-separator"></span>
                          ${(
                              [
                                  ["all", "All"],
                                  ["success", "\u2713 Success path"],
                                  ["failure", "\u2717 Failure path"],
                              ] as const
                          ).map(
                              ([value, label]) => html`
                                  <button
                                      class="filter-btn ${this._pathFilter ===
                                      value
                                          ? "active"
                                          : ""}"
                                      @click=${() => {
                                          this._pathFilter = value;
                                      }}
                                  >
                                      ${label}
                                  </button>
                              `,
                          )}
                      </div>

                      <table>
                          <thead>
                              <tr>
                                  <th>#</th>
                                  <th>Rule</th>
                                  <th>Part</th>
                                  <th>Event</th>
                                  <th>Input Pos</th>
                                  <th>Detail</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${visible.map(
                                  ({
                                      event,
                                      index,
                                      depth,
                                      groupSize,
                                      attemptPos,
                                  }) => {
                                      const isPartEvent =
                                          event.kind === "partAttempted" ||
                                          event.kind === "partMatched" ||
                                          event.kind === "partFailed";
                                      const partLabel = isPartEvent
                                          ? this.grammar?.debugInfo?.partLabels.get(
                                                (event as { part: number })
                                                    .part,
                                            )
                                          : undefined;
                                      const ruleName =
                                          event.kind !== "backtrack"
                                              ? event.rule
                                              : undefined;
                                      const hasSlots =
                                          event.kind === "partMatched" &&
                                          event.capturedValue !== undefined;
                                      const isGroup = groupSize > 0;
                                      const collapsed =
                                          this._collapsedGroups.has(index);
                                      const rowClass = [
                                          this._selectedRow === index
                                              ? "selected"
                                              : "",
                                          event.kind === "partMatched"
                                              ? "row-matched"
                                              : "",
                                          event.kind === "partFailed"
                                              ? "row-failed"
                                              : "",
                                          event.kind === "backtrack"
                                              ? "row-backtrack"
                                              : "",
                                      ]
                                          .filter(Boolean)
                                          .join(" ");
                                      return html`
                                          <tr
                                              class="${rowClass}"
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
                                                      class="depth-indent"
                                                      style="width: ${depth *
                                                      12}px"
                                                  ></span
                                                  >${isGroup
                                                      ? html`<span
                                                            class="group-toggle"
                                                            @click=${(
                                                                e: Event,
                                                            ) => {
                                                                e.stopPropagation();
                                                                this._toggleCollapse(
                                                                    index,
                                                                );
                                                            }}
                                                            >${collapsed
                                                                ? "\u25B6"
                                                                : "\u25BC"}</span
                                                        >`
                                                      : nothing}
                                                  ${this._renderRuleLink(
                                                      ruleName ?? "",
                                                  )}${isGroup && collapsed
                                                      ? html`<span
                                                            class="muted"
                                                        >
                                                            (${groupSize})</span
                                                        >`
                                                      : nothing}
                                              </td>
                                              <td>${partLabel ?? ""}</td>
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
                                                  ${EVENT_LABELS[event.kind] ??
                                                  event.kind}
                                              </td>
                                              <td>
                                                  ${event.kind === "partMatched"
                                                      ? `${attemptPos ?? 0}..${event.endPos}`
                                                      : event.inputPos}
                                              </td>
                                              <td>
                                                  ${this._eventDetail(
                                                      event,
                                                      attemptPos,
                                                  )}
                                              </td>
                                          </tr>
                                          ${hasSlots &&
                                          this._expandedRows.has(index)
                                              ? html`<tr>
                                                    <td colspan="6">
                                                        <div class="slots">
                                                            $${(
                                                                event as PartMatchedEvent
                                                            ).capturedValue!
                                                                .variable}
                                                            =
                                                            ${JSON.stringify(
                                                                (
                                                                    event as PartMatchedEvent
                                                                ).capturedValue!
                                                                    .value,
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>`
                                              : nothing}
                                      `;
                                  },
                              )}
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
                          ${this._trace.matchValue !== undefined
                              ? html`, value:
                                    <code
                                        >${JSON.stringify(
                                            this._trace.matchValue,
                                            null,
                                            2,
                                        )}</code
                                    >`
                              : nothing}
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

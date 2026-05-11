// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
    CoverageReport,
    RuleCoverage,
    SourceLocation,
} from "grammar-tools-core";
import { baseStyles } from "./styles.js";

type SortKey = "hits" | "name" | "location";

/**
 * Per-rule coverage heatmap with expandable part details.
 * @element gt-coverage-heatmap
 */
@customElement("gt-coverage-heatmap")
export class GtCoverageHeatmap extends LitElement {
    static override styles = [
        baseStyles,
        css`
            .summary-bar {
                display: flex;
                gap: 16px;
                padding: 8px;
                border-bottom: 1px solid var(--vscode-panel-border, #80808059);
                flex-wrap: wrap;
            }
            .summary-bar .stat {
                font-weight: bold;
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
                cursor: pointer;
                user-select: none;
            }
            th:hover {
                color: var(--vscode-foreground, #cccccc);
            }
            th.sorted::after {
                content: " \\25BC";
            }
            td {
                padding: 3px 8px;
                vertical-align: top;
                border-bottom: 1px solid
                    var(--vscode-panel-border, rgba(128, 128, 128, 0.15));
            }
            tr.rule-row {
                cursor: pointer;
            }
            tr.rule-row:hover td {
                background: var(--vscode-list-hoverBackground, #2a2d2e);
            }
            tr.zero-hits td {
                opacity: 0.5;
            }

            .heat-bar {
                display: inline-block;
                height: 10px;
                min-width: 2px;
                border-radius: 2px;
                vertical-align: middle;
                margin-right: 6px;
            }
            .heat-high {
                background: #4ec9b0;
            }
            .heat-mid {
                background: var(--vscode-editorWarning-foreground, #cca700);
            }
            .heat-zero {
                background: var(--vscode-errorForeground, #f48771);
                opacity: 0.6;
            }

            .part-row td {
                padding-left: 32px;
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }

            .location-link {
                cursor: pointer;
                color: var(--vscode-textLink-foreground, #3794ff);
            }
            .location-link:hover {
                text-decoration: underline;
            }

            .unmatched-section {
                margin-top: 12px;
                border-top: 1px solid var(--vscode-panel-border, #80808059);
                padding: 8px;
            }
            .unmatched-section h3 {
                font-size: 0.9em;
                margin: 0 0 8px;
                color: var(--vscode-descriptionForeground, #9d9d9d);
            }
            .unmatched-item {
                padding: 2px 0;
                font-family: var(--gt-mono-font-family, monospace);
                font-size: 0.85em;
            }
            .unmatched-item .reason {
                color: var(--vscode-descriptionForeground, #9d9d9d);
                margin-left: 12px;
            }
        `,
    ];

    @property({ attribute: false })
    report: CoverageReport | undefined;

    @property({ attribute: false })
    onSourceClick: ((loc: SourceLocation) => void) | undefined;

    @property({ type: String, attribute: "sort-by" })
    sortBy: SortKey = "hits";

    @state()
    private _expandedRules: Set<string> = new Set();

    @state()
    private _sortKey: SortKey = "hits";

    override connectedCallback(): void {
        super.connectedCallback();
        this._sortKey = this.sortBy;
    }

    private _toggleExpand(ruleId: string): void {
        const next = new Set(this._expandedRules);
        if (next.has(ruleId)) {
            next.delete(ruleId);
        } else {
            next.add(ruleId);
        }
        this._expandedRules = next;
    }

    private _sortedRules(): RuleCoverage[] {
        if (!this.report) return [];
        const rules = [...this.report.perRule];
        switch (this._sortKey) {
            case "hits":
                rules.sort((a, b) => b.hits - a.hits);
                break;
            case "name":
                rules.sort((a, b) => a.id.localeCompare(b.id));
                break;
            case "location":
                rules.sort(
                    (a, b) =>
                        (a.location?.range.start.line ?? 0) -
                        (b.location?.range.start.line ?? 0),
                );
                break;
        }
        return rules;
    }

    private _maxHits(): number {
        if (!this.report) return 1;
        return Math.max(1, ...this.report.perRule.map((r) => r.hits));
    }

    private _heatClass(hits: number): string {
        if (hits === 0) return "heat-zero";
        if (hits >= this._maxHits() * 0.5) return "heat-high";
        return "heat-mid";
    }

    private _pct(n: number, total: number): string {
        if (total === 0) return "0%";
        return Math.round((n / total) * 100) + "%";
    }

    override render() {
        const r = this.report;
        if (!r) {
            return html`<div class="empty-state">
                No coverage report loaded
            </div>`;
        }

        const sorted = this._sortedRules();
        const maxHits = this._maxHits();

        return html`
            <div class="summary-bar">
                <span>
                    Coverage:
                    <span class="stat"
                        >${r.totals.ruleHits}/${r.totals.rules} rules</span
                    >
                    (${this._pct(r.totals.ruleHits, r.totals.rules)})
                </span>
                <span>
                    <span class="stat"
                        >${r.totals.partHits}/${r.totals.parts} parts</span
                    >
                    (${this._pct(r.totals.partHits, r.totals.parts)})
                </span>
                <span>
                    Corpus:
                    ${r.unmatchedInputs.length > 0
                        ? html`<span class="error-text"
                              >${r.unmatchedInputs.length} unmatched</span
                          >`
                        : html`<span class="info-text">all matched</span>`}
                </span>
            </div>

            <table>
                <thead>
                    <tr>
                        <th
                            class="${this._sortKey === "hits" ? "sorted" : ""}"
                            @click=${() => {
                                this._sortKey = "hits";
                            }}
                        >
                            Hits
                        </th>
                        <th
                            class="${this._sortKey === "name" ? "sorted" : ""}"
                            @click=${() => {
                                this._sortKey = "name";
                            }}
                        >
                            Rule
                        </th>
                        <th>Parts</th>
                        <th
                            class="${this._sortKey === "location"
                                ? "sorted"
                                : ""}"
                            @click=${() => {
                                this._sortKey = "location";
                            }}
                        >
                            Location
                        </th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.flatMap((rule) => {
                        const barWidth = Math.max(
                            2,
                            Math.round((rule.hits / maxHits) * 40),
                        );
                        const hitParts = rule.parts.filter(
                            (p) => p.hits > 0,
                        ).length;
                        const rows = [
                            html`<tr
                                class="rule-row ${rule.hits === 0
                                    ? "zero-hits"
                                    : ""}"
                                @click=${() => this._toggleExpand(rule.id)}
                            >
                                <td>
                                    <span
                                        class="heat-bar ${this._heatClass(
                                            rule.hits,
                                        )}"
                                        style="width: ${barWidth}px"
                                    ></span>
                                    ${rule.hits}
                                </td>
                                <td>${rule.id}</td>
                                <td>${hitParts}/${rule.parts.length}</td>
                                <td>${this._renderLocation(rule.location)}</td>
                            </tr>`,
                        ];

                        if (this._expandedRules.has(rule.id)) {
                            for (const part of rule.parts) {
                                rows.push(
                                    html`<tr class="part-row">
                                        <td>${part.hits}</td>
                                        <td>${part.id}</td>
                                        <td></td>
                                        <td>
                                            ${this._renderLocation(
                                                part.location,
                                            )}
                                        </td>
                                    </tr>`,
                                );
                            }
                        }
                        return rows;
                    })}
                </tbody>
            </table>

            ${r.unmatchedInputs.length > 0
                ? html`
                      <div class="unmatched-section">
                          <h3>Unmatched inputs:</h3>
                          ${r.unmatchedInputs.map(
                              (u) => html`
                                  <div class="unmatched-item">
                                      "${u.input}"
                                      ${u.reason
                                          ? html`<span class="reason"
                                                >${u.reason}</span
                                            >`
                                          : nothing}
                                  </div>
                              `,
                          )}
                      </div>
                  `
                : nothing}
        `;
    }

    private _renderLocation(loc: SourceLocation | undefined) {
        if (!loc) return nothing;
        const display = `${loc.displayPath}:${loc.range.start.line + 1}`;
        if (!this.onSourceClick) return html`<span>${display}</span>`;
        return html`<span
            class="location-link"
            @click=${(e: Event) => {
                e.stopPropagation();
                this.onSourceClick!(loc);
            }}
            >${display}</span
        >`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "gt-coverage-heatmap": GtCoverageHeatmap;
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromHtmlDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { StoredGrammarRule } from "action-grammar";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { GrammarAction } from "../schema/grammarActionSchema.js";

export async function executeGrammarAction(
    action: TypeAgentAction<GrammarAction>,
    context: ActionContext<CommandHandlerContext>,
): Promise<ActionResult | undefined> {
    const chc = context.sessionContext.agentContext;
    const store = chc.persistedGrammarStore;

    if (!store) {
        return createActionResultFromTextDisplay(
            "Grammar rule management is not available in this session (no session directory).",
        );
    }

    switch (action.actionName) {
        case "listRules": {
            const agentFilter = action.parameters?.agentName
                ?.toLowerCase()
                .trim();
            let rules = store.getAllRules();
            if (agentFilter) {
                rules = rules.filter(
                    (r) => r.schemaName.toLowerCase() === agentFilter,
                );
            }
            rules.sort((a, b) => b.timestamp - a.timestamp);
            const title = agentFilter
                ? `Grammar rules for "${agentFilter}"`
                : "All grammar rules";
            return createActionResultFromHtmlDisplay(
                renderRulesTable(rules, title),
            );
        }

        case "showRule": {
            const id = action.parameters.id;
            const rule = store.getAllRules().find((r) => r.id === id);
            if (!rule) {
                return createActionResultFromTextDisplay(
                    `No grammar rule with ID ${id}. Use "list grammar rules" to see available IDs.`,
                );
            }
            return createActionResultFromHtmlDisplay(renderRuleDetail(rule));
        }

        case "deleteRule": {
            const id = action.parameters.id;
            const deleted = await store.deleteRuleById(id);
            if (!deleted) {
                return createActionResultFromTextDisplay(
                    `No grammar rule with ID ${id}. Use "list grammar rules" to see available IDs.`,
                );
            }
            // Rebuild in-memory NFA for the affected schema
            chc.agentCache.syncAgentGrammar(deleted.schemaName);
            return createActionResultFromTextDisplay(
                `Deleted rule #${id} (${deleted.schemaName}${deleted.actionName ? `.${deleted.actionName}` : ""}).`,
            );
        }

        case "clearRules": {
            const agentFilter = action.parameters?.agentName?.trim();
            const schemas = agentFilter
                ? [agentFilter]
                : store.getSchemaNames();
            let totalCount = 0;
            for (const schema of schemas) {
                const count = await store.clearSchema(schema);
                if (count > 0) {
                    chc.agentCache.syncAgentGrammar(schema);
                    totalCount += count;
                }
            }
            const scope = agentFilter ? ` for "${agentFilter}"` : "";
            return createActionResultFromTextDisplay(
                totalCount === 0
                    ? `No grammar rules found${scope}.`
                    : `Cleared ${totalCount} rule${totalCount === 1 ? "" : "s"}${scope}.`,
            );
        }

        default:
            throw new Error(
                `Unknown grammar action: ${(action as TypeAgentAction).actionName}`,
            );
    }
}

// ---------------------------------------------------------------------------
// Risk analysis
// ---------------------------------------------------------------------------

type RiskLevel = "high" | "medium" | "none";

interface MunchRisk {
    level: RiskLevel;
    reason: string;
}

interface CompletionRisk {
    anchorWords: string[];
    level: "high" | "medium" | "low";
}

function analyzeMunchRisk(grammarText: string): MunchRisk {
    // Work with the pattern portion only (before the first ->)
    const arrowIdx = grammarText.indexOf("->");
    const pattern =
        arrowIdx >= 0 ? grammarText.slice(0, arrowIdx) : grammarText;

    const hasUnconstrained = /\$\(\w+:(wildcard|string)\)/i.test(pattern);
    if (!hasUnconstrained) {
        return { level: "none", reason: "" };
    }

    // Trailing wildcard: last capture before -> is unconstrained
    if (/\$\(\w+:(wildcard|string)\)\s*$/i.test(pattern.trimEnd())) {
        return {
            level: "high",
            reason: "Trailing wildcard — may over-consume words",
        };
    }

    // Adjacent unconstrained wildcards (no fixed tokens between them)
    if (
        /\$\(\w+:(wildcard|string)\)[^$\-]*\$\(\w+:(wildcard|string)\)/i.test(
            pattern,
        )
    ) {
        return {
            level: "high",
            reason: "Adjacent wildcards — ambiguous token split",
        };
    }

    return {
        level: "medium",
        reason: "Wildcard in pattern — watch for over-capture",
    };
}

function analyzeCompletionRisk(grammarText: string): CompletionRisk {
    const arrowIdx = grammarText.indexOf("->");
    const pattern =
        arrowIdx >= 0 ? grammarText.slice(0, arrowIdx) : grammarText;

    // Check if there's any wildcard at all; if not, no completion risk
    if (!/\$\(/.test(pattern)) {
        return { anchorWords: [], level: "low" };
    }

    // Collect bare word tokens before the first capture
    const anchorWords: string[] = [];
    for (const tok of pattern.split(/[\s()?*+]+/)) {
        const t = tok.trim();
        if (!t || t.startsWith("<") || t.startsWith("->") || t === "|") {
            continue;
        }
        if (t.startsWith("$(")) {
            break; // hit a capture — anchor ends here
        }
        if (/^[a-zA-Z'][a-zA-Z']*$/.test(t)) {
            anchorWords.push(t.toLowerCase());
        }
    }

    const level =
        anchorWords.length <= 1
            ? "high"
            : anchorWords.length === 2
              ? "medium"
              : "low";

    return { anchorWords, level };
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const d = new Date(ts);
    const opts: Intl.DateTimeFormatOptions = {
        month: "numeric",
        day: "numeric",
    };
    if (d.getFullYear() !== new Date().getFullYear()) {
        opts.year = "numeric";
    }
    return d.toLocaleDateString(undefined, opts);
}

function schemaBadgeColor(schemaName: string): string {
    let h = 0;
    for (let i = 0; i < schemaName.length; i++) {
        h = (h * 31 + schemaName.charCodeAt(i)) & 0xffff;
    }
    return `hsl(${(h * 137) % 360}, 55%, 68%)`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// AGR syntax highlighter (mirrors agr.tmLanguage.json token scopes)
// ---------------------------------------------------------------------------

function readStringToken(raw: string, start: number): [string, number] {
    const q = raw[start];
    let j = start + 1;
    while (j < raw.length && raw[j] !== q && raw[j] !== "\n") {
        if (raw[j] === "\\") j++;
        j++;
    }
    if (j < raw.length && raw[j] === q) j++;
    return [raw.slice(start, j), j - start];
}

function highlightGrammarText(raw: string): string {
    let out = "";
    let i = 0;
    let afterArrow = false; // true once we've passed ->

    while (i < raw.length) {
        const c = raw[i];
        const rest = raw.slice(i);

        // Newline — reset arrow flag for multiline texts
        if (c === "\n") {
            out += "\n";
            i++;
            afterArrow = false;
            continue;
        }

        // Comment: // to end of line
        if (rest.startsWith("//")) {
            const eol = raw.indexOf("\n", i);
            const comment = eol < 0 ? rest : raw.slice(i, eol);
            out += `<span style="color:#888;font-style:italic">${escapeHtml(comment)}</span>`;
            i += comment.length;
            continue;
        }

        // Arrow -> separates pattern from action body
        if (!afterArrow && rest.startsWith("->")) {
            out += `<span style="color:#b07000;font-weight:bold">-&gt;</span>`;
            i += 2;
            afterArrow = true;
            continue;
        }

        // ---- Action body (after ->) ----
        if (afterArrow) {
            // String literal in action body
            if (c === '"' || c === "'") {
                const [str, len] = readStringToken(raw, i);
                out += `<span style="color:#067">${escapeHtml(str)}</span>`;
                i += len;
                continue;
            }
            // Number
            const numM = rest.match(/^\d+/);
            if (numM) {
                out += `<span style="color:#c70">${numM[0]}</span>`;
                i += numM[0].length;
                continue;
            }
            // Keywords true/false/null/undefined
            const kwM = rest.match(/^(true|false|null|undefined)\b/);
            if (kwM) {
                out += `<span style="color:#a50">${kwM[1]}</span>`;
                i += kwM[1].length;
                continue;
            }
            // Identifier (property key or value reference) — color like variable.other.agr
            const idM = rest.match(/^[A-Za-z_]\w*/);
            if (idM) {
                out += `<span style="color:#36c">${escapeHtml(idM[0])}</span>`;
                i += idM[0].length;
                continue;
            }
            out += escapeHtml(c);
            i++;
            continue;
        }

        // ---- Pattern side (before ->) ----

        // Capture: $(name:type) or $(name:type)?
        const captM = rest.match(
            /^\$\(([A-Za-z_]\w*):([A-Za-z_<>][A-Za-z0-9_<>]*)\)(\?)?/,
        );
        if (captM) {
            // Wildcard/string types are "risky" — highlight differently from entity types
            const isGreedy = /^(wildcard|string)$/i.test(captM[2]);
            const typeColor = isGreedy ? "#c44" : "#690";
            out +=
                `<span style="color:#c44">$</span>` +
                `<span style="color:#888">(</span>` +
                `<span style="color:#36c">${escapeHtml(captM[1])}</span>` +
                `<span style="color:#888">:</span>` +
                `<span style="color:${typeColor};font-weight:600">${escapeHtml(captM[2])}</span>` +
                `<span style="color:#888">)</span>` +
                (captM[3] ? `<span style="color:#90c">?</span>` : "");
            i += captM[0].length;
            continue;
        }

        // Rule reference: <Name>
        const ruleM = rest.match(/^<([A-Za-z_]\w*)>/);
        if (ruleM) {
            out +=
                `<span style="color:#888">&lt;</span>` +
                `<span style="color:#55c;font-style:italic">${escapeHtml(ruleM[1])}</span>` +
                `<span style="color:#888">&gt;</span>`;
            i += ruleM[0].length;
            continue;
        }

        // String literal in pattern
        if (c === '"' || c === "'") {
            const [str, len] = readStringToken(raw, i);
            out += `<span style="color:#484">${escapeHtml(str)}</span>`;
            i += len;
            continue;
        }

        // Escape sequence: \x
        if (c === "\\" && i + 1 < raw.length) {
            out += `<span style="color:#c77">${escapeHtml(raw.slice(i, i + 2))}</span>`;
            i += 2;
            continue;
        }

        // Operators
        if (c === "|") {
            out += `<span style="color:#90c">|</span>`;
            i++;
            continue;
        }
        if (c === "?" || c === "*" || c === "+") {
            out += `<span style="color:#90c">${c}</span>`;
            i++;
            continue;
        }

        // Default: pass through (HTML-escaped)
        out += escapeHtml(c);
        i++;
    }

    return out;
}

function munchIcon(level: RiskLevel): string {
    if (level === "high")
        return `<span title="Munch risk (high)" style="color:#e55">M⬤</span>`;
    if (level === "medium")
        return `<span title="Munch risk (medium)" style="color:#c90">M◐</span>`;
    return "";
}

function completionIcon(cr: CompletionRisk): string {
    if (cr.level === "low" || cr.anchorWords.length === 0) return "";
    const anchor = cr.anchorWords.join(" ");
    const desc =
        cr.level === "high"
            ? `1-word anchor "${anchor}" — wildcard fires after typing "${anchor}"`
            : `${cr.anchorWords.length}-word anchor "${anchor}" — wildcard fires early`;
    const color = cr.level === "high" ? "#e55" : "#c90";
    return `<span title="Completion risk: ${escapeHtml(desc)}" style="color:${color}">C⬤</span>`;
}

const TABLE_STYLE = `
<style>
  .grammar-view { font-family: system-ui, sans-serif; font-size: 13px; padding: 8px; }
  .grammar-view h3 { margin: 0 0 8px; font-size: 14px; }
  .grammar-view .warn-summary { color: #c90; font-size: 12px; margin-left: 8px; }
  .grammar-view table { border-collapse: collapse; width: 100%; }
  .grammar-view th { background: #f0f0f0; text-align: left; padding: 4px 8px; font-size: 11px;
       border-bottom: 1px solid #ccc; white-space: nowrap; }
  .grammar-view td { padding: 4px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .grammar-view .id { font-family: monospace; color: #555; white-space: nowrap; }
  .grammar-view .badge { display:inline-block; padding: 1px 6px; border-radius: 10px;
           font-size: 11px; font-weight: 600; color: #333; }
  .grammar-view .anchor { font-family: monospace; font-size: 11px; color: #666; }
  .grammar-view .phrase { font-style: italic; color: #444; }
  .grammar-view .date { color: #999; font-size: 11px; white-space: nowrap; }
  .grammar-view .risks { white-space: nowrap; display: flex; gap: 4px; }
  .grammar-view .empty { color: #999; font-style: italic; padding: 16px 0; }
  .grammar-view .table-scroll { max-height: 400px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 4px; }
  .grammar-view pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
  .grammar-view mark { background: #ffe08a; padding: 0 2px; border-radius: 2px; }

  .grammar-view .detail-header { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  .grammar-view .detail-id { font-family: monospace; font-size: 16px; font-weight: bold; }
  .grammar-view .risk-row { margin: 4px 0; font-size: 12px; }
  .grammar-view .grammar-block { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px;
                   padding: 8px; margin-top: 8px; font-family: monospace; font-size: 12px;
                   white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere; overflow-x: hidden; }
  .grammar-view .detail-card { border: 1px solid #ddd; border-radius: 6px; padding: 12px;
                   max-width: 800px; overflow-x: hidden; }
  .grammar-view .source-req { margin-top: 8px; font-size: 12px; color: #555; font-style: italic; }
  .grammar-view .anchor-info { font-size: 12px; color: #777; margin: 4px 0; }
  .grammar-view details > summary { list-style: none; cursor: pointer; color: #338; font-family: monospace; }
  .grammar-view details > summary::-webkit-details-marker { display: none; }
  .grammar-view details[open] > summary { color: #006; }
  .grammar-view .grammar-inline { background: #f8f8f8; border: 1px solid #ddd; border-radius: 4px;
    padding: 6px 8px; margin-top: 4px; font-family: monospace; font-size: 11px; white-space: pre-wrap;
    word-break: break-all; max-width: 500px; }
</style>
`;

export function renderRulesTable(
    rules: StoredGrammarRule[],
    title: string,
): string {
    const highRiskCount = rules.filter((r) => {
        const m = analyzeMunchRisk(r.grammarText);
        const c = analyzeCompletionRisk(r.grammarText);
        return m.level === "high" || c.level === "high";
    }).length;

    const warnSummary =
        highRiskCount > 0
            ? `<span class="warn-summary">⚠ ${highRiskCount} possibly greedy</span>`
            : "";

    const showAgentCol = !title.startsWith("Grammar rules for ");

    if (rules.length === 0) {
        const scope = showAgentCol
            ? "all agents"
            : title.replace("Grammar rules for ", "");
        return `${TABLE_STYLE}<div class="grammar-view"><h3>${escapeHtml(title)}</h3>
<div class="empty">No grammar rules stored for ${escapeHtml(scope)} yet.</div></div>`;
    }

    const agentCol = showAgentCol ? `<th>Agent</th>` : "";

    let rows = "";
    for (const rule of rules) {
        const munch = analyzeMunchRisk(rule.grammarText);
        const comp = analyzeCompletionRisk(rule.grammarText);

        const risks = `<div class="risks">${munchIcon(munch.level)}${completionIcon(comp)}</div>`;
        const anchor =
            comp.anchorWords.length > 0
                ? `<span class="anchor">${escapeHtml(comp.anchorWords.join(" "))}</span>`
                : `<span style="color:#ccc">—</span>`;
        const badge = showAgentCol
            ? `<td><span class="badge" style="background:${schemaBadgeColor(rule.schemaName)}">${escapeHtml(rule.schemaName)}</span></td>`
            : "";
        const idCell =
            `<details title="${escapeHtml(rule.grammarText)}">` +
            `<summary>#${rule.id}</summary>` +
            `<div class="grammar-inline">${highlightGrammarText(rule.grammarText)}</div>` +
            `</details>`;

        rows += `<tr>
  <td>${risks}</td>
  <td class="id">${idCell}</td>
  ${badge}
  <td>${anchor}</td>
  <td class="date">${timeAgo(rule.timestamp)}</td>
</tr>`;
    }

    return `${TABLE_STYLE}
<div class="grammar-view">
<h3>${escapeHtml(title)} (${rules.length})${warnSummary}</h3>
<div class="table-scroll">
<table>
  <thead><tr>
    <th>Risks</th><th>#</th>${agentCol}<th>Anchor</th><th>Date</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>
</div>`;
}

export function renderRuleDetail(rule: StoredGrammarRule): string {
    const munch = analyzeMunchRisk(rule.grammarText);
    const comp = analyzeCompletionRisk(rule.grammarText);

    const munchRow =
        munch.level !== "none"
            ? `<div class="risk-row">${munchIcon(munch.level)} <b>Munch:</b> ${escapeHtml(munch.reason)}</div>`
            : "";

    const compRow =
        comp.level !== "low" && comp.anchorWords.length > 0
            ? (() => {
                  const anchor = comp.anchorWords.join(" ");
                  const desc =
                      comp.level === "high"
                          ? `1-word anchor "${anchor}" — wildcard fires after typing "${anchor}"`
                          : `${comp.anchorWords.length}-word anchor "${anchor}" — wildcard fires early`;
                  return `<div class="risk-row">${completionIcon(comp)} <b>Completion:</b> ${escapeHtml(desc)}</div>`;
              })()
            : "";

    const anchorInfo =
        comp.anchorWords.length > 0
            ? `<div class="anchor-info">Completion anchor: <code>${escapeHtml(comp.anchorWords.join(" "))}</code> (${comp.anchorWords.length} word${comp.anchorWords.length === 1 ? "" : "s"})</div>`
            : "";

    const highlighted = highlightGrammarText(rule.grammarText);

    const sourceRow = rule.sourceRequest
        ? `<div class="source-req">Learned from: <em>"${escapeHtml(rule.sourceRequest)}"</em></div>`
        : "";

    const ts = new Date(rule.timestamp).toLocaleString();

    return `${TABLE_STYLE}
<div class="grammar-view">
<div class="detail-card">
  <div class="detail-header">
    <span class="detail-id">#${rule.id}</span>
    <span class="badge" style="background:${schemaBadgeColor(rule.schemaName)}">${escapeHtml(rule.schemaName)}</span>
    <span>${escapeHtml(rule.actionName ?? "")}</span>
    <span style="color:#999; font-size:12px">${ts}</span>
  </div>
  ${munchRow}${compRow}${anchorInfo}
  <div class="grammar-block">${highlighted}</div>
  ${sourceRow}
</div>
</div>`;
}

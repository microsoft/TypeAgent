// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayResult,
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    Grammar,
    GrammarPart,
    GrammarRule,
    grammarFromJson,
} from "action-grammar";
import { getGrammarContent } from "../../../translation/actionConfig.js";
import { getAppAgentName } from "../../../translation/agentTranslators.js";
import {
    renderRulesTable,
    renderRuleDetail,
} from "../action/grammarActionHandler.js";

// ---------------------------------------------------------------------------
// Stored grammar rules (mirrors system.grammar NL actions)
// ---------------------------------------------------------------------------

class GrammarListCommandHandler implements CommandHandler {
    public readonly description =
        "List grammar rules learned at runtime (optionally filtered by agent)";
    public readonly parameters = {
        args: {
            agent: {
                description: "Agent name to filter by (e.g. 'list', 'player')",
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const store = systemContext.persistedGrammarStore;
        if (!store) {
            displayWarn(
                "Grammar rule management is not available in this session (no session directory).",
                context,
            );
            return;
        }
        const agentFilter = params.args.agent?.toLowerCase().trim();
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
        context.actionIO.appendDisplay({
            type: "html",
            content: renderRulesTable(rules, title),
        });
    }
}

class GrammarShowCommandHandler implements CommandHandler {
    public readonly description = "Show a stored grammar rule by ID";
    public readonly parameters = {
        args: {
            id: {
                description: "Numeric ID of the rule to inspect",
                type: "number",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const store = systemContext.persistedGrammarStore;
        if (!store) {
            displayWarn(
                "Grammar rule management is not available in this session (no session directory).",
                context,
            );
            return;
        }
        const id = params.args.id;
        const rule = store.getAllRules().find((r) => r.id === id);
        if (!rule) {
            displayResult(
                `No grammar rule with ID ${id}. Use '@grammar list' to see available IDs.`,
                context,
            );
            return;
        }
        context.actionIO.appendDisplay({
            type: "html",
            content: renderRuleDetail(rule),
        });
    }
}

class GrammarDeleteCommandHandler implements CommandHandler {
    public readonly description = "Delete a stored grammar rule by ID";
    public readonly parameters = {
        args: {
            id: {
                description: "Numeric ID of the rule to delete",
                type: "number",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const store = systemContext.persistedGrammarStore;
        if (!store) {
            displayWarn(
                "Grammar rule management is not available in this session (no session directory).",
                context,
            );
            return;
        }
        const id = params.args.id;
        const deleted = await store.deleteRuleById(id);
        if (!deleted) {
            displayResult(
                `No grammar rule with ID ${id}. Use '@grammar list' to see available IDs.`,
                context,
            );
            return;
        }
        systemContext.agentCache.syncAgentGrammar(deleted.schemaName);
        displayResult(
            `Deleted rule #${id} (${deleted.schemaName}${deleted.actionName ? `.${deleted.actionName}` : ""}).`,
            context,
        );
    }
}

class GrammarClearCommandHandler implements CommandHandler {
    public readonly description =
        "Clear stored grammar rules (optionally for a specific agent)";
    public readonly parameters = {
        args: {
            agent: {
                description:
                    "Agent name to clear rules for. Omit to clear all stored rules.",
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const store = systemContext.persistedGrammarStore;
        if (!store) {
            displayWarn(
                "Grammar rule management is not available in this session (no session directory).",
                context,
            );
            return;
        }
        const agentFilter = params.args.agent?.trim();
        const schemas = agentFilter ? [agentFilter] : store.getSchemaNames();
        let totalCount = 0;
        for (const schema of schemas) {
            const count = await store.clearSchema(schema);
            if (count > 0) {
                systemContext.agentCache.syncAgentGrammar(schema);
                totalCount += count;
            }
        }
        const scope = agentFilter ? ` for "${agentFilter}"` : "";
        displayResult(
            totalCount === 0
                ? `No grammar rules found${scope}.`
                : `Cleared ${totalCount} rule${totalCount === 1 ? "" : "s"}${scope}.`,
            context,
        );
    }
}

// ---------------------------------------------------------------------------
// Static .agr collision scanner (cross-agent overlap detection)
// ---------------------------------------------------------------------------

/**
 * Anchor extracted from a single grammar rule alternative. The anchor is the
 * sequence of literal terminals before the first unconstrained capture
 * (wildcard / string-typed variable). Two rules that produce the same anchor
 * will both match an input that begins with those tokens — likely collision.
 *
 * - words:           lowercased literal tokens, in order, up to the first wildcard.
 * - terminatedByWildcard: true if the anchor ended at a wildcard (vs. running off
 *                    the end of the rule); these are the high-risk cases.
 */
type Anchor = {
    words: string[];
    terminatedByWildcard: boolean;
};

/**
 * Walk a compiled grammar rule's parts and extract its anchor. Conservative:
 * treats nested rule parts and phrase sets as opaque (anchor stops there).
 * Optional/repeat parts are skipped — their tokens may not appear at runtime.
 */
function extractAnchor(rule: GrammarRule): Anchor {
    const words: string[] = [];
    let terminatedByWildcard = false;
    for (const part of rule.parts) {
        // Optional/repeat parts can be absent at runtime, so they don't extend
        // the anchor. Skip them entirely.
        if (isPartOptional(part)) {
            continue;
        }
        if (part.type === "string") {
            for (const w of part.value) {
                words.push(w.toLowerCase());
            }
            continue;
        }
        if (part.type === "wildcard") {
            // Unconstrained capture — anchor ends here.
            terminatedByWildcard = true;
            break;
        }
        // number / rules / phraseSet — opaque terminator.
        break;
    }
    return { words, terminatedByWildcard };
}

function isPartOptional(part: GrammarPart): boolean {
    switch (part.type) {
        case "string":
        case "phraseSet":
            return false;
        case "wildcard":
        case "number":
            return Boolean(part.optional);
        case "rules":
            return Boolean(part.optional || part.repeat);
        default:
            return false;
    }
}

/**
 * Walk a grammar's top-level alternatives plus any first-token dispatch
 * buckets, calling `visit` once per concrete `GrammarRule`. This is the same
 * traversal the optimizer's invariants describe (RulesPart's dual-role
 * `rules` field + per-mode `dispatch`), so it covers every alternative the
 * matcher would actually try.
 */
function forEachTopLevelRule(
    grammar: Grammar,
    visit: (rule: GrammarRule) => void,
): void {
    for (const r of grammar.alternatives) {
        visit(r);
    }
    if (grammar.dispatch) {
        for (const bucket of grammar.dispatch) {
            for (const [, rules] of bucket.tokenMap) {
                for (const r of rules) {
                    visit(r);
                }
            }
        }
    }
}

type GrammarRuleEntry = {
    schemaName: string;
    agentName: string;
    anchor: Anchor;
    rule: GrammarRule;
};

type CollisionGroup = {
    anchorKey: string;
    entries: GrammarRuleEntry[];
};

function anchorKey(anchor: Anchor): string {
    if (anchor.words.length === 0) {
        return "<none>";
    }
    return anchor.words.join(" ");
}

/**
 * Walk every loaded action config, load its compiled grammar, and accumulate
 * a (schemaName -> [anchor, rule]) entry for each top-level alternative.
 * Returns one CollisionGroup per anchor that's shared by 2+ distinct schemas.
 */
async function scanGrammarCollisions(
    context: ActionContext<CommandHandlerContext>,
    onProgress: (message: string) => void,
): Promise<{
    collisions: CollisionGroup[];
    totalRules: number;
    schemasScanned: number;
    schemasSkipped: number;
}> {
    const systemContext = context.sessionContext.agentContext;
    const configs = systemContext.agents.getActionConfigs();

    const byAnchor = new Map<string, GrammarRuleEntry[]>();
    let totalRules = 0;
    let schemasScanned = 0;
    let schemasSkipped = 0;

    for (let i = 0; i < configs.length; i++) {
        const config = configs[i];
        onProgress(
            `[${i + 1}/${configs.length}] Scanning ${config.schemaName}…`,
        );
        const grammarContent = getGrammarContent(config);
        if (!grammarContent) {
            schemasSkipped++;
            continue;
        }
        if (grammarContent.format !== "ag") {
            schemasSkipped++;
            continue;
        }
        let grammar: Grammar;
        try {
            grammar = grammarFromJson(JSON.parse(grammarContent.content));
        } catch {
            schemasSkipped++;
            continue;
        }
        schemasScanned++;
        const agentName = getAppAgentName(config.schemaName);
        forEachTopLevelRule(grammar, (rule) => {
            const anchor = extractAnchor(rule);
            // Anchorless rules (no literal prefix) can't be grouped meaningfully
            // by this scanner — they're either pure-capture rules or start with
            // a nested reference. Skip them; they'd produce a single noisy bucket.
            if (anchor.words.length === 0) {
                return;
            }
            const key = anchorKey(anchor);
            const list = byAnchor.get(key) ?? [];
            list.push({
                schemaName: config.schemaName,
                agentName,
                anchor,
                rule,
            });
            byAnchor.set(key, list);
            totalRules++;
        });
    }

    onProgress(
        `Analyzing ${totalRules} rule(s) across ${schemasScanned} schema(s)…`,
    );

    const collisions: CollisionGroup[] = [];
    for (const [key, entries] of byAnchor) {
        const distinctSchemas = new Set(entries.map((e) => e.schemaName));
        if (distinctSchemas.size > 1) {
            collisions.push({ anchorKey: key, entries });
        }
    }
    // Sort: terminated-by-wildcard collisions first (highest risk), then by
    // distinct-schema count desc, then by anchor.
    collisions.sort((a, b) => {
        const aWild = a.entries.some((e) => e.anchor.terminatedByWildcard);
        const bWild = b.entries.some((e) => e.anchor.terminatedByWildcard);
        if (aWild !== bWild) return aWild ? -1 : 1;
        const aCount = new Set(a.entries.map((e) => e.schemaName)).size;
        const bCount = new Set(b.entries.map((e) => e.schemaName)).size;
        if (aCount !== bCount) return bCount - aCount;
        return a.anchorKey.localeCompare(b.anchorKey);
    });
    return { collisions, totalRules, schemasScanned, schemasSkipped };
}

// ---------------------------------------------------------------------------
// Collision report rendering
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const COLLISION_STYLE = `
<style>
  .gc-view { font-family: system-ui, sans-serif; font-size: 13px; padding: 8px; max-width: 900px; }
  .gc-view h3 { margin: 0 0 8px; font-size: 14px; }
  .gc-view .summary { color: #555; font-size: 12px; margin-bottom: 12px; }
  .gc-view .group { border: 1px solid #e0e0e0; border-radius: 4px; padding: 8px 10px; margin-bottom: 10px; }
  .gc-view .group.high { border-left: 4px solid #e55; }
  .gc-view .group.medium { border-left: 4px solid #c90; }
  .gc-view .anchor { font-family: monospace; font-weight: 600; color: #333; }
  .gc-view .badge { display: inline-block; padding: 1px 6px; border-radius: 10px;
       font-size: 11px; font-weight: 600; color: #333; margin-right: 4px; }
  .gc-view .meta { font-size: 11px; color: #777; margin: 4px 0; }
  .gc-view ul { margin: 4px 0 0 0; padding-left: 18px; font-size: 12px; }
  .gc-view li { margin-bottom: 2px; }
  .gc-view .schema { font-weight: 600; color: #36c; }
  .gc-view .empty { color: #999; font-style: italic; padding: 16px 0; }
  .gc-view .warn { color: #e55; font-weight: 600; }
</style>
`;

function schemaBadgeColor(schemaName: string): string {
    let h = 0;
    for (let i = 0; i < schemaName.length; i++) {
        h = (h * 31 + schemaName.charCodeAt(i)) & 0xffff;
    }
    return `hsl(${(h * 137) % 360}, 55%, 68%)`;
}

function renderCollisionsReport(
    collisions: CollisionGroup[],
    totalRules: number,
    schemasScanned: number,
    schemasSkipped: number,
): string {
    if (collisions.length === 0) {
        return `${COLLISION_STYLE}<div class="gc-view"><h3>Grammar collisions</h3>
<div class="summary">Scanned ${totalRules} rule(s) across ${schemasScanned} schema(s)${schemasSkipped > 0 ? ` (${schemasSkipped} skipped — no grammar)` : ""}.</div>
<div class="empty">No cross-agent grammar collisions detected.</div></div>`;
    }

    const highRiskCount = collisions.filter((g) =>
        g.entries.some((e) => e.anchor.terminatedByWildcard),
    ).length;
    const summary =
        `Scanned ${totalRules} rule(s) across ${schemasScanned} schema(s)` +
        (schemasSkipped > 0 ? ` (${schemasSkipped} skipped)` : "") +
        ` — found <b>${collisions.length}</b> collision group(s)` +
        (highRiskCount > 0
            ? `, <span class="warn">${highRiskCount} high-risk</span>`
            : "");

    let groups = "";
    for (const g of collisions) {
        const distinctSchemas = Array.from(
            new Set(g.entries.map((e) => e.schemaName)),
        );
        const hasWildcard = g.entries.some(
            (e) => e.anchor.terminatedByWildcard,
        );
        const cls = hasWildcard
            ? "group high"
            : distinctSchemas.length >= 3
              ? "group medium"
              : "group";
        const badges = distinctSchemas
            .map(
                (s) =>
                    `<span class="badge" style="background:${schemaBadgeColor(s)}">${escapeHtml(s)}</span>`,
            )
            .join("");
        const items = g.entries
            .map((e) => {
                const wildMark = e.anchor.terminatedByWildcard
                    ? ' <span title="Anchor ends at unconstrained wildcard" class="warn">⚠ wildcard</span>'
                    : "";
                return `<li><span class="schema">${escapeHtml(e.schemaName)}</span>${wildMark}</li>`;
            })
            .join("");
        groups += `<div class="${cls}">
  <div class="anchor">${escapeHtml(g.anchorKey)}</div>
  <div class="meta">${badges} · ${distinctSchemas.length} agents · ${g.entries.length} rule(s)${hasWildcard ? ' <span class="warn">· wildcard exposure</span>' : ""}</div>
  <ul>${items}</ul>
</div>`;
    }

    return `${COLLISION_STYLE}<div class="gc-view"><h3>Grammar collisions</h3>
<div class="summary">${summary}</div>
${groups}
</div>`;
}

function renderCollisionsText(
    collisions: CollisionGroup[],
    totalRules: number,
    schemasScanned: number,
    schemasSkipped: number,
): string[] {
    const lines: string[] = [];
    lines.push(
        `Scanned ${totalRules} rule(s) across ${schemasScanned} schema(s)` +
            (schemasSkipped > 0 ? ` (${schemasSkipped} skipped)` : ""),
    );
    if (collisions.length === 0) {
        lines.push("No cross-agent grammar collisions detected.");
        return lines;
    }
    const highRiskCount = collisions.filter((g) =>
        g.entries.some((e) => e.anchor.terminatedByWildcard),
    ).length;
    lines.push(
        `Found ${collisions.length} collision group(s)` +
            (highRiskCount > 0 ? `, ${highRiskCount} high-risk` : ""),
    );
    lines.push("");
    for (const g of collisions) {
        const distinct = Array.from(
            new Set(g.entries.map((e) => e.schemaName)),
        );
        const wild = g.entries.some((e) => e.anchor.terminatedByWildcard)
            ? "  ⚠"
            : "";
        lines.push(
            `[${g.anchorKey}]${wild} — ${distinct.length} agents (${distinct.join(", ")}), ${g.entries.length} rule(s)`,
        );
    }
    return lines;
}

class GrammarCollisionsCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Scan all loaded agent grammars for cross-agent collisions (rules whose anchors overlap)";

    public async run(context: ActionContext<CommandHandlerContext>) {
        displayStatus("Loading agent grammars…", context);
        const result = await scanGrammarCollisions(context, (msg) => {
            displayStatus(msg, context);
        });

        // Render the final report. HTML is the primary view; a text alternate
        // keeps the CLI experience usable.
        const html = renderCollisionsReport(
            result.collisions,
            result.totalRules,
            result.schemasScanned,
            result.schemasSkipped,
        );
        const text = renderCollisionsText(
            result.collisions,
            result.totalRules,
            result.schemasScanned,
            result.schemasSkipped,
        );
        context.actionIO.appendDisplay({
            type: "html",
            content: html,
            alternates: [{ type: "text", content: text }],
        });
    }
}

export function getGrammarCommandHandlers(): CommandHandlerTable {
    return {
        description: "Grammar rule and collision commands",
        defaultSubCommand: "list",
        commands: {
            list: new GrammarListCommandHandler(),
            show: new GrammarShowCommandHandler(),
            delete: new GrammarDeleteCommandHandler(),
            clear: new GrammarClearCommandHandler(),
            collisions: new GrammarCollisionsCommandHandler(),
        },
    };
}

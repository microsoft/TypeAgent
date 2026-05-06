// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
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
    scanGrammarCollisions,
    collectTopLevelRules,
} from "action-grammar";
import type {
    CollisionScanResult,
    CollisionRecord,
    SchemaInput,
    SchemaSkip,
} from "action-grammar";
import * as fs from "node:fs";
import * as path from "node:path";
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
// Grammar collision detection.
//
// Always runs the full NFA product-construction pass (see
// `findGrammarOverlap` in action-grammar) — the cheaper anchor-based
// heuristic was retired because the NFA path is fast enough at our scale
// and it actually produces a witness input rather than a guess.  An
// optional `--json <path>` flag dumps the structured scan result to disk
// for offline post-processing (grammar tuning, CI gates, diffs across
// changes).
// ---------------------------------------------------------------------------

class GrammarCollisionsCommandHandler implements CommandHandler {
    public readonly description =
        "Scan all loaded agent grammars for cross-agent collisions, with concrete witness inputs";
    public readonly parameters = {
        flags: {
            json: {
                description:
                    "Write the structured scan result to this path as JSON (in addition to rendering the report)",
                type: "string",
                optional: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        await runCollisionScan(context, params.flags.json);
    }
}

// ---------------------------------------------------------------------------
// Loaded-grammar bookkeeping local to this scan invocation.  We keep the
// original (un-stripped) grammars and rule lists in-memory so the HTML
// renderer can syntax-color rule patterns using the actual `GrammarPart`
// shapes — the JSON-friendly result returned by `scanGrammarCollisions`
// only carries pretty-printed strings, which is right for downstream
// tooling but loses the structure we want for colorization.
// ---------------------------------------------------------------------------

type LoadedSchema = {
    schemaName: string;
    grammar: Grammar;
    rules: GrammarRule[];
};

type PreloadSkipReason = "no-grammar" | "wrong-format" | "parse-error";

type SchemaSkipExt = SchemaSkip | {
    schemaName: string;
    reason: PreloadSkipReason;
    error?: string;
};

async function runCollisionScan(
    context: ActionContext<CommandHandlerContext>,
    jsonOutPath: string | undefined,
): Promise<void> {
    const systemContext = context.sessionContext.agentContext;
    const configs = systemContext.agents.getActionConfigs();

    // displayStatus replaces the previous status line in the shell, so
    // each call wipes whatever was there before.  Send a stable header on
    // the first line and a per-step counter on the second; only the
    // second line visually changes as the scan progresses.
    const compileHeader = "Processing grammar files";
    const pairHeader = "Pairwise NFA collision detection";
    displayStatus(`${compileHeader}\n[0/${configs.length}]`, context);

    // ---- Phase 0: preload — parse JSON and gather SchemaInput[] ----

    const inputs: SchemaInput[] = [];
    const loaded = new Map<string, LoadedSchema>();
    const preloadSkips: SchemaSkipExt[] = [];

    for (let i = 0; i < configs.length; i++) {
        const config = configs[i];
        displayStatus(
            `${compileHeader}\n[${i + 1}/${configs.length}] ${config.schemaName}`,
            context,
        );
        const grammarContent = getGrammarContent(config);
        if (!grammarContent) {
            preloadSkips.push({
                schemaName: config.schemaName,
                reason: "no-grammar",
            });
            continue;
        }
        if (grammarContent.format !== "ag") {
            preloadSkips.push({
                schemaName: config.schemaName,
                reason: "wrong-format",
            });
            continue;
        }
        let grammar: Grammar;
        try {
            grammar = grammarFromJson(JSON.parse(grammarContent.content));
        } catch (err) {
            preloadSkips.push({
                schemaName: config.schemaName,
                reason: "parse-error",
                error: err instanceof Error ? err.message : String(err),
            });
            continue;
        }
        inputs.push({
            schemaName: config.schemaName,
            agentName: getAppAgentName(config.schemaName),
            grammar,
        });
        loaded.set(config.schemaName, {
            schemaName: config.schemaName,
            grammar,
            rules: collectTopLevelRules(grammar),
        });
    }

    // ---- Phase 1+2: shared scanner does compile (with tail-call strip
    // fallback) and pairwise NFA intersection. ----

    const result = scanGrammarCollisions(inputs, {
        onProgress: (phase, index, total, label) => {
            const header = phase === "compile" ? compileHeader : pairHeader;
            displayStatus(`${header}\n[${index}/${total}] ${label}`, context);
        },
    });

    // Optional: write the structured scan result to disk so post-processing
    // tools can consume it.  Done before rendering so a write failure
    // surfaces visibly (the report is supplementary).
    if (jsonOutPath) {
        try {
            const merged = mergeSkipsForJson(result, preloadSkips);
            const absPath = path.resolve(jsonOutPath);
            fs.writeFileSync(absPath, JSON.stringify(merged, null, 2));
            displayStatus(`Wrote scan result to ${absPath}`, context);
        } catch (err) {
            displayWarn(
                `Failed to write JSON scan result to ${jsonOutPath}: ${err instanceof Error ? err.message : String(err)}`,
                context,
            );
        }
    }

    // ---- Render report ----

    const html = renderCollisionsReportHTML(result, preloadSkips, loaded);
    const text = renderCollisionsReportText(result, preloadSkips, loaded);
    context.actionIO.appendDisplay({
        type: "html",
        content: html,
        alternates: [{ type: "text", content: text }],
    });
}

/**
 * Fold the dispatcher's preload skips (no-grammar / wrong-format /
 * parse-error) into the scanner's `skipped` list so the JSON output is a
 * single source of truth: anything that didn't make it into a pairwise
 * check shows up here with a reason.  The result has a wider `skipped`
 * type than `CollisionScanResult` since the scanner only reports
 * `compile-error` itself.
 */
function mergeSkipsForJson(
    result: CollisionScanResult,
    preloadSkips: SchemaSkipExt[],
): Omit<CollisionScanResult, "skipped"> & { skipped: SchemaSkipExt[] } {
    return { ...result, skipped: [...preloadSkips, ...result.skipped] };
}

// ---------------------------------------------------------------------------
// Rendering.  HTML uses inline `style="…"` attributes everywhere because
// the shell strips `<style>` blocks during sanitization.  Color palette
// mirrors `highlightGrammarText` in `grammarActionHandler.ts` so the two
// views read consistently.
// ---------------------------------------------------------------------------

function escapeHtml(s: unknown): string {
    // Tolerant of non-strings: stringifies first.  Some callers feed
    // values from `JSON.stringify(...)` whose result is `string | undefined`
    // when the input is `undefined`; defending here keeps the renderer
    // from exploding on malformed action shapes.
    const str = typeof s === "string" ? s : String(s);
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const C_LITERAL = "#080";
const C_VAR = "#36c";
const C_TYPE_SAFE = "#690";
const C_TYPE_RISKY = "#c44";
const C_PHRASESET = "#28a";
const C_RULES = "#55c";
const C_OP = "#90c";
const C_PUNCT = "#888";
const C_MUTED = "#777";
const C_DIM = "#999";

function schemaBadgeColor(schemaName: string): string {
    let h = 0;
    for (let i = 0; i < schemaName.length; i++) {
        h = (h * 31 + schemaName.charCodeAt(i)) & 0xffff;
    }
    return `hsl(${(h * 137) % 360}, 55%, 68%)`;
}

function schemaBadgeHTML(schemaName: string): string {
    return (
        `<span style="display:inline-block;padding:1px 8px;border-radius:10px;` +
        `font-size:11px;font-weight:600;color:#222;` +
        `background:${schemaBadgeColor(schemaName)}">${escapeHtml(schemaName)}</span>`
    );
}

function renderRulePartsHTML(parts: GrammarPart[]): string {
    return parts.map((p) => renderPartHTML(p, 0)).join(" ");
}

/**
 * Syntax-colored part renderer.  At depth 0 a small `RulesPart` is expanded
 * inline so the user sees the actual alternation; deeper or larger
 * `RulesPart`s collapse to `<N alternatives>` to keep the report bounded.
 */
function renderPartHTML(part: GrammarPart, depth: number): string {
    switch (part.type) {
        case "string":
            return `<span style="color:${C_LITERAL};font-weight:600">${escapeHtml(part.value.join(" "))}</span>`;
        case "wildcard":
            return renderCaptureHTML(
                part.variable,
                part.typeName,
                part.optional,
            );
        case "number":
            return renderCaptureHTML(part.variable, "number", part.optional);
        case "phraseSet":
            return (
                `<span style="color:${C_PUNCT}">&lt;</span>` +
                `<span style="color:${C_PHRASESET};font-style:italic">${escapeHtml(part.matcherName)}</span>` +
                `<span style="color:${C_PUNCT}">&gt;</span>`
            );
        case "rules": {
            const alts = part.alternatives ?? [];
            const optMark =
                (part.optional ? "?" : "") + (part.repeat ? "*" : "");
            const optHTML = optMark
                ? `<span style="color:${C_OP}">${optMark}</span>`
                : "";
            if (alts.length > 0 && alts.length <= 4 && depth === 0) {
                const expansion = alts
                    .map((r) =>
                        r.parts
                            .map((p) => renderPartHTML(p, depth + 1))
                            .join(" "),
                    )
                    .join(` <span style="color:${C_OP}">|</span> `);
                return (
                    `<span style="color:${C_PUNCT}">(</span>${expansion}<span style="color:${C_PUNCT}">)</span>${optHTML}`
                );
            }
            const label =
                alts.length > 0 ? `${alts.length} alternatives` : "rules";
            return (
                `<span style="color:${C_PUNCT}">&lt;</span>` +
                `<span style="color:${C_RULES};font-style:italic">${label}</span>` +
                `<span style="color:${C_PUNCT}">&gt;</span>${optHTML}`
            );
        }
        default:
            return "?";
    }
}

function renderCaptureHTML(
    name: string,
    typeName: string | undefined,
    optional: boolean | undefined,
): string {
    const isRisky =
        !typeName ||
        typeName === "wildcard" ||
        typeName === "string" ||
        typeName === "word";
    const typeColor = isRisky ? C_TYPE_RISKY : C_TYPE_SAFE;
    const typePart = typeName
        ? `<span style="color:${C_PUNCT}">:</span><span style="color:${typeColor};font-weight:600">${escapeHtml(typeName)}</span>`
        : "";
    const opt = optional ? `<span style="color:${C_OP}">?</span>` : "";
    return (
        `<span style="color:${C_TYPE_RISKY}">$</span>` +
        `<span style="color:${C_PUNCT}">(</span>` +
        `<span style="color:${C_VAR}">${escapeHtml(name)}</span>` +
        `${typePart}` +
        `<span style="color:${C_PUNCT}">)</span>${opt}`
    );
}

/**
 * Render the witness as a colored monospace box, lighting up synthetic
 * `<TypeName>` placeholder tokens (which can't actually appear at runtime
 * but stand in for an unknown member of the type's accepted language).
 */
function renderWitnessHTML(witness: string[]): string {
    const tokens = witness
        .map((t) => {
            const isPlaceholder =
                t.startsWith("<") && (t.endsWith(">") || t.includes("∩"));
            if (isPlaceholder) {
                return `<span style="color:#c80;font-style:italic">${escapeHtml(t)}</span>`;
            }
            return `<span style="color:#222">${escapeHtml(t)}</span>`;
        })
        .join(" ");
    return (
        `<code style="background:#f5f5f5;border:1px solid #e0e0e0;` +
        `padding:2px 8px;border-radius:3px;font-size:12px;">${tokens}</code>`
    );
}

/**
 * Render the matched action object as `actionName({param: "value", …})` —
 * the user's mental model is "what action would this input dispatch?",
 * which the rule pattern alone can't answer when the top-level rule is a
 * single dispatching `<rules>` reference.
 */
function renderMatchPreviewHTML(match: unknown): string {
    if (match === undefined || match === null) {
        return `<span style="color:${C_DIM};font-style:italic">no match</span>`;
    }
    if (typeof match !== "object") {
        return `<code style="color:${C_LITERAL}">${escapeHtml(formatValue(match))}</code>`;
    }
    const m = match as { actionName?: string; parameters?: unknown };
    const actionName = m.actionName ?? "?";
    const params =
        m.parameters && typeof m.parameters === "object"
            ? Object.entries(m.parameters as Record<string, unknown>)
                  .map(
                      ([k, v]) =>
                          `<span style="color:${C_VAR}">${escapeHtml(k)}</span>` +
                          `<span style="color:${C_PUNCT}">:</span> ` +
                          `<span style="color:${C_LITERAL}">${escapeHtml(formatValue(v))}</span>`,
                  )
                  .join(`<span style="color:${C_PUNCT}">, </span>`)
            : "";
    return (
        `<code style="font-size:12px;">` +
        `<span style="color:${C_TYPE_SAFE};font-weight:600">${escapeHtml(actionName)}</span>` +
        `<span style="color:${C_PUNCT}">(</span>${params}<span style="color:${C_PUNCT}">)</span>` +
        `</code>`
    );
}

/**
 * Stringify a value for display.  Plain `JSON.stringify` returns the
 * value `undefined` (not the string "undefined") for `undefined` inputs,
 * which crashes downstream string ops; this helper keeps the output a
 * string for every input.
 */
function formatValue(v: unknown): string {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "string") return JSON.stringify(v);
    try {
        return JSON.stringify(v) ?? String(v);
    } catch {
        return String(v);
    }
}

const SKIP_REASON_LABEL: Record<string, string> = {
    "no-grammar": "no grammar registered",
    "wrong-format": "non-NFA grammar format",
    "parse-error": "grammar JSON parse failed",
    "compile-error": "NFA compile failed",
};

function aggregateSkips(
    preloadSkips: SchemaSkipExt[],
    scannerSkips: SchemaSkip[],
): Map<string, { count: number; samples: string[]; lastError?: string }> {
    const buckets = new Map<
        string,
        { count: number; samples: string[]; lastError?: string }
    >();
    const all: SchemaSkipExt[] = [...preloadSkips, ...scannerSkips];
    for (const s of all) {
        const b = buckets.get(s.reason) ?? { count: 0, samples: [] };
        b.count++;
        if (b.samples.length < 5) b.samples.push(s.schemaName);
        if ("error" in s && s.error) b.lastError = s.error;
        buckets.set(s.reason, b);
    }
    return buckets;
}

function renderSkipBreakdownHTML(
    preloadSkips: SchemaSkipExt[],
    result: CollisionScanResult,
): string {
    const buckets = aggregateSkips(preloadSkips, result.skipped);
    const strippedCount = Object.values(result.schemas).filter(
        (s) => s.compiledWithStripping,
    ).length;
    const total = Array.from(buckets.values()).reduce(
        (n, b) => n + b.count,
        0,
    );
    if (total === 0 && strippedCount === 0) return "";

    const items: string[] = [];
    for (const reason of [
        "no-grammar",
        "wrong-format",
        "parse-error",
        "compile-error",
    ]) {
        const b = buckets.get(reason);
        if (!b || b.count === 0) continue;
        const samples = b.samples
            .map(
                (s) =>
                    `<span style="font-family:monospace;color:${C_RULES}">${escapeHtml(s)}</span>`,
            )
            .join(", ");
        const more = b.count > b.samples.length ? ", …" : "";
        const errLine = b.lastError
            ? `<div style="margin-left:16px;color:${C_DIM};font-size:11px;font-family:monospace;">${escapeHtml(b.lastError)}</div>`
            : "";
        items.push(
            `<li><b>${b.count}</b> ${escapeHtml(SKIP_REASON_LABEL[reason] ?? reason)} — ${samples}${more}${errLine}</li>`,
        );
    }
    if (strippedCount > 0) {
        items.push(
            `<li><b>${strippedCount}</b> compiled after stripping <code style="color:${C_OP}">tailCall</code> markers (optimizer-only flag the NFA path can't handle; language acceptance preserved)</li>`,
        );
    }
    return (
        `<details style="margin-bottom:12px;font-size:12px;color:${C_MUTED};">` +
        `<summary style="cursor:pointer;">Why ${total} schema(s) ${total === 1 ? "was" : "were"} skipped${strippedCount > 0 ? ` (${strippedCount} also auto-fixed)` : ""}</summary>` +
        `<ul style="margin:6px 0 0 0;padding-left:20px;">${items.join("")}</ul>` +
        `</details>`
    );
}

function renderCollisionsReportHTML(
    result: CollisionScanResult,
    preloadSkips: SchemaSkipExt[],
    loaded: Map<string, LoadedSchema>,
): string {
    const collisions = sortCollisions(Object.values(result.collisions));
    const schemasScanned = Object.keys(result.schemas).length;
    const totalSkip = preloadSkips.length + result.skipped.length;
    const strippedCount = Object.values(result.schemas).filter(
        (s) => s.compiledWithStripping,
    ).length;

    const skipText =
        totalSkip > 0
            ? ` (${totalSkip} schema(s) skipped${strippedCount > 0 ? `; ${strippedCount} compiled with tailCall markers stripped` : ""})`
            : strippedCount > 0
              ? ` (${strippedCount} compiled with tailCall markers stripped)`
              : "";
    const wrapStart = `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:1000px;">`;
    const wrapEnd = `</div>`;
    const header = `<h3 style="margin:0 0 8px;font-size:14px;">Grammar collisions</h3>`;
    const breakdown = renderSkipBreakdownHTML(preloadSkips, result);

    if (collisions.length === 0) {
        return (
            wrapStart +
            header +
            `<div style="color:${C_MUTED};font-size:12px;margin-bottom:8px;">Scanned ${result.totalRules} rule(s) across ${schemasScanned} schema(s)${skipText}.</div>` +
            breakdown +
            `<div style="color:${C_DIM};font-style:italic;padding:16px 0;">No cross-agent grammar collisions detected.</div>` +
            wrapEnd
        );
    }

    const placeholderCount = collisions.filter(
        (c) => c.hasPlaceholders,
    ).length;
    const summary =
        `Scanned ${result.totalRules} rule(s) across ${schemasScanned} schema(s)${skipText}` +
        ` — found <b>${collisions.length}</b> overlapping pair(s)` +
        (placeholderCount > 0
            ? `, <span style="color:#e55;font-weight:600">${placeholderCount} requires manual review</span> (custom entity types)`
            : "");

    let pairs = "";
    for (const c of collisions) {
        pairs += renderPairCardHTML(c, loaded);
    }

    return (
        wrapStart +
        header +
        `<div style="color:${C_MUTED};font-size:12px;margin-bottom:8px;">${summary}</div>` +
        breakdown +
        pairs +
        wrapEnd
    );
}

function renderPairCardHTML(
    c: CollisionRecord,
    loaded: Map<string, LoadedSchema>,
): string {
    const accentColor = c.hasPlaceholders ? "#e55" : "#aaa";
    const cardStyle =
        `border:1px solid #e0e0e0;border-left:4px solid ${accentColor};` +
        `border-radius:4px;padding:10px 12px;margin-bottom:10px;` +
        `background:#fff;`;
    const labelStyle = `color:${C_MUTED};font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-right:6px;`;

    const headerLine =
        `<div style="margin-bottom:8px;">` +
        schemaBadgeHTML(c.schemaA) +
        ` <span style="color:${C_MUTED}">×</span> ` +
        schemaBadgeHTML(c.schemaB) +
        `</div>`;

    const witnessLine =
        `<div style="margin:6px 0;">` +
        `<span style="${labelStyle}">witness</span>` +
        renderWitnessHTML(c.witness) +
        `</div>`;

    const ruleA = renderRuleSection(
        c.schemaA,
        c.ruleIndexA,
        c.matchA,
        labelStyle,
        loaded,
    );
    const ruleB = renderRuleSection(
        c.schemaB,
        c.ruleIndexB,
        c.matchB,
        labelStyle,
        loaded,
    );

    const note = c.hasPlaceholders
        ? `<div style="margin-top:8px;color:${C_MUTED};font-size:11px;">` +
          `Witness contains synthetic <code style="color:#c80">&lt;TypeName&gt;</code> placeholders because at least one wildcard requires a custom entity type whose accepted strings can't be enumerated.  Inspect the rules to confirm whether the type sets actually overlap.</div>`
        : "";

    return `<div style="${cardStyle}">${headerLine}${witnessLine}${ruleA}${ruleB}${note}</div>`;
}

function renderRuleSection(
    schemaName: string,
    ruleIndex: number | undefined,
    match: unknown,
    labelStyle: string,
    loaded: Map<string, LoadedSchema>,
): string {
    const rule =
        ruleIndex !== undefined
            ? loaded.get(schemaName)?.rules[ruleIndex]
            : undefined;
    if (!rule) return "";
    const ruleHTML = renderRulePartsHTML(rule.parts);
    const matchHTML =
        match !== undefined
            ? `<div style="margin:2px 0 0 8px;color:${C_MUTED};font-size:12px;">→ ` +
              renderMatchPreviewHTML(match) +
              `</div>`
            : "";
    return (
        `<div style="margin:6px 0 0;">` +
        `<span style="${labelStyle}">${escapeHtml(schemaName)} rule</span>` +
        `<code style="font-size:12px;">${ruleHTML}</code>` +
        `</div>` +
        matchHTML
    );
}

/**
 * Order: high-risk (placeholder witnesses indicate type-only overlap and
 * need manual review) first, then by witness length (shorter = more
 * worrying), then alphabetically by schema pair.
 */
function sortCollisions(collisions: CollisionRecord[]): CollisionRecord[] {
    return [...collisions].sort((a, b) => {
        if (a.hasPlaceholders !== b.hasPlaceholders) {
            return a.hasPlaceholders ? -1 : 1;
        }
        if (a.witness.length !== b.witness.length) {
            return a.witness.length - b.witness.length;
        }
        const ka = `${a.schemaA}|${a.schemaB}`;
        const kb = `${b.schemaA}|${b.schemaB}`;
        return ka.localeCompare(kb);
    });
}

function renderCollisionsReportText(
    result: CollisionScanResult,
    preloadSkips: SchemaSkipExt[],
    _loaded: Map<string, LoadedSchema>,
): string[] {
    const lines: string[] = [];
    const collisions = sortCollisions(Object.values(result.collisions));
    const schemasScanned = Object.keys(result.schemas).length;
    const totalSkip = preloadSkips.length + result.skipped.length;
    const strippedCount = Object.values(result.schemas).filter(
        (s) => s.compiledWithStripping,
    ).length;

    const skipText =
        totalSkip > 0
            ? ` (${totalSkip} skipped${strippedCount > 0 ? `; ${strippedCount} stripped tailCall` : ""})`
            : strippedCount > 0
              ? ` (${strippedCount} stripped tailCall)`
              : "";
    lines.push(
        `Scanned ${result.totalRules} rule(s) across ${schemasScanned} schema(s)${skipText}`,
    );

    if (totalSkip > 0) {
        const buckets = aggregateSkips(preloadSkips, result.skipped);
        for (const reason of [
            "no-grammar",
            "wrong-format",
            "parse-error",
            "compile-error",
        ]) {
            const b = buckets.get(reason);
            if (!b || b.count === 0) continue;
            const samples = b.samples.join(", ");
            const more = b.count > b.samples.length ? ", …" : "";
            lines.push(
                `  ${b.count} ${SKIP_REASON_LABEL[reason] ?? reason}: ${samples}${more}`,
            );
            if (b.lastError) lines.push(`    last error: ${b.lastError}`);
        }
    }

    if (collisions.length === 0) {
        lines.push("");
        lines.push("No cross-agent grammar collisions detected.");
        return lines;
    }

    const placeholderCount = collisions.filter(
        (c) => c.hasPlaceholders,
    ).length;
    lines.push(
        `Found ${collisions.length} overlapping pair(s)` +
            (placeholderCount > 0
                ? `, ${placeholderCount} require manual review (custom entity types)`
                : ""),
    );
    lines.push("");
    for (const c of collisions) {
        const flag = c.hasPlaceholders ? "  ⚠" : "";
        lines.push(`${c.schemaA} × ${c.schemaB}${flag}`);
        lines.push(`  witness: ${c.witnessText}`);
        if (c.rulePatternA)
            lines.push(`  ${c.schemaA}: ${c.rulePatternA}`);
        if (c.rulePatternB)
            lines.push(`  ${c.schemaB}: ${c.rulePatternB}`);
        lines.push("");
    }
    return lines;
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

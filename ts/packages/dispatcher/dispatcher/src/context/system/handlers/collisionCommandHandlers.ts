// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayStatus, displayWarn } from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    CollisionEvent,
    CollisionEventKind,
    getRecentCollisionEvents,
} from "../../collisionTelemetry.js";
import {
    ActionSimilarityPair,
    ActionSimilarityScanInput,
    ActionSimilarityScanResult,
    ActionVectorKey,
    computeActionSimilarity,
} from "../../../translation/actionSimilarity.js";
import { getAppAgentName } from "../../../translation/agentTranslators.js";

// ---------------------------------------------------------------------------
// `@collision events` — show recent events captured in the in-memory ring
// buffer.  Lets a tester confirm in-flight that detection is firing during
// a Phase 1 / Phase 2 experiment without shelling out to the per-session
// JSONL file.  See the soft-rollout plan
// (`docs/architecture/collision-rollout.md`) for the surrounding workflow.
// ---------------------------------------------------------------------------

const VALID_KINDS: readonly CollisionEventKind[] = [
    "static",
    "grammarMatch",
    "llmSelect",
    "fuzzy",
];

class CollisionEventsCommandHandler implements CommandHandler {
    public readonly description =
        "Show recent collision events captured in the current session's ring buffer";
    public readonly parameters = {
        flags: {
            limit: {
                description: "Maximum number of events to show (default 10)",
                char: "n",
                type: "number",
                default: 10,
            },
            kind: {
                description: `Filter by detection point (one of: ${VALID_KINDS.join(", ")})`,
                char: "k",
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
        const cfg = systemContext.session.getConfig().collision;
        const limit = Math.max(1, params.flags.limit ?? 10);
        const kindFilter = params.flags.kind?.trim() as
            | CollisionEventKind
            | undefined;

        if (
            kindFilter !== undefined &&
            !VALID_KINDS.includes(kindFilter)
        ) {
            displayWarn(
                `Unknown --kind "${kindFilter}". Valid values: ${VALID_KINDS.join(", ")}.`,
                context,
            );
            return;
        }

        // Pull from the ring buffer.  Filter first, then limit so the user
        // gets `limit` events of the requested kind even when the buffer
        // is dominated by other kinds.
        const all = getRecentCollisionEvents(systemContext);
        const filtered = kindFilter
            ? all.filter((e) => e.kind === kindFilter)
            : all;
        const events = filtered.slice(-limit);

        const html = renderCollisionEventsHTML(events, {
            kindFilter,
            limit,
            totalInBuffer: all.length,
            telemetryEmit: cfg.telemetry.emit,
            experimentId: cfg.telemetry.experimentId,
        });
        const text = renderCollisionEventsText(events, {
            kindFilter,
            limit,
            totalInBuffer: all.length,
            telemetryEmit: cfg.telemetry.emit,
            experimentId: cfg.telemetry.experimentId,
        });
        context.actionIO.appendDisplay({
            type: "html",
            content: html,
            alternates: [{ type: "text", content: text }],
        });
    }
}

// ---- Rendering -----------------------------------------------------------
//
// Inline `style="…"` everywhere because the shell sanitizer strips
// `<style>` blocks (same constraint as the grammar collision renderer).
// Color palette mirrors `configCommandHandlers.ts` collision-show table
// so the two views read consistently.

function escapeHtml(s: unknown): string {
    const str = typeof s === "string" ? s : String(s);
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function schemaBadgeColor(schemaName: string): string {
    let h = 0;
    for (let i = 0; i < schemaName.length; i++) {
        h = (h * 31 + schemaName.charCodeAt(i)) & 0xffff;
    }
    return `hsl(${(h * 137) % 360}, 55%, 68%)`;
}

function schemaBadge(schemaName: string): string {
    return (
        `<span style="display:inline-block;padding:1px 6px;border-radius:10px;` +
        `font-size:11px;font-weight:600;color:#222;` +
        `background:${schemaBadgeColor(schemaName)}">${escapeHtml(schemaName)}</span>`
    );
}

function kindBadge(kind: CollisionEventKind): string {
    const colors: Record<CollisionEventKind, [string, string]> = {
        static: ["#666", "#eee"],
        grammarMatch: ["#36c", "#e8f0ff"],
        llmSelect: ["#690", "#e8f5e0"],
        fuzzy: ["#c80", "#fff3e0"],
    };
    const [fg, bg] = colors[kind];
    return (
        `<span style="display:inline-block;padding:1px 6px;border-radius:3px;` +
        `font-family:monospace;font-size:11px;font-weight:600;color:${fg};background:${bg};">${escapeHtml(kind)}</span>`
    );
}

function strategyBadge(strategy: string): string {
    const isDefault = strategy === "first-match" || strategy === "warn";
    const isRisky =
        strategy === "user-clarify" ||
        strategy === "error" ||
        strategy === "downgraded";
    const fg = isDefault ? "#888" : isRisky ? "#c44" : "#36c";
    const bg = isDefault ? "#eee" : isRisky ? "#fee" : "#e8f0ff";
    return (
        `<span style="display:inline-block;padding:1px 6px;border-radius:10px;` +
        `font-family:monospace;font-size:11px;font-weight:600;color:${fg};background:${bg};">${escapeHtml(strategy)}</span>`
    );
}

/**
 * Did the chosen candidate diverge from what `first-match` would have
 * picked?  Returns undefined when we can't tell (e.g. user-clarify before
 * the user has picked, or static where there's no first-match concept).
 */
function divergedFromFirstMatch(event: CollisionEvent): boolean | undefined {
    if (!event.firstMatchCandidate || !event.chosen) return undefined;
    return (
        event.firstMatchCandidate.schemaName !== event.chosen.schemaName ||
        event.firstMatchCandidate.actionName !== event.chosen.actionName
    );
}

function relativeTime(timestamp: number): string {
    const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${Math.round(seconds)}s ago`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.round(minutes)}m ago`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.round(hours)}h ago`;
    return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

interface RenderContext {
    kindFilter: CollisionEventKind | undefined;
    limit: number;
    totalInBuffer: number;
    telemetryEmit: boolean;
    experimentId: string;
}

function renderCollisionEventsHTML(
    events: CollisionEvent[],
    ctx: RenderContext,
): string {
    const C_MUTED = "#777";
    const wrap = `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:1000px;">`;

    const banner =
        !ctx.telemetryEmit && events.length === 0
            ? `<div style="color:#c80;background:#fff8e0;padding:6px 10px;border-radius:3px;font-size:12px;margin-bottom:10px;">Telemetry capture is <b>off</b> — no events are being recorded. Run <code>@config collision telemetry emit on</code> to start recording.</div>`
            : "";

    const filterLabel = ctx.kindFilter
        ? `kind=${kindBadge(ctx.kindFilter)} · `
        : "";
    const expIdLabel = ctx.experimentId
        ? ` · experiment=<code style="background:#e8f0ff;color:#36c;padding:1px 4px;border-radius:2px;">"${escapeHtml(ctx.experimentId)}"</code>`
        : "";
    const summary = `<div style="color:${C_MUTED};font-size:12px;margin-bottom:10px;">${filterLabel}showing ${events.length} of ${ctx.totalInBuffer} buffered event(s) (limit=${ctx.limit})${expIdLabel}</div>`;

    if (events.length === 0) {
        return (
            wrap +
            `<h3 style="margin:0 0 8px;font-size:14px;">Collision events</h3>` +
            banner +
            summary +
            `<div style="color:#999;font-style:italic;padding:16px 0;">No events in the ring buffer${ctx.kindFilter ? ` for kind=${ctx.kindFilter}` : ""}.</div>` +
            `</div>`
        );
    }

    const headStyle =
        "padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;font-weight:600;color:#555;";
    const cellStyle = "padding:6px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;";

    let rows = "";
    // Render newest first so the most recent event is at the top — testers
    // typically want "what just happened?", not full history.
    for (const event of [...events].reverse()) {
        const candidatesHTML = event.candidates
            .map((c) => schemaBadge(c.schemaName))
            .join(" ");
        const chosenHTML = event.chosen
            ? schemaBadge(event.chosen.schemaName) +
              `<span style="color:${C_MUTED};font-family:monospace;font-size:11px;margin-left:4px;">.${escapeHtml(event.chosen.actionName)}</span>`
            : `<span style="color:#999;font-style:italic;">(none)</span>`;

        const diverged = divergedFromFirstMatch(event);
        const divergeMark =
            diverged === true
                ? ` <span title="chosen ≠ first-match counterfactual" style="color:#c80;">⚡</span>`
                : "";

        const requestText = event.request
            ? `<code style="font-family:monospace;font-size:11px;color:#222;">${escapeHtml(truncate(event.request, 60))}</code>`
            : `<span style="color:#999;font-style:italic;">—</span>`;

        const elapsed =
            event.elapsedMs !== undefined
                ? `${event.elapsedMs.toFixed(1)}ms`
                : "—";

        const note = event.note
            ? `<div style="color:${C_MUTED};font-size:11px;margin-top:2px;">${escapeHtml(event.note)}</div>`
            : "";

        rows += `<tr>
            <td style="${cellStyle}color:${C_MUTED};font-size:11px;white-space:nowrap;">${escapeHtml(relativeTime(event.timestamp))}</td>
            <td style="${cellStyle}">${kindBadge(event.kind)}</td>
            <td style="${cellStyle}">${requestText}</td>
            <td style="${cellStyle}">${candidatesHTML}</td>
            <td style="${cellStyle}">${chosenHTML}${divergeMark}${note}</td>
            <td style="${cellStyle}">${strategyBadge(event.strategy)}</td>
            <td style="${cellStyle}color:${C_MUTED};font-size:11px;font-family:monospace;text-align:right;">${elapsed}</td>
        </tr>`;
    }

    return (
        wrap +
        `<h3 style="margin:0 0 8px;font-size:14px;">Collision events</h3>` +
        banner +
        summary +
        `<table style="border-collapse:collapse;width:100%;font-size:12px;">` +
        `<thead><tr style="background:#fafafa;">` +
        `<th style="${headStyle}">When</th>` +
        `<th style="${headStyle}">Kind</th>` +
        `<th style="${headStyle}">Request</th>` +
        `<th style="${headStyle}">Candidates</th>` +
        `<th style="${headStyle}">Chosen</th>` +
        `<th style="${headStyle}">Strategy</th>` +
        `<th style="${headStyle}">Elapsed</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>` +
        `<div style="color:${C_MUTED};font-size:11px;margin-top:8px;">⚡ marks events where the chosen candidate differs from the <code>first-match</code> counterfactual — a real strategy divergence worth a closer look.</div>` +
        `</div>`
    );
}

function renderCollisionEventsText(
    events: CollisionEvent[],
    ctx: RenderContext,
): string[] {
    const lines: string[] = [];
    const filter = ctx.kindFilter ? ` (kind=${ctx.kindFilter})` : "";
    const exp = ctx.experimentId ? ` experiment="${ctx.experimentId}"` : "";
    lines.push(
        `Collision events${filter}: showing ${events.length} of ${ctx.totalInBuffer} buffered (limit=${ctx.limit})${exp}`,
    );
    if (!ctx.telemetryEmit && events.length === 0) {
        lines.push(
            "  Telemetry capture is OFF — `@config collision telemetry emit on` to start.",
        );
        return lines;
    }
    if (events.length === 0) {
        lines.push("  No events in the ring buffer.");
        return lines;
    }
    lines.push("");
    for (const event of [...events].reverse()) {
        const ts = relativeTime(event.timestamp);
        const candidates = event.candidates
            .map((c) => `${c.schemaName}.${c.actionName}`)
            .join(", ");
        const chosen = event.chosen
            ? `${event.chosen.schemaName}.${event.chosen.actionName}`
            : "(none)";
        const diverged = divergedFromFirstMatch(event);
        const flag = diverged === true ? " ⚡diverged" : "";
        const elapsed =
            event.elapsedMs !== undefined
                ? ` ${event.elapsedMs.toFixed(1)}ms`
                : "";
        lines.push(
            `[${ts}] ${event.kind} strategy=${event.strategy}${elapsed}${flag}`,
        );
        if (event.request) {
            lines.push(`  request: ${truncate(event.request, 80)}`);
        }
        lines.push(`  candidates: ${candidates}`);
        lines.push(`  chosen: ${chosen}`);
        if (event.note) lines.push(`  note: ${event.note}`);
        lines.push("");
    }
    return lines;
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
}

// ===========================================================================
// `@collision similar` — multi-vector pairwise action similarity (S1 of the
// soft-rollout plan).  Surfaces semantic collisions that the grammar / NFA
// path can't see — actions that are the same kind of operation even when
// their `.agr` patterns don't overlap.
// ===========================================================================

const SIMILARITY_CACHE_RELATIVE = path.join(
    "agentCache",
    "actionSimilarity",
    "embeddings.json",
);

class CollisionSimilarCommandHandler implements CommandHandler {
    public readonly description =
        "Find semantically similar actions across agents (multi-vector embedding similarity)";
    public readonly parameters = {
        flags: {
            threshold: {
                description:
                    "Aggregate-score threshold (0–1.3 effective range; default 0.7)",
                char: "t",
                type: "number",
                default: 0.7,
            },
            top: {
                description: "Maximum number of pairs to render (default 50)",
                char: "n",
                type: "number",
                default: 50,
            },
            json: {
                description:
                    "Write the structured scan result to this path as JSON (in addition to rendering)",
                type: "string",
                optional: true,
            },
            "no-cache": {
                description:
                    "Skip the on-disk embedding cache (forces re-embed)",
                type: "boolean",
                default: false,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const configs = systemContext.agents.getActionConfigs();

        // Build inputs from every loaded action config.  Skip configs
        // whose schema file fails to load (rare; agent registration
        // would normally have already errored).  The embedding model is
        // lazily created inside the engine if not provided here.
        const inputs: ActionSimilarityScanInput[] = [];
        const skipped: { schemaName: string; reason: string }[] = [];
        for (const config of configs) {
            try {
                const actionSchemaFile =
                    systemContext.agents.getActionSchemaFileForConfig(config);
                inputs.push({
                    schemaName: config.schemaName,
                    agentName: getAppAgentName(config.schemaName),
                    actionSchemaFile,
                });
            } catch (err) {
                skipped.push({
                    schemaName: config.schemaName,
                    reason:
                        err instanceof Error ? err.message : String(err),
                });
            }
        }

        if (inputs.length === 0) {
            displayWarn(
                "No agent action schemas available to scan.",
                context,
            );
            return;
        }

        const cachePath = params.flags["no-cache"]
            ? undefined
            : resolveSimilarityCachePath(systemContext);

        const compileHeader = "Embedding action vectors";
        const scoreHeader = "Pairwise similarity";
        displayStatus(
            `${compileHeader}\n[0/${inputs.length}] preparing…`,
            context,
        );

        const result = await computeActionSimilarity(inputs, {
            threshold: params.flags.threshold ?? 0.7,
            cachePath,
            onProgress: (phase, index, total, label) => {
                const header =
                    phase === "embedding" ? compileHeader : scoreHeader;
                displayStatus(
                    `${header}\n[${index}/${total}]${label ? ` ${label}` : ""}`,
                    context,
                );
            },
        });

        if (params.flags.json) {
            try {
                const absPath = path.resolve(params.flags.json);
                fs.writeFileSync(
                    absPath,
                    JSON.stringify(result, null, 2),
                );
            } catch (err) {
                displayWarn(
                    `Failed to write JSON scan result to ${params.flags.json}: ${err instanceof Error ? err.message : String(err)}`,
                    context,
                );
            }
        }

        const top = Math.max(1, params.flags.top ?? 50);
        const html = renderActionSimilarityHTML(result, skipped, top);
        const text = renderActionSimilarityText(result, skipped, top);
        context.actionIO.appendDisplay({
            type: "html",
            content: html,
            alternates: [{ type: "text", content: text }],
        });
    }
}

/**
 * Resolve the cache path for the multi-vector embeddings.  Lives under
 * the dispatcher's instance dir so it survives session resets and is
 * shared across sessions on the same profile (the embeddings only
 * depend on action shape, not session state).
 */
function resolveSimilarityCachePath(
    ctx: CommandHandlerContext,
): string | undefined {
    const root = ctx.instanceDir;
    if (!root) return undefined;
    return path.join(root, SIMILARITY_CACHE_RELATIVE);
}

// ---- HTML rendering ------------------------------------------------------

function renderActionSimilarityHTML(
    result: ActionSimilarityScanResult,
    skipped: { schemaName: string; reason: string }[],
    top: number,
): string {
    const C_MUTED = "#777";
    const wrap = `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:1100px;">`;
    const header = `<h3 style="margin:0 0 6px;font-size:14px;">Semantic action similarity (multi-vector)</h3>`;

    const summaryLines = [
        `Scanned <b>${result.actionCount}</b> action(s) across <b>${result.schemaCount}</b> schema(s)`,
        `threshold=<code style="background:#f5f5f5;padding:1px 4px;border-radius:2px;">${result.threshold.toFixed(2)}</code>`,
        `pairs above threshold: <b>${result.pairs.length}</b>`,
    ].join(" · ");

    const skipNote =
        skipped.length > 0
            ? `<div style="color:#c80;font-size:11px;margin:4px 0;">${skipped.length} schema(s) failed to load: ${skipped
                  .map((s) => `<code>${escapeHtml(s.schemaName)}</code>`)
                  .join(", ")}</div>`
            : "";

    if (result.pairs.length === 0) {
        return (
            wrap +
            header +
            `<div style="color:${C_MUTED};font-size:12px;margin-bottom:8px;">${summaryLines}</div>` +
            skipNote +
            `<div style="color:#999;font-style:italic;padding:16px 0;">No action pairs above threshold ${result.threshold.toFixed(2)}.</div>` +
            `</div>`
        );
    }

    const shown = result.pairs.slice(0, top);
    const truncated =
        result.pairs.length > shown.length
            ? `<div style="color:${C_MUTED};font-size:11px;margin-top:6px;">…${result.pairs.length - shown.length} more pair(s) above threshold not shown (use <code>--top &lt;n&gt;</code> to see more, <code>--json &lt;path&gt;</code> for full export).</div>`
            : "";

    let cards = "";
    for (const pair of shown) {
        cards += renderPairCardHTML(pair);
    }

    return (
        wrap +
        header +
        `<div style="color:${C_MUTED};font-size:12px;margin-bottom:8px;">${summaryLines}</div>` +
        skipNote +
        cards +
        truncated +
        `<div style="color:${C_MUTED};font-size:11px;margin-top:8px;">Per-vector score badges: <b>D</b> = description, <b>P</b> = parameters, <b>C</b> = combined description+parameters. Aggregate score weights the strongest signal heavily, with a small bonus when other signals also align.</div>` +
        `</div>`
    );
}

function renderPairCardHTML(pair: ActionSimilarityPair): string {
    const accent = aggregateAccent(pair.aggregateScore);
    const cardStyle =
        `border:1px solid #e0e0e0;border-left:4px solid ${accent};` +
        `border-radius:4px;padding:8px 12px;margin-bottom:8px;background:#fff;`;

    const aggregateBadge =
        `<span style="display:inline-block;padding:1px 8px;border-radius:10px;` +
        `font-family:monospace;font-size:12px;font-weight:600;color:#fff;background:${accent};">` +
        pair.aggregateScore.toFixed(3) +
        `</span>`;

    const vectorBadges = (["desc", "params", "combined"] as ActionVectorKey[])
        .map((k) => {
            const score = pair.scores[k];
            if (score === undefined) {
                return `<span title="${k} vector absent on at least one side" style="display:inline-block;padding:1px 6px;border-radius:8px;font-family:monospace;font-size:10px;font-weight:600;color:#bbb;background:#f5f5f5;">${vectorLabel(k)}=—</span>`;
            }
            const color = vectorScoreColor(score);
            return `<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-family:monospace;font-size:10px;font-weight:600;color:#fff;background:${color};">${vectorLabel(k)}=${score.toFixed(2)}</span>`;
        })
        .join(" ");

    const headerLine =
        `<div style="margin-bottom:6px;">${aggregateBadge} ${vectorBadges}</div>`;

    const aHTML = renderSideHTML(pair.keyA, pair.descriptionA);
    const bHTML = renderSideHTML(pair.keyB, pair.descriptionB);

    return (
        `<div style="${cardStyle}">${headerLine}` +
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">${aHTML}${bHTML}</div>` +
        `</div>`
    );
}

function renderSideHTML(
    key: { schemaName: string; actionName: string },
    description: string | undefined,
): string {
    const C_MUTED = "#777";
    const schema = schemaBadge(key.schemaName);
    const action = `<code style="font-family:monospace;font-size:12px;color:#333;">${escapeHtml(key.actionName)}</code>`;
    const desc = description
        ? `<div style="color:#444;font-size:12px;margin-top:4px;">${escapeHtml(description)}</div>`
        : `<div style="color:${C_MUTED};font-size:11px;font-style:italic;margin-top:4px;">(no description)</div>`;
    return (
        `<div style="min-width:0;">${schema} ${action}${desc}</div>`
    );
}

function aggregateAccent(score: number): string {
    if (score >= 1.0) return "#c44"; // very strong agreement — likely real overlap
    if (score >= 0.85) return "#c80"; // strong
    if (score >= 0.75) return "#36c"; // moderate
    return "#888"; // weak (just above threshold)
}

function vectorScoreColor(score: number): string {
    if (score >= 0.85) return "#080";
    if (score >= 0.7) return "#36c";
    if (score >= 0.55) return "#c80";
    return "#aaa";
}

function vectorLabel(k: ActionVectorKey): string {
    return k === "desc" ? "D" : k === "params" ? "P" : "C";
}

function renderActionSimilarityText(
    result: ActionSimilarityScanResult,
    skipped: { schemaName: string; reason: string }[],
    top: number,
): string[] {
    const lines: string[] = [];
    lines.push(
        `Semantic action similarity: ${result.actionCount} actions / ${result.schemaCount} schemas, threshold=${result.threshold.toFixed(2)}, ${result.pairs.length} pair(s) above threshold`,
    );
    if (skipped.length > 0) {
        lines.push(
            `  (${skipped.length} schema(s) skipped: ${skipped.map((s) => s.schemaName).join(", ")})`,
        );
    }
    if (result.pairs.length === 0) {
        return lines;
    }
    lines.push("");
    const shown = result.pairs.slice(0, top);
    for (const pair of shown) {
        const scoreParts = (
            ["desc", "params", "combined"] as ActionVectorKey[]
        )
            .map((k) =>
                pair.scores[k] !== undefined
                    ? `${vectorLabel(k)}=${pair.scores[k]!.toFixed(2)}`
                    : `${vectorLabel(k)}=-`,
            )
            .join(" ");
        lines.push(
            `[${pair.aggregateScore.toFixed(3)}] ${scoreParts}  ${pair.keyA.schemaName}.${pair.keyA.actionName}  ⇄  ${pair.keyB.schemaName}.${pair.keyB.actionName}`,
        );
        if (pair.descriptionA)
            lines.push(`  ${pair.keyA.schemaName}: ${truncate(pair.descriptionA, 80)}`);
        if (pair.descriptionB)
            lines.push(`  ${pair.keyB.schemaName}: ${truncate(pair.descriptionB, 80)}`);
        lines.push("");
    }
    if (result.pairs.length > shown.length) {
        lines.push(
            `…${result.pairs.length - shown.length} more pair(s) not shown (--top to extend, --json for full export).`,
        );
    }
    return lines;
}

export function getCollisionCommandHandlers(): CommandHandlerTable {
    return {
        description:
            "Inspect collision detection telemetry and run static collision analyses",
        defaultSubCommand: "events",
        commands: {
            events: new CollisionEventsCommandHandler(),
            similar: new CollisionSimilarCommandHandler(),
        },
    };
}

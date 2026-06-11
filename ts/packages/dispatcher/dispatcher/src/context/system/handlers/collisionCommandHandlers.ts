// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    CollisionEvent,
    CollisionEventKind,
    getRecentCollisionEvents,
} from "../../collisionTelemetry.js";
import {
    ActionCluster,
    ActionSimilarityScanInput,
    ActionSimilarityScanResult,
    AppliedStrategy,
    VectorKey,
    applyStrategy,
    computeActionSimilarity,
    getStrategy,
    listStrategies,
} from "../../../translation/actionSimilarity.js";
import { getAppAgentName } from "../../../translation/agentTranslators.js";
import { getCollisionCorpusCommandHandlers } from "./collisionCorpusHandlers.js";
import { CollisionNeighborhoodsCommandHandler } from "./collisionNeighborhoodHandlers.js";
import { getCollisionOptimizeCommandHandlers } from "./collisionOptimizeHandlers.js";
import { getCollisionPreferenceCommandHandlers } from "./collisionPreferenceHandlers.js";

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

        if (kindFilter !== undefined && !VALID_KINDS.includes(kindFilter)) {
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
    const cellStyle =
        "padding:6px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;";

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
        "Find semantically similar actions across agents (multi-vector embedding similarity, clusters by default)";
    public readonly parameters = {
        flags: {
            threshold: {
                description:
                    "Per-strategy score threshold (default 0.85; raw cosine scale)",
                char: "t",
                type: "number",
                default: 0.85,
            },
            strategy: {
                description:
                    "Named scoring strategy (use `@collision similar list-strategies` to see all). Default: balanced",
                char: "s",
                type: "string",
                default: "balanced",
            },
            "all-strategies": {
                description: "Run every strategy and render a comparison view",
                type: "boolean",
                default: false,
            },
            pairs: {
                description:
                    "Render pairwise (legacy view) instead of clusters",
                type: "boolean",
                default: false,
            },
            top: {
                description: "Maximum clusters / pairs to render (default 50)",
                char: "n",
                type: "number",
                default: 50,
            },
            json: {
                description:
                    "Write the structured scan result + applied-strategy data to this path as JSON",
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

        // Build inputs.  Pull the agent manifest description so the
        // agent-context strategies have something richer than just the
        // schema name token — manifests like "Calendar agent that keeps
        // track of important dates and events…" carry more semantic
        // signal than action JSDoc often does.
        const inputs: ActionSimilarityScanInput[] = [];
        const skipped: { schemaName: string; reason: string }[] = [];
        for (const config of configs) {
            try {
                const actionSchemaFile =
                    systemContext.agents.getActionSchemaFileForConfig(config);
                const agentName = getAppAgentName(config.schemaName);
                let agentDescription: string | undefined;
                try {
                    agentDescription =
                        systemContext.agents.getAppAgentDescription(agentName);
                } catch {
                    // Some configs (e.g. ad-hoc dynamic schemas) may not
                    // have a registered agent record; agent context just
                    // won't be embeddable for them.
                    agentDescription = undefined;
                }
                inputs.push({
                    schemaName: config.schemaName,
                    agentName,
                    agentDescription,
                    actionSchemaFile,
                });
            } catch (err) {
                skipped.push({
                    schemaName: config.schemaName,
                    reason: err instanceof Error ? err.message : String(err),
                });
            }
        }

        if (inputs.length === 0) {
            displayWarn("No agent action schemas available to scan.", context);
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

        const scan = await computeActionSimilarity(inputs, {
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

        const threshold = Math.max(0, params.flags.threshold ?? 0.85);
        const top = Math.max(1, params.flags.top ?? 50);

        // Apply one or more strategies to the scan.
        let applied: AppliedStrategy[];
        if (params.flags["all-strategies"]) {
            applied = listStrategies().map((s) =>
                applyStrategy(scan, s, threshold),
            );
        } else {
            const strategyName = params.flags.strategy ?? "balanced";
            const strategy = getStrategy(strategyName);
            if (!strategy) {
                displayWarn(
                    `Unknown strategy "${strategyName}". Run \`@collision similar list-strategies\` to see all.`,
                    context,
                );
                return;
            }
            applied = [applyStrategy(scan, strategy, threshold)];
        }

        if (params.flags.json) {
            try {
                const absPath = path.resolve(params.flags.json);
                fs.writeFileSync(
                    absPath,
                    JSON.stringify(
                        { scan, applied, skipped, threshold },
                        null,
                        2,
                    ),
                );
            } catch (err) {
                displayWarn(
                    `Failed to write JSON scan result to ${params.flags.json}: ${err instanceof Error ? err.message : String(err)}`,
                    context,
                );
            }
        }

        const html = params.flags["all-strategies"]
            ? renderAllStrategiesHTML(scan, applied, skipped, top)
            : renderSingleStrategyHTML(
                  scan,
                  applied[0],
                  skipped,
                  top,
                  params.flags.pairs,
              );
        const text = params.flags["all-strategies"]
            ? renderAllStrategiesText(scan, applied, skipped)
            : renderSingleStrategyText(
                  scan,
                  applied[0],
                  skipped,
                  top,
                  params.flags.pairs,
              );
        context.actionIO.appendDisplay({
            type: "html",
            content: html,
            alternates: [{ type: "text", content: text }],
        });
    }
}

class CollisionSimilarListStrategiesCommandHandler implements CommandHandler {
    public readonly description =
        "List the named strategies available for `@collision similar -s <name>`";
    public readonly parameters = {} as const;

    public async run(context: ActionContext<CommandHandlerContext>) {
        const C_MUTED = "#777";
        const rows = listStrategies()
            .map(
                (s) =>
                    `<tr>
                        <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-weight:600;color:#36c;">${escapeHtml(s.name)}</td>
                        <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;">${escapeHtml(s.description)}</td>
                    </tr>`,
            )
            .join("");
        const html =
            `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:920px;">` +
            `<h3 style="margin:0 0 8px;font-size:14px;">Action similarity strategies</h3>` +
            `<div style="color:${C_MUTED};font-size:12px;margin-bottom:8px;">Pick one with <code>@collision similar -s &lt;name&gt;</code>, or compare all with <code>@collision similar --all-strategies</code>.</div>` +
            `<table style="border-collapse:collapse;width:100%;font-size:12px;">` +
            `<thead><tr style="background:#fafafa;"><th style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;color:#555;">Name</th><th style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;color:#555;">What it does</th></tr></thead>` +
            `<tbody>${rows}</tbody></table></div>`;
        context.actionIO.appendDisplay({ type: "html", content: html });
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

const C_SIM_MUTED = "#777";
const C_SIM_DIM = "#999";

function vectorLabel(k: VectorKey): string {
    switch (k) {
        case "desc":
            return "D";
        case "params":
            return "P";
        case "combined":
            return "C";
        case "nameShape":
            return "N";
        case "agentContext":
            return "A";
        case "agentAndAction":
            return "A+";
    }
}

function vectorScoreColor(score: number): string {
    if (score >= 0.85) return "#080";
    if (score >= 0.7) return "#36c";
    if (score >= 0.55) return "#c80";
    return "#aaa";
}

function aggregateAccent(score: number): string {
    if (score >= 1.0) return "#c44";
    if (score >= 0.85) return "#c80";
    if (score >= 0.75) return "#36c";
    return "#888";
}

function renderVectorBadges(
    scores: Partial<Record<VectorKey, number>>,
    keys: readonly VectorKey[],
): string {
    return keys
        .map((k) => {
            const score = scores[k];
            if (score === undefined) {
                return `<span title="${k} vector absent on at least one side" style="display:inline-block;padding:1px 6px;border-radius:8px;font-family:monospace;font-size:10px;font-weight:600;color:#bbb;background:#f5f5f5;">${vectorLabel(k)}=—</span>`;
            }
            const color = vectorScoreColor(score);
            return `<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-family:monospace;font-size:10px;font-weight:600;color:#fff;background:${color};">${vectorLabel(k)}=${score.toFixed(2)}</span>`;
        })
        .join(" ");
}

function renderScanSummary(
    scan: ActionSimilarityScanResult,
    applied: AppliedStrategy[],
    skipped: { schemaName: string; reason: string }[],
): string {
    const items = [
        `<b>${scan.actionCount}</b> action(s)`,
        `<b>${scan.schemaCount}</b> schema(s)`,
        `<b>${scan.pairs.length}</b> kept pair(s)`,
    ];
    if (applied.length === 1) {
        items.push(
            `strategy=<code style="background:#f5f5f5;padding:1px 4px;border-radius:2px;">${escapeHtml(applied[0].strategy.name)}</code>`,
        );
        items.push(
            `threshold=<code style="background:#f5f5f5;padding:1px 4px;border-radius:2px;">${applied[0].threshold.toFixed(2)}</code>`,
        );
    } else {
        items.push(`comparing <b>${applied.length}</b> strategies`);
        items.push(
            `threshold=<code style="background:#f5f5f5;padding:1px 4px;border-radius:2px;">${applied[0].threshold.toFixed(2)}</code>`,
        );
    }
    const summary = items.join(" · ");
    const skipNote =
        skipped.length > 0
            ? `<div style="color:#c80;font-size:11px;margin:4px 0;">${skipped.length} schema(s) failed to load: ${skipped
                  .map((s) => `<code>${escapeHtml(s.schemaName)}</code>`)
                  .join(", ")}</div>`
            : "";
    return `<div style="color:${C_SIM_MUTED};font-size:12px;margin-bottom:8px;">${summary}</div>${skipNote}`;
}

// ---- Single-strategy view -----------------------------------------------

function renderSingleStrategyHTML(
    scan: ActionSimilarityScanResult,
    applied: AppliedStrategy,
    skipped: { schemaName: string; reason: string }[],
    top: number,
    showPairs: boolean,
): string {
    const wrap = `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:1100px;">`;
    const header = `<h3 style="margin:0 0 6px;font-size:14px;">Semantic action similarity (multi-vector)</h3>`;
    const strategyHeader = `<div style="font-size:12px;color:${C_SIM_MUTED};margin-bottom:6px;"><b>${escapeHtml(applied.strategy.name)}</b> — ${escapeHtml(applied.strategy.description)}</div>`;

    const summary = renderScanSummary(scan, [applied], skipped);
    const histogram = renderScoreHistogramHTML(scan, applied);

    const view = showPairs
        ? renderPairsView(applied, top)
        : renderClustersView(applied, top);

    return (
        wrap + header + strategyHeader + summary + histogram + view + `</div>`
    );
}

/**
 * Render a one-line histogram of score buckets across the current
 * strategy.  Helps testers pick a threshold based on the distribution
 * shape instead of guessing — if the bucket at 0.85+ is huge and the
 * 0.95+ is tiny, that's a sign the threshold is in the noise floor.
 */
function renderScoreHistogramHTML(
    scan: ActionSimilarityScanResult,
    applied: AppliedStrategy,
): string {
    const buckets: {
        label: string;
        min: number;
        count: number;
        color: string;
    }[] = [
        { label: "0.55+", min: 0.55, count: 0, color: "#888" },
        { label: "0.65+", min: 0.65, count: 0, color: "#888" },
        { label: "0.75+", min: 0.75, count: 0, color: "#36c" },
        { label: "0.85+", min: 0.85, count: 0, color: "#080" },
        { label: "0.95+", min: 0.95, count: 0, color: "#c44" },
    ];
    let scored = 0;
    for (const pair of scan.pairs) {
        const score = applied.strategy.score(pair.scores);
        if (score === undefined) continue;
        scored++;
        for (const b of buckets) {
            if (score >= b.min) b.count++;
        }
    }
    if (scored === 0) return "";
    const max = Math.max(...buckets.map((b) => b.count), 1);
    const bars = buckets
        .map((b) => {
            const w = Math.max(2, Math.round((b.count / max) * 280));
            return (
                `<tr>` +
                `<td style="font-family:monospace;color:${b.color};padding:2px 8px 2px 0;font-size:11px;text-align:right;">${b.label}</td>` +
                `<td style="padding:2px 0;"><span style="display:inline-block;height:10px;width:${w}px;background:${b.color};vertical-align:middle;border-radius:2px;"></span></td>` +
                `<td style="font-family:monospace;color:${C_SIM_MUTED};padding:2px 8px;font-size:11px;">${b.count}</td>` +
                `</tr>`
            );
        })
        .join("");
    const note = `<div style="color:${C_SIM_MUTED};font-size:11px;margin-top:2px;">${scored} scored pair(s) under <code>${escapeHtml(applied.strategy.name)}</code>; threshold currently <code>${applied.threshold.toFixed(2)}</code>.</div>`;
    return (
        `<details style="margin-bottom:10px;">` +
        `<summary style="cursor:pointer;font-size:12px;color:${C_SIM_MUTED};">Score distribution (cumulative — pairs ≥ threshold)</summary>` +
        `<table style="border-collapse:collapse;margin-top:4px;">${bars}</table>` +
        note +
        `</details>`
    );
}

function renderClustersView(applied: AppliedStrategy, top: number): string {
    if (applied.clusters.length === 0) {
        return `<div style="color:${C_SIM_DIM};font-style:italic;padding:16px 0;">No clusters at threshold ${applied.threshold.toFixed(2)} (${applied.pairs.length} surviving pair(s) — try <code>--pairs</code> to see them).</div>`;
    }
    const shown = applied.clusters.slice(0, top);
    const truncated =
        applied.clusters.length > shown.length
            ? `<div style="color:${C_SIM_MUTED};font-size:11px;margin-top:6px;">…${applied.clusters.length - shown.length} more cluster(s) not shown.</div>`
            : "";
    let cards = "";
    for (const cluster of shown) {
        cards += renderClusterCardHTML(cluster);
    }
    return cards + truncated;
}

function renderClusterCardHTML(cluster: ActionCluster): string {
    const accent = aggregateAccent(cluster.topPair.aggregateScore);
    const cardStyle =
        `border:1px solid #e0e0e0;border-left:4px solid ${accent};` +
        `border-radius:4px;padding:10px 12px;margin-bottom:10px;background:#fff;`;
    const sizeBadge =
        `<span style="display:inline-block;padding:1px 8px;border-radius:10px;` +
        `font-size:11px;font-weight:600;color:#fff;background:${accent};">${cluster.members.length} members</span>`;
    const topBadge = `<span style="font-family:monospace;font-size:11px;color:${C_SIM_MUTED};margin-left:6px;">top score ${cluster.topPair.aggregateScore.toFixed(3)}</span>`;
    const headerLine = `<div style="margin-bottom:6px;">${sizeBadge}${topBadge}</div>`;

    // Group members by schema so the membership reads as "browser:
    // openWebPage; desktop: openFile; …"
    const bySchema = new Map<string, string[]>();
    for (const m of cluster.members) {
        const list = bySchema.get(m.schemaName) ?? [];
        list.push(m.actionName);
        bySchema.set(m.schemaName, list);
    }
    const memberLines: string[] = [];
    for (const [schemaName, actions] of bySchema) {
        const actionsHTML = actions
            .map(
                (a) =>
                    `<code style="font-family:monospace;font-size:12px;color:#333;">${escapeHtml(a)}</code>`,
            )
            .join(" · ");
        memberLines.push(
            `<div style="margin:2px 0;">${schemaBadge(schemaName)} ${actionsHTML}</div>`,
        );
    }

    // Show a sample description if any cluster member has one — gives
    // the reader a foothold for what the cluster is actually about.
    const sampleDesc = cluster.members.find((m) => m.description)?.description;
    const descLine = sampleDesc
        ? `<div style="margin-top:8px;color:#444;font-size:12px;font-style:italic;">↳ ${escapeHtml(truncate(sampleDesc, 200))}</div>`
        : "";

    return `<div style="${cardStyle}">${headerLine}<div>${memberLines.join("")}</div>${descLine}</div>`;
}

function renderPairsView(applied: AppliedStrategy, top: number): string {
    if (applied.pairs.length === 0) {
        return `<div style="color:${C_SIM_DIM};font-style:italic;padding:16px 0;">No pairs above threshold ${applied.threshold.toFixed(2)}.</div>`;
    }
    const shown = applied.pairs.slice(0, top);
    const truncated =
        applied.pairs.length > shown.length
            ? `<div style="color:${C_SIM_MUTED};font-size:11px;margin-top:6px;">…${applied.pairs.length - shown.length} more pair(s) not shown.</div>`
            : "";
    const allKeys: readonly VectorKey[] = [
        "desc",
        "params",
        "nameShape",
        "agentContext",
        "agentAndAction",
    ];
    let cards = "";
    for (const pair of shown) {
        const accent = aggregateAccent(pair.aggregateScore);
        const cardStyle =
            `border:1px solid #e0e0e0;border-left:4px solid ${accent};` +
            `border-radius:4px;padding:8px 12px;margin-bottom:8px;background:#fff;`;
        const aggBadge =
            `<span style="display:inline-block;padding:1px 8px;border-radius:10px;` +
            `font-family:monospace;font-size:12px;font-weight:600;color:#fff;background:${accent};">${pair.aggregateScore.toFixed(3)}</span>`;
        const vectorBadges = renderVectorBadges(pair.scores, allKeys);
        const headerLine = `<div style="margin-bottom:6px;">${aggBadge} ${vectorBadges}</div>`;
        const aHTML = renderSideHTML(pair.keyA, pair.descriptionA);
        const bHTML = renderSideHTML(pair.keyB, pair.descriptionB);
        cards += `<div style="${cardStyle}">${headerLine}<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">${aHTML}${bHTML}</div></div>`;
    }
    return cards + truncated;
}

function renderSideHTML(
    key: { schemaName: string; actionName: string },
    description: string | undefined,
): string {
    const schema = schemaBadge(key.schemaName);
    const action = `<code style="font-family:monospace;font-size:12px;color:#333;">${escapeHtml(key.actionName)}</code>`;
    const desc = description
        ? `<div style="color:#444;font-size:12px;margin-top:4px;">${escapeHtml(description)}</div>`
        : `<div style="color:${C_SIM_MUTED};font-size:11px;font-style:italic;margin-top:4px;">(no description)</div>`;
    return `<div style="min-width:0;">${schema} ${action}${desc}</div>`;
}

// ---- Multi-strategy comparison view -------------------------------------

function renderAllStrategiesHTML(
    scan: ActionSimilarityScanResult,
    applied: AppliedStrategy[],
    skipped: { schemaName: string; reason: string }[],
    top: number,
): string {
    const wrap = `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:1100px;">`;
    const header = `<h3 style="margin:0 0 6px;font-size:14px;">Action similarity — strategy comparison</h3>`;
    const summary = renderScanSummary(scan, applied, skipped);

    // Comparison table: one row per strategy with totals.
    const headStyle =
        "padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;font-weight:600;color:#555;";
    const cellStyle =
        "padding:6px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;";
    let rows = "";
    for (const a of applied) {
        rows += `<tr>
            <td style="${cellStyle}font-family:monospace;font-weight:600;color:#36c;">${escapeHtml(a.strategy.name)}</td>
            <td style="${cellStyle}font-family:monospace;text-align:right;">${a.scoredPairs}</td>
            <td style="${cellStyle}font-family:monospace;text-align:right;">${a.pairs.length}</td>
            <td style="${cellStyle}font-family:monospace;text-align:right;">${a.clusters.length}</td>
            <td style="${cellStyle}font-family:monospace;text-align:right;">${a.clusters[0]?.members.length ?? "—"}</td>
            <td style="${cellStyle}color:${C_SIM_MUTED};font-size:11px;">${escapeHtml(a.strategy.description)}</td>
        </tr>`;
    }
    const table =
        `<table style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:12px;">` +
        `<thead><tr style="background:#fafafa;">` +
        `<th style="${headStyle}">Strategy</th>` +
        `<th style="${headStyle}">Scored</th>` +
        `<th style="${headStyle}">Above thr.</th>` +
        `<th style="${headStyle}">Clusters</th>` +
        `<th style="${headStyle}">Largest</th>` +
        `<th style="${headStyle}">Description</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>`;

    // Top clusters per strategy (small previews).  Helps the operator
    // judge which strategy is producing the most useful signal.
    let topPerStrat = "";
    for (const a of applied) {
        if (a.clusters.length === 0) continue;
        topPerStrat += `<details style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:13px;"><b>${escapeHtml(a.strategy.name)}</b> — top ${Math.min(top, a.clusters.length)} of ${a.clusters.length} clusters</summary>`;
        topPerStrat += renderClustersView(a, top);
        topPerStrat += `</details>`;
    }

    return wrap + header + summary + table + topPerStrat + `</div>`;
}

// ---- Text alternates ----------------------------------------------------

function renderSingleStrategyText(
    scan: ActionSimilarityScanResult,
    applied: AppliedStrategy,
    skipped: { schemaName: string; reason: string }[],
    top: number,
    showPairs: boolean,
): string[] {
    const lines: string[] = [];
    lines.push(
        `Action similarity (${applied.strategy.name}, threshold=${applied.threshold.toFixed(2)}): ${scan.actionCount} actions / ${scan.schemaCount} schemas, ${applied.pairs.length} pair(s) above threshold, ${applied.clusters.length} cluster(s)`,
    );
    if (skipped.length > 0) {
        lines.push(
            `  (${skipped.length} schema(s) skipped: ${skipped.map((s) => s.schemaName).join(", ")})`,
        );
    }
    if (showPairs) {
        lines.push("");
        lines.push("PAIRS:");
        const shown = applied.pairs.slice(0, top);
        for (const pair of shown) {
            lines.push(
                `[${pair.aggregateScore.toFixed(3)}] ${pair.keyA.schemaName}.${pair.keyA.actionName} ⇄ ${pair.keyB.schemaName}.${pair.keyB.actionName}`,
            );
        }
        if (applied.pairs.length > shown.length) {
            lines.push(
                `…${applied.pairs.length - shown.length} more pair(s) not shown.`,
            );
        }
        return lines;
    }
    if (applied.clusters.length === 0) {
        lines.push("");
        lines.push(`No clusters at this threshold.`);
        return lines;
    }
    lines.push("");
    lines.push("CLUSTERS:");
    const shown = applied.clusters.slice(0, top);
    for (const cluster of shown) {
        const members = cluster.members
            .map((m) => `${m.schemaName}.${m.actionName}`)
            .join(", ");
        lines.push(
            `[${cluster.members.length} members, top ${cluster.topPair.aggregateScore.toFixed(3)}] ${members}`,
        );
    }
    if (applied.clusters.length > shown.length) {
        lines.push(
            `…${applied.clusters.length - shown.length} more cluster(s) not shown.`,
        );
    }
    return lines;
}

function renderAllStrategiesText(
    scan: ActionSimilarityScanResult,
    applied: AppliedStrategy[],
    skipped: { schemaName: string; reason: string }[],
): string[] {
    const lines: string[] = [];
    lines.push(
        `Action similarity — strategy comparison: ${scan.actionCount} actions / ${scan.schemaCount} schemas`,
    );
    if (skipped.length > 0) {
        lines.push(
            `  (${skipped.length} schema(s) skipped: ${skipped.map((s) => s.schemaName).join(", ")})`,
        );
    }
    lines.push("");
    lines.push(
        `${"strategy".padEnd(20)} ${"scored".padStart(8)} ${"above thr".padStart(10)} ${"clusters".padStart(10)} ${"largest".padStart(8)}`,
    );
    for (const a of applied) {
        lines.push(
            `${a.strategy.name.padEnd(20)} ${String(a.scoredPairs).padStart(8)} ${String(a.pairs.length).padStart(10)} ${String(a.clusters.length).padStart(10)} ${String(a.clusters[0]?.members.length ?? "—").padStart(8)}`,
        );
    }
    return lines;
}

// ===========================================================================
// `@collision probe` — given a hand-crafted user utterance, return the top-K
// candidate actions ranked by `semanticSearchActionSchema` (the same ranker
// the LLM-select detection point uses).  Lets the operator test whether
// embedding-similarity clusters from `@collision similar` are *real dispatch
// collisions* or just semantic neighbors that the ranker would still
// disambiguate cleanly.
//
// This is a manual, single-phrase probe.  The full S3 corpus-replay tool
// will wrap this same engine in a batch flow once we have a corpus.
// ===========================================================================

const LLM_SELECT_DELTA_DEFAULT = 0.05;

class CollisionProbeCommandHandler implements CommandHandler {
    public readonly description =
        "Probe what action(s) a hand-crafted utterance would route to via the embedding ranker (top-K with cosine deltas)";
    public readonly parameters = {
        flags: {
            top: {
                description: "Top-K candidates to render (default 5)",
                char: "n",
                type: "number",
                default: 5,
            },
            expected: {
                description:
                    'Expected target as "schema.actionName" — flagged in the output if the top-1 candidate matches',
                char: "e",
                type: "string",
                optional: true,
            },
            delta: {
                description:
                    "Score delta below which the top two are flagged ambiguous (default 0.05, matches llmSelect.scoreDeltaThreshold)",
                type: "number",
                default: LLM_SELECT_DELTA_DEFAULT,
            },
            "include-inactive": {
                description:
                    "Include schemas that aren't currently active in this session",
                type: "boolean",
                default: false,
            },
        },
        args: {
            phrase: {
                description: 'The utterance to probe, e.g. "turn on wifi"',
                type: "string",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const phrase = params.args.phrase.trim();
        if (!phrase) {
            displayWarn("Probe phrase must be non-empty.", context);
            return;
        }
        const top = Math.max(1, params.flags.top ?? 5);
        const delta = Math.max(
            0,
            params.flags.delta ?? LLM_SELECT_DELTA_DEFAULT,
        );
        const expected = params.flags.expected?.trim() || undefined;
        const filter = params.flags["include-inactive"]
            ? () => true
            : (schemaName: string) =>
                  systemContext.agents.isSchemaActive(schemaName);

        const results = await systemContext.agents.semanticSearchActionSchema(
            phrase,
            top,
            filter,
        );
        if (!results || results.length === 0) {
            displayWarn(
                `No action schemas matched "${phrase}".  Are the agents loaded?`,
                context,
            );
            return;
        }

        const html = renderProbeHTML(phrase, results, expected, delta);
        const text = renderProbeText(phrase, results, expected, delta);
        context.actionIO.appendDisplay({
            type: "html",
            content: html,
            alternates: [{ type: "text", content: text }],
        });
    }
}

interface ProbeRow {
    rank: number;
    schemaName: string;
    actionName: string;
    score: number;
    /** Score delta to the next-rank candidate (positive number). undefined for last row. */
    deltaToNext?: number | undefined;
    description?: string | undefined;
    isExpected?: boolean | undefined;
}

function buildProbeRows(
    results: { score: number; item: any }[],
    expected: string | undefined,
): ProbeRow[] {
    const rows: ProbeRow[] = results.map((r, i) => {
        const schemaName = r.item.actionSchemaFile.schemaName as string;
        const actionName = r.item.definition.name as string;
        return {
            rank: i + 1,
            schemaName,
            actionName,
            score: r.score,
            description:
                (r.item.definition.comments?.[0] as string | undefined) ||
                undefined,
            isExpected: expected
                ? `${schemaName}.${actionName}` === expected
                : undefined,
        };
    });
    for (let i = 0; i < rows.length - 1; i++) {
        rows[i].deltaToNext = rows[i].score - rows[i + 1].score;
    }
    return rows;
}

function renderProbeHTML(
    phrase: string,
    results: { score: number; item: any }[],
    expected: string | undefined,
    delta: number,
): string {
    const rows = buildProbeRows(results, expected);
    const top1 = rows[0];

    // Verdict logic:
    //   - If `expected` matches top1: PASS
    //   - If top-1 to top-2 delta < threshold: AMBIGUOUS (real dispatch collision risk)
    //   - Else CLEAN
    let verdict: { color: string; label: string; detail: string };
    if (expected && top1.isExpected) {
        const ambiguous =
            top1.deltaToNext !== undefined && top1.deltaToNext < delta;
        if (ambiguous) {
            verdict = {
                color: "#c80",
                label: "PASS but ambiguous",
                detail: `top-1 matches expected target, but #2 is within ${delta.toFixed(2)} cosine — llmSelect would flag this as a collision.`,
            };
        } else {
            verdict = {
                color: "#080",
                label: "CLEAN",
                detail: `top-1 matches expected target with delta ≥ ${delta.toFixed(2)} — no dispatch ambiguity at this threshold.`,
            };
        }
    } else if (expected && !top1.isExpected) {
        verdict = {
            color: "#c44",
            label: "FAIL",
            detail: `top-1 is <code>${escapeHtml(top1.schemaName + "." + top1.actionName)}</code>, expected <code>${escapeHtml(expected)}</code>.`,
        };
    } else if (top1.deltaToNext !== undefined && top1.deltaToNext < delta) {
        verdict = {
            color: "#c80",
            label: "AMBIGUOUS",
            detail: `top-1 vs #2 delta ${top1.deltaToNext.toFixed(3)} &lt; ${delta.toFixed(2)} — llmSelect would flag this.`,
        };
    } else {
        verdict = {
            color: "#080",
            label: "CLEAN",
            detail: `top-1 vs #2 delta ${(top1.deltaToNext ?? 0).toFixed(3)} ≥ ${delta.toFixed(2)} — no dispatch ambiguity at this threshold.`,
        };
    }

    const verdictBadge =
        `<span style="display:inline-block;padding:2px 10px;border-radius:10px;` +
        `font-size:11px;font-weight:700;letter-spacing:0.04em;color:#fff;background:${verdict.color};">${escapeHtml(verdict.label)}</span>`;

    const headStyle =
        "padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;font-weight:600;color:#555;";
    const cellStyle =
        "padding:6px 8px;border-bottom:1px solid #f0f0f0;vertical-align:top;";
    let rowsHTML = "";
    for (const row of rows) {
        const ambiguous =
            row.deltaToNext !== undefined && row.deltaToNext < delta;
        const rankStyle = row.isExpected
            ? `font-family:monospace;font-weight:700;color:#080;`
            : `font-family:monospace;color:${C_SIM_MUTED};`;
        const expectedMarker = row.isExpected
            ? ` <span title="matches --expected" style="color:#080;">✓</span>`
            : "";
        const deltaCell =
            row.deltaToNext !== undefined
                ? `<code style="font-family:monospace;color:${ambiguous ? "#c80" : C_SIM_MUTED};">${row.deltaToNext.toFixed(3)}${ambiguous ? " ⚠" : ""}</code>`
                : "—";
        const desc = row.description
            ? `<div style="color:#444;font-size:11px;margin-top:2px;">${escapeHtml(truncate(row.description, 120))}</div>`
            : `<div style="color:${C_SIM_MUTED};font-size:11px;font-style:italic;margin-top:2px;">(no description)</div>`;
        rowsHTML += `<tr>
            <td style="${cellStyle}${rankStyle}">${row.rank}${expectedMarker}</td>
            <td style="${cellStyle}font-family:monospace;color:${vectorScoreColor(row.score)};font-weight:600;">${row.score.toFixed(3)}</td>
            <td style="${cellStyle}">${deltaCell}</td>
            <td style="${cellStyle}">${schemaBadge(row.schemaName)}<code style="font-family:monospace;font-size:12px;color:#333;margin-left:4px;">${escapeHtml(row.actionName)}</code>${desc}</td>
        </tr>`;
    }

    return (
        `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:8px;max-width:1000px;">` +
        `<h3 style="margin:0 0 6px;font-size:14px;">Embedding probe</h3>` +
        `<div style="margin-bottom:8px;">${verdictBadge} <span style="color:${C_SIM_MUTED};font-size:12px;margin-left:4px;">${verdict.detail}</span></div>` +
        `<div style="margin-bottom:10px;font-size:12px;color:#555;">phrase: <code style="background:#f5f5f5;padding:2px 6px;border-radius:3px;">${escapeHtml(phrase)}</code>${expected ? ` · expected: <code style="background:#e8f0ff;color:#36c;padding:2px 6px;border-radius:3px;">${escapeHtml(expected)}</code>` : ""}</div>` +
        `<table style="border-collapse:collapse;width:100%;font-size:12px;">` +
        `<thead><tr style="background:#fafafa;">` +
        `<th style="${headStyle}">#</th>` +
        `<th style="${headStyle}">Score</th>` +
        `<th style="${headStyle}">Δ to next</th>` +
        `<th style="${headStyle}">Action</th>` +
        `</tr></thead><tbody>${rowsHTML}</tbody></table>` +
        `</div>`
    );
}

function renderProbeText(
    phrase: string,
    results: { score: number; item: any }[],
    expected: string | undefined,
    delta: number,
): string[] {
    const rows = buildProbeRows(results, expected);
    const lines: string[] = [];
    lines.push(
        `Probe: "${phrase}"${expected ? ` (expected: ${expected})` : ""}`,
    );
    lines.push("");
    for (const row of rows) {
        const flag = row.isExpected ? " ✓" : "";
        const deltaPart =
            row.deltaToNext !== undefined
                ? `  Δ${row.deltaToNext.toFixed(3)}${row.deltaToNext < delta ? " ⚠" : ""}`
                : "";
        lines.push(
            `  ${row.rank}. [${row.score.toFixed(3)}]${deltaPart}  ${row.schemaName}.${row.actionName}${flag}`,
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
            probe: new CollisionProbeCommandHandler(),
            corpus: getCollisionCorpusCommandHandlers(),
            neighborhoods: new CollisionNeighborhoodsCommandHandler(),
            optimize: getCollisionOptimizeCommandHandlers(),
            preferences: getCollisionPreferenceCommandHandlers(),
            "list-strategies":
                new CollisionSimilarListStrategiesCommandHandler(),
        },
    };
}

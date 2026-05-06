// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayWarn } from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    CollisionEvent,
    CollisionEventKind,
    getRecentCollisionEvents,
} from "../../collisionTelemetry.js";

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

export function getCollisionCommandHandlers(): CommandHandlerTable {
    return {
        description: "Inspect collision detection telemetry",
        defaultSubCommand: "events",
        commands: {
            events: new CollisionEventsCommandHandler(),
        },
    };
}

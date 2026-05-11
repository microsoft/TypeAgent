// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// One-shot HTML visualizer for the neighborhood preview. Shows what
// neighborhoods would emerge from current similarity + corpus data,
// with filters by kind / source / size and per-row expansion to inspect
// members + evidence.

import {
    computeActionGravity,
    type ActionGravity,
    type PairScoreLookup,
} from "./actionGravity.js";
import type { Neighborhood, NeighborhoodPreview } from "./types.js";

// ---------------------------------------------------------------------------
// Payload shape (the JSON embedded in the HTML for the page's JS to consume)
// ---------------------------------------------------------------------------

/** A raw cross-schema pair score under the chosen strategy. The page uses
 *  these to dynamically re-tag corpus-only neighborhoods as "both" when the
 *  slider drops below the pair's score. Same-schema pairs aren't computed
 *  by the engine and are absent here. */
export interface ViewPairScore {
    /** Canonical key: `${schemaName}.${actionName}`, sorted ascending. */
    a: string;
    b: string;
    score: number;
}

interface VizPayload {
    builtAt: string;
    sources: NeighborhoodPreview["sources"];
    /** Default slider position. Should be ≤ the cluster threshold. */
    initialConfirmThreshold: number;
    /** Min slider value (matches the engine's keepThreshold of 0.5). */
    minConfirmThreshold: number;
    /** All scored cross-schema pairs (can be large). */
    pairScores: ViewPairScore[];
    neighborhoods: Neighborhood[];
    /** Per-neighborhood gravity rankings, keyed by neighborhood id. */
    gravity: Record<string, ActionGravity[]>;
    /** True when at least one neighborhood has translator-derived evidence. */
    hasTranslatorData: boolean;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

export interface BuildPreviewHTMLOptions {
    /** All cross-schema pairs with their aggregate scores under the strategy.
     *  Used by the slider to dynamically tag corpus pairs as "both". */
    pairScores: ViewPairScore[];
    /** Default slider position. Default 0.5 (the engine's keepThreshold). */
    initialConfirmThreshold?: number;
    /** Slider lower bound. Default 0.5. */
    minConfirmThreshold?: number;
}

export function buildNeighborhoodPreviewHTML(
    preview: NeighborhoodPreview,
    opts: BuildPreviewHTMLOptions = { pairScores: [] },
): string {
    // Build a pair-score lookup once and reuse for every neighborhood.
    const pairMap = new Map<string, number>();
    for (const ps of opts.pairScores) {
        const k = ps.a < ps.b ? `${ps.a}|${ps.b}` : `${ps.b}|${ps.a}`;
        pairMap.set(k, ps.score);
    }
    const pairScoreLookup: PairScoreLookup = (a, b) => {
        const ka = `${a.schemaName}.${a.actionName}`;
        const kb = `${b.schemaName}.${b.actionName}`;
        const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        return pairMap.get(k);
    };

    // Pre-compute per-neighborhood gravity so the JS doesn't have to recompute
    // it on every render.
    const gravity: Record<string, ActionGravity[]> = {};
    let hasTranslatorData = false;
    for (const n of preview.neighborhoods) {
        const ag = computeActionGravity(n, pairScoreLookup);
        gravity[n.id] = ag;
        if (ag.some((a) => a.endUserOwedTraffic !== undefined)) {
            hasTranslatorData = true;
        }
    }

    const payload: VizPayload = {
        builtAt: preview.builtAt,
        sources: preview.sources,
        initialConfirmThreshold: opts.initialConfirmThreshold ?? 0.5,
        minConfirmThreshold: opts.minConfirmThreshold ?? 0.5,
        pairScores: opts.pairScores,
        neighborhoods: preview.neighborhoods,
        gravity,
        hasTranslatorData,
    };
    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    return PREVIEW_HTML_PREFIX + json + PREVIEW_HTML_SUFFIX;
}

const PREVIEW_HTML_PREFIX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TypeAgent neighborhood preview</title>
<style>
  :root {
    --bg: #0f1217; --panel: #161a22; --ink: #e8ecf3; --muted: #8a93a3;
    --line: #242a36; --accent: #7aa2f7;
    --kind-cross: #60a5fa;
    --kind-same:  #a3e635;
    --src-sim:    #c084fc;
    --src-corpus: #fb923c;
    --src-both:   #f472b6;
  }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  header { padding: 22px 32px 10px 32px; border-bottom: 1px solid var(--line); }
  header h1 { margin: 0 0 4px 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
  header .stats { color: var(--muted); font-size: 13px; }
  header .stats b { color: var(--ink); font-weight: 600; }
  .pill { display:inline-block; padding:1px 7px; border-radius:9px; font-size:12px; margin-right:6px; border:1px solid var(--line); }
  main { padding: 22px 32px; display: grid; grid-template-columns: 1fr; gap: 24px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px 22px; }
  section h2 { margin: 0 0 6px 0; font-size: 16px; font-weight: 600; }
  section .sub { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
  .controls { display:flex; gap:10px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
  /* Per-phrase-style chips. Click-to-toggle which styles count toward the
     displayed totals + sample lists. Default state: every detected style
     enabled. The whole row hides when the corpus carries no per-style
     breakdown (countsByStyle undefined on every edge — older artifacts). */
  .style-chips { display:flex; gap:6px; align-items:center; margin: 4px 0 12px 0; flex-wrap:wrap; }
  .style-chips .label { color: var(--muted); font-size: 12px; margin-right: 4px; }
  .style-chips .chip {
    font-size: 11px; padding: 2px 9px; border-radius: 11px;
    border: 1px solid var(--line); background: #0a0d12;
    color: var(--ink); cursor: pointer; user-select: none;
    transition: background 0.08s, border-color 0.08s, opacity 0.08s;
    font-family: ui-monospace, monospace;
  }
  .style-chips .chip:hover { border-color: var(--accent); }
  .style-chips .chip.off { opacity: 0.35; background: transparent; }
  .style-chips .chip .count { color: var(--muted); margin-left: 4px; font-size: 10px; }
  .style-chips .quick { font-size: 11px; color: var(--muted); cursor: pointer; text-decoration: underline; margin-left: 8px; }
  .style-chips .quick:hover { color: var(--accent); }
  .controls input, .controls select {
    background: #0a0d12; border: 1px solid var(--line); color: var(--ink);
    border-radius: 5px; padding: 5px 8px; font: inherit;
  }
  .controls label { color: var(--muted); font-size: 12px; }

  details.help { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 18px; }
  details.help > summary { cursor: pointer; user-select: none; font-weight: 600; font-size: 14px; list-style: none; outline: none; display: flex; align-items: center; gap: 8px; }
  details.help > summary::-webkit-details-marker { display: none; }
  details.help > summary::before { content: "▸"; color: var(--muted); font-size: 11px; transition: transform 0.1s; display: inline-block; width: 10px; }
  details.help[open] > summary::before { transform: rotate(90deg); }
  details.help[open] > summary { margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
  details.help .help-body { font-size: 13px; color: var(--ink); }
  details.help .help-body h3 { margin: 14px 0 6px; font-size: 13px; font-weight: 600; }
  details.help .help-body h3:first-child { margin-top: 0; }
  details.help .help-body p { margin: 4px 0 8px; }
  details.help .help-body ul { margin: 4px 0 8px; padding-left: 20px; }
  details.help .help-body li { margin: 3px 0; }
  details.help .help-body code { background: #11141b; padding: 1px 5px; border-radius: 2px; font-size: 12px; font-family: ui-monospace, monospace; }
  details.help .help-body .muted { color: var(--muted); }
  details.help .help-body .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: middle; margin-right: 4px; }

  .nbhd-list { display: grid; grid-template-columns: 1fr; gap: 4px; }
  /* Shared column template so the header lines up with every row. Fixed
     widths are essential here: separate CSS grids don't share auto-sized
     track widths, so each row would otherwise size its own columns
     independently of the header. */
  .nbhd-list-header,
  .nbhd-row {
    display: grid;
    grid-template-columns: 32ch 13ch 12ch 11ch 24ch 1fr;
    align-items: center; gap: 12px;
    padding: 6px 10px;
  }
  .nbhd-list-header {
    color: var(--muted); font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.04em; font-weight: 600;
    border-bottom: 1px solid var(--line);
    margin-bottom: 4px;
  }
  .nbhd-list-header .sortable { cursor: pointer; user-select: none; }
  .nbhd-list-header .sortable:hover { color: var(--ink); }
  .nbhd-list-header .sortable.active { color: var(--accent); }
  .nbhd-list-header .arrow { font-size: 10px; margin-left: 3px; }
  .nbhd-row {
    border-radius: 4px; cursor: pointer;
    transition: background 0.08s;
    border: 1px solid transparent;
  }
  .nbhd-row .top-offender {
    font-family: ui-monospace, monospace; font-size: 11px;
    color: var(--ink); display: flex; align-items: center; gap: 4px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nbhd-row .top-offender .marker { color: #ef4444; }
  .nbhd-row .top-offender .arrow { color: var(--src-corpus); font-weight: 600; }
  .nbhd-row .top-offender .none { color: var(--muted); font-style: italic; }
  /* Gravity table inside the expand panel */
  .gravity-table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-family: ui-monospace, monospace; font-size: 11px; }
  .gravity-table th { color: var(--muted); text-align: right; padding: 2px 8px; font-weight: 500; border-bottom: 1px solid var(--line); cursor: pointer; user-select: none; }
  .gravity-table th:first-child { text-align: left; }
  .gravity-table th:hover { color: var(--ink); }
  .gravity-table th.active { color: var(--accent); }
  .gravity-table td { padding: 2px 8px; text-align: right; color: var(--ink); }
  .gravity-table td:first-child { text-align: left; }
  .gravity-table tr.top-row td { background: rgba(122, 162, 247, 0.06); }
  .gravity-table .owed { color: var(--src-corpus); font-weight: 600; }
  .gravity-table .stolen { color: var(--accent); }
  .gravity-table .tier-blocker { color: #ef4444; font-weight: 600; }
  .gravity-table .tier-leaky { color: #f59e0b; font-weight: 600; }
  .gravity-table .tier-clean { color: #22c55e; }
  /* Force-directed graph */
  #force-svg { display: block; width: 100%; height: 600px; background: #11141b; border-radius: 6px; cursor: grab; }
  #force-svg.dragging { cursor: grabbing; }
  #force-svg .node { stroke: #0a0d12; stroke-width: 1.5; cursor: grab; }
  #force-svg .node.top-offender { stroke: #fff; stroke-width: 2.5; }
  #force-svg .node.dim { opacity: 0.15; }
  #force-svg .link { stroke-opacity: 0.45; fill: none; pointer-events: none; }
  #force-svg .link.dim { stroke-opacity: 0.05; }
  #force-svg .link.translator-only { stroke: #a855f7; }
  #force-svg .link.translator-confirmed { stroke-opacity: 0.7; }
  #force-svg .label {
    font-family: ui-monospace, monospace; font-size: 10px; fill: var(--ink);
    pointer-events: none; text-shadow: 0 0 3px var(--bg);
  }
  #force-svg .label.dim { opacity: 0.2; }
  /* Compact zoom-control buttons sitting in the controls row. */
  .zoom-btn, .fs-btn {
    background: #0a0d12; border: 1px solid var(--line); color: var(--ink);
    border-radius: 4px; padding: 3px 9px; font: inherit; font-size: 13px;
    cursor: pointer; min-width: 28px;
    transition: background 0.08s, border-color 0.08s;
  }
  .zoom-btn:hover, .fs-btn:hover { background: #1c212c; border-color: var(--accent); }
  .zoom-btn:active, .fs-btn:active { background: #11141b; }
  /* Fullscreen mode: section flexes to fill the viewport, the chart stage
     takes the remaining vertical space. The Fullscreen API gives the
     element a black background by default; overlay our own. */
  section:fullscreen {
    display: flex; flex-direction: column;
    height: 100vh; max-height: 100vh; width: 100vw;
    padding: 22px 32px; box-sizing: border-box;
    background: var(--bg); overflow-y: auto;
    border-radius: 0;
  }
  section:fullscreen > * { flex: 0 0 auto; }
  section:fullscreen #force-stage,
  section:fullscreen #bundling-stage {
    flex: 1 1 auto; min-height: 0;
    display: flex; flex-direction: column;
  }
  section:fullscreen #force-svg {
    flex: 1 1 auto; height: auto !important;
  }
  section:fullscreen #bundling-svg {
    max-height: 100% !important;
  }
  section:fullscreen .fs-btn::before { content: "⤡ "; }
  #force-tooltip {
    position: absolute; pointer-events: none; opacity: 0;
    background: rgba(15,18,23,0.96); border: 1px solid var(--line);
    border-radius: 6px; padding: 8px 12px; font-size: 11px; color: var(--ink);
    font-family: ui-monospace, monospace;
    max-width: 460px; min-width: 280px;
    z-index: 10;
    transition: opacity 0.1s;
    box-shadow: 0 8px 28px rgba(0,0,0,0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  #force-tooltip.visible { opacity: 1; }
  #force-tooltip .row { display: flex; justify-content: space-between; gap: 12px; }
  #force-tooltip .row .label-cell { color: var(--muted); }
  #force-tooltip .name { font-weight: 600; color: var(--accent); margin-bottom: 4px; word-break: break-all; }
  #force-tooltip .scores { margin-bottom: 6px; }
  #force-tooltip .phrases-section {
    margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line);
  }
  #force-tooltip .phrases-section h5 {
    margin: 0 0 3px; font-size: 10px; font-weight: 600;
    color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em;
  }
  #force-tooltip .phrase {
    font-size: 11px; padding: 1px 0; color: var(--ink);
    white-space: normal; word-break: break-word;
  }
  #force-tooltip .phrase .edge-tag {
    color: var(--muted); font-size: 10px; margin-right: 4px;
  }
  #force-tooltip .phrase.outgoing .edge-tag { color: #ef4444; }
  #force-tooltip .phrase.incoming .edge-tag { color: #22c55e; }
  #force-tooltip .more-note { font-size: 10px; color: var(--muted); font-style: italic; margin-top: 2px; }
  .nbhd-row:hover { background: #1c212c; border-color: var(--line); }
  .nbhd-row.expanded { background: #1c212c; border-color: var(--line); }
  .nbhd-row .id {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .nbhd-row .kind { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 10px; color:#0f1217; }
  .nbhd-row .kind.cross { background: var(--kind-cross); }
  .nbhd-row .kind.same  { background: var(--kind-same); }
  .nbhd-row .members { font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); text-align: right; }
  .nbhd-row .badges { display:flex; gap: 3px; }
  .nbhd-row .badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; color: #0f1217; font-weight: 600; }
  .nbhd-row .badge.sim    { background: var(--src-sim); }
  .nbhd-row .badge.corpus { background: var(--src-corpus); }
  .nbhd-row .badge.both   { background: var(--src-both); }
  /* Translator-derived per-row badges. .tx-confirmed = ranker+translator
     both wrong (real collisions); .tx-rescued = ranker wrong but translator
     fixed it (LLM bails the ranker out). Numbers show counts. */
  .nbhd-row .badge.tx-confirmed { background: #ef4444; color: #fff; }
  .nbhd-row .badge.tx-rescued   { background: #22c55e; color: #061a0d; }
  .nbhd-row .badge.tx-newfail   { background: #f59e0b; color: #1a1209; }
  /* Edge-level translator decoration */
  .nbhd-detail .edges .tx-counts {
    font-size: 10px; color: var(--muted); margin-left: 6px;
    font-family: ui-monospace, monospace;
  }
  .nbhd-detail .edges .tx-counts .conf  { color: #ef4444; }
  .nbhd-detail .edges .tx-counts .resc  { color: #22c55e; }
  /* Per-sample category tag */
  .nbhd-detail .edges .samples .ph .cat {
    font-size: 9px; padding: 0 4px; border-radius: 6px;
    margin-right: 4px; font-weight: 600;
  }
  .nbhd-detail .edges .samples .ph .cat.CONFIRMED   { background: #4a1414; color: #ef4444; }
  .nbhd-detail .edges .samples .ph .cat.RESCUED     { background: #14401a; color: #22c55e; }
  .nbhd-detail .edges .samples .ph .cat.NEW_FAILURE { background: #443013; color: #f59e0b; }
  /* Translator summary callout in the headline */
  header .tx-summary {
    margin-top: 6px; padding: 6px 10px;
    background: rgba(34, 197, 94, 0.06);
    border-left: 3px solid #22c55e;
    font-size: 13px; color: var(--ink);
    border-radius: 0 4px 4px 0;
  }
  header .tx-summary b { font-weight: 600; }
  header .tx-summary .conf { color: #ef4444; font-weight: 600; }
  header .tx-summary .resc { color: #22c55e; font-weight: 600; }
  header .tx-summary .nf   { color: #f59e0b; font-weight: 600; }
  header .tx-summary .recovery { font-style: italic; color: var(--muted); }
  .nbhd-row .meta {
    font-family: ui-monospace, monospace; font-size: 11px; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .nbhd-detail {
    padding: 10px 16px 12px 16px;
    background: #11141b;
    border-radius: 4px;
    margin: 2px 0 8px 24px;
    font-size: 12px;
    border-left: 2px solid var(--accent);
  }
  .nbhd-detail h4 { margin: 0 0 6px 0; color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .nbhd-detail .member-list { display: grid; grid-template-columns: 1fr; gap: 2px; margin: 4px 0 10px 0; }
  .nbhd-detail .member-list .m { font-family: ui-monospace, monospace; font-size: 12px; color: var(--ink); padding: 2px 0; }
  .nbhd-detail .edges { display: grid; grid-template-columns: 1fr; gap: 6px; margin: 4px 0 0 0; }
  .nbhd-detail .edges .edge-block { padding: 4px 0 4px 0; border-top: 1px solid var(--line); }
  .nbhd-detail .edges .edge-block:first-child { border-top: none; }
  .nbhd-detail .edges .edge-head { font-family: ui-monospace, monospace; font-size: 11px; color: var(--ink); display: grid; grid-template-columns: 40px 1fr; gap: 6px; }
  .nbhd-detail .edges .edge-head .count { color: var(--src-corpus); text-align: right; font-weight: 600; }
  .nbhd-detail .edges .samples { padding: 2px 0 0 46px; display: grid; grid-template-columns: 1fr; gap: 1px; }
  .nbhd-detail .edges .samples .ph { font-size: 11px; color: var(--ink); padding: 1px 0; }
  .nbhd-detail .edges .samples .ph .src { color: var(--accent); font-family: ui-monospace, monospace; font-size: 10px; margin-right: 6px; }
  .nbhd-detail .empty-detail { color: var(--muted); font-style: italic; }

  .empty-state { color: var(--muted); font-style: italic; padding: 12px 0; font-size: 13px; text-align: center; }

  .slider-row {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 10px; margin-bottom: 12px;
    background: #11141b; border: 1px solid var(--line); border-radius: 6px;
  }
  .slider-row label { color: var(--muted); font-size: 12px; }
  .slider-row input[type="range"] { flex: 1; max-width: 480px; accent-color: var(--src-both); }
  .slider-row .val { font-family: ui-monospace, monospace; font-size: 13px; color: var(--ink); min-width: 56px; }
  .slider-row .hint { color: var(--muted); font-size: 11px; }

  /* Hierarchical edge bundling */
  #bundling-svg { display: block; margin: 0 auto; }
  #bundling-svg .leaf-label {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 9px; fill: var(--ink); cursor: default;
  }
  #bundling-svg .leaf-label.dim { fill: #3a4253 !important; }
  #bundling-svg .leaf-label.target { fill: var(--accent) !important; font-weight: 700; }
  #bundling-svg .leaf-label.source { fill: var(--src-both) !important; font-weight: 700; }
  /* Agent ring — clickable to filter the chart by that agent. */
  #bundling-svg .agent-arc { cursor: pointer; }
  #bundling-svg .agent-arc:hover { filter: brightness(1.25); }
  #bundling-svg .agent-label {
    cursor: pointer;
    text-anchor: middle;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 3px;
    stroke-linejoin: round;
  }
  #bundling-svg .agent-label:hover { font-weight: 800; }
  #bundling-svg .edge {
    fill: none; mix-blend-mode: screen;
    pointer-events: none;
    transition: stroke-opacity 0.08s, stroke 0.08s;
  }
  #bundling-svg .edge.dim { stroke-opacity: 0.04; }
  /* Hover edge: thicker, fully opaque, blend mode off so the direction
     color reads cleanly against everything underneath. */
  #bundling-svg .edge.hover {
    stroke-opacity: 1;
    stroke-width: 3px;
    mix-blend-mode: normal;
  }
  /* Direction coloring is set via the stroke attribute in JS (not CSS)
     so SVG attribute precedence is unambiguous. */
  #bundling-svg .leaf-hit {
    fill: rgba(0,0,0,0.001);
    cursor: pointer;
  }
  .bundling-legend { display: flex; gap: 14px; margin: 8px 0 0 0; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
  .bundling-legend .item { display: inline-flex; align-items: center; gap: 4px; }
  .bundling-legend .item i { display: inline-block; width: 16px; height: 2px; }

  #bundling-phrases {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(15, 18, 23, 0.72);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 14px 12px;
    /* Width is set in JS to 90% of the inscribed graph circle diameter,
       capped at 560px. Falls back to a reasonable default if JS hasn't
       run yet. */
    width: min(560px, 70%);
    max-height: 360px;
    overflow-y: auto;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 28px rgba(0,0,0,0.45);
    /* Hover state: panel is non-interactive so the user can mouse "through"
       it to other leaves. Pinned state (set by click): panel becomes
       interactive so the user can scroll inside it. */
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s, border-color 0.1s, box-shadow 0.1s;
    z-index: 10;
    color: var(--ink);
  }
  #bundling-phrases.visible { opacity: 1; }
  #bundling-phrases.pinned {
    pointer-events: auto;
    border-color: var(--accent);
    box-shadow: 0 8px 28px rgba(0,0,0,0.45), 0 0 0 1px rgba(122, 162, 247, 0.4);
  }
  #bundling-phrases .pinned-banner {
    display: none;
    margin: -10px -14px 8px -14px;
    padding: 4px 12px;
    background: rgba(122, 162, 247, 0.12);
    border-bottom: 1px solid var(--line);
    font-size: 11px;
    color: var(--accent);
    border-radius: 8px 8px 0 0;
  }
  #bundling-phrases.pinned .pinned-banner { display: block; }
  #bundling-phrases .pinned-banner .unpin {
    float: right; cursor: pointer; color: var(--muted);
    text-decoration: underline; font-size: 10px;
  }
  #bundling-phrases .pinned-banner .unpin:hover { color: var(--ink); }
  #bundling-phrases h4 { margin: 0 0 6px 0; font-size: 12px; color: var(--ink); font-weight: 600; }
  #bundling-phrases .target-name { color: var(--accent); font-family: ui-monospace, monospace; font-weight: 700; }
  #bundling-phrases .group { margin: 8px 0 0; }
  #bundling-phrases .group-head { font-size: 11px; color: var(--muted); margin: 0 0 3px; font-family: ui-monospace, monospace; }
  #bundling-phrases .ph {
    font-size: 12px; padding: 3px 0;
    border-top: 1px solid #1f2532;
  }
  #bundling-phrases .ph:first-child { border-top: none; }
  #bundling-phrases .src { color: var(--accent); font-family: ui-monospace, monospace; font-size: 10px; margin-right: 6px; }
  #bundling-phrases .empty { color: var(--muted); font-style: italic; font-size: 12px; }
  /* Custom thin scrollbar to keep the floating look clean. */
  #bundling-phrases::-webkit-scrollbar { width: 6px; }
  #bundling-phrases::-webkit-scrollbar-track { background: transparent; }
  #bundling-phrases::-webkit-scrollbar-thumb { background: #2a3142; border-radius: 3px; }
</style>
</head>
<body>
<header>
  <h1>Ambiguity neighborhood preview</h1>
  <div class="stats" id="stats"></div>
  <div class="tx-summary" id="tx-summary" style="display:none;"></div>
</header>
<main>
  <details class="help" open>
    <summary>How to read this page</summary>
    <div class="help-body">
      <h3>What this is</h3>
      <p>A <b>preview</b> of the ambiguity-action neighborhoods that would be built from your current data. <b>Nothing is persisted.</b> This page lets you eyeball the shape of the data — which actions cluster together, where the evidence comes from, how big the clusters are — before committing to a real <code>@collision neighborhoods build</code>.</p>

      <h3>What's a neighborhood?</h3>
      <p>A set of <code>{schemaName, actionName}</code> members that are mutually confusable. Two kinds:</p>
      <ul>
        <li><span class="swatch" style="background:var(--kind-cross)"></span><b>cross-schema</b> — members live in different agents (e.g. <code>music.setVolume</code> + <code>player.setVolume</code>). These matter most at runtime: <code>llmSelect</code>'s schema picker can route to the wrong agent.</li>
        <li><span class="swatch" style="background:var(--kind-same)"></span><b>same-schema</b> — siblings within one agent (e.g. <code>email.send</code> + <code>email.reply</code>). The LLM's translation pass usually disambiguates these, but they're tracked so we can spot the few that don't.</li>
      </ul>

      <h3>Where the data comes from</h3>
      <p>Neighborhoods are surfaced from up to <b>three signals</b>. The first two are baseline sources (shown as badges on each row); the third is enrichment that decorates existing neighborhoods rather than forming new ones:</p>
      <ul>
        <li><span class="swatch" style="background:var(--src-sim)"></span><b>similarity</b> — pairs surfaced by <code>@collision similar</code>'s multi-vector embedding clustering. Cross-schema only by construction.</li>
        <li><span class="swatch" style="background:var(--src-corpus)"></span><b>corpus</b> — empirical misroute edges from <code>@collision corpus probe</code> (the <i>embedding ranker</i> replayed against an LLM-authored phrase corpus). Cross- or same-schema. Edges below <code>--min-misroute</code> are filtered out.</li>
        <li><span class="swatch" style="background:var(--src-both)"></span><b>both</b> — confirmed by similarity and corpus. The strongest baseline signal.</li>
        <li><span class="swatch" style="background:#ef4444"></span><b>translator</b> — cross-tab from <code>@collision corpus translate</code> (the actual <i>LLM translator</i> replayed against the same phrase corpus). When loaded, every neighborhood gets per-edge <code>translatorConfirmedCount</code> / <code>translatorRescuedCount</code> counts, plus three derived badges: <span class="swatch" style="background:#ef4444"></span><b>🛑N CONFIRMED</b> (ranker AND translator both wrong → genuine collision), <span class="swatch" style="background:#22c55e"></span><b>↻N RESCUED</b> (ranker wrong, translator fixed it), and <span class="swatch" style="background:#f59e0b"></span><b>!N NEW_FAILURE</b> (translator wrong on a phrase the ranker got right). The headline panel under the title shows the totals plus the recovery rate.</li>
      </ul>
      <p>Use the <b>Sources</b> filter to narrow: <code>both</code> = similarity + corpus overlap; <code>translator-confirmed</code> = at least one phrase where ranker AND translator both pick wrong on this neighborhood (the highest-priority neighborhoods for explicit policy).</p>
      <p>Member-set merge: candidates from the two baseline sources are unioned when they share <b>≥2 members</b>. Translator data folds onto whatever neighborhoods that merge produces — translator-only pairs that aren't already in a neighborhood are dropped (counted as orphan stats; promoting them to standalone neighborhoods is a follow-up).</p>

      <h3>Reading the rows</h3>
      <p>Each row is one neighborhood. Sorted by member count, then by similarity score. Click a row to expand and see the members + the corpus misroute edges that contributed + the actual <b>example phrases</b> users said for each edge (with the LLM model and phrasing style that generated them, in brackets). When translator data is loaded, each phrase sample also carries a colored <b>CONFIRMED</b> / <b>RESCUED</b> / <b>NEW_FAILURE</b> chip showing the cross-tab verdict, and each edge shows <code>[translator: N confirmed · M rescued]</code> beside the from→to.</p>
      <ul>
        <li><b>Filter by kind / source / size / text</b> using the controls above the list. The <code>translator-confirmed</code> source filter narrows to neighborhoods whose <code>crossVerdicts.CONFIRMED &gt; 0</code> — the genuine hard collisions worth explicit policy.</li>
        <li><b>Member counts &gt; 2</b> are interesting — they signal a tight cluster of mutually-confusable actions.</li>
        <li><b>"both"-source neighborhoods</b> are high-confidence baseline candidates. <b>Translator-confirmed neighborhoods</b> are even higher signal: the LLM agrees the ranker's misroute is real even when given the chance to override.</li>
      </ul>

      <h3>The confirm-threshold slider</h3>
      <p>The cluster threshold (used to <i>build</i> similarity neighborhoods) is fixed at preview-build time. The <b>confirm threshold</b> slider above the table is a separate, weaker bar: when a corpus-only cross-schema pair has an embedding similarity score at or above the slider value, it gets retagged as <b>both</b> — empirical evidence (corpus) plus semantic evidence (similarity) line up. Drag the slider down to surface more "both" matches; drag it up to require near-cluster-strength similarity. Same-schema pairs aren't computed by the engine at all, so they always stay <b>corpus</b>-tagged.</p>

      <h3>The hierarchical edge bundling chart</h3>
      <p>Below the table, every action that's a member of any neighborhood is a leaf on a circle, organized by <code>agent → schema → action</code>. Curves connect actions that share a neighborhood, color-coded by source (both / similarity / corpus). The curves bundle along common parents so dense areas read as fat ropes. Hover an action label to focus on its edges and see exactly which other actions it's confused with. Use the chart's own filter controls (separate from the table's) to slice by source / kind / size.</p>

      <h3>What this preview does <em>not</em> show</h3>
      <p>No runtime policy ladder, no resolution decisions, no live traffic — just the static merge of similarity + corpus. Phase 1 of the rollout adds policy assignment per neighborhood; later phases wire the runtime resolver and the live-event updater.</p>
    </div>
  </details>

  <section>
    <h2>Neighborhoods</h2>
    <div class="sub">Rows are sorted by member count (largest first), then by similarity score. Click a row to expand.</div>
    <div class="slider-row">
      <label>Confirm threshold</label>
      <input type="range" id="confirmSlider" min="0.5" max="1.0" step="0.01" value="0.5">
      <span class="val" id="confirmValue">0.50</span>
      <span class="hint">Drag to retag corpus pairs as "both" when their cross-schema embedding similarity meets this score. Same-schema pairs (engine doesn't compute them) stay corpus-only at any threshold.</span>
    </div>
    <div class="style-chips" id="styleChips" style="display:none;">
      <span class="label">Styles:</span>
      <span id="styleChipsList"></span>
      <span class="quick" data-style-all>all</span>
      <span class="quick" data-style-none>none</span>
    </div>
    <div class="controls">
      <input type="text" id="filter" placeholder="filter by id / member / agent…" style="width:340px">
      <label>Kind
        <select id="kindFilter">
          <option value="all">all</option>
          <option value="cross-schema">cross-schema</option>
          <option value="same-schema">same-schema</option>
        </select>
      </label>
      <label>Sources
        <select id="sourceFilter">
          <option value="all">all</option>
          <option value="both">confirmed (both)</option>
          <option value="similarity">similarity only</option>
          <option value="corpus">corpus only</option>
          <option value="tx-confirmed">translator-confirmed</option>
        </select>
      </label>
      <label>Min size
        <input type="number" id="minSize" value="2" min="2" max="20" style="width:60px">
      </label>
      <label>Sort by
        <select id="sortBy">
          <option value="default">size · sim score (default)</option>
          <option value="topOffender">top offender owed</option>
          <option value="endUser">top offender end-user owed</option>
        </select>
      </label>
      <span id="count" style="color:var(--muted);font-size:12px;"></span>
    </div>
    <div class="nbhd-list-header">
      <div>id</div>
      <div>kind</div>
      <div>source</div>
      <div>size</div>
      <div>top offender</div>
      <div>meta</div>
    </div>
    <div class="nbhd-list" id="list"></div>
  </section>

  <section>
    <h2>Hierarchical edge bundling</h2>
    <div class="sub">Each leaf is one action. The hierarchy is <code>agent → schema → action</code>. Curves connect actions that share a neighborhood; they bundle along common parents so dense areas (e.g. one schema with many internal collisions) read as fat ropes. Hover an action to highlight only its neighbors.</div>
    <div class="controls">
      <label>Show
        <select id="bundleSourceFilter">
          <option value="all">all neighborhoods</option>
          <option value="both">confirmed (both)</option>
          <option value="similarity">similarity-only</option>
          <option value="corpus">corpus-only</option>
          <option value="tx-confirmed">translator-confirmed</option>
        </select>
      </label>
      <label>Kind
        <select id="bundleKindFilter">
          <option value="all">all</option>
          <option value="cross-schema">cross-schema</option>
          <option value="same-schema">same-schema</option>
        </select>
      </label>
      <label>Min neighborhood size
        <input type="number" id="bundleMinSize" value="2" min="2" max="20" style="width:60px">
      </label>
      <label><input type="checkbox" id="bundleFullPath"> Show full path (agent.schema.action)</label>
      <button type="button" id="bundleFullscreen" class="fs-btn" title="toggle fullscreen">⛶</button>
      <span id="bundleCount" style="color:var(--muted);font-size:12px;"></span>
    </div>
    <div id="bundling-stage" style="position:relative;">
      <div id="bundling"></div>
      <div id="bundling-phrases"></div>
    </div>
    <div class="bundling-legend">
      <span class="item"><i style="background:var(--src-both)"></i>both</span>
      <span class="item"><i style="background:var(--src-sim)"></i>similarity</span>
      <span class="item"><i style="background:var(--src-corpus)"></i>corpus</span>
      <span class="item">Hover an action label to focus on its edges</span>
    </div>
    <div class="bundling-legend">
      <span class="item"><b>On hover:</b></span>
      <span class="item"><i style="background:#ef4444;height:3px;"></i>redirected away (focused was expected)</span>
      <span class="item"><i style="background:#22c55e;height:3px;"></i>redirected to (focused was picked instead)</span>
      <span class="item"><i style="background:#a855f7;height:3px;"></i>both directions</span>
      <span class="item"><i style="background:#94a3b8;height:3px;"></i>similarity-only (no direction)</span>
    </div>
  </section>

  <section>
    <h2>Misroute force graph</h2>
    <div class="sub">Empirical action-confusion graph laid out by physics. Each node is one action; size = gravity. Each link is a real misroute observed in the corpus.</div>

    <details class="help" style="margin: 8px 0 14px 0; padding: 10px 14px; background:#11141b;">
      <summary>How to read this graph</summary>
      <div class="help-body">
        <h3>What the layout means</h3>
        <p>Nothing about position is intrinsic — d3's force simulation pulls connected nodes together (link force) while pushing all nodes apart (charge force) until things settle. Tightly connected groups end up as visual clusters; loosely linked outliers drift to the edges. Position is emergent, so absolute coordinates are not meaningful — only relative proximity is.</p>

        <h3>What the encoding means</h3>
        <ul>
          <li><b>Node radius</b> = gravity under the chosen "Sort/size by" metric (default <code>owedTraffic</code> — phrases that should have routed to this action but didn't). Bigger node = more pain.</li>
          <li><b>Link width</b> = √(misroute count). A fat arrow between A and B means many phrases that should have hit A landed on B instead.</li>
          <li><b>Arrow direction</b> = <code>from → to</code>: the source is the action whose user intent got bypassed; the target is the action that absorbed the traffic.</li>
          <li><b>Node color</b> = neighborhood (categorical). When translator-probe data is loaded, switch to severity tier (red = blocker, amber = leaky, green = clean) via the color toggle.</li>
          <li><b>White outline</b> on a node marks it as the top offender of its neighborhood.</li>
        </ul>

        <h3>Source filter</h3>
        <ul>
          <li><b>all neighborhoods</b> — every neighborhood in the dataset.</li>
          <li><b>confirmed (both)</b> — neighborhoods supported by <i>both</i> baseline signals (similarity + corpus). Highest baseline confidence.</li>
          <li><b>similarity-only</b> / <b>corpus-only</b> — neighborhoods seen by exactly one baseline signal.</li>
          <li><b>translator-confirmed</b> — neighborhoods where at least one phrase made <i>both</i> the embedding ranker AND the LLM translator pick the wrong action (<code>crossVerdicts.CONFIRMED &gt; 0</code>). These are the genuine hard collisions: even when the translator has the chance to override the ranker, it doesn't. Empty when translator data hasn't been loaded — run <code>@collision corpus translate</code> to populate.</li>
        </ul>

        <h3>What to do with it</h3>
        <ul>
          <li><b>Hover a node</b> to dim everything else and read the full gravity scores plus example phrases for the lost / gained traffic.</li>
          <li><b>Drag a node</b> to reposition it. Drag releases the node back into the simulation; it will drift until pinned again.</li>
          <li><b>Mouse wheel</b> zooms; <b>click-drag the empty background</b> pans. Use the zoom controls (<code>+</code> / <code>−</code> / <code>fit</code>) for precise framing.</li>
          <li><b>Sort/size by</b> reflows node radii (and re-runs the simulation briefly so big nodes settle without overlapping). Try <code>stolenTraffic</code> to find magnets and <code>entanglement</code> to find structurally confused hubs.</li>
        </ul>

        <h3>What this is NOT</h3>
        <p>This is not a runtime trace, not a probability distribution, and not a recommendation. It's an empirical record of where the embedding ranker put phrases that the corpus says belong elsewhere. The same data drives the hotspot heatmap and the recovery breakdown — this view just reorganizes it as a connected graph so the offenders pop visually.</p>
      </div>
    </details>

    <div class="controls">
      <label>Show
        <select id="forceSourceFilter">
          <option value="all">all neighborhoods</option>
          <option value="both">confirmed (both)</option>
          <option value="similarity">similarity-only</option>
          <option value="corpus">corpus-only</option>
          <option value="tx-confirmed">translator-confirmed</option>
        </select>
      </label>
      <label>Kind
        <select id="forceKindFilter">
          <option value="all">all</option>
          <option value="cross-schema">cross-schema</option>
          <option value="same-schema">same-schema</option>
        </select>
      </label>
      <label>Min size
        <input type="number" id="forceMinSize" value="2" min="2" max="20" style="width:60px">
      </label>
      <label>Sort/size by
        <select id="forceSortBy">
          <option value="owed">owedTraffic (lost)</option>
          <option value="stolen">stolenTraffic (gained)</option>
          <option value="entanglement">entanglement</option>
          <option value="weighted">weightedConfusion</option>
          <option value="endUser" id="forceSortEndUser" disabled>endUserOwed (translator)</option>
        </select>
      </label>
      <label id="forceColorByLabel" style="display:none;">Color by
        <select id="forceColorBy">
          <option value="severity">severity tier</option>
          <option value="neighborhood">neighborhood</option>
        </select>
      </label>
      <button type="button" id="forceZoomIn" class="zoom-btn" title="zoom in">+</button>
      <button type="button" id="forceZoomOut" class="zoom-btn" title="zoom out">−</button>
      <button type="button" id="forceZoomFit" class="zoom-btn" title="fit graph to view">fit</button>
      <button type="button" id="forceZoomReset" class="zoom-btn" title="reset zoom (1:1, centered)">1:1</button>
      <button type="button" id="forceFullscreen" class="fs-btn" title="toggle fullscreen">⛶</button>
      <span id="forceCount" style="color:var(--muted);font-size:12px;"></span>
    </div>
    <div id="force-stage" style="position:relative;">
      <svg id="force-svg"></svg>
      <div id="force-tooltip"></div>
    </div>
    <div class="bundling-legend">
      <span class="item"><b>Node size:</b> gravity (sqrt-scaled phrase count)</span>
      <span class="item"><b>Link width:</b> edge count (sqrt-scaled)</span>
      <span class="item"><b>Arrow:</b> direction of misroute (from → to)</span>
      <span class="item"><b>Wheel / drag bg:</b> zoom / pan · <b>drag node:</b> reposition</span>
      <span class="item" id="forceTranslatorLegend" style="display:none;"><i style="background:#a855f7;height:3px;"></i>NEW_FAILURE (translator-only edge)</span>
    </div>
  </section>
</main>
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script id="payload" type="application/json">`;

const PREVIEW_HTML_SUFFIX = `</script>
<script>
const PAYLOAD = JSON.parse(document.getElementById("payload").textContent);
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// =========================================================================
// Per-phrase-style filter — discovers all styles present in the corpus
// (from edge.countsByStyle), renders chips, and gates every count-bearing
// renderer through styleFilteredEdgeCount() / .CONFIRMED() / .RESCUED() so
// totals re-aggregate live as the user toggles chips.
// =========================================================================

const ALL_STYLES = (() => {
    const s = new Set();
    for (const n of PAYLOAD.neighborhoods) {
        for (const e of n.evidence.misrouteEdges || []) {
            for (const k of Object.keys(e.countsByStyle || {})) s.add(k);
        }
        for (const e of n.evidence.translatorMisrouteEdges || []) {
            for (const k of Object.keys(e.countsByStyle || {})) s.add(k);
        }
    }
    // Stable, semantically grouped order: the historical "base" trio first,
    // then expanded styles. Unknown keys land alphabetically at the end.
    const order = [
        "imperative", "conversational", "casual",
        "polite", "curt", "slang", "typos",
    ];
    const sorted = [...s].sort((a, b) => {
        const ai = order.indexOf(a), bi = order.indexOf(b);
        if (ai !== bi) {
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        }
        return a.localeCompare(b);
    });
    return sorted;
})();
const HAS_STYLE_DATA = ALL_STYLES.length > 0;
const enabledStyles = new Set(ALL_STYLES); // default: every detected style on

/**
 * Sum a per-style scalar across only the styles the user currently has
 * enabled. When the chip row is hidden (no style data on the corpus),
 * falls back to the top-level value via the supplied accessor.
 */
function sumStyleField(cbs, field) {
    if (!cbs) return 0;
    let total = 0;
    for (const k of enabledStyles) {
        const v = cbs[k];
        if (v && typeof v[field] === "number") total += v[field];
    }
    return total;
}

/** Effective count for an edge under the current style filter. Falls back
 *  to edge.count when no per-style data is available. */
function edgeCount(e) {
    if (e.countsByStyle && HAS_STYLE_DATA) return sumStyleField(e.countsByStyle, "count");
    return e.count;
}
function edgeTxConfirmed(e) {
    if (e.countsByStyle && HAS_STYLE_DATA) return sumStyleField(e.countsByStyle, "translatorConfirmedCount");
    return e.translatorConfirmedCount ?? 0;
}
function edgeTxRescued(e) {
    if (e.countsByStyle && HAS_STYLE_DATA) return sumStyleField(e.countsByStyle, "translatorRescuedCount");
    return e.translatorRescuedCount ?? 0;
}

/** True when a phrase sample should be displayed under the current filter. */
function sampleEnabled(s) {
    if (!HAS_STYLE_DATA) return true;
    if (!s.style) return true; // legacy samples without style: always show
    return enabledStyles.has(s.style);
}

/** Re-aggregate a neighborhood's crossVerdicts under the current style
 *  filter. Returns a frozen object with the same shape as cv. When no
 *  per-style data is available, falls back to the stored cv unchanged. */
function filteredCrossVerdicts(n) {
    const cv = n.evidence.crossVerdicts;
    if (!HAS_STYLE_DATA || !cv) return cv;
    let confirmed = 0, rescued = 0, newFail = 0, clean = 0;
    for (const e of n.evidence.misrouteEdges || []) {
        confirmed += edgeTxConfirmed(e);
        rescued += edgeTxRescued(e);
    }
    for (const e of n.evidence.translatorMisrouteEdges || []) {
        newFail += edgeCount(e);
    }
    // CLEAN isn't bucketed per-edge — it counts phrases where both probes
    // were correct. Without a per-style breakdown of those, fall back to
    // the stored count when all styles are on; zero otherwise (avoids
    // misleading display). This is a known limitation; the CONFIRMED /
    // RESCUED / NEW_FAILURE counts are the load-bearing ones for triage.
    if (enabledStyles.size === ALL_STYLES.length) clean = cv.CLEAN ?? 0;
    return { CONFIRMED: confirmed, RESCUED: rescued, NEW_FAILURE: newFail, CLEAN: clean };
}

function renderStyleChips() {
    if (!HAS_STYLE_DATA) return;
    const row = document.getElementById("styleChips");
    const list = document.getElementById("styleChipsList");
    row.style.display = "flex";
    // Per-chip total: sum count across every edge for this style. Helps the
    // operator see at a glance which styles produce the most misroutes.
    const totals = {};
    for (const s of ALL_STYLES) totals[s] = 0;
    for (const n of PAYLOAD.neighborhoods) {
        for (const e of n.evidence.misrouteEdges || []) {
            for (const [s, v] of Object.entries(e.countsByStyle || {})) {
                totals[s] = (totals[s] ?? 0) + (v.count ?? 0);
            }
        }
    }
    list.innerHTML = ALL_STYLES.map(s => {
        const on = enabledStyles.has(s);
        return \`<span class="chip\${on ? "" : " off"}" data-style="\${escapeHtml(s)}">\${escapeHtml(s)}<span class="count">\${totals[s] || 0}</span></span>\`;
    }).join("");
    list.querySelectorAll("[data-style]").forEach(el => {
        el.addEventListener("click", () => {
            const s = el.getAttribute("data-style");
            if (enabledStyles.has(s)) enabledStyles.delete(s);
            else enabledStyles.add(s);
            renderStyleChips();
            render();
            if (typeof renderBundling === "function") renderBundling();
        });
    });
    row.querySelectorAll("[data-style-all]").forEach(el => {
        el.onclick = () => {
            for (const s of ALL_STYLES) enabledStyles.add(s);
            renderStyleChips(); render();
            if (typeof renderBundling === "function") renderBundling();
        };
    });
    row.querySelectorAll("[data-style-none]").forEach(el => {
        el.onclick = () => {
            enabledStyles.clear();
            renderStyleChips(); render();
            if (typeof renderBundling === "function") renderBundling();
        };
    });
}

// =========================================================================
// Gravity helpers (consume the pre-computed PAYLOAD.gravity map)
// =========================================================================

const HAS_TRANSLATOR = !!PAYLOAD.hasTranslatorData;

function gravityFor(neighborhoodId) {
    return PAYLOAD.gravity[neighborhoodId] || [];
}

function topOffenderOf(n) {
    const ag = gravityFor(n.id);
    if (ag.length === 0) return undefined;
    const hasTranslator = ag.some(a => a.endUserOwedTraffic !== undefined);
    const hasCorpus = ag.some(a => a.owedTraffic > 0 || a.stolenTraffic > 0);
    const sorted = [...ag].sort((a, b) => {
        if (hasTranslator) {
            const ae = a.endUserOwedTraffic || 0;
            const be = b.endUserOwedTraffic || 0;
            if (be !== ae) return be - ae;
        }
        if (hasCorpus) {
            if (b.owedTraffic !== a.owedTraffic) return b.owedTraffic - a.owedTraffic;
        }
        if (b.entanglement !== a.entanglement) return b.entanglement - a.entanglement;
        return (a.member.schemaName + "." + a.member.actionName)
            .localeCompare(b.member.schemaName + "." + b.member.actionName);
    });
    return sorted[0];
}

function renderTopOffender(n) {
    const t = topOffenderOf(n);
    if (!t) return \`<span class="none">—</span>\`;
    const hasCorpus = (t.owedTraffic || 0) > 0 || (t.stolenTraffic || 0) > 0;
    if (!hasCorpus && t.endUserOwedTraffic === undefined) {
        // similarity-only — show member name without a count
        return \`<span class="none">—</span>\`;
    }
    const useTx = HAS_TRANSLATOR && t.endUserOwedTraffic !== undefined;
    const value = useTx ? t.endUserOwedTraffic : t.owedTraffic;
    const marker = useTx ? \`<span class="marker" title="ground-truth user-visible misroutes (translator probe)">🛑</span>\` : "";
    const name = \`\${escapeHtml(t.member.schemaName)}.\${escapeHtml(t.member.actionName)}\`;
    return \`\${marker}<span>\${name}</span><span class="arrow">⇣\${value}</span>\`;
}

function renderGravityTable(n) {
    const ag = gravityFor(n.id);
    if (ag.length === 0) return "";
    const showTranslator = HAS_TRANSLATOR && ag.some(a => a.endUserOwedTraffic !== undefined);
    const sorted = [...ag].sort((a, b) => {
        if (showTranslator) {
            const ae = a.endUserOwedTraffic || 0;
            const be = b.endUserOwedTraffic || 0;
            if (be !== ae) return be - ae;
        }
        if (b.owedTraffic !== a.owedTraffic) return b.owedTraffic - a.owedTraffic;
        return (a.member.schemaName + "." + a.member.actionName)
            .localeCompare(b.member.schemaName + "." + b.member.actionName);
    });
    const head = \`
        <tr>
            <th>member</th>
            <th>owed</th>
            <th>stolen</th>
            <th>partners</th>
            <th>entangle</th>
            <th>weighted</th>
            \${showTranslator ? "<th>tx-owed</th><th>recovery%</th><th>tier</th>" : ""}
            <th>share</th>
        </tr>
    \`;
    const rows = sorted.map((a, i) => {
        const name = \`\${escapeHtml(a.member.schemaName)}.\${escapeHtml(a.member.actionName)}\`;
        const tier = a.severityTier
            ? \`<span class="tier-\${a.severityTier}">\${a.severityTier}</span>\`
            : "—";
        const recovery = a.translatorRecoveryRate !== undefined
            ? \`\${(a.translatorRecoveryRate * 100).toFixed(0)}%\`
            : "—";
        return \`<tr class="\${i === 0 ? 'top-row' : ''}">
            <td>\${name}</td>
            <td class="owed">\${a.owedTraffic}</td>
            <td class="stolen">\${a.stolenTraffic}</td>
            <td>\${a.partners}</td>
            <td>\${a.entanglement}</td>
            <td>\${a.weightedConfusion.toFixed(1)}</td>
            \${showTranslator ? \`<td>\${a.endUserOwedTraffic ?? 0}</td><td>\${recovery}</td><td>\${tier}</td>\` : ""}
            <td>\${(a.shareInNeighborhood * 100).toFixed(0)}%</td>
        </tr>\`;
    }).join("");
    return \`<h4>members ranked by gravity\${showTranslator ? " (incl. translator)" : ""}</h4>
        <table class="gravity-table">\${head}\${rows}</table>\`;
}

// Build a pair-score lookup keyed by canonical-sorted "a|b". Used by the
// confirm-threshold slider to dynamically retag corpus pairs as "both"
// without rebuilding the index.
const pairScoreMap = new Map();
for (const ps of PAYLOAD.pairScores || []) {
    const key = ps.a < ps.b ? ps.a + "|" + ps.b : ps.b + "|" + ps.a;
    pairScoreMap.set(key, ps.score);
}
function lookupPairScore(memberA, memberB) {
    const a = memberA.schemaName + "." + memberA.actionName;
    const b = memberB.schemaName + "." + memberB.actionName;
    const key = a < b ? a + "|" + b : b + "|" + a;
    return pairScoreMap.get(key);
}

// Compute the effective sources for a neighborhood given the current slider
// threshold. Server-side baseline + slider can only ADD a "similarity" tag
// (when a corpus pair has a sub-cluster but real similarity score). Same-
// schema pairs aren't in the engine's pair set, so they stay corpus-only.
function effectiveSources(n, threshold) {
    const hasSim = n.sources.includes("similarity");
    const hasCor = n.sources.includes("corpus");
    let dynamicSim = hasSim;
    let dynamicScore;
    if (!hasSim && hasCor && n.members.length === 2) {
        const score = lookupPairScore(n.members[0], n.members[1]);
        if (score !== undefined && score >= threshold) {
            dynamicSim = true;
            dynamicScore = score;
        }
    }
    return { hasSim: dynamicSim, hasCor, dynamicScore };
}

const sources = PAYLOAD.sources;

// State
const expanded = new Set();
let confirmThreshold = PAYLOAD.initialConfirmThreshold ?? 0.5;
let activeBundleAgent = null; // set by clicking an outer-ring arc or label in the bundling chart
document.getElementById("confirmSlider").value = String(confirmThreshold);
document.getElementById("confirmSlider").min = String(PAYLOAD.minConfirmThreshold ?? 0.5);

// Render
function render() {
    const filter = document.getElementById("filter").value.trim().toLowerCase();
    const kind = document.getElementById("kindFilter").value;
    const sourceMode = document.getElementById("sourceFilter").value;
    const minSize = Number(document.getElementById("minSize").value) || 2;
    const sortBy = document.getElementById("sortBy").value;

    // Compute effective sources for every neighborhood under current slider.
    const tagged = PAYLOAD.neighborhoods.map(n => {
        const eff = effectiveSources(n, confirmThreshold);
        return { n, eff };
    });

    // Headline summary recomputed every render (slider-aware).
    const totalAll = tagged.length;
    const byKind = { "cross-schema": 0, "same-schema": 0 };
    const bySources = { similarityOnly: 0, corpusOnly: 0, both: 0 };
    const agents = new Set();
    for (const { n, eff } of tagged) {
        byKind[n.kind]++;
        if (eff.hasSim && eff.hasCor) bySources.both++;
        else if (eff.hasSim) bySources.similarityOnly++;
        else if (eff.hasCor) bySources.corpusOnly++;
        for (const m of n.members) agents.add(m.schemaName.split(".")[0]);
    }
    document.getElementById("stats").innerHTML =
        \`<b>\${totalAll}</b> neighborhoods · \` +
        \`<span class="pill" style="color:var(--kind-cross);border-color:rgba(96,165,250,.4);">cross-schema \${byKind["cross-schema"]}</span>\` +
        \`<span class="pill" style="color:var(--kind-same);border-color:rgba(163,230,53,.4);">same-schema \${byKind["same-schema"]}</span>\` +
        \`· <span class="pill" style="color:var(--src-both);border-color:rgba(244,114,182,.4);">both \${bySources.both}</span>\` +
        \`<span class="pill" style="color:var(--src-sim);border-color:rgba(192,132,252,.4);">similarity \${bySources.similarityOnly}</span>\` +
        \`<span class="pill" style="color:var(--src-corpus);border-color:rgba(251,146,60,.4);">corpus \${bySources.corpusOnly}</span>\` +
        \`· <b>\${agents.size}</b> agents touched · strategy <code>\${escapeHtml(sources.similarityStrategy)}</code> @ cluster <code>\${sources.similarityThreshold}</code>, confirm <code>\${confirmThreshold.toFixed(2)}</code>\` +
        (sources.corpusFile ? \` · corpus <code>\${escapeHtml(sources.corpusFile)}</code> (min-misroute=\${sources.minMisrouteCount}, sameSchema=\${sources.includeSameSchema ? "yes" : "no"})\` : "");

    // Translator cross-tab callout — only rendered when translator data was
    // merged in. Aggregates crossVerdicts across every neighborhood so the
    // operator sees the headline split: how many ranker misroutes does the
    // translator confirm, rescue, or introduce as new failures?
    if (HAS_TRANSLATOR) {
        let confirmed = 0, rescued = 0, newFailure = 0;
        let nbhdsTouched = 0;
        for (const { n } of tagged) {
            const cv = filteredCrossVerdicts(n);
            if (!cv) continue;
            if ((cv.CONFIRMED || 0) + (cv.RESCUED || 0) + (cv.NEW_FAILURE || 0) === 0) continue;
            nbhdsTouched++;
            confirmed += cv.CONFIRMED || 0;
            rescued += cv.RESCUED || 0;
            newFailure += cv.NEW_FAILURE || 0;
        }
        const total = confirmed + rescued + newFailure;
        const recovery = (rescued + confirmed) > 0
            ? ((rescued / (rescued + confirmed)) * 100).toFixed(0)
            : null;
        const txSum = document.getElementById("tx-summary");
        if (total === 0) {
            txSum.style.display = "none";
        } else {
            txSum.style.display = "block";
            txSum.innerHTML =
                \`<b>Translator probe</b>: \` +
                \`<span class="conf">\${confirmed} CONFIRMED</span> · \` +
                \`<span class="resc">\${rescued} RESCUED</span> · \` +
                \`<span class="nf">\${newFailure} NEW_FAILURE</span> \` +
                \`across \${nbhdsTouched} neighborhood(s).\` +
                (recovery !== null
                    ? \` <span class="recovery">Translator rescues \${recovery}% of in-neighborhood ranker misroutes.</span>\`
                    : "") +
                \` <span class="recovery">CONFIRMED edges are the true hard collisions worth explicit policy.</span>\`;
        }
    }

    let filtered = tagged.filter(({ n, eff }) => {
        if (n.members.length < minSize) return false;
        if (kind !== "all" && n.kind !== kind) return false;
        if (sourceMode !== "all") {
            if (sourceMode === "both" && !(eff.hasSim && eff.hasCor)) return false;
            if (sourceMode === "similarity" && !(eff.hasSim && !eff.hasCor)) return false;
            if (sourceMode === "corpus" && !(eff.hasCor && !eff.hasSim)) return false;
            // "translator-confirmed": at least one phrase where ranker AND
            // translator both picked wrong on this neighborhood's edges.
            // These are the genuine hard collisions worth explicit policy.
            if (sourceMode === "tx-confirmed" && !(((filteredCrossVerdicts(n) || {}).CONFIRMED ?? 0) > 0)) return false;
        }
        if (filter) {
            const blob = (n.id + " " + n.members.map(m => m.schemaName + "." + m.actionName).join(" ")).toLowerCase();
            if (!blob.includes(filter)) return false;
        }
        return true;
    });

    if (sortBy === "topOffender" || sortBy === "endUser") {
        const useTx = sortBy === "endUser";
        filtered.sort(({ n: a }, { n: b }) => {
            const ta = topOffenderOf(a);
            const tb = topOffenderOf(b);
            const va = useTx
                ? ((ta && ta.endUserOwedTraffic) || 0)
                : ((ta && ta.owedTraffic) || 0);
            const vb = useTx
                ? ((tb && tb.endUserOwedTraffic) || 0)
                : ((tb && tb.owedTraffic) || 0);
            if (vb !== va) return vb - va;
            return a.id.localeCompare(b.id);
        });
    }

    document.getElementById("count").textContent = \`\${filtered.length} of \${totalAll}\`;
    const list = document.getElementById("list");
    list.innerHTML = "";
    if (filtered.length === 0) {
        list.innerHTML = \`<div class="empty-state">No neighborhoods match the current filter.</div>\`;
        return;
    }

    for (const { n, eff } of filtered) {
        const isExp = expanded.has(n.id);
        const hasSim = eff.hasSim;
        const hasCor = eff.hasCor;
        const sourceBadge = (hasSim && hasCor)
            ? \`<span class="badge both">both</span>\`
            : (hasSim
                ? \`<span class="badge sim">similarity</span>\`
                : \`<span class="badge corpus">corpus</span>\`);
        // Translator-derived per-row badges. CONFIRMED is the headline
        // signal — phrases where both ranker and translator pick wrong;
        // these are the true hard collisions.
        let txBadges = "";
        if (HAS_TRANSLATOR && n.evidence.crossVerdicts) {
            const cv = filteredCrossVerdicts(n) || {};
            if ((cv.CONFIRMED || 0) > 0) {
                txBadges += \`<span class="badge tx-confirmed" title="ranker AND translator both wrong on this many phrases">\${cv.CONFIRMED}🛑</span>\`;
            }
            if ((cv.RESCUED || 0) > 0) {
                txBadges += \`<span class="badge tx-rescued" title="ranker wrong, translator rescued (this many phrases)">\${cv.RESCUED}↻</span>\`;
            }
            if ((cv.NEW_FAILURE || 0) > 0) {
                txBadges += \`<span class="badge tx-newfail" title="translator wrong on phrases the ranker got right">\${cv.NEW_FAILURE}!</span>\`;
            }
        }
        const kindClass = n.kind === "cross-schema" ? "cross" : "same";
        const meta = [];
        const showSimScore = n.evidence.similarityScore ?? eff.dynamicScore;
        if (showSimScore !== undefined) {
            meta.push(\`sim \${showSimScore.toFixed(2)}\`);
        }
        if (n.evidence.misrouteCount !== undefined) {
            meta.push(\`misroutes \${n.evidence.misrouteCount}\`);
        }
        const offHtml = renderTopOffender(n);
        const row = document.createElement("div");
        row.className = "nbhd-row" + (isExp ? " expanded" : "");
        row.innerHTML = \`
            <div class="id" title="\${escapeHtml(n.id)}">\${escapeHtml(n.id)}</div>
            <div><span class="kind \${kindClass}">\${n.kind}</span></div>
            <div class="badges">\${sourceBadge}\${txBadges}</div>
            <div class="members">\${n.members.length} members</div>
            <div class="top-offender">\${offHtml}</div>
            <div class="meta" title="\${escapeHtml(meta.join(" · "))}">\${escapeHtml(meta.join(" · "))}</div>
        \`;
        row.addEventListener("click", () => {
            if (expanded.has(n.id)) expanded.delete(n.id);
            else expanded.add(n.id);
            render();
        });
        list.appendChild(row);

        if (isExp) {
            const detail = document.createElement("div");
            detail.className = "nbhd-detail";
            const memberHtml = n.members.map(m =>
                \`<div class="m">\${escapeHtml(m.schemaName)}.<b>\${escapeHtml(m.actionName)}</b></div>\`
            ).join("");
            const renderTxCounts = (e) => {
                const conf = edgeTxConfirmed(e);
                const resc = edgeTxRescued(e);
                if (conf === 0 && resc === 0) return "";
                const parts = [];
                if (conf > 0) parts.push(\`<span class="conf">\${conf} confirmed</span>\`);
                if (resc > 0) parts.push(\`<span class="resc">\${resc} rescued</span>\`);
                return \`<span class="tx-counts">[translator: \${parts.join(" · ")}]</span>\`;
            };
            const renderSamples = (samples) => (samples || []).filter(sampleEnabled).map(s => {
                const src = (s.model || s.style)
                    ? \`<span class="src">[\${escapeHtml([s.model, s.style].filter(Boolean).join(" · "))}]</span>\`
                    : "";
                const cat = s.category
                    ? \`<span class="cat \${escapeHtml(s.category)}">\${escapeHtml(s.category)}</span>\`
                    : "";
                return \`<div class="ph">\${cat}\${src}\${escapeHtml(s.phrase)}</div>\`;
            }).join("");
            const edgeHtml = (n.evidence.misrouteEdges || [])
                .filter(e => edgeCount(e) > 0 || edgeTxConfirmed(e) > 0 || edgeTxRescued(e) > 0)
                .slice(0, 12)
                .map(e => {
                    return \`<div class="edge-block">
                        <div class="edge-head"><span class="count">\${edgeCount(e)}</span><span>\${escapeHtml(e.from)} → \${escapeHtml(e.to)}\${renderTxCounts(e)}</span></div>
                        \${renderSamples(e.samples) ? \`<div class="samples">\${renderSamples(e.samples)}</div>\` : ""}
                    </div>\`;
                }).join("");
            // Translator-only NEW_FAILURE edges — kept separate from ranker
            // edges so the misrouteEdges contract stays stable. Show under
            // their own header when present.
            const txEdgeHtml = (n.evidence.translatorMisrouteEdges || [])
                .filter(e => edgeCount(e) > 0)
                .slice(0, 12)
                .map(e => {
                    return \`<div class="edge-block">
                        <div class="edge-head"><span class="count">\${edgeCount(e)}</span><span>\${escapeHtml(e.from)} → \${escapeHtml(e.to)}\${renderTxCounts(e)}</span></div>
                        \${renderSamples(e.samples) ? \`<div class="samples">\${renderSamples(e.samples)}</div>\` : ""}
                    </div>\`;
                }).join("");
            const verdictHtml = n.evidence.sourceVerdicts
                ? \`<div style="color:var(--muted);font-size:11px;margin-top:6px;">verdicts: \` +
                  ["CLEAN", "TIGHT", "MISROUTE", "ERROR"]
                    .filter(k => (n.evidence.sourceVerdicts[k] ?? 0) > 0)
                    .map(k => \`\${k}=\${n.evidence.sourceVerdicts[k]}\`).join(" · ") +
                  \`</div>\`
                : "";
            const gravityHtml = renderGravityTable(n);
            detail.innerHTML = \`
                <h4>members</h4>
                <div class="member-list">\${memberHtml}</div>
                \${gravityHtml}
                \${edgeHtml ? \`<h4>misroute edges (top 12)</h4><div class="edges">\${edgeHtml}</div>\` : \`<div class="empty-detail">no corpus edges (similarity-only neighborhood)</div>\`}
                \${txEdgeHtml ? \`<h4>translator-only NEW_FAILURE edges</h4><div class="edges">\${txEdgeHtml}</div>\` : ""}
                \${verdictHtml}
            \`;
            list.appendChild(detail);
        }
    }
}

document.getElementById("filter").addEventListener("input", render);
document.getElementById("kindFilter").addEventListener("change", render);
document.getElementById("sourceFilter").addEventListener("change", render);
document.getElementById("minSize").addEventListener("input", render);
document.getElementById("sortBy").addEventListener("change", render);
// Disable end-user sort option when no translator data is available.
{
    const sortBy = document.getElementById("sortBy");
    const endUserOpt = sortBy.querySelector('option[value="endUser"]');
    if (endUserOpt && !HAS_TRANSLATOR) {
        endUserOpt.disabled = true;
        endUserOpt.textContent += " (no translator data)";
    }
}
document.getElementById("confirmSlider").addEventListener("input", (e) => {
    confirmThreshold = parseFloat(e.target.value);
    document.getElementById("confirmValue").textContent = confirmThreshold.toFixed(2);
    render();
    renderBundling();
});
document.getElementById("confirmValue").textContent = confirmThreshold.toFixed(2);

// =========================================================================
// Hierarchical edge bundling
// =========================================================================
//
// Builds a hierarchy (root - agent - schema - action) from the union of all
// member sets in (slider-aware) neighborhoods, then draws curved bundled
// edges between actions that share a neighborhood. Hover a leaf to focus
// on its edges and tag each connected leaf as source / target.

function memberPath(m) {
    // schemaName like "browser.actionDiscovery" splits to agent="browser",
    // sub="actionDiscovery". For schemas without a sub-segment the action
    // hangs directly off the agent.
    const parts = m.schemaName.split(".");
    const agent = parts[0];
    const sub = parts.slice(1).join(".");
    return [agent, sub || agent, m.actionName];
}
function memberPathKey(m) {
    return memberPath(m).join("/");
}

function buildBundlingData() {
    // Slider-aware effective sources for each neighborhood.
    const tagged = PAYLOAD.neighborhoods.map(n => ({
        n,
        eff: effectiveSources(n, confirmThreshold),
    }));
    const sourceMode = document.getElementById("bundleSourceFilter").value;
    const kindMode = document.getElementById("bundleKindFilter").value;
    const minSize = Number(document.getElementById("bundleMinSize").value) || 2;

    let filtered = tagged.filter(({ n, eff }) => {
        if (n.members.length < minSize) return false;
        if (kindMode !== "all" && n.kind !== kindMode) return false;
        if (sourceMode === "both" && !(eff.hasSim && eff.hasCor)) return false;
        if (sourceMode === "similarity" && !(eff.hasSim && !eff.hasCor)) return false;
        if (sourceMode === "corpus" && !(eff.hasCor && !eff.hasSim)) return false;
        if (sourceMode === "tx-confirmed" && !(((filteredCrossVerdicts(n) || {}).CONFIRMED ?? 0) > 0)) return false;
        return true;
    });

    // Agent click-to-filter (set by the click handler on the outer ring
    // arcs / labels). When set, keep only neighborhoods that include at
    // least one member from this agent — leaves connected to that agent
    // through any neighborhood are surfaced too because the rest of the
    // pipeline takes the union of members across the kept neighborhoods.
    if (activeBundleAgent) {
        filtered = filtered.filter(({ n }) =>
            n.members.some(m => m.schemaName.split(".")[0] === activeBundleAgent),
        );
    }

    const countLabel = activeBundleAgent
        ? \`\${filtered.length} of \${tagged.length} neighborhoods · filter: \${activeBundleAgent} (click agent ring or "clear" to reset)\`
        : \`\${filtered.length} of \${tagged.length} neighborhoods\`;
    document.getElementById("bundleCount").innerHTML =
        activeBundleAgent
            ? \`\${countLabel} <a href="#" id="bundleClearAgent" style="color:var(--accent);text-decoration:underline;cursor:pointer;margin-left:8px;">clear</a>\`
            : countLabel;
    const clearLink = document.getElementById("bundleClearAgent");
    if (clearLink) {
        clearLink.addEventListener("click", (evt) => {
            evt.preventDefault();
            activeBundleAgent = null;
            renderBundling();
        });
    }

    // Hierarchy: only include actions that appear as members of any
    // surviving neighborhood (otherwise the circle gets very crowded).
    const memberKeys = new Set();
    for (const { n } of filtered) {
        for (const m of n.members) memberKeys.add(memberPathKey(m));
    }
    // Build agent → schema → action map (used for grouping). The hierarchy
    // we feed d3 is the flatter agent → action: actions per agent get
    // sorted alphabetically by name regardless of which sub-schema they
    // come from, since the visual benefit of grouping by sub-schema is
    // small once you can color-code the agent. Sub-schema is preserved in
    // each leaf's pathKey for tooltips, color, and edge resolution.
    const agentMap = new Map();
    for (const k of memberKeys) {
        const [agent, sub, action] = k.split("/");
        let ag = agentMap.get(agent);
        if (!ag) { ag = new Map(); agentMap.set(agent, ag); }
        let sch = ag.get(sub);
        if (!sch) { sch = new Set(); ag.set(sub, sch); }
        sch.add(action);
    }
    const root = { name: "root", children: [] };
    for (const [agent, schemas] of [...agentMap.entries()].sort()) {
        // Flatten (sub, action) pairs to a single per-agent list.
        const flat = [];
        for (const [sub, actions] of schemas.entries()) {
            for (const action of actions) {
                flat.push({ sub, action });
            }
        }
        // Detect action-name collisions within this agent so duplicates
        // get a disambiguating prefix in short-label mode (otherwise two
        // adjacent leaves would both read e.g. "setVolume" with no way
        // to tell which sub-schema they came from).
        const nameCount = new Map();
        for (const f of flat) {
            nameCount.set(f.action, (nameCount.get(f.action) ?? 0) + 1);
        }
        function disambig(f) {
            if ((nameCount.get(f.action) ?? 0) > 1) {
                return f.sub === agent
                    ? \`(\${agent}).\${f.action}\`
                    : \`\${f.sub}.\${f.action}\`;
            }
            return f.action;
        }
        flat.sort((a, b) =>
            disambig(a).localeCompare(disambig(b)),
        );
        const agentNode = {
            name: agent,
            children: flat.map(f => ({
                name: disambig(f),
                pathKey: \`\${agent}/\${f.sub}/\${f.action}\`,
            })),
        };
        root.children.push(agentNode);
    }

    // Edges: pairs of (source-leaf-key, target-leaf-key, color). Also
    // attach per-edge direction info derived from the neighborhood's
    // misroute edges so hover can color by who-redirects-to-whom.
    const edges = [];
    for (const { n, eff } of filtered) {
        const color = (eff.hasSim && eff.hasCor)
            ? "var(--src-both)"
            : (eff.hasSim ? "var(--src-sim)" : "var(--src-corpus)");
        // Group misroute edges by the unordered pair of member-keys; the
        // value is the set of member-keys that appear as "from" (expected,
        // got bypassed) for that pair.
        const dirByPair = new Map();
        for (const me of n.evidence?.misrouteEdges || []) {
            const k = me.from < me.to
                ? me.from + "|" + me.to
                : me.to + "|" + me.from;
            let s = dirByPair.get(k);
            if (!s) { s = new Set(); dirByPair.set(k, s); }
            s.add(me.from);
        }
        const memberKeyOf = m => \`\${m.schemaName}.\${m.actionName}\`;
        for (let i = 0; i < n.members.length; i++) {
            for (let j = i + 1; j < n.members.length; j++) {
                const mi = n.members[i];
                const mj = n.members[j];
                const ki = memberKeyOf(mi);
                const kj = memberKeyOf(mj);
                const pairKey = ki < kj ? ki + "|" + kj : kj + "|" + ki;
                const fromSet = dirByPair.get(pairKey);
                edges.push({
                    sourceKey: memberPathKey(mi),
                    targetKey: memberPathKey(mj),
                    sourceMemberKey: ki,
                    targetMemberKey: kj,
                    fromMemberKeys: fromSet ? Array.from(fromSet) : [],
                    color,
                    neighborhoodId: n.id,
                });
            }
        }
    }
    return { root, edges };
}

function renderBundling() {
    const { root: rootData, edges } = buildBundlingData();
    const wrap = document.getElementById("bundling");
    wrap.innerHTML = "";

    if (rootData.children.length === 0) {
        wrap.innerHTML = \`<div class="empty-state">No neighborhoods match the current filter.</div>\`;
        return;
    }

    // Fill the container width. Stay square so the radial layout uses both
    // dimensions; cap height to keep it usable on tall narrow windows.
    const measured = wrap.clientWidth || wrap.parentElement?.clientWidth || 1100;
    const width = Math.max(600, Math.min(measured, 1800));
    const radius = width / 2;
    // Reserve space for labels in the outer ring; scale with width so labels
    // never overlap the curves.
    const labelMargin = Math.min(280, Math.max(160, width * 0.22));
    const innerRadius = radius - labelMargin;

    const showFullPath = document.getElementById("bundleFullPath").checked;

    const root = d3.hierarchy(rootData)
        .sort((a, b) => d3.ascending(a.height, b.height) || d3.ascending(a.data.name, b.data.name));
    d3.cluster().size([2 * Math.PI, innerRadius])(root);

    const leafByKey = new Map();
    for (const leaf of root.leaves()) {
        leafByKey.set(leaf.data.pathKey, leaf);
    }

    const line = d3.lineRadial()
        .curve(d3.curveBundle.beta(0.85))
        .radius(d => d.y)
        .angle(d => d.x);

    const svg = d3.select(wrap).append("svg")
        .attr("id", "bundling-svg")
        .attr("viewBox", \`\${-radius} \${-radius} \${width} \${width}\`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("width", "100%")
        .attr("height", "auto")
        .attr("style", "font: 9px ui-monospace, monospace; max-height: 90vh;");

    const resolvedEdges = edges
        .map(e => ({
            source: leafByKey.get(e.sourceKey),
            target: leafByKey.get(e.targetKey),
            sourceMemberKey: e.sourceMemberKey,
            targetMemberKey: e.targetMemberKey,
            fromMemberKeys: e.fromMemberKeys,
            color: e.color,
            neighborhoodId: e.neighborhoodId,
        }))
        .filter(e => e.source && e.target);

    const edgeSel = svg.append("g")
        .selectAll("path")
        .data(resolvedEdges).join("path")
        .attr("class", "edge")
        .attr("d", e => line(e.source.path(e.target)))
        .attr("stroke", e => e.color)
        .attr("stroke-opacity", 0.35);

    // ---- Agent palette + outer agent ring ----
    // Agents are the first segment of pathKey. Build a stable agent ->
    // color map (sorted alphabetically), reused for both leaf text fill
    // and the outer ring arcs.
    const palette = [
        "#7aa2f7", "#a3e635", "#f59e0b", "#f87171",
        "#c084fc", "#fb923c", "#f472b6", "#34d399",
        "#fde047", "#a78bfa", "#22d3ee", "#fbbf24",
        "#84cc16", "#e879f9", "#60a5fa", "#fb7185",
    ];
    const agentSet = new Set();
    for (const leaf of root.leaves()) {
        agentSet.add(leaf.data.pathKey.split("/")[0]);
    }
    const agents = [...agentSet].sort();
    const agentColor = (a) => palette[agents.indexOf(a) % palette.length];

    // Compute angular extents per agent. Leaves are contiguous by agent
    // because we built the hierarchy as agent -> schema -> action and
    // d3.cluster preserves traversal order.
    const agentSegments = [];
    let curAgent = null;
    let segStart = 0;
    let segEnd = 0;
    for (const leaf of root.leaves()) {
        const a = leaf.data.pathKey.split("/")[0];
        if (a !== curAgent) {
            if (curAgent !== null) {
                agentSegments.push({
                    agent: curAgent,
                    x0: segStart,
                    x1: segEnd,
                    color: agentColor(curAgent),
                });
            }
            curAgent = a;
            segStart = leaf.x;
        }
        segEnd = leaf.x;
    }
    if (curAgent !== null) {
        agentSegments.push({
            agent: curAgent,
            x0: segStart,
            x1: segEnd,
            color: agentColor(curAgent),
        });
    }
    // Pad each segment by half the inter-leaf gap so adjacent agents'
    // arcs don't visually touch (preserves the per-agent grouping).
    if (root.leaves().length > 1) {
        const allLeaves = root.leaves();
        const pad =
            (allLeaves[1].x - allLeaves[0].x) / 2 || (Math.PI / 180);
        for (const s of agentSegments) {
            s.x0 = Math.max(0, s.x0 - pad * 0.4);
            s.x1 = Math.min(2 * Math.PI, s.x1 + pad * 0.4);
        }
    }

    const ringInner = radius - 26;
    const ringOuter = radius - 12;
    const arcGen = d3.arc()
        .innerRadius(ringInner)
        .outerRadius(ringOuter)
        .startAngle(d => d.x0)
        .endAngle(d => d.x1);

    // Click handler: toggle this agent as the active filter. Clicking the
    // currently-active agent clears the filter; clicking a different one
    // switches. The "clear" link in the count line is the keyboard-friendly
    // alternative. stopPropagation prevents the SVG-background click handler
    // from also firing (which would unpin a pinned phrase panel).
    function handleAgentClick(evt, d) {
        evt.stopPropagation();
        activeBundleAgent = activeBundleAgent === d.agent ? null : d.agent;
        renderBundling();
    }

    const ringG = svg.append("g");
    const arcSel = ringG.selectAll("path.agent-arc")
        .data(agentSegments).join("path")
        .attr("class", "agent-arc")
        .attr("d", arcGen)
        .attr("fill", d => d.color)
        .attr("opacity", d =>
            activeBundleAgent && activeBundleAgent !== d.agent ? 0.15 : 0.55,
        )
        .attr("stroke", d =>
            activeBundleAgent === d.agent ? "var(--ink)" : "var(--bg)",
        )
        .attr("stroke-width", d =>
            activeBundleAgent === d.agent ? 1.5 : 0.5,
        )
        .style("cursor", "pointer")
        .on("click", handleAgentClick);

    // Tangential agent labels at the arc midpoint. Skip when the arc is
    // too narrow to fit the agent name; truncate when it's borderline.
    const labelSel = ringG.selectAll("text.agent-label")
        .data(agentSegments).join("text")
        .attr("class", "agent-label")
        .attr("transform", d => {
            const midRad = (d.x0 + d.x1) / 2;
            const midDeg = midRad * 180 / Math.PI - 90;
            const flip = midRad >= Math.PI;
            const r = (ringInner + ringOuter) / 2;
            // The trailing rotate(±90) makes the text tangent to the arc
            // (reads circumferentially); flip on the lower half so the
            // text isn't upside-down.
            return \`rotate(\${midDeg}) translate(\${r}, 0) rotate(\${flip ? -90 : 90})\`;
        })
        .attr("dy", "0.31em")
        .attr("fill", d => d.color)
        .style("cursor", "pointer")
        .style("opacity", d =>
            activeBundleAgent && activeBundleAgent !== d.agent ? 0.4 : 1,
        )
        .style("font-weight", d =>
            activeBundleAgent === d.agent ? "800" : "700",
        )
        .style("text-decoration", d =>
            activeBundleAgent === d.agent ? "underline" : "none",
        )
        .text(d => {
            const arcLenPx = (d.x1 - d.x0) * (ringInner + ringOuter) / 2;
            // Each glyph is ~5.5px wide at 10px font size. Skip below the
            // shortest agent name (~4 chars). Truncate when borderline.
            if (arcLenPx < 24) return "";
            const maxChars = Math.floor((arcLenPx - 6) / 5.5);
            return d.agent.length <= maxChars
                ? d.agent
                : d.agent.slice(0, Math.max(2, maxChars - 1)) + "…";
        })
        .on("click", handleAgentClick);
    // Suppress unused-var lint
    void arcSel; void labelSel;

    // Leaf node = group containing label + (optional) hit area. Hover
    // handlers are attached to the group so both the text and the
    // surrounding hit-rect trigger the highlight.
    function leafLabel(d) {
        if (!showFullPath) return d.data.name;
        // pathKey is agent/sub/action - convert to dotted form. When the
        // schema has no sub-segment, sub === agent, which collapses
        // naturally to agent.action below.
        const [agent, sub, action] = d.data.pathKey.split("/");
        return sub === agent ? \`\${agent}.\${action}\` : \`\${agent}.\${sub}.\${action}\`;
    }

    // Pin state: when a leaf is "pinned" by a click, hover changes are
    // suppressed and the phrase panel becomes interactive (mouse can scroll
    // inside it). Click the same leaf again to unpin, or click another leaf
    // to repin, or click empty SVG background to unpin.
    let pinnedLeaf = null;

    function setPinned(leaf) {
        pinnedLeaf = leaf;
        if (leaf) {
            phrasePanel.classList.add("pinned");
            focus(leaf);
        } else {
            phrasePanel.classList.remove("pinned");
            focus(null);
        }
    }

    const leafG = svg.append("g")
        .selectAll("g")
        .data(root.leaves()).join("g")
        .attr("transform", d => \`rotate(\${d.x * 180 / Math.PI - 90}) translate(\${d.y},0)\`)
        .style("cursor", "pointer")
        .on("mouseenter", (evt, d) => {
            if (pinnedLeaf) return; // pinned overrides hover preview
            focus(d);
        })
        .on("mouseleave", () => {
            if (pinnedLeaf) return;
            focus(null);
        })
        .on("click", (evt, d) => {
            evt.stopPropagation();
            // Toggle: clicking the pinned leaf unpins; clicking another leaf
            // repins to it. Clicking an unpinned leaf pins it.
            if (pinnedLeaf === d) {
                setPinned(null);
            } else {
                setPinned(d);
            }
        });

    // Background click on the SVG (anywhere not on a leaf or agent ring)
    // unpins. Listening on the SVG root means a click that bubbles up
    // without being stopped by a leaf/arc handler reaches us here.
    svg.on("click", () => {
        if (pinnedLeaf) setPinned(null);
    });
    // The phrasePanel.onclick handler that wires the banner's "unpin" link
    // is wired below, after phrasePanel is declared (avoids the const TDZ).

    // Hit area (invisible but painted so it captures mouse events). Wider
    // when full-path labels are on so the larger text still gets a generous
    // hover region.
    const hitWidth = showFullPath ? 240 : 162;
    leafG.append("rect")
        .attr("class", "leaf-hit")
        .attr("x", d => d.x < Math.PI ? -2 : -hitWidth)
        .attr("y", -7)
        .attr("width", hitWidth + 2)
        .attr("height", 14);

    const leafText = leafG.append("text")
        .attr("class", "leaf-label")
        .attr("dy", "0.31em")
        .attr("x", d => d.x < Math.PI ? 6 : -6)
        .attr("text-anchor", d => d.x < Math.PI ? "start" : "end")
        .attr("transform", d => d.x >= Math.PI ? "rotate(180)" : null)
        // Color leaves by their agent so the eye can track where each
        // outgoing curve originates. Dim/source/target focus states use
        // !important in CSS to override this inline fill.
        .style("fill", d => agentColor(d.data.pathKey.split("/")[0]))
        // Make text itself part of the hit area (extra belt + suspenders so
        // hover works even outside the rect's slack zone).
        .style("pointer-events", "all")
        .text(leafLabel);

    // Highlight on focus + populate the floating phrase panel.
    const phrasePanel = document.getElementById("bundling-phrases");

    // Wire the "unpin" link inside the panel's banner. Use onclick (not
    // addEventListener) so each renderBundling call overwrites rather than
    // stacks listeners.
    phrasePanel.onclick = (evt) => {
        const target = evt.target;
        if (target && target.matches && target.matches("[data-unpin]")) {
            evt.preventDefault();
            evt.stopPropagation();
            setPinned(null);
        }
    };
    function pathKeyToMemberKey(pathKey) {
        const [agent, sub, action] = pathKey.split("/");
        const schema = sub === agent ? agent : \`\${agent}.\${sub}\`;
        return \`\${schema}.\${action}\`;
    }
    function collectPhrasesForFocus(focusLeaf) {
        const focusMemberKey = pathKeyToMemberKey(focusLeaf.data.pathKey);
        // Group by edge so the panel reads "edge: phrase, phrase, …" with
        // direction preserved.
        const groups = []; // { edgeLabel, partner, phrases: [] }
        for (const n of PAYLOAD.neighborhoods) {
            const isMember = n.members.some(m =>
                memberPathKey(m) === focusLeaf.data.pathKey,
            );
            if (!isMember) continue;
            for (const e of n.evidence.misrouteEdges || []) {
                if (e.from !== focusMemberKey && e.to !== focusMemberKey) continue;
                const phrases = (e.samples || []).filter(s => s.phrase);
                if (phrases.length === 0) continue;
                const partner = e.from === focusMemberKey ? e.to : e.from;
                const arrow = e.from === focusMemberKey ? "to" : "from";
                groups.push({
                    edgeLabel: \`\${e.from} → \${e.to}\`,
                    partner,
                    arrow,
                    count: e.count,
                    phrases,
                });
            }
        }
        // Sort by edge count desc so heaviest edges show at the top.
        groups.sort((a, b) => b.count - a.count);
        return groups;
    }
    function renderPhrasePanel(focusLeaf) {
        if (!focusLeaf) {
            phrasePanel.classList.remove("visible");
            phrasePanel.innerHTML = "";
            return;
        }
        const focusName = leafLabel(focusLeaf);
        const groups = collectPhrasesForFocus(focusLeaf);
        // Pinned-state banner shows up only when .pinned class is set; the
        // <a> click is handled below at render time via the unpin handler.
        const banner =
            \`<div class="pinned-banner">📌 pinned · scroll inside · <a class="unpin" href="#" data-unpin>unpin</a></div>\`;
        if (groups.length === 0) {
            phrasePanel.innerHTML =
                banner +
                \`<h4>Phrases for <span class="target-name">\${escapeHtml(focusName)}</span></h4>\` +
                \`<div class="empty">No corpus phrases. This action only appears in similarity-only neighborhoods.</div>\`;
            phrasePanel.classList.add("visible");
            phrasePanel.scrollTop = 0;
            return;
        }
        const totalPhrases = groups.reduce((n, g) => n + g.phrases.length, 0);
        let html = banner + \`<h4>\${totalPhrases} phrase(s) involving <span class="target-name">\${escapeHtml(focusName)}</span></h4>\`;
        for (const g of groups) {
            html += \`<div class="group"><div class="group-head">\${g.count}× \${escapeHtml(g.edgeLabel)}</div>\`;
            for (const p of g.phrases) {
                const src = (p.model || p.style)
                    ? \`<span class="src">[\${escapeHtml([p.model, p.style].filter(Boolean).join(" · "))}]</span>\`
                    : "";
                html += \`<div class="ph">\${src}\${escapeHtml(p.phrase)}</div>\`;
            }
            html += \`</div>\`;
        }
        phrasePanel.innerHTML = html;
        phrasePanel.classList.add("visible");
        phrasePanel.scrollTop = 0;
    }
    // Direction palette — kept on a single line so it's easy to retune:
    //   outgoing  red    — focused leaf is misroute-FROM (was expected, lost traffic)
    //   incoming  green  — focused leaf is misroute-TO (won traffic from partner)
    //   bidir     purple — both directions exist for this pair
    //   neutral   gray   — similarity-only pair (no corpus direction info)
    const DIR_COLOR = {
        outgoing: "#ef4444",
        incoming: "#22c55e",
        bidir:    "#a855f7",
        neutral:  "#94a3b8",
    };
    function focus(focusLeaf) {
        if (!focusLeaf) {
            edgeSel.classed("dim", false).classed("hover", false)
                .attr("stroke", e => e.color)
                .attr("data-dir", null);
            leafText.classed("dim", false).classed("source", false).classed("target", false);
            renderPhrasePanel(null);
            return;
        }
        const focusMK = pathKeyToMemberKey(focusLeaf.data.pathKey);
        const connectedKeys = new Set([focusLeaf.data.pathKey]);
        edgeSel.each(function(e) {
            const isMine = e.source === focusLeaf || e.target === focusLeaf;
            if (isMine) {
                if (e.source === focusLeaf) connectedKeys.add(e.target.data.pathKey);
                else connectedKeys.add(e.source.data.pathKey);
            }
        });
        // Returns one of "outgoing"|"incoming"|"bidir"|"neutral" for hover
        // edges, or null for non-hover (color reverts to e.color).
        function dirFor(e) {
            const isMine = e.source === focusLeaf || e.target === focusLeaf;
            if (!isMine) return null;
            const fromKeys = e.fromMemberKeys || [];
            if (fromKeys.length === 0) return "neutral";
            const partnerMK = e.source === focusLeaf
                ? e.targetMemberKey
                : e.sourceMemberKey;
            const focusIsFrom = fromKeys.includes(focusMK);
            const partnerIsFrom = fromKeys.includes(partnerMK);
            if (focusIsFrom && partnerIsFrom) return "bidir";
            if (focusIsFrom) return "outgoing";
            if (partnerIsFrom) return "incoming";
            return "neutral";
        }
        edgeSel
            .classed("dim", e => e.source !== focusLeaf && e.target !== focusLeaf)
            .classed("hover", e => e.source === focusLeaf || e.target === focusLeaf)
            .attr("data-dir", e => dirFor(e))
            .attr("stroke", e => {
                const d = dirFor(e);
                return d ? DIR_COLOR[d] : e.color;
            });
        // Move hover edges to the end of the parent <g> so they paint on
        // top of the dim'd background — otherwise dense overlapping edges
        // visually swallow the highlighted curve.
        edgeSel.filter(e => e.source === focusLeaf || e.target === focusLeaf).raise();
        leafText
            .classed("dim", d => !connectedKeys.has(d.data.pathKey))
            .classed("source", d => d === focusLeaf)
            .classed("target", d => d !== focusLeaf && connectedKeys.has(d.data.pathKey));
        renderPhrasePanel(focusLeaf);
    }

    // Size the floating phrase panel to 90% of the rendered inscribed-
    // circle diameter, capped at 560px (the prior fixed cap). Computed
    // here so the panel keeps fitting the chart on window resize.
    const stage = document.getElementById("bundling-stage");
    if (stage && phrasePanel) {
        const stageWidth = stage.clientWidth || width;
        const inscribedPx = stageWidth * (innerRadius / radius);
        const panelWidthPx = Math.min(560, 0.9 * inscribedPx);
        phrasePanel.style.width = panelWidthPx + "px";
    }
}

document.getElementById("bundleSourceFilter").addEventListener("change", renderBundling);
document.getElementById("bundleKindFilter").addEventListener("change", renderBundling);
document.getElementById("bundleMinSize").addEventListener("input", renderBundling);
document.getElementById("bundleFullPath").addEventListener("change", renderBundling);

// =========================================================================
// Force-directed graph
// =========================================================================
//
// Inspired by https://observablehq.com/@d3/force-directed-graph/2 — D3 v7
// forceSimulation. Nodes are deduplicated actions across all neighborhoods;
// node radius scales with gravity (default: owedTraffic). Hover dims
// non-connected nodes/links and pops a tooltip with all gravity scores.
//
// Day-one (no translator data): nodes colored categorically by neighborhood;
// "Color by" toggle hidden; "endUserOwed" sort disabled. When translator
// data is present, severity-tier coloring activates and NEW_FAILURE links
// render in a distinct purple hue.

let forceSimulation = null;
let forceZoom = null;
let forceSvgSel = null;
let forceContentSel = null;

// Per-node phrase index: collect up to ~12 outgoing + 12 incoming sample
// phrases per action across all neighborhoods. Computed once on first render
// since PAYLOAD doesn't change.
const PHRASE_TOOLTIP_PER_DIRECTION = 6;
let phrasesByNode = null;
function getPhrasesByNode() {
    if (phrasesByNode) return phrasesByNode;
    phrasesByNode = new Map();
    function getBucket(key) {
        let b = phrasesByNode.get(key);
        if (!b) { b = { outgoing: [], incoming: [] }; phrasesByNode.set(key, b); }
        return b;
    }
    for (const n of PAYLOAD.neighborhoods) {
        const allEdges = [
            ...(n.evidence.misrouteEdges || []),
            ...(n.evidence.translatorMisrouteEdges || []),
        ];
        for (const e of allEdges) {
            const samples = e.samples || [];
            if (samples.length === 0) continue;
            const fromBucket = getBucket(e.from);
            const toBucket = getBucket(e.to);
            for (const s of samples) {
                const entry = {
                    phrase: s.phrase,
                    edge: e.from + " → " + e.to,
                    count: e.count,
                };
                fromBucket.outgoing.push(entry);
                toBucket.incoming.push(entry);
            }
        }
    }
    // Dedupe by phrase text within each bucket; keep highest-count edge.
    for (const b of phrasesByNode.values()) {
        for (const dir of ["outgoing", "incoming"]) {
            const seen = new Map();
            for (const e of b[dir]) {
                const k = e.phrase.toLowerCase();
                const existing = seen.get(k);
                if (!existing || existing.count < e.count) seen.set(k, e);
            }
            b[dir] = [...seen.values()].sort((x, y) => y.count - x.count);
        }
    }
    return phrasesByNode;
}

function buildForceData(sortBy) {
    // Slider-aware source state, then user-driven source / kind / min-size
    // filters. Mirrors the bundling chart's filtering so the two views agree
    // when the user picks the same filter combination.
    const sourceMode = document.getElementById("forceSourceFilter")?.value ?? "all";
    const kindMode = document.getElementById("forceKindFilter")?.value ?? "all";
    const minSize = Number(
        document.getElementById("forceMinSize")?.value ?? 2,
    ) || 2;
    const tagged = PAYLOAD.neighborhoods.map(n => ({
        n,
        eff: effectiveSources(n, confirmThreshold),
    }));
    const filtered = tagged.filter(({ n, eff }) => {
        if (n.members.length < minSize) return false;
        if (kindMode !== "all" && n.kind !== kindMode) return false;
        if (sourceMode === "both" && !(eff.hasSim && eff.hasCor)) return false;
        if (sourceMode === "similarity" && !(eff.hasSim && !eff.hasCor)) return false;
        if (sourceMode === "corpus" && !(eff.hasCor && !eff.hasSim)) return false;
        if (sourceMode === "tx-confirmed" && !(((filteredCrossVerdicts(n) || {}).CONFIRMED ?? 0) > 0)) return false;
        return true;
    });

    // Deduplicate nodes across neighborhoods.
    const nodeMap = new Map(); // key: "schema.action"
    function nodeKey(m) { return m.schemaName + "." + m.actionName; }
    function ensureNode(m, neighborhoodId) {
        const k = nodeKey(m);
        let node = nodeMap.get(k);
        if (!node) {
            node = {
                id: k,
                schemaName: m.schemaName,
                actionName: m.actionName,
                neighborhoodId,
                owedTraffic: 0,
                stolenTraffic: 0,
                partners: 0,
                entanglement: 0,
                weightedConfusion: 0,
                endUserOwedTraffic: undefined,
                translatorOwedTraffic: undefined,
                translatorRecoveryRate: undefined,
                severityTier: undefined,
                isTopOffender: false,
            };
            nodeMap.set(k, node);
        }
        return node;
    }

    // Aggregate gravity across all neighborhoods that contain each member.
    for (const { n } of filtered) {
        const ag = gravityFor(n.id);
        const top = topOffenderOf(n);
        for (const a of ag) {
            const node = ensureNode(a.member, n.id);
            node.owedTraffic += a.owedTraffic;
            node.stolenTraffic += a.stolenTraffic;
            node.partners += a.partners;
            node.entanglement += a.entanglement;
            node.weightedConfusion += a.weightedConfusion;
            if (a.endUserOwedTraffic !== undefined) {
                node.endUserOwedTraffic =
                    (node.endUserOwedTraffic || 0) + a.endUserOwedTraffic;
            }
            if (a.translatorOwedTraffic !== undefined) {
                node.translatorOwedTraffic =
                    (node.translatorOwedTraffic || 0) + a.translatorOwedTraffic;
            }
            if (a.translatorRecoveryRate !== undefined) {
                node.translatorRecoveryRate = a.translatorRecoveryRate;
            }
            if (a.severityTier) {
                // Highest tier wins (blocker > leaky > clean).
                const order = { blocker: 3, leaky: 2, clean: 1 };
                if (
                    !node.severityTier ||
                    order[a.severityTier] > order[node.severityTier]
                ) {
                    node.severityTier = a.severityTier;
                }
            }
            if (top && top.member.schemaName === a.member.schemaName &&
                top.member.actionName === a.member.actionName) {
                node.isTopOffender = true;
            }
        }
    }

    // Build links from misroute edges across all neighborhoods.
    const links = [];
    for (const { n } of filtered) {
        for (const e of n.evidence.misrouteEdges || []) {
            if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) continue;
            links.push({
                source: e.from,
                target: e.to,
                count: e.count,
                kind: (e.translatorConfirmedCount || 0) > 0
                    ? "translator-confirmed"
                    : "ranker",
            });
        }
        for (const e of n.evidence.translatorMisrouteEdges || []) {
            if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) continue;
            links.push({
                source: e.from,
                target: e.to,
                count: e.count,
                kind: "translator-only",
            });
        }
    }

    const sortKey = sortBy || "owed";
    const valueOf = node => {
        switch (sortKey) {
            case "stolen": return node.stolenTraffic;
            case "entanglement": return node.entanglement;
            case "weighted": return node.weightedConfusion;
            case "endUser": return node.endUserOwedTraffic || 0;
            case "owed":
            default: return node.owedTraffic;
        }
    };

    const nodes = [...nodeMap.values()];
    const maxValue = Math.max(1, ...nodes.map(valueOf));
    const k = 14 / Math.sqrt(maxValue + 1);
    for (const node of nodes) {
        node.radius = Math.sqrt(valueOf(node) + 1) * k + 4;
    }
    return { nodes, links };
}

function colorForNode(node, colorBy) {
    if (colorBy === "severity" && node.severityTier) {
        if (node.severityTier === "blocker") return "#ef4444";
        if (node.severityTier === "leaky") return "#f59e0b";
        return "#22c55e";
    }
    // Categorical by neighborhood.
    const palette = [
        "#7aa2f7", "#a3e635", "#fb923c", "#f472b6",
        "#c084fc", "#22d3ee", "#facc15", "#34d399",
    ];
    let h = 0;
    for (let i = 0; i < node.neighborhoodId.length; i++) {
        h = (h * 31 + node.neighborhoodId.charCodeAt(i)) | 0;
    }
    return palette[Math.abs(h) % palette.length];
}

function renderForceGraph() {
    const sortBy = document.getElementById("forceSortBy").value;
    const colorBySel = document.getElementById("forceColorBy");
    const colorBy = colorBySel ? colorBySel.value : "neighborhood";

    if (HAS_TRANSLATOR) {
        document.getElementById("forceSortEndUser").disabled = false;
        document.getElementById("forceColorByLabel").style.display = "";
        document.getElementById("forceTranslatorLegend").style.display = "";
    }

    const { nodes, links } = buildForceData(sortBy);
    const svg = d3.select("#force-svg");
    svg.selectAll("*").remove();
    forceSvgSel = svg;
    if (nodes.length === 0) {
        document.getElementById("forceCount").textContent = "no actions to display";
        return;
    }
    document.getElementById("forceCount").textContent =
        \`\${nodes.length} actions · \${links.length} edges\`;

    const stage = document.getElementById("force-stage");
    const width = stage.clientWidth || 1100;
    const height = 600;
    svg.attr("viewBox", \`0 0 \${width} \${height}\`);

    // Arrow marker for directional links. Uses userSpaceOnUse so the marker
    // size doesn't shrink/grow with the link's stroke-width.
    const defs = svg.append("defs");
    defs.append("marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 18)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#94a3b8");

    // All visual content goes into a single zoomable <g>. d3.zoom rewrites
    // the transform of this <g> on wheel / pan events; the SVG itself stays
    // put. Drag handlers on individual nodes consume their own events so
    // they don't trigger pan.
    const content = svg.append("g").attr("class", "force-content");
    forceContentSel = content;

    const linkSel = content.append("g")
        .selectAll("path")
        .data(links).join("path")
        .attr("class", l => "link " + l.kind)
        .attr("stroke", l => l.kind === "translator-only" ? "#a855f7" : "#94a3b8")
        .attr("stroke-width", l => Math.sqrt(l.count) * 1.2 + 0.5)
        .attr("marker-end", "url(#arrow)");

    const nodeSel = content.append("g")
        .selectAll("circle")
        .data(nodes).join("circle")
        .attr("class", n => "node" + (n.isTopOffender ? " top-offender" : ""))
        .attr("r", n => n.radius)
        .attr("fill", n => colorForNode(n, colorBy));

    const labelSel = content.append("g")
        .selectAll("text")
        .data(nodes).join("text")
        .attr("class", "label")
        .attr("text-anchor", "middle")
        .attr("dy", n => -(n.radius + 3))
        .text(n => n.actionName);

    // Force simulation.
    if (forceSimulation) forceSimulation.stop();
    forceSimulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(60).strength(0.4))
        .force("charge", d3.forceManyBody().strength(-160))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide().radius(d => d.radius + 2));

    forceSimulation.on("tick", () => {
        linkSel.attr("d", d => \`M\${d.source.x},\${d.source.y}L\${d.target.x},\${d.target.y}\`);
        nodeSel.attr("cx", d => d.x).attr("cy", d => d.y);
        labelSel.attr("x", d => d.x).attr("y", d => d.y);
    });

    // ---- Zoom / pan ----
    forceZoom = d3.zoom()
        .scaleExtent([0.1, 8])
        // Allow wheel + drag-on-empty-bg pan; node drag handler is set on
        // the nodes themselves and consumes its own events.
        .filter((event) => {
            if (event.type === "wheel") return true;
            // Don't intercept clicks on circles — let the drag handler win.
            return !event.target.closest("circle.node");
        })
        .on("zoom", (event) => {
            content.attr("transform", event.transform);
        })
        .on("start", () => svg.classed("dragging", true))
        .on("end", () => svg.classed("dragging", false));
    svg.call(forceZoom);

    // ---- Node drag (in zoom-transformed coordinates) ----
    nodeSel.call(d3.drag()
        .on("start", (event, d) => {
            event.sourceEvent.stopPropagation();
            if (!event.active) forceSimulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => {
            d.fx = event.x; d.fy = event.y;
        })
        .on("end", (event, d) => {
            if (!event.active) forceSimulation.alphaTarget(0);
            d.fx = null; d.fy = null;
        }));

    // ---- Hover focus + tooltip with sample phrases ----
    const tooltip = document.getElementById("force-tooltip");
    const phraseIndex = getPhrasesByNode();

    function buildTooltipHTML(d) {
        const rows = [];
        rows.push(\`<div class="name">\${escapeHtml(d.id)}</div>\`);
        rows.push('<div class="scores">');
        rows.push(\`<div class="row"><span class="label-cell">owedTraffic (lost)</span><span>\${d.owedTraffic}</span></div>\`);
        rows.push(\`<div class="row"><span class="label-cell">stolenTraffic (gained)</span><span>\${d.stolenTraffic}</span></div>\`);
        rows.push(\`<div class="row"><span class="label-cell">entanglement</span><span>\${d.entanglement}</span></div>\`);
        rows.push(\`<div class="row"><span class="label-cell">weightedConfusion</span><span>\${d.weightedConfusion.toFixed(1)}</span></div>\`);
        if (d.endUserOwedTraffic !== undefined) {
            rows.push(\`<div class="row"><span class="label-cell">endUserOwed (translator)</span><span>\${d.endUserOwedTraffic}</span></div>\`);
        }
        if (d.translatorRecoveryRate !== undefined) {
            rows.push(\`<div class="row"><span class="label-cell">recovery rate</span><span>\${(d.translatorRecoveryRate * 100).toFixed(0)}%</span></div>\`);
        }
        if (d.severityTier) {
            rows.push(\`<div class="row"><span class="label-cell">severity</span><span class="tier-\${d.severityTier}">\${d.severityTier}</span></div>\`);
        }
        rows.push('</div>');

        const bucket = phraseIndex.get(d.id);
        if (bucket) {
            if (bucket.outgoing.length > 0) {
                rows.push('<div class="phrases-section">');
                rows.push(\`<h5>lost — phrases meant for this action</h5>\`);
                const shown = bucket.outgoing.slice(0, PHRASE_TOOLTIP_PER_DIRECTION);
                for (const p of shown) {
                    rows.push(\`<div class="phrase outgoing"><span class="edge-tag">→\${escapeHtml(p.edge.split(" → ")[1])}</span>\${escapeHtml(p.phrase)}</div>\`);
                }
                if (bucket.outgoing.length > shown.length) {
                    rows.push(\`<div class="more-note">… and \${bucket.outgoing.length - shown.length} more</div>\`);
                }
                rows.push('</div>');
            }
            if (bucket.incoming.length > 0) {
                rows.push('<div class="phrases-section">');
                rows.push(\`<h5>gained — phrases that landed here by mistake</h5>\`);
                const shown = bucket.incoming.slice(0, PHRASE_TOOLTIP_PER_DIRECTION);
                for (const p of shown) {
                    rows.push(\`<div class="phrase incoming"><span class="edge-tag">←\${escapeHtml(p.edge.split(" → ")[0])}</span>\${escapeHtml(p.phrase)}</div>\`);
                }
                if (bucket.incoming.length > shown.length) {
                    rows.push(\`<div class="more-note">… and \${bucket.incoming.length - shown.length} more</div>\`);
                }
                rows.push('</div>');
            }
        }
        return rows.join("");
    }

    function positionTooltip(event) {
        const rect = stage.getBoundingClientRect();
        const tipRect = tooltip.getBoundingClientRect();
        // Default: anchor to the right of the cursor. Flip to the left if it
        // would overflow the stage (long phrases can push the tooltip wide).
        let left = event.clientX - rect.left + 14;
        let top = event.clientY - rect.top + 14;
        if (left + tipRect.width > rect.width - 8) {
            left = Math.max(8, event.clientX - rect.left - tipRect.width - 14);
        }
        if (top + tipRect.height > rect.height - 8) {
            top = Math.max(8, event.clientY - rect.top - tipRect.height - 14);
        }
        tooltip.style.left = left + "px";
        tooltip.style.top = top + "px";
    }

    nodeSel.on("mouseenter", function (event, d) {
        const connected = new Set([d.id]);
        for (const l of links) {
            const s = typeof l.source === "object" ? l.source.id : l.source;
            const t = typeof l.target === "object" ? l.target.id : l.target;
            if (s === d.id) connected.add(t);
            if (t === d.id) connected.add(s);
        }
        nodeSel.classed("dim", n => !connected.has(n.id));
        labelSel.classed("dim", n => !connected.has(n.id));
        linkSel.classed("dim", l => {
            const s = typeof l.source === "object" ? l.source.id : l.source;
            const t = typeof l.target === "object" ? l.target.id : l.target;
            return s !== d.id && t !== d.id;
        });
        tooltip.innerHTML = buildTooltipHTML(d);
        tooltip.classList.add("visible");
        positionTooltip(event);
    });
    nodeSel.on("mousemove", function (event) {
        positionTooltip(event);
    });
    nodeSel.on("mouseleave", function () {
        nodeSel.classed("dim", false);
        labelSel.classed("dim", false);
        linkSel.classed("dim", false);
        tooltip.classList.remove("visible");
    });

    // ---- Initial framing: zoom-to-fit once the simulation has settled. ----
    // Run the sim a bit synchronously so the bounding box is meaningful
    // before fitting; this avoids a visible "jump" when fit kicks in.
    for (let i = 0; i < 80; i++) forceSimulation.tick();
    linkSel.attr("d", d => \`M\${d.source.x},\${d.source.y}L\${d.target.x},\${d.target.y}\`);
    nodeSel.attr("cx", d => d.x).attr("cy", d => d.y);
    labelSel.attr("x", d => d.x).attr("y", d => d.y);
    forceZoomToFit(false);
}

function forceZoomToFit(animate) {
    if (!forceZoom || !forceSvgSel || !forceContentSel) return;
    const stage = document.getElementById("force-stage");
    const width = stage.clientWidth || 1100;
    const height = 600;
    const bbox = forceContentSel.node().getBBox();
    if (bbox.width === 0 || bbox.height === 0) return;
    const scale = Math.min(8, Math.max(0.1, 0.92 / Math.max(bbox.width / width, bbox.height / height)));
    const tx = width / 2 - scale * (bbox.x + bbox.width / 2);
    const ty = height / 2 - scale * (bbox.y + bbox.height / 2);
    const target = d3.zoomIdentity.translate(tx, ty).scale(scale);
    if (animate) {
        forceSvgSel.transition().duration(400).call(forceZoom.transform, target);
    } else {
        forceSvgSel.call(forceZoom.transform, target);
    }
}

function forceZoomBy(factor) {
    if (!forceZoom || !forceSvgSel) return;
    forceSvgSel.transition().duration(180).call(forceZoom.scaleBy, factor);
}

function forceZoomReset() {
    if (!forceZoom || !forceSvgSel) return;
    forceSvgSel.transition().duration(220).call(forceZoom.transform, d3.zoomIdentity);
}

document.getElementById("forceSortBy").addEventListener("change", renderForceGraph);
document.getElementById("forceSourceFilter").addEventListener("change", renderForceGraph);
document.getElementById("forceKindFilter").addEventListener("change", renderForceGraph);
document.getElementById("forceMinSize").addEventListener("input", renderForceGraph);
document.getElementById("forceZoomIn").addEventListener("click", () => forceZoomBy(1.4));
document.getElementById("forceZoomOut").addEventListener("click", () => forceZoomBy(1 / 1.4));
document.getElementById("forceZoomFit").addEventListener("click", () => forceZoomToFit(true));
document.getElementById("forceZoomReset").addEventListener("click", forceZoomReset);
{
    const colorBy = document.getElementById("forceColorBy");
    if (colorBy) colorBy.addEventListener("change", renderForceGraph);
}

// =========================================================================
// Fullscreen toggles for the bundling and force-graph sections.
// =========================================================================
//
// We fullscreen the entire <section> (not just the chart stage) so the
// controls bar and legends remain available. CSS handles the layout flip
// (section becomes a flex column; the stage takes the remaining vertical
// space). On fullscreenchange we re-render both charts so they pick up the
// new container dimensions; the simulation re-centers on the new midpoint.

function setupFullscreenButton(buttonId) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener("click", async () => {
        const section = btn.closest("section");
        if (!section) return;
        try {
            if (document.fullscreenElement === section) {
                await document.exitFullscreen();
            } else if (document.fullscreenElement) {
                await document.exitFullscreen();
                await section.requestFullscreen();
            } else {
                await section.requestFullscreen();
            }
        } catch (err) {
            console.warn("fullscreen toggle failed:", err);
        }
    });
}
setupFullscreenButton("bundleFullscreen");
setupFullscreenButton("forceFullscreen");

document.addEventListener("fullscreenchange", () => {
    // Allow the layout to settle before re-measuring container dimensions.
    requestAnimationFrame(() => {
        renderBundling();
        renderForceGraph();
    });
});

// Re-render on window resize so the SVG keeps filling the available width.
// Debounce to avoid thrashing while the user drags the window.
let resizeTimer = null;
window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        renderBundling();
        renderForceGraph();
    }, 150);
});

renderStyleChips();
render();
renderBundling();
renderForceGraph();
</script>
</body>
</html>`;

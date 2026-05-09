// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// One-shot HTML visualizer for the neighborhood preview. Shows what
// neighborhoods would emerge from current similarity + corpus data,
// with filters by kind / source / size and per-row expansion to inspect
// members + evidence.

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
    const payload: VizPayload = {
        builtAt: preview.builtAt,
        sources: preview.sources,
        initialConfirmThreshold: opts.initialConfirmThreshold ?? 0.5,
        minConfirmThreshold: opts.minConfirmThreshold ?? 0.5,
        pairScores: opts.pairScores,
        neighborhoods: preview.neighborhoods,
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
  .nbhd-row {
    display: grid;
    grid-template-columns: 32ch auto auto auto 1fr;
    align-items: center; gap: 12px;
    padding: 6px 10px;
    border-radius: 4px; cursor: pointer;
    transition: background 0.08s;
    border: 1px solid transparent;
  }
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
  #bundling-svg .leaf-label.dim { fill: #3a4253; }
  #bundling-svg .leaf-label.target { fill: var(--accent); font-weight: 700; }
  #bundling-svg .leaf-label.source { fill: var(--src-both); font-weight: 700; }
  #bundling-svg .edge {
    fill: none; mix-blend-mode: screen;
    pointer-events: none;
    transition: stroke-opacity 0.08s, stroke 0.08s;
  }
  #bundling-svg .edge.dim { stroke-opacity: 0.05; }
  #bundling-svg .edge.hover { stroke-opacity: 0.95; stroke-width: 2px; }
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
    background: rgba(15, 18, 23, 0.86);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 14px 12px;
    width: min(560px, 70%);
    max-height: 360px;
    overflow-y: auto;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    box-shadow: 0 8px 28px rgba(0,0,0,0.55);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 10;
    color: var(--ink);
  }
  #bundling-phrases.visible { opacity: 1; }
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
      <p>Neighborhoods are merged from up to two sources, shown as badges on each row:</p>
      <ul>
        <li><span class="swatch" style="background:var(--src-sim)"></span><b>similarity</b> — pairs surfaced by <code>@collision similar</code>'s multi-vector embedding clustering. Cross-schema only by construction.</li>
        <li><span class="swatch" style="background:var(--src-corpus)"></span><b>corpus</b> — empirical misroute edges from <code>@collision corpus probe</code>. Cross- or same-schema. Edges below <code>--min-misroute</code> are filtered out.</li>
        <li><span class="swatch" style="background:var(--src-both)"></span><b>both</b> — confirmed by similarity and corpus. The strongest signal.</li>
      </ul>
      <p>Member-set merge: candidates from the two sources are unioned when they share <b>≥2 members</b>. Singleton agreements aren't merged; they remain distinct neighborhoods.</p>

      <h3>Reading the rows</h3>
      <p>Each row is one neighborhood. Sorted by member count, then by similarity score. Click a row to expand and see the members + the corpus misroute edges that contributed + the actual <b>example phrases</b> users said for each edge (with the LLM model and phrasing style that generated them, in brackets).</p>
      <ul>
        <li><b>Filter by kind / source / size / text</b> using the controls above the list.</li>
        <li><b>Member counts &gt; 2</b> are interesting — they signal a tight cluster of mutually-confusable actions.</li>
        <li><b>"both"-source neighborhoods</b> are the highest-confidence candidates for runtime policy attention.</li>
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
        </select>
      </label>
      <label>Min size
        <input type="number" id="minSize" value="2" min="2" max="20" style="width:60px">
      </label>
      <span id="count" style="color:var(--muted);font-size:12px;"></span>
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
  </section>
</main>
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<script id="payload" type="application/json">`;

const PREVIEW_HTML_SUFFIX = `</script>
<script>
const PAYLOAD = JSON.parse(document.getElementById("payload").textContent);
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

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
document.getElementById("confirmSlider").value = String(confirmThreshold);
document.getElementById("confirmSlider").min = String(PAYLOAD.minConfirmThreshold ?? 0.5);

// Render
function render() {
    const filter = document.getElementById("filter").value.trim().toLowerCase();
    const kind = document.getElementById("kindFilter").value;
    const sourceMode = document.getElementById("sourceFilter").value;
    const minSize = Number(document.getElementById("minSize").value) || 2;

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

    let filtered = tagged.filter(({ n, eff }) => {
        if (n.members.length < minSize) return false;
        if (kind !== "all" && n.kind !== kind) return false;
        if (sourceMode !== "all") {
            if (sourceMode === "both" && !(eff.hasSim && eff.hasCor)) return false;
            if (sourceMode === "similarity" && !(eff.hasSim && !eff.hasCor)) return false;
            if (sourceMode === "corpus" && !(eff.hasCor && !eff.hasSim)) return false;
        }
        if (filter) {
            const blob = (n.id + " " + n.members.map(m => m.schemaName + "." + m.actionName).join(" ")).toLowerCase();
            if (!blob.includes(filter)) return false;
        }
        return true;
    });

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
        const kindClass = n.kind === "cross-schema" ? "cross" : "same";
        const meta = [];
        const showSimScore = n.evidence.similarityScore ?? eff.dynamicScore;
        if (showSimScore !== undefined) {
            meta.push(\`sim \${showSimScore.toFixed(2)}\`);
        }
        if (n.evidence.misrouteCount !== undefined) {
            meta.push(\`misroutes \${n.evidence.misrouteCount}\`);
        }
        const row = document.createElement("div");
        row.className = "nbhd-row" + (isExp ? " expanded" : "");
        row.innerHTML = \`
            <div class="id" title="\${escapeHtml(n.id)}">\${escapeHtml(n.id)}</div>
            <div><span class="kind \${kindClass}">\${n.kind}</span></div>
            <div class="badges">\${sourceBadge}</div>
            <div class="members">\${n.members.length} members</div>
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
            const edgeHtml = (n.evidence.misrouteEdges || []).slice(0, 12).map(e => {
                const sampleHtml = (e.samples || []).map(s => {
                    const src = (s.model || s.style)
                        ? \`<span class="src">[\${escapeHtml([s.model, s.style].filter(Boolean).join(" · "))}]</span>\`
                        : "";
                    return \`<div class="ph">\${src}\${escapeHtml(s.phrase)}</div>\`;
                }).join("");
                return \`<div class="edge-block">
                    <div class="edge-head"><span class="count">\${e.count}</span><span>\${escapeHtml(e.from)} → \${escapeHtml(e.to)}</span></div>
                    \${sampleHtml ? \`<div class="samples">\${sampleHtml}</div>\` : ""}
                </div>\`;
            }).join("");
            const verdictHtml = n.evidence.sourceVerdicts
                ? \`<div style="color:var(--muted);font-size:11px;margin-top:6px;">verdicts: \` +
                  ["CLEAN", "TIGHT", "MISROUTE", "ERROR"]
                    .filter(k => (n.evidence.sourceVerdicts[k] ?? 0) > 0)
                    .map(k => \`\${k}=\${n.evidence.sourceVerdicts[k]}\`).join(" · ") +
                  \`</div>\`
                : "";
            detail.innerHTML = \`
                <h4>members</h4>
                <div class="member-list">\${memberHtml}</div>
                \${edgeHtml ? \`<h4>misroute edges (top 12)</h4><div class="edges">\${edgeHtml}</div>\` : \`<div class="empty-detail">no corpus edges (similarity-only neighborhood)</div>\`}
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

    const filtered = tagged.filter(({ n, eff }) => {
        if (n.members.length < minSize) return false;
        if (kindMode !== "all" && n.kind !== kindMode) return false;
        if (sourceMode === "both" && !(eff.hasSim && eff.hasCor)) return false;
        if (sourceMode === "similarity" && !(eff.hasSim && !eff.hasCor)) return false;
        if (sourceMode === "corpus" && !(eff.hasCor && !eff.hasSim)) return false;
        return true;
    });

    document.getElementById("bundleCount").textContent =
        \`\${filtered.length} of \${tagged.length} neighborhoods\`;

    // Hierarchy: only include actions that appear as members of any
    // surviving neighborhood (otherwise the circle gets very crowded).
    const memberKeys = new Set();
    for (const { n } of filtered) {
        for (const m of n.members) memberKeys.add(memberPathKey(m));
    }
    // Build agent → schema → action structure.
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
        const agentNode = { name: agent, children: [] };
        for (const [sub, actions] of [...schemas.entries()].sort()) {
            const schemaNode = { name: sub, children: [] };
            for (const action of [...actions].sort()) {
                schemaNode.children.push({
                    name: action,
                    pathKey: \`\${agent}/\${sub}/\${action}\`,
                });
            }
            agentNode.children.push(schemaNode);
        }
        root.children.push(agentNode);
    }

    // Edges: pairs of (source-leaf-key, target-leaf-key, color)
    const edges = [];
    for (const { n, eff } of filtered) {
        const color = (eff.hasSim && eff.hasCor)
            ? "var(--src-both)"
            : (eff.hasSim ? "var(--src-sim)" : "var(--src-corpus)");
        for (let i = 0; i < n.members.length; i++) {
            for (let j = i + 1; j < n.members.length; j++) {
                edges.push({
                    sourceKey: memberPathKey(n.members[i]),
                    targetKey: memberPathKey(n.members[j]),
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

    const leafG = svg.append("g")
        .selectAll("g")
        .data(root.leaves()).join("g")
        .attr("transform", d => \`rotate(\${d.x * 180 / Math.PI - 90}) translate(\${d.y},0)\`)
        .style("cursor", "pointer")
        .on("mouseenter", (evt, d) => focus(d))
        .on("mouseleave", () => focus(null));

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
        // Make text itself part of the hit area (extra belt + suspenders so
        // hover works even outside the rect's slack zone).
        .style("pointer-events", "all")
        .text(leafLabel);

    // Highlight on focus + populate the floating phrase panel.
    const phrasePanel = document.getElementById("bundling-phrases");
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
        if (groups.length === 0) {
            phrasePanel.innerHTML =
                \`<h4>Phrases for <span class="target-name">\${escapeHtml(focusName)}</span></h4>\` +
                \`<div class="empty">No corpus phrases. This action only appears in similarity-only neighborhoods.</div>\`;
            phrasePanel.classList.add("visible");
            phrasePanel.scrollTop = 0;
            return;
        }
        const totalPhrases = groups.reduce((n, g) => n + g.phrases.length, 0);
        let html = \`<h4>\${totalPhrases} phrase(s) involving <span class="target-name">\${escapeHtml(focusName)}</span></h4>\`;
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
    function focus(focusLeaf) {
        if (!focusLeaf) {
            edgeSel.classed("dim", false).classed("hover", false);
            leafText.classed("dim", false).classed("source", false).classed("target", false);
            renderPhrasePanel(null);
            return;
        }
        const connectedKeys = new Set([focusLeaf.data.pathKey]);
        edgeSel.each(function(e) {
            const isMine = e.source === focusLeaf || e.target === focusLeaf;
            if (isMine) {
                if (e.source === focusLeaf) connectedKeys.add(e.target.data.pathKey);
                else connectedKeys.add(e.source.data.pathKey);
            }
        });
        edgeSel
            .classed("dim", e => e.source !== focusLeaf && e.target !== focusLeaf)
            .classed("hover", e => e.source === focusLeaf || e.target === focusLeaf);
        leafText
            .classed("dim", d => !connectedKeys.has(d.data.pathKey))
            .classed("source", d => d === focusLeaf)
            .classed("target", d => d !== focusLeaf && connectedKeys.has(d.data.pathKey));
        renderPhrasePanel(focusLeaf);
    }
}

document.getElementById("bundleSourceFilter").addEventListener("change", renderBundling);
document.getElementById("bundleKindFilter").addEventListener("change", renderBundling);
document.getElementById("bundleMinSize").addEventListener("input", renderBundling);
document.getElementById("bundleFullPath").addEventListener("change", renderBundling);

// Re-render on window resize so the SVG keeps filling the available width.
// Debounce to avoid thrashing while the user drags the window.
let resizeTimer = null;
window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderBundling, 150);
});

render();
renderBundling();
</script>
</body>
</html>`;

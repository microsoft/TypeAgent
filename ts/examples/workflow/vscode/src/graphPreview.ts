// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Workflow graph preview — renders the GraphModel returned by the
 * language server's `workflow/previewGraph` request inside a VS Code
 * WebviewPanel.
 *
 * The webview owns its layout and SVG generation; the extension host
 * only feeds it a GraphModel JSON snapshot. We deliberately avoid
 * heavyweight layout libraries (elkjs, dagre) to keep the bundle
 * small — a layered top-down layout grouped by control-flow scope is
 * good enough for the typical workflow size, and the inline SVG
 * remains zoomable in the panel.
 *
 * Revisit a real layout engine (e.g. `elkjs` or `dagre`, loaded in a
 * webview worker) if real workflows routinely exceed ~30 nodes/edges
 * or if users start asking for cleaner edge routing — at that point
 * the added bundle cost is justified.
 *
 * Security: the webview disables remote resources, uses a strict CSP
 * with a per-load nonce, and never echoes raw `.wf` source text — it
 * only renders the structured GraphModel coming from the server.
 */

import { randomBytes } from "node:crypto";
import {
    ViewColumn,
    WebviewPanel,
    window,
    type Webview,
} from "vscode";

/** Mirrors `GraphModel` from workflow-dsl. Defined locally to avoid
 *  pulling the dsl package into the extension bundle. */
export interface GraphParam {
    id: string;
    name: string;
    type: string;
}
export interface GraphNode {
    id: string;
    kind: string;
    label: string;
    taskType?: string | undefined;
    bindName?: string | undefined;
    groupId?: string | undefined;
    line?: number | undefined;
}
export interface GraphEdge {
    from: string;
    to: string;
    label?: string | undefined;
}
export interface GraphGroup {
    id: string;
    kind: string;
    label: string;
    parentId?: string | undefined;
    children: string[];
}
export interface GraphModel {
    workflowName: string;
    params: GraphParam[];
    nodes: GraphNode[];
    edges: GraphEdge[];
    groups: GraphGroup[];
}

export interface PreviewGraphResult {
    graph?: GraphModel;
    errors: {
        phase: string;
        message: string;
        line: number;
        col: number;
    }[];
}

export function createGraphPanel(title: string): WebviewPanel {
    return window.createWebviewPanel(
        "workflowGraphPreview",
        title,
        { viewColumn: ViewColumn.Beside, preserveFocus: true },
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [],
        },
    );
}

export function renderGraph(
    webview: Webview,
    result: PreviewGraphResult,
    sourceLabel: string,
): void {
    webview.html = buildHtml(webview, result, sourceLabel);
}

function buildHtml(
    webview: Webview,
    result: PreviewGraphResult,
    sourceLabel: string,
): string {
    const nonce = randomBytes(16).toString("base64");
    const cspSource = webview.cspSource;
    const payload = JSON.stringify(result);
    const safeLabel = escapeHtml(sourceLabel);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<title>Workflow Graph: ${safeLabel}</title>
<style nonce="${nonce}">
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px; }
    h1 { font-size: 1em; margin: 0 0 8px 0; font-weight: 600; }
    .errors { color: var(--vscode-errorForeground); white-space: pre-wrap; font-family: var(--vscode-editor-font-family); font-size: 12px; }
    .errors div { margin-bottom: 4px; }
    .legend { font-size: 11px; opacity: 0.7; margin-bottom: 8px; }
    svg { width: 100%; height: auto; display: block; }
    .node-task    { fill: var(--vscode-charts-blue);   stroke: var(--vscode-foreground); }
    .node-call    { fill: var(--vscode-charts-purple); stroke: var(--vscode-foreground); }
    .node-tmpl    { fill: var(--vscode-charts-green);  stroke: var(--vscode-foreground); }
    .node-return  { fill: var(--vscode-charts-orange); stroke: var(--vscode-foreground); }
    .node-other   { fill: var(--vscode-charts-gray);   stroke: var(--vscode-foreground); }
    .node-param   { fill: var(--vscode-charts-yellow); stroke: var(--vscode-foreground); }
    .group-box    { fill: none; stroke: var(--vscode-panel-border); stroke-dasharray: 4 3; }
    .group-label  { font-size: 11px; fill: var(--vscode-descriptionForeground); }
    .node-label   { font-size: 11px; fill: var(--vscode-editor-foreground); pointer-events: none; }
    .edge         { stroke: var(--vscode-foreground); stroke-width: 1; fill: none; opacity: 0.6; }
    .edge-label   { font-size: 10px; fill: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h1>Graph: ${safeLabel}</h1>
<div class="legend">task = blue, workflow call = purple, template = green, return = orange, param = yellow</div>
<div id="errors" class="errors"></div>
<div id="graph"></div>
<script id="payload" type="application/json" nonce="${nonce}">${escapeJsonForScript(payload)}</script>
<script nonce="${nonce}">
${RENDER_SCRIPT}
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// JSON in a <script> needs the '<' escaped to defeat </script> injection.
function escapeJsonForScript(s: string): string {
    return s.replace(/</g, "\\u003c");
}

/**
 * Inline renderer running inside the webview. Performs a simple
 * layered top-down layout: assigns each node a depth based on the
 * longest incoming edge chain, packs same-depth nodes horizontally,
 * then draws orthogonal-ish edges between centers. Groups are drawn
 * as dashed rectangles wrapping their members.
 */
const RENDER_SCRIPT = String.raw`
(function () {
    const raw = document.getElementById("payload").textContent || "{}";
    const errBox = document.getElementById("errors");
    let result;
    try { result = JSON.parse(raw); } catch (e) {
        const d = document.createElement("div");
        d.textContent = "Failed to parse graph payload: " + e.message;
        errBox.appendChild(d);
        return;
    }
    if (result.errors && result.errors.length) {
        for (const e of result.errors) {
            const d = document.createElement("div");
            d.textContent = "[" + e.phase + " " + e.line + ":" + e.col + "] " + e.message;
            errBox.appendChild(d);
        }
    }
    const g = result.graph;
    if (!g) return;

    // Layered layout. Params at depth 0; otherwise depth = 1 + max(depth(producer)).
    const depth = new Map();
    for (const p of (g.params ?? [])) depth.set(p.id, 0);
    const incoming = new Map();
    for (const n of (g.nodes ?? [])) incoming.set(n.id, []);
    for (const e of (g.edges ?? [])) {
        const list = incoming.get(e.to) || [];
        list.push(e.from);
        incoming.set(e.to, list);
    }
    // groupMap must be available before depthOf is called.
    const groupMap = new Map((g.groups ?? []).map((gr) => [gr.id, gr]));
    function depthOf(id, stack) {
        if (depth.has(id)) return depth.get(id);
        if (stack.has(id)) { depth.set(id, 0); return 0; } // cycle guard
        stack.add(id);
        // For group IDs, depth = max depth of their member nodes so that
        // nodes consuming the group's output are placed below all inner nodes.
        const grp = groupMap.get(id);
        if (grp) {
            const memberIds = collectGroupMembersFwd(grp);
            let d = 0;
            for (const mid of memberIds) d = Math.max(d, depthOf(mid, stack));
            stack.delete(id);
            depth.set(id, d);
            return d;
        }
        const ins = incoming.get(id) || [];
        let d = 0;
        for (const src of ins) d = Math.max(d, depthOf(src, stack) + 1);
        stack.delete(id);
        depth.set(id, d);
        return d;
    }
    for (const n of (g.nodes ?? [])) depthOf(n.id, new Set());

    // Bucket all positioned items by depth.
    const byDepth = new Map();
    function push(id, d) {
        if (!byDepth.has(d)) byDepth.set(d, []);
        byDepth.get(d).push(id);
    }
    for (const p of (g.params ?? [])) push(p.id, 0);
    for (const n of (g.nodes ?? [])) push(n.id, depth.get(n.id));

    const layers = [...byDepth.keys()].sort((a, b) => a - b);
    const NODE_W = 160, NODE_H = 36, GAP_X = 24, GAP_Y = 60, PAD = 20;
    const positions = new Map(); // id -> {x, y, w, h, kind, label, line}

    const paramMap = new Map((g.params ?? []).map((p) => [p.id, p]));
    const nodeMap = new Map((g.nodes ?? []).map((n) => [n.id, n]));

    let maxW = 0;
    for (const d of layers) {
        const ids = byDepth.get(d);
        const layerW = ids.length * NODE_W + (ids.length - 1) * GAP_X;
        if (layerW > maxW) maxW = layerW;
    }
    for (const d of layers) {
        const ids = byDepth.get(d);
        const layerW = ids.length * NODE_W + (ids.length - 1) * GAP_X;
        let x = PAD + (maxW - layerW) / 2;
        const y = PAD + d * (NODE_H + GAP_Y);
        for (const id of ids) {
            let kind, label, line;
            if (paramMap.has(id)) {
                const p = paramMap.get(id);
                kind = "param";
                label = p.name + ": " + p.type;
            } else {
                const n = nodeMap.get(id);
                kind = n.kind;
                label = n.label;
                line = n.line;
            }
            positions.set(id, { x, y, w: NODE_W, h: NODE_H, kind, label, line });
            x += NODE_W + GAP_X;
        }
    }

    // Compute a center position for each group based on its member nodes.
    // This allows edges whose source or target is a group ID to render.
    for (const grp of g.groups) {
        const memberIds = collectGroupMembersFwd(grp);
        const ps = memberIds.map(id => positions.get(id)).filter(Boolean);
        if (!ps.length) continue;
        const minX = Math.min(...ps.map(p => p.x));
        const minY = Math.min(...ps.map(p => p.y));
        const maxX = Math.max(...ps.map(p => p.x + p.w));
        const maxY = Math.max(...ps.map(p => p.y + p.h));
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        positions.set(grp.id, { x: cx - NODE_W / 2, y: cy - NODE_H / 2, w: NODE_W, h: NODE_H, kind: "group", label: grp.label });
    }

    // Forward declaration used by group-position loop above.
    function collectGroupMembersFwd(grp) {
        const out = [];
        const seen = new Set();
        function visit(id) {
            if (seen.has(id)) return;
            seen.add(id);
            const sub = groupMap.get(id);
            if (sub) { for (const c of sub.children) visit(c); }
            else { out.push(id); }
        }
        for (const c of grp.children) visit(c);
        return out;
    }

    const totalH = PAD * 2 + layers.length * NODE_H + (layers.length - 1) * GAP_Y;
    const totalW = PAD * 2 + maxW;

    const svgns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgns, "svg");
    svg.setAttribute("viewBox", "0 0 " + totalW + " " + totalH);
    svg.setAttribute("xmlns", svgns);

    // Groups (drawn behind nodes).
    for (const grp of g.groups) {
        const memberIds = collectGroupMembers(grp);
        const ps = memberIds.map((id) => positions.get(id)).filter(Boolean);
        if (!ps.length) continue;
        const minX = Math.min(...ps.map((p) => p.x)) - 8;
        const minY = Math.min(...ps.map((p) => p.y)) - 18;
        const maxX = Math.max(...ps.map((p) => p.x + p.w)) + 8;
        const maxY = Math.max(...ps.map((p) => p.y + p.h)) + 8;
        const r = document.createElementNS(svgns, "rect");
        r.setAttribute("class", "group-box");
        r.setAttribute("x", String(minX));
        r.setAttribute("y", String(minY));
        r.setAttribute("width", String(maxX - minX));
        r.setAttribute("height", String(maxY - minY));
        svg.appendChild(r);
        const t = document.createElementNS(svgns, "text");
        t.setAttribute("class", "group-label");
        t.setAttribute("x", String(minX + 4));
        t.setAttribute("y", String(minY + 12));
        t.textContent = grp.label || grp.kind;
        svg.appendChild(t);
    }

    function collectGroupMembers(grp) {
        const out = [];
        const seen = new Set();
        function visit(id) {
            if (seen.has(id)) return;
            seen.add(id);
            const sub = groupMap.get(id);
            if (sub) {
                for (const c of sub.children) visit(c);
            } else {
                out.push(id);
            }
        }
        for (const c of grp.children) visit(c);
        return out;
    }

    // Edges.
    for (const e of g.edges) {
        const a = positions.get(e.from);
        const b = positions.get(e.to);
        if (!a || !b) continue;
        const x1 = a.x + a.w / 2;
        const y1 = a.y + a.h;
        const x2 = b.x + b.w / 2;
        const y2 = b.y;
        const midY = (y1 + y2) / 2;
        const path = document.createElementNS(svgns, "path");
        path.setAttribute("class", "edge");
        path.setAttribute("d", "M " + x1 + " " + y1 + " C " + x1 + " " + midY + ", " + x2 + " " + midY + ", " + x2 + " " + y2);
        svg.appendChild(path);
        if (e.label) {
            const t = document.createElementNS(svgns, "text");
            t.setAttribute("class", "edge-label");
            t.setAttribute("x", String((x1 + x2) / 2));
            t.setAttribute("y", String(midY));
            t.textContent = e.label;
            svg.appendChild(t);
        }
    }

    // Nodes (skip synthetic group-center entries - groups are drawn as dashed boxes above).
    for (const [, p] of positions) {
        if (p.kind === "group") continue;
        const cls = nodeClass(p.kind);
        const r = document.createElementNS(svgns, "rect");
        r.setAttribute("class", cls);
        r.setAttribute("x", String(p.x));
        r.setAttribute("y", String(p.y));
        r.setAttribute("width", String(p.w));
        r.setAttribute("height", String(p.h));
        r.setAttribute("rx", "4");
        r.setAttribute("ry", "4");
        if (p.line) {
            const title = document.createElementNS(svgns, "title");
            title.textContent = "line " + p.line + " — " + p.label;
            r.appendChild(title);
        }
        svg.appendChild(r);
        const t = document.createElementNS(svgns, "text");
        t.setAttribute("class", "node-label");
        t.setAttribute("x", String(p.x + p.w / 2));
        t.setAttribute("y", String(p.y + p.h / 2 + 4));
        t.setAttribute("text-anchor", "middle");
        t.textContent = p.label.length > 22 ? p.label.slice(0, 21) + "…" : p.label;
        svg.appendChild(t);
    }

    function nodeClass(kind) {
        switch (kind) {
            case "task": return "node-task";
            case "workflowCall": return "node-call";
            case "template": return "node-tmpl";
            case "return": return "node-return";
            case "param": return "node-param";
            default: return "node-other";
        }
    }

    document.getElementById("graph").appendChild(svg);
})();
`;

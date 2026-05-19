// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Generates a self-contained HTML page that visualizes a workflow
 * DSL file as a node graph using SVG.
 *
 * Usage: node dist/visualize.js examples/d1-standup-prep.wf > out.html
 */

import * as fs from "fs";
import * as path from "path";
import { lex } from "./lexer.js";
import { Parser } from "./parser.js";
import { extractGraph, GraphModel } from "./graphExtractor.js";

function parseWf(filePath: string): GraphModel {
    const source = fs.readFileSync(filePath, "utf-8");
    const { tokens, errors: lexErrors, comments } = lex(source);
    if (lexErrors.length > 0) {
        throw new Error(
            `Lex errors: ${lexErrors.map((e) => e.message).join(", ")}`,
        );
    }
    const parser = new Parser(tokens, comments);
    const { ast, errors: parseErrors } = parser.parseSingle();
    if (!ast || parseErrors.length > 0) {
        throw new Error(
            `Parse errors: ${parseErrors.map((e) => e.message).join(", ")}`,
        );
    }
    return extractGraph(ast);
}

// ---- Layout engine (simple top-down, left-to-right) ----

interface LayoutNode {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    kind: string;
    taskType?: string | undefined;
    groupId?: string | undefined;
}

interface LayoutEdge {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    label?: string | undefined;
}

interface LayoutGroup {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    kind: string;
}

interface Layout {
    nodes: LayoutNode[];
    edges: LayoutEdge[];
    groups: LayoutGroup[];
    width: number;
    height: number;
}

function computeLayout(graph: GraphModel): Layout {
    const NODE_WIDTH = 200;
    const NODE_HEIGHT = 50;
    const PARAM_WIDTH = 140;
    const PARAM_HEIGHT = 36;
    const H_GAP = 40;
    const V_GAP = 30;
    const GROUP_PAD = 20;
    const GROUP_HEADER = 28;

    // Build a topological ordering:
    // params first, then nodes in declaration order, grouped by parent
    const layoutNodes: LayoutNode[] = [];
    const nodePositions = new Map<
        string,
        { x: number; y: number; w: number; h: number }
    >();

    let cursorY = 40;

    // Params row
    let cursorX = 40;
    for (const p of graph.params) {
        const ln: LayoutNode = {
            id: p.id,
            x: cursorX,
            y: cursorY,
            width: PARAM_WIDTH,
            height: PARAM_HEIGHT,
            label: `${p.name}: ${p.type}`,
            kind: "param",
        };
        layoutNodes.push(ln);
        nodePositions.set(p.id, {
            x: cursorX,
            y: cursorY,
            w: PARAM_WIDTH,
            h: PARAM_HEIGHT,
        });
        cursorX += PARAM_WIDTH + H_GAP;
    }
    cursorY += PARAM_HEIGHT + V_GAP;

    // Recursively lay out nodes and groups
    // Top-level items: nodes/groups with no parent group
    const topLevelNodeIds = new Set(
        graph.nodes.filter((n) => !n.groupId).map((n) => n.id),
    );
    const topLevelGroupIds = new Set(
        graph.groups.filter((g) => !g.parentId).map((g) => g.id),
    );

    // Build ordered list of top-level items by source order
    // (nodes and groups interleaved)
    interface OrderedItem {
        kind: "node" | "group";
        id: string;
        line: number;
    }

    function getMinLine(groupId: string): number {
        const group = graph.groups.find((g) => g.id === groupId)!;
        let minLine = Infinity;
        for (const childId of group.children) {
            const childNode = graph.nodes.find((n) => n.id === childId);
            if (childNode && childNode.line !== undefined) {
                minLine = Math.min(minLine, childNode.line);
            }
            const childGroup = graph.groups.find((g) => g.id === childId);
            if (childGroup) {
                minLine = Math.min(minLine, getMinLine(childId));
            }
        }
        return minLine;
    }

    function layoutItems(
        nodeIds: Set<string>,
        groupIds: Set<string>,
        startX: number,
        startY: number,
        parentGroupId?: string,
    ): { width: number; height: number } {
        const items: OrderedItem[] = [];

        for (const id of nodeIds) {
            const node = graph.nodes.find((n) => n.id === id)!;
            items.push({ kind: "node", id, line: node.line ?? 0 });
        }
        for (const id of groupIds) {
            items.push({ kind: "group", id, line: getMinLine(id) });
        }
        items.sort((a, b) => a.line - b.line);

        let y = startY;
        let maxWidth = 0;

        for (const item of items) {
            if (item.kind === "node") {
                const node = graph.nodes.find((n) => n.id === item.id)!;
                const ln: LayoutNode = {
                    id: node.id,
                    x: startX,
                    y,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                    label: node.label,
                    kind: node.kind,
                    taskType: node.taskType,
                    groupId: parentGroupId,
                };
                layoutNodes.push(ln);
                nodePositions.set(node.id, {
                    x: startX,
                    y,
                    w: NODE_WIDTH,
                    h: NODE_HEIGHT,
                });
                maxWidth = Math.max(maxWidth, NODE_WIDTH);
                y += NODE_HEIGHT + V_GAP;
            } else {
                const group = graph.groups.find((g) => g.id === item.id)!;
                const childNodeIds = new Set(
                    group.children.filter((c) =>
                        graph.nodes.some((n) => n.id === c),
                    ),
                );
                const childGroupIds = new Set(
                    group.children.filter((c) =>
                        graph.groups.some((g) => g.id === c),
                    ),
                );

                const innerResult = layoutItems(
                    childNodeIds,
                    childGroupIds,
                    startX + GROUP_PAD,
                    y + GROUP_HEADER + GROUP_PAD,
                    group.id,
                );

                const groupWidth = Math.max(
                    innerResult.width + GROUP_PAD * 2,
                    NODE_WIDTH + GROUP_PAD * 2,
                );
                const groupHeight =
                    innerResult.height + GROUP_HEADER + GROUP_PAD * 2;

                layoutGroups.push({
                    id: group.id,
                    x: startX,
                    y,
                    width: groupWidth,
                    height: groupHeight,
                    label: group.label,
                    kind: group.kind,
                });

                maxWidth = Math.max(maxWidth, groupWidth);
                y += groupHeight + V_GAP;
            }
        }

        return { width: maxWidth, height: y - startY };
    }

    const layoutGroups: LayoutGroup[] = [];
    const result = layoutItems(topLevelNodeIds, topLevelGroupIds, 40, cursorY);

    // Compute edges
    const layoutEdges: LayoutEdge[] = [];
    for (const edge of graph.edges) {
        const from = nodePositions.get(edge.from);
        const to = nodePositions.get(edge.to);
        if (from && to) {
            layoutEdges.push({
                fromX: from.x + from.w / 2,
                fromY: from.y + from.h,
                toX: to.x + to.w / 2,
                toY: to.y,
                label: edge.label,
            });
        }
    }

    const totalWidth = Math.max(result.width + 80, cursorX + 40);
    const totalHeight = cursorY + result.height + 40;

    return {
        nodes: layoutNodes,
        edges: layoutEdges,
        groups: layoutGroups,
        width: totalWidth,
        height: totalHeight,
    };
}

// ---- HTML/SVG generation ----

function nodeColor(kind: string): string {
    switch (kind) {
        case "param":
            return "#e3f2fd";
        case "task":
            return "#fff3e0";
        case "template":
            return "#f3e5f5";
        case "constant":
            return "#e8f5e9";
        case "literal":
            return "#e8f5e9";
        case "return":
            return "#fce4ec";
        case "operator":
            return "#fff8e1";
        case "branch":
            return "#e0f7fa";
        case "error":
            return "#ffebee";
        case "workflowCall":
            return "#fce4ec";
        default:
            return "#f5f5f5";
    }
}

function nodeBorder(kind: string): string {
    switch (kind) {
        case "param":
            return "#1565c0";
        case "task":
            return "#e65100";
        case "template":
            return "#7b1fa2";
        case "constant":
            return "#2e7d32";
        case "literal":
            return "#2e7d32";
        case "return":
            return "#c62828";
        case "operator":
            return "#f9a825";
        case "error":
            return "#b71c1c";
        case "branch":
            return "#00838f";
        case "workflowCall":
            return "#ad1457";
        default:
            return "#616161";
    }
}

function groupColor(kind: string): { fill: string; stroke: string } {
    switch (kind) {
        case "attempts":
            return { fill: "#fff3e0", stroke: "#ef6c00" };
        case "map":
            return { fill: "#e8eaf6", stroke: "#3f51b5" };
        case "filter":
            return { fill: "#ede7f6", stroke: "#673ab7" };
        case "parallel":
            return { fill: "#e0f7fa", stroke: "#00838f" };
        case "parallelMap":
            return { fill: "#e0f2f1", stroke: "#00695c" };
        case "if-then":
            return { fill: "#e8f5e9", stroke: "#2e7d32" };
        case "if-else":
            return { fill: "#fce4ec", stroke: "#c62828" };
        case "switch":
            return { fill: "#f3e5f5", stroke: "#6a1b9a" };
        case "switch-case":
            return { fill: "#f3e5f5", stroke: "#8e24aa" };
        case "switch-default":
            return { fill: "#fce4ec", stroke: "#ad1457" };
        default:
            return { fill: "#fafafa", stroke: "#9e9e9e" };
    }
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function generateHtml(
    graph: GraphModel,
    layout: Layout,
    title: string,
): string {
    let svg = "";

    // Draw groups (back to front)
    for (const g of layout.groups) {
        const colors = groupColor(g.kind);
        svg += `  <rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="8" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5" stroke-dasharray="${g.kind === "attempts" ? "6,3" : "none"}" opacity="0.6" />\n`;
        svg += `  <text x="${g.x + 10}" y="${g.y + 18}" font-size="12" font-weight="600" fill="${colors.stroke}" font-family="system-ui, sans-serif">${escapeHtml(g.label)}</text>\n`;
    }

    // Draw edges
    for (const e of layout.edges) {
        const midY = (e.fromY + e.toY) / 2;
        svg += `  <path d="M ${e.fromX} ${e.fromY} C ${e.fromX} ${midY}, ${e.toX} ${midY}, ${e.toX} ${e.toY}" fill="none" stroke="#90a4ae" stroke-width="1.5" marker-end="url(#arrow)" />\n`;
        if (e.label) {
            const lx = (e.fromX + e.toX) / 2 + 5;
            const ly = midY - 4;
            svg += `  <text x="${lx}" y="${ly}" font-size="10" fill="#607d8b" font-family="system-ui, sans-serif">${escapeHtml(e.label)}</text>\n`;
        }
    }

    // Draw nodes
    for (const n of layout.nodes) {
        const fill = nodeColor(n.kind);
        const stroke = nodeBorder(n.kind);
        const rx = n.kind === "param" ? 18 : 6;
        svg += `  <rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />\n`;

        // Label
        const textY = n.y + n.height / 2 + 4;
        if (n.taskType && n.kind !== "param") {
            // Two-line: bind name + task type
            svg += `  <text x="${n.x + n.width / 2}" y="${n.y + 18}" text-anchor="middle" font-size="13" font-weight="600" fill="#212121" font-family="system-ui, sans-serif">${escapeHtml(n.label)}</text>\n`;
            svg += `  <text x="${n.x + n.width / 2}" y="${n.y + 35}" text-anchor="middle" font-size="11" fill="#757575" font-family="monospace">${escapeHtml(n.taskType)}</text>\n`;
        } else {
            svg += `  <text x="${n.x + n.width / 2}" y="${textY}" text-anchor="middle" font-size="13" font-weight="${n.kind === "return" ? "700" : "500"}" fill="#212121" font-family="system-ui, sans-serif">${escapeHtml(n.label)}</text>\n`;
        }
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; background: #fafafa; font-family: system-ui, sans-serif; }
  .container { padding: 20px; }
  h1 { font-size: 20px; color: #333; margin-bottom: 16px; }
  svg { border: 1px solid #e0e0e0; border-radius: 8px; background: #fff; }
  .legend { display: flex; gap: 16px; margin-top: 12px; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #555; }
  .legend-swatch { width: 16px; height: 16px; border-radius: 3px; border: 1.5px solid; }
</style>
</head>
<body>
<div class="container">
<h1>workflow ${escapeHtml(graph.workflowName)}</h1>
<svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#90a4ae" />
    </marker>
  </defs>
${svg}</svg>
<div class="legend">
  <div class="legend-item"><div class="legend-swatch" style="background:${nodeColor("param")};border-color:${nodeBorder("param")}"></div>Parameter</div>
  <div class="legend-item"><div class="legend-swatch" style="background:${nodeColor("task")};border-color:${nodeBorder("task")}"></div>Task call</div>
  <div class="legend-item"><div class="legend-swatch" style="background:${nodeColor("template")};border-color:${nodeBorder("template")}"></div>Template</div>
  <div class="legend-item"><div class="legend-swatch" style="background:${nodeColor("constant")};border-color:${nodeBorder("constant")}"></div>Constant</div>
  <div class="legend-item"><div class="legend-swatch" style="background:${nodeColor("return")};border-color:${nodeBorder("return")}"></div>Return</div>
  <div class="legend-item"><div class="legend-swatch" style="background:${nodeColor("operator")};border-color:${nodeBorder("operator")}"></div>Operator</div>
  <div class="legend-item"><div class="legend-swatch" style="background:${nodeColor("branch")};border-color:${nodeBorder("branch")}"></div>Branch</div>
  <div class="legend-item"><div class="legend-swatch" style="background:${nodeColor("error")};border-color:${nodeBorder("error")}"></div>Error</div>
  <div class="legend-item"><div class="legend-swatch" style="background:${nodeColor("workflowCall")};border-color:${nodeBorder("workflowCall")}"></div>Workflow call</div>
</div>
<details style="margin-top: 16px;">
  <summary style="cursor: pointer; font-size: 13px; color: #666;">Graph model (JSON)</summary>
  <pre style="font-size: 11px; background: #f5f5f5; padding: 12px; border-radius: 6px; overflow: auto; max-height: 400px;">${escapeHtml(JSON.stringify(graph, null, 2))}</pre>
</details>
</div>
</body>
</html>`;
}

// ---- Main ----

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Usage: node dist/visualize.js <file.wf> [file2.wf ...]");
    process.exit(1);
}

for (const filePath of args) {
    const resolved = path.resolve(filePath);
    const graph = parseWf(resolved);
    const layout = computeLayout(graph);
    const title = path.basename(filePath, ".wf");

    if (args.length === 1) {
        // Single file: write to stdout
        console.log(generateHtml(graph, layout, title));
    } else {
        // Multiple files: write to <name>.html
        const outPath = resolved.replace(/\.wf$/, ".html");
        fs.writeFileSync(outPath, generateHtml(graph, layout, title));
        console.error(`Wrote ${outPath}`);
    }
}

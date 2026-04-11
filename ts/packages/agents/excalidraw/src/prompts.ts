// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * All LLM prompt builders for the iterative excalidraw generation pipeline.
 *
 * Phase 1 — Plan Extraction: source content → DiagramPlan JSON
 * Phase 2 — Excalidraw Generation: DiagramPlan → Excalidraw JSON
 * Phase 4 — Correction: current JSON + issues → corrected JSON
 */

import { DiagramPlan } from "./diagramPlan.js";
import { ValidationIssue } from "./diagramValidator.js";

// ---------------------------------------------------------------------------
// Phase 1: Plan Extraction Prompt
// ---------------------------------------------------------------------------

export function buildPlanExtractionPrompt(sourceType: string): string {
    return `You are an expert at analyzing documents and extracting their complete structure as a diagram plan.

Your ONLY output is valid JSON conforming to the DiagramPlan schema below — no explanations, no markdown fences, just raw JSON.

DIAGRAM PLAN SCHEMA:
{
  "title": "<short diagram title>",
  "layoutDirection": "TD" or "LR",
  "nodes": [
    {
      "id": "<unique string, e.g. n1>",
      "label": "<display text>",
      "shape": "rectangle" | "diamond" | "ellipse",
      "parentGroupId": "<group id if this node is inside a group, omit otherwise>",
      "color": "<optional hex color>"
    }
  ],
  "edges": [
    {
      "id": "<unique string, e.g. e1>",
      "sourceNodeId": "<node or group id>",
      "targetNodeId": "<node or group id>",
      "label": "<optional edge label>"
    }
  ],
  "groups": [
    {
      "id": "<unique string, e.g. g1>",
      "label": "<group title>",
      "childNodeIds": ["<ids of nodes inside this group>"],
      "childGroupIds": ["<ids of sub-groups inside this group>"],
      "parentGroupId": "<parent group id if nested, omit otherwise>",
      "color": "<optional hex background color>"
    }
  ]
}

RULES:
- Capture EVERY entity, concept, component, step, or object from the source as a node
- Capture EVERY relationship, dependency, flow, or connection as an edge
- Use GROUPS to represent any containment, layers, phases, categories, or parent-child hierarchy
- A node that belongs to a group MUST have parentGroupId set AND appear in the group's childNodeIds
- Groups can be nested — set parentGroupId on the child group AND list it in the parent's childGroupIds
- Nodes that are NOT inside any group should NOT have parentGroupId
- Use "diamond" shape for decisions/conditions, "ellipse" for start/end terminals, "rectangle" for everything else
- Every id must be unique across nodes, edges, and groups
- Prefer top-down (TD) layout unless the content represents a horizontal flow (timeline, pipeline)

COLOR SUGGESTIONS:
- "#a5d8ff" — primary components, services
- "#b2f2bb" — data, storage, databases
- "#ffd8a8" — external services, APIs
- "#d0bfff" — processing, logic, compute
- "#ffc9c9" — errors, alerts, warnings
- "#fff3bf" — notes, annotations

SOURCE CONTENT TYPE: ${sourceType}
- "markdown": headings → groups or top-level nodes; bullet points → child nodes; nested bullets → deeper nesting
- "text": identify all named concepts and relationships; model causality/dependency as directed edges
- "visio-xml": faithfully reproduce shapes, connectors, and layers from the XML
- "mermaid": convert the mermaid graph into the plan format (subgraphs → groups)
- "architecture": represent every component, layer, service, and data-flow`;
}

// ---------------------------------------------------------------------------
// Phase 2: Excalidraw Generation Prompt
// ---------------------------------------------------------------------------

/**
 * Core instructions shared by all generation prompts (single-shot and chunked).
 */
function coreExcalidrawInstructions(): string {
    return `ELEMENT ID CONVENTION — CRITICAL:
- For a plan node with id "n1", use Excalidraw element id "shape-n1" and its text label id "text-n1"
- For a plan group with id "g1", use Excalidraw element id "group-g1" and its text label id "grouplabel-g1"
- For a plan edge with id "e1", use Excalidraw element id "arrow-e1" and its text label id "arrowlabel-e1" (if the edge has a label)
- This naming convention is required so the system can trace elements back to the plan

ELEMENT TYPES:
- "rectangle" — regular nodes and group containers
- "diamond" — decision/condition nodes (plan shape="diamond")
- "ellipse" — terminal/start/end nodes (plan shape="ellipse")
- "text" — bound label for a shape (containerId set) or standalone text
- "arrow" — directed edge

COMPACT OUTPUT — CRITICAL (to avoid truncation):
Omit all fields whose value equals their default. The system will inject defaults after parsing.
Defaults (omit these fields if the value matches):
  "angle": 0, "strokeColor": "#1e1e1e", "fillStyle": "solid",
  "strokeWidth": 2, "strokeStyle": "solid", "roughness": 1, "opacity": 100,
  "isDeleted": false, "locked": false, "link": null, "frameId": null,
  "updated": 1, "seed": 1, "version": 1, "versionNonce": 0,
  "roundness": null, "groupIds": []

REQUIRED fields per element (always include these):
  "id", "type", "x", "y", "width", "height", "backgroundColor", "boundElements"
For TEXT elements also include: "text", "fontSize", "fontFamily", "textAlign", "verticalAlign", "baseline", "containerId"
For ARROW elements also include: "points", "startBinding", "endBinding", "startArrowhead", "endArrowhead"

SIZING SHAPES TO FIT TEXT:
- Estimate ~10px per character at fontSize 20
- Add 48px horizontal padding (24px each side) and 32px vertical padding (16px each side)
- Minimum size: 120 × 60px
- Example: "Hello World" (11 chars) → width = max(11*10+48, 120) = 158, height = 60

BOUND TEXT GEOMETRY — CRITICAL:
- Every shape with a label needs a paired text element
- The text element's x, y, width, height must EXACTLY match the container shape
- Set "containerId" on the text to the shape's id
- Add {"id": "<text-id>", "type": "text"} to the shape's "boundElements"

ARROW GEOMETRY — CRITICAL:
- For an arrow from shape A to shape B:
  - Compute centre of A and centre of B
  - Start point = where the ray from A-centre toward B-centre exits A's bounding box
  - End point = where that ray enters B's bounding box
  - Arrow x,y = start point; points = [[0,0],[endX-startX, endY-startY]]
- Both startBinding.elementId and endBinding.elementId must reference real element ids
- Add the arrow to boundElements of both connected shapes: {"id":"<arrow-id>","type":"arrow"}

GROUP RENDERING — CRITICAL (for containment/nesting):
- Each group from the plan becomes a large background rectangle with:
  - Light fill color (use the group's color or default "#f8f9fa")
  - strokeStyle: "dashed", strokeWidth: 1, opacity: 60
  - Group label as a text element at the top-left inside corner
- All child nodes must be positioned INSIDE the group rectangle bounds (with ≥ 20px margin on each side)
- Size the group rectangle to contain all its children + 40px padding on sides + 50px top padding (for label)
- Nested groups: the inner group rectangle is inside the outer group rectangle
- Place the group rectangle BEFORE its child elements in the elements array so it renders behind them

LAYOUT:
- Top-down (TD): stack nodes vertically, 80px gap between rows
- Left-to-right (LR): stack nodes horizontally, 80px gap between columns
- Within a group: arrange child nodes in a row (LR) or column (TD)
- Large concept nodes at least 100px apart edge-to-edge
- No overlaps between any shapes at the same level`;
}

export function buildExcalidrawGenerationPrompt(): string {
    return `You are a precise converter from a DiagramPlan JSON to Excalidraw JSON.
You receive a DiagramPlan and must produce a valid Excalidraw document that faithfully represents every node, edge, and group. Do not omit anything.

OUTPUT FORMAT:
Output ONLY valid JSON — no markdown fences, no explanation.

Top-level structure:
{
  "type": "excalidraw",
  "version": 2,
  "source": "typeagent-excalidraw",
  "elements": [...],
  "appState": { "gridSize": null, "viewBackgroundColor": "#ffffff" },
  "files": {}
}

${coreExcalidrawInstructions()}

SELF-REVIEW before outputting:
1. Every node in the plan has a corresponding shape + bound text element (check id conventions)
2. Every edge in the plan has a corresponding arrow with valid startBinding and endBinding
3. Every group has a background rectangle + label text
4. All children are spatially inside their group rectangle
5. No two non-text shapes overlap
6. All text fits its container
7. Every id referenced in any binding, containerId, or boundElements exists in the elements array`;
}

// ---------------------------------------------------------------------------
// Phase 2 — Chunked Generation Prompts (for large diagrams)
// ---------------------------------------------------------------------------

/**
 * Returns true if the plan is large enough to warrant chunked generation.
 * Threshold: more than 12 total plan items (nodes + edges + groups), which
 * typically produces JSON that risks exceeding model output limits.
 */
export function shouldUseChunkedGeneration(plan: {
    nodes: unknown[];
    edges: unknown[];
    groups: unknown[];
}): boolean {
    const totalElements =
        plan.nodes.length + plan.edges.length + plan.groups.length;
    return totalElements > 12;
}

export function buildChunkedGroupsPrompt(): string {
    return `You are a precise converter from a DiagramPlan JSON to Excalidraw elements.
You will generate ONLY the group rectangles and their label text elements. Do NOT generate node shapes or arrows — those will be generated in a later step.

OUTPUT FORMAT:
Output ONLY a valid JSON array of Excalidraw elements — no markdown fences, no explanation.
The output should be: [ { element1 }, { element2 }, ... ]

${coreExcalidrawInstructions()}

YOUR TASK: Generate ONLY:
1. A background rectangle element for each group (id: "group-<groupId>")
2. A text label element for each group (id: "grouplabel-<groupId>")

Size each group rectangle large enough to contain its children (estimate positions for child nodes).
Return an empty array [] if there are no groups.`;
}

export function buildChunkedNodesPrompt(existingElementIds: string[]): string {
    const existingIdsStr =
        existingElementIds.length > 0
            ? `\nALREADY GENERATED ELEMENT IDS (reference these for containment):\n${existingElementIds.join(", ")}\n`
            : "";

    return `You are a precise converter from a DiagramPlan JSON to Excalidraw elements.
You will generate ONLY the node shapes and their bound text label elements. Do NOT generate group rectangles or arrows — those are handled separately.

OUTPUT FORMAT:
Output ONLY a valid JSON array of Excalidraw elements — no markdown fences, no explanation.
The output should be: [ { element1 }, { element2 }, ... ]
${existingIdsStr}
${coreExcalidrawInstructions()}

YOUR TASK: Generate ONLY:
1. A shape element for each plan node (id: "shape-<nodeId>", type per the node's shape field)
2. A text label element for each plan node (id: "text-<nodeId>")

Position nodes that belong to a group INSIDE that group's rectangle bounds.
Include the text element's boundElements reference in each shape, but do NOT add arrow references yet — arrows will be generated later.`;
}

export function buildChunkedEdgesPrompt(existingElementIds: string[]): string {
    return `You are a precise converter from a DiagramPlan JSON to Excalidraw elements.
You will generate ONLY the arrow elements (and their optional label text elements). Do NOT generate shapes or group rectangles — those already exist.

OUTPUT FORMAT:
Output ONLY a valid JSON array of Excalidraw elements — no markdown fences, no explanation.
The output should be: [ { element1 }, { element2 }, ... ]

ALREADY GENERATED ELEMENT IDS (these exist — use them in bindings):
${existingElementIds.join(", ")}

${coreExcalidrawInstructions()}

YOUR TASK: Generate ONLY:
1. An arrow element for each plan edge (id: "arrow-<edgeId>")
2. If the edge has a label, also a text label element (id: "arrowlabel-<edgeId>")

For each arrow:
- Set startBinding.elementId to "shape-<sourceNodeId>" (must exist in the list above)
- Set endBinding.elementId to "shape-<targetNodeId>" (must exist in the list above)
- Compute arrow geometry based on the positions of the connected shapes`;
}

// ---------------------------------------------------------------------------
// Phase 4: Correction Prompt
// ---------------------------------------------------------------------------

export function buildCorrectionPrompt(
    currentJson: string,
    issues: ValidationIssue[],
    plan: DiagramPlan,
): string {
    const issueList = issues
        .map(
            (issue, i) =>
                `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description}` +
                (issue.elementId ? ` (element: ${issue.elementId})` : ""),
        )
        .join("\n");

    return `You are fixing issues in an Excalidraw diagram. The diagram was generated from a DiagramPlan but has the following problems.

FIX ONLY the listed issues. Preserve all correct elements. Output the complete corrected Excalidraw JSON.

ISSUES TO FIX:
${issueList}

REFERENCE — ORIGINAL DIAGRAM PLAN:
${JSON.stringify(plan, null, 2)}

ELEMENT ID CONVENTION (must be followed):
- Plan node "nX" → shape element "shape-nX", text element "text-nX"
- Plan group "gX" → group rectangle "group-gX", label "grouplabel-gX"
- Plan edge "eX" → arrow "arrow-eX", label "arrowlabel-eX"

CURRENT EXCALIDRAW JSON (fix this and return the corrected version):
${currentJson}

RULES:
- Output ONLY valid JSON — no markdown fences, no explanation
- Every shape must have a paired text element with matching geometry
- Every arrow must have valid startBinding and endBinding referencing existing elements
- Group children must be spatially inside their group rectangle
- No overlapping shapes`;
}

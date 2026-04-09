// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResult,
    createActionResultFromTextDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import { openai } from "aiclient";
import {
    CreateDiagramAction,
    ExcalidrawAction,
    ExportDiagramAction,
} from "./excalidrawActionSchema.js";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function instantiate(): AppAgent {
    return {
        executeAction: executeExcalidrawAction,
    };
}

type ExcalidrawActionContext = {
    store: undefined;
};

async function executeExcalidrawAction(
    action: AppAction,
    context: ActionContext<ExcalidrawActionContext>,
): Promise<ActionResult> {
    return handleExcalidrawAction(action as ExcalidrawAction, context);
}

async function handleExcalidrawAction(
    action: ExcalidrawAction,
    context: ActionContext<ExcalidrawActionContext>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "createDiagram":
            return handleCreateDiagram(action as CreateDiagramAction, context);
        case "exportDiagram":
            return handleExportDiagram(action as ExportDiagramAction);
        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
}

function getDefaultOutputDir(): string {
    // Use Documents folder, works on Windows (%USERPROFILE%\Documents) and Unix (~Documents)
    const documentsDir = path.join(os.homedir(), "Documents");
    if (!fs.existsSync(documentsDir)) {
        fs.mkdirSync(documentsDir, { recursive: true });
    }
    return documentsDir;
}

function sanitizeFilename(name: string): string {
    return name
        .replace(/[<>:"/\\|?*]/g, "_")
        .replace(/\s+/g, "_")
        .substring(0, 100);
}

function resolveOutputPath(
    outputPath: string | undefined,
    diagramTitle: string | undefined,
): string {
    if (outputPath) {
        // Ensure it has .excalidraw extension
        if (!outputPath.endsWith(".excalidraw")) {
            outputPath += ".excalidraw";
        }
        return path.resolve(outputPath);
    }

    const title = diagramTitle ?? "diagram";
    const filename = `${sanitizeFilename(title)}_${Date.now()}.excalidraw`;
    return path.join(getDefaultOutputDir(), filename);
}

function buildMermaidSystemPrompt(sourceType: string): string {
    return `You are an expert at reading documents and extracting their structure as a complete Mermaid flowchart.

Your ONLY output is a valid Mermaid flowchart — no explanations, no markdown fences, just the raw Mermaid syntax starting with "flowchart TD" or "flowchart LR".

RULES:
- Capture EVERY node, relationship, and label present in the source — do not simplify or omit anything
- Use quoted labels on nodes and edges so spaces and special characters are safe: A["My Label"]
- Use --> for directed edges, -- label --> for labelled edges
- Use subgraph ... end to represent groups or layers
- Prefer top-down (TD) layout unless the content is clearly horizontal

SOURCE CONTENT TYPE: ${sourceType}
- If "markdown": headings become top-level nodes, bullet points become child nodes, nested bullets become sub-children
- If "text": identify all named concepts and their relationships; model causality/dependency as directed edges
- If "visio-xml": faithfully reproduce the shapes and connectors from the XML
- If "mermaid": output it unchanged (it is already Mermaid)
- If "architecture": represent every component, layer, and data-flow arrow`;
}

function buildExcalidrawSystemPrompt(): string {
    return `You are a mechanical converter from Mermaid flowchart syntax to Excalidraw JSON.
You receive a complete Mermaid flowchart and must produce a valid Excalidraw JSON file that faithfully represents every node and edge. Do not omit anything.

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

ELEMENT TYPES:
- "rectangle" — regular nodes
- "diamond" — decision/condition nodes (Mermaid {braces})
- "ellipse" — terminal/start/end nodes (Mermaid stadium or circle)
- "text" — bound label for a shape (containerId set) or standalone text
- "arrow" — directed edge

ELEMENT STRUCTURE (every field required):
{
  "id": "<unique-string>",
  "type": "<type>",
  "x": <number>, "y": <number>, "width": <number>, "height": <number>,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "<color>",
  "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
  "roughness": 1, "opacity": 100,
  "seed": <random-int>, "version": 1, "versionNonce": <random-int>,
  "isDeleted": false, "boundElements": [], "updated": 1,
  "link": null, "locked": false, "groupIds": [], "frameId": null,
  "roundness": { "type": 3 }
}

TEXT elements also need:
  "text": "<label>", "fontSize": 20, "fontFamily": 1,
  "textAlign": "center", "verticalAlign": "middle", "baseline": 18,
  "containerId": "<shape-id> or null"

ARROW elements also need:
  "points": [[0,0],[dx,dy]],
  "startBinding": { "elementId": "<id>", "focus": 0, "gap": 8 },
  "endBinding":   { "elementId": "<id>", "focus": 0, "gap": 8 },
  "startArrowhead": null, "endArrowhead": "arrow"

SIZING SHAPES TO FIT TEXT:
- Estimate ~12px per character at fontSize 20
- Add 48px horizontal padding (24px each side) and 32px vertical padding (16px each side)
- Minimum size: 120 × 60px
- Example: "Hello World" (11 chars) → width = max(11×12+48, 120) = 180, height = 60

BOUND TEXT GEOMETRY — CRITICAL:
- Every shape with a label needs a paired text element
- The text element's x, y, width, height must EXACTLY match the container shape
- Set "containerId" on the text to the shape's id
- Add {"id": "<text-id>", "type": "text"} to the shape's "boundElements"

ARROW GEOMETRY — CRITICAL:
- Endpoints must land on the EDGE of shapes, not the center
- For an arrow from shape A to shape B:
  - Compute centre of A: (A.x + A.w/2, A.y + A.h/2), centre of B similarly
  - Start point = where the ray from A-centre toward B-centre exits A's rectangle
  - End point   = where that ray enters B's rectangle
  - Arrow x,y = start point; points = [[0,0],[endX-startX, endY-startY]]
- Add the arrow id to boundElements of both A and B: {"id":"<arrow-id>","type":"arrow"}
- Both startBinding.elementId and endBinding.elementId must be real ids in the elements array

LAYOUT:
- Top-down or left-to-right flow matching the Mermaid layout direction
- Large concept nodes at least 150px apart edge-to-edge
- Account for shape width+height when placing nodes — no overlaps
- Use subgraph boundaries as visual grouping (add a lightly-filled rectangle behind the group)
- Colors:
  "#a5d8ff" primary components · "#b2f2bb" data/storage · "#ffd8a8" external services
  "#d0bfff" processing/logic · "#ffc9c9" errors/alerts · "#fff3bf" notes/annotations

SELF-REVIEW before outputting:
1. Every node in the Mermaid has a corresponding shape + bound text element
2. Every edge in the Mermaid has a corresponding arrow with valid startBinding and endBinding
3. No two shapes overlap
4. All text fits its container (check width)
5. Every id referenced in a binding or containerId exists in the elements array`;
}

/**
 * Returns the point on the border of a rectangle (cx±w/2, cy±h/2) that is
 * closest to the given external point (tx, ty).  The rectangle is axis-aligned.
 */
function edgePoint(
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    tx: number,
    ty: number,
): [number, number] {
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const dx = tx - cx;
    const dy = ty - cy;

    // Avoid division-by-zero for overlapping centres
    if (dx === 0 && dy === 0) return [cx, ry]; // top-centre fallback

    // Scale factor so the ray from centre just reaches the rectangle edge
    const scaleX = dx !== 0 ? rw / 2 / Math.abs(dx) : Infinity;
    const scaleY = dy !== 0 ? rh / 2 / Math.abs(dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);

    return [cx + dx * scale, cy + dy * scale];
}

/**
 * Post-generation repair pass: fixes common issues LLMs produce.
 * - Flags arrows whose startBinding/endBinding point to non-existent element ids
 * - Ensures every shape referenced by an arrow has that arrow in its boundElements
 * - Ensures every text element's containerId (if set) exists
 * - Ensures shapes have boundElements as an array (not null) when they have bindings
 * Returns a list of warning strings describing what was fixed.
 */
function repairExcalidrawDiagram(doc: ExcalidrawDocument): string[] {
    const warnings: string[] = [];
    const elementIds = new Set(doc.elements.map((e) => e.id));
    const elementById = new Map(doc.elements.map((e) => [e.id, e]));

    // Fix arrows
    const validElements: ExcalidrawElement[] = [];
    for (const el of doc.elements) {
        if (el.type === "arrow" || el.type === "line") {
            const startId = (el.startBinding as any)?.elementId;
            const endId = (el.endBinding as any)?.elementId;

            // Flag arrows with broken bindings with a visible error label
            const brokenReasons: string[] = [];
            if (startId && !elementIds.has(startId)) {
                brokenReasons.push(`startBinding refs missing "${startId}"`);
                el.startBinding = null;
            }
            if (endId && !elementIds.has(endId)) {
                brokenReasons.push(`endBinding refs missing "${endId}"`);
                el.endBinding = null;
            }
            if (brokenReasons.length > 0) {
                const labelId = `error-label-${el.id}`;
                const errorLabel: ExcalidrawElement = {
                    id: labelId,
                    type: "text",
                    x: el.x,
                    y: el.y - 30,
                    width: 300,
                    height: 40,
                    angle: 0,
                    strokeColor: "#e03131",
                    backgroundColor: "transparent",
                    fillStyle: "solid",
                    strokeWidth: 1,
                    strokeStyle: "solid",
                    roughness: 0,
                    opacity: 100,
                    seed: Math.floor(Math.random() * 1000000),
                    version: 1,
                    versionNonce: Math.floor(Math.random() * 1000000),
                    isDeleted: false,
                    boundElements: null,
                    updated: 1,
                    link: null,
                    locked: false,
                    groupIds: [],
                    frameId: null,
                    roundness: null,
                    text: "ERROR: FIX ME",
                    fontSize: 20,
                    fontFamily: 1,
                    textAlign: "left",
                    verticalAlign: "top",
                    baseline: 18,
                    containerId: null,
                };
                validElements.push(errorLabel);
                elementIds.add(labelId);
                warnings.push(
                    `Arrow "${el.id}" has broken bindings (${brokenReasons.join("; ")}); added ERROR label`,
                );
            }

            // Ensure connected shapes list this arrow in their boundElements
            for (const connectedId of [startId, endId]) {
                if (!connectedId) continue;
                const shape = elementById.get(connectedId);
                if (!shape) continue;
                if (!Array.isArray(shape.boundElements)) {
                    shape.boundElements = [];
                }
                const already = (shape.boundElements as any[]).some(
                    (b: any) => b.id === el.id,
                );
                if (!already) {
                    (shape.boundElements as any[]).push({
                        id: el.id,
                        type: el.type,
                    });
                    warnings.push(
                        `Added arrow "${el.id}" to boundElements of shape "${connectedId}"`,
                    );
                }
            }

            // Recompute arrow geometry so endpoints land on shape edges, not centers.
            // Re-read startId/endId after the broken-binding pass (they may have been nulled).
            const fixedStartId = (el.startBinding as any)?.elementId as
                | string
                | undefined;
            const fixedEndId = (el.endBinding as any)?.elementId as
                | string
                | undefined;
            const startShape = fixedStartId
                ? elementById.get(fixedStartId)
                : undefined;
            const endShape = fixedEndId
                ? elementById.get(fixedEndId)
                : undefined;

            if (startShape && endShape) {
                const startCx = startShape.x + startShape.width / 2;
                const startCy = startShape.y + startShape.height / 2;
                const endCx = endShape.x + endShape.width / 2;
                const endCy = endShape.y + endShape.height / 2;

                const [sx, sy] = edgePoint(
                    startShape.x,
                    startShape.y,
                    startShape.width,
                    startShape.height,
                    endCx,
                    endCy,
                );
                const [ex, ey] = edgePoint(
                    endShape.x,
                    endShape.y,
                    endShape.width,
                    endShape.height,
                    startCx,
                    startCy,
                );

                // Arrow origin is the start edge point; points are relative to that origin
                el.x = sx;
                el.y = sy;
                el.width = Math.abs(ex - sx);
                el.height = Math.abs(ey - sy);
                el.points = [
                    [0, 0],
                    [ex - sx, ey - sy],
                ];
            }
        }

        // Fix text elements whose containerId is broken
        if (el.type === "text") {
            const cid = el.containerId as string | null | undefined;
            if (cid && !elementIds.has(cid)) {
                warnings.push(
                    `Cleared containerId on text "${el.id}": referenced missing element "${cid}"`,
                );
                el.containerId = null;
            } else if (cid) {
                // Snap text geometry to match its container exactly
                const container = elementById.get(cid);
                if (container) {
                    if (
                        el.x !== container.x ||
                        el.y !== container.y ||
                        el.width !== container.width ||
                        el.height !== container.height
                    ) {
                        el.x = container.x;
                        el.y = container.y;
                        el.width = container.width;
                        el.height = container.height;
                        warnings.push(
                            `Snapped text "${el.id}" geometry to match container "${cid}"`,
                        );
                    }
                }
            }
        }

        validElements.push(el);
    }

    doc.elements = validElements;
    return warnings;
}

async function handleCreateDiagram(
    action: CreateDiagramAction,
    context: ActionContext<ExcalidrawActionContext>,
): Promise<ActionResult> {
    const { sourceContent, diagramTitle, outputPath } = action.parameters;
    let { sourceType } = action.parameters;

    // Show loading indicator
    context.actionIO.setDisplay({
        type: "html",
        content: `
        <div style="loading-container">
        <div class="loading"><div class="loading-inner first"></div><div class="loading-inner second"></div><div class="loading-inner third"></div></div>
        <div class="generating">Generating Excalidraw diagram...</div>
        </div>`,
    });

    try {
        // If sourceContent looks like a file path and that file exists, read it
        let resolvedContent = sourceContent;
        const trimmed = sourceContent.trim();
        const looksLikePath =
            /^[a-zA-Z]:[/\\]/.test(trimmed) || // Windows absolute: C:\... or C:/...
            trimmed.startsWith("/") || // Unix absolute
            trimmed.startsWith("./") || // relative
            trimmed.startsWith("../") || // relative parent
            (trimmed.length < 512 && /\.(md|txt|xml|json)$/i.test(trimmed)); // short string ending in a known extension
        if (looksLikePath) {
            const candidate = path.resolve(trimmed);
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                resolvedContent = fs.readFileSync(candidate, "utf-8");
                // Auto-detect sourceType from extension if not already specific
                if (sourceType === "text" && /\.md$/i.test(candidate)) {
                    sourceType = "markdown";
                }
            }
        }

        // --- Pass 1: extract full structure as Mermaid (cheap tokens, complete content) ---
        context.actionIO.setDisplay({
            type: "html",
            content: `<div class="generating">Step 1/2: Extracting diagram structure...</div>`,
        });

        const mermaidModel = openai.createChatModel();
        const mermaidResponse = await mermaidModel.complete([
            {
                role: "system",
                content: buildMermaidSystemPrompt(sourceType),
            },
            {
                role: "user",
                content: `Convert the following ${sourceType} content into a complete Mermaid flowchart:\n\n${resolvedContent}`,
            },
        ]);

        if (!mermaidResponse.success) {
            return createActionResultFromError(
                `Failed to extract diagram structure: ${mermaidResponse.message}`,
            );
        }

        const mermaidDiagram = mermaidResponse.data.trim();

        // --- Pass 2: convert Mermaid → Excalidraw JSON (mechanical translation) ---
        context.actionIO.setDisplay({
            type: "html",
            content: `<div class="generating">Step 2/2: Generating Excalidraw diagram...</div>`,
        });

        const excalidrawModel = openai.createJsonChatModel();
        const response = await excalidrawModel.complete([
            { role: "system", content: buildExcalidrawSystemPrompt() },
            {
                role: "user",
                content: `Convert this Mermaid flowchart to Excalidraw JSON:\n\n${mermaidDiagram}`,
            },
        ]);

        // Clear loading display
        context.actionIO.setDisplay({ type: "html", content: "" });

        if (!response.success) {
            return createActionResultFromError(
                `Failed to generate Excalidraw JSON: ${response.message}`,
            );
        }

        // Parse and validate the Excalidraw JSON
        let excalidrawData: ExcalidrawDocument;
        try {
            excalidrawData = JSON.parse(response.data);
        } catch {
            return createActionResultFromError(
                "The AI returned invalid JSON. Please try again with clearer input.",
            );
        }

        // Ensure required top-level fields
        if (!excalidrawData.type) {
            excalidrawData.type = "excalidraw";
        }
        if (!excalidrawData.version) {
            excalidrawData.version = 2;
        }
        if (!excalidrawData.source) {
            excalidrawData.source = "typeagent-excalidraw";
        }
        if (!excalidrawData.elements) {
            excalidrawData.elements = [];
        }
        if (!excalidrawData.appState) {
            excalidrawData.appState = {
                gridSize: null,
                viewBackgroundColor: "#ffffff",
            };
        }
        if (!excalidrawData.files) {
            excalidrawData.files = {};
        }

        // Repair common LLM output issues (broken arrow bindings, missing boundElements, etc.)
        const repairWarnings = repairExcalidrawDiagram(excalidrawData);

        // Write the file
        const resolvedPath = resolveOutputPath(outputPath, diagramTitle);
        const outputDir = path.dirname(resolvedPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const jsonOutput = JSON.stringify(excalidrawData, null, 2);
        fs.writeFileSync(resolvedPath, jsonOutput, "utf-8");

        const elementCount = excalidrawData.elements.length;
        const displayTitle = diagramTitle ?? "Excalidraw diagram";

        const warningNote =
            repairWarnings.length > 0
                ? `\n\n⚠️ Auto-repaired ${repairWarnings.length} issue(s):\n` +
                  repairWarnings.map((w) => `  • ${w}`).join("\n")
                : "";

        const result = createActionResultFromTextDisplay(
            `📐 ${displayTitle} created successfully!\n\n` +
                `📁 Saved to: ${resolvedPath}\n` +
                `📊 Elements: ${elementCount}\n` +
                `📄 Source type: ${sourceType}` +
                warningNote +
                `\n\nOpen the .excalidraw file in Excalidraw (https://excalidraw.com) to view and edit.`,
            `Created Excalidraw diagram "${displayTitle}" with ${elementCount} elements at ${resolvedPath}`,
        );

        result.entities.push({
            name: path.basename(resolvedPath),
            type: ["file", "diagram", "excalidraw"],
        });

        return result;
    } catch (error) {
        // Clear loading display on error
        context.actionIO.setDisplay({
            type: "html",
            content: "",
        });

        const errorMessage =
            error instanceof Error ? error.message : String(error);
        return createActionResultFromError(
            `Failed to create diagram: ${errorMessage}`,
        );
    }
}

function handleExportDiagram(action: ExportDiagramAction): ActionResult {
    const { excalidrawJson, outputPath } = action.parameters;

    try {
        // Validate JSON
        let parsed: ExcalidrawDocument;
        try {
            parsed = JSON.parse(excalidrawJson);
        } catch {
            return createActionResultFromError(
                "The provided Excalidraw JSON is not valid JSON.",
            );
        }

        // Ensure required top-level fields
        if (!parsed.type) {
            parsed.type = "excalidraw";
        }
        if (!parsed.version) {
            parsed.version = 2;
        }

        const resolvedPath = resolveOutputPath(outputPath, undefined);
        const outputDir = path.dirname(resolvedPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const jsonOutput = JSON.stringify(parsed, null, 2);
        fs.writeFileSync(resolvedPath, jsonOutput, "utf-8");

        const result = createActionResult(
            `Excalidraw diagram exported to: ${resolvedPath}`,
        );

        result.entities.push({
            name: path.basename(resolvedPath),
            type: ["file", "diagram", "excalidraw"],
        });

        return result;
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        return createActionResultFromError(
            `Failed to export diagram: ${errorMessage}`,
        );
    }
}

// Type definition for the Excalidraw document format
interface ExcalidrawDocument {
    type?: string;
    version?: number;
    source?: string;
    elements: ExcalidrawElement[];
    appState?: {
        gridSize: number | null;
        viewBackgroundColor: string;
    };
    files?: Record<string, unknown>;
}

interface ExcalidrawElement {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    [key: string]: unknown;
}

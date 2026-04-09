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

function buildSystemPrompt(sourceType: string): string {
    return `You are an expert diagram generator. Your task is to convert the provided content into a valid Excalidraw JSON diagram.

OUTPUT FORMAT:
You MUST output ONLY valid JSON in Excalidraw format. Do NOT include any markdown code fences, explanations, or text outside the JSON.

The JSON must have this top-level structure:
{
  "type": "excalidraw",
  "version": 2,
  "source": "typeagent-excalidraw",
  "elements": [...],
  "appState": {
    "gridSize": null,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}

ELEMENT TYPES you can use:
1. "rectangle" - for boxes/containers/nodes
2. "ellipse" - for circular/oval nodes
3. "diamond" - for decision points
4. "text" - for labels (can be standalone or bound to shapes)
5. "arrow" - for connections/relationships between elements
6. "line" - for non-directional connections

ELEMENT STRUCTURE (required fields for each element):
{
  "id": "<unique-string-id>",
  "type": "<element-type>",
  "x": <number>,
  "y": <number>,
  "width": <number>,
  "height": <number>,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "<color>",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "seed": <random-integer>,
  "version": 1,
  "versionNonce": <random-integer>,
  "isDeleted": false,
  "boundElements": null,
  "updated": 1,
  "link": null,
  "locked": false,
  "groupIds": [],
  "frameId": null,
  "roundness": { "type": 3 }
}

For TEXT elements, also include:
  "text": "<the text>",
  "fontSize": 20,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "baseline": 18,
  "containerId": null (or the id of the shape it's bound to)

SIZING SHAPES TO FIT TEXT:
- Estimate text width: each character is approximately 12px wide at fontSize 20, with a minimum of 100px
- Estimate text height: each line of text is approximately 28px tall at fontSize 20
- For multi-line text, count the lines and multiply
- Add padding of at least 24px on each horizontal side and 16px on each vertical side
- So for text "Hello World" (11 chars × 12px = 132px), the shape width should be at least 132 + 48 = 180px
- For shapes with longer text, increase width proportionally; never let text overflow its container
- Minimum shape dimensions: width 120px, height 60px

For ARROW elements, also include:
  "points": [[0, 0], [<dx>, <dy>]],
  "startBinding": { "elementId": "<source-id>", "focus": 0, "gap": 8 },
  "endBinding": { "elementId": "<target-id>", "focus": 0, "gap": 8 },
  "startArrowhead": null,
  "endArrowhead": "arrow"

ARROW BINDING RULES (critical — broken arrows ruin the diagram):
- Every arrow MUST have both "startBinding" and "endBinding" set (never null unless intentionally floating)
- "startBinding.elementId" must match the "id" of an existing shape element in the diagram
- "endBinding.elementId" must match the "id" of an existing shape element in the diagram
- On each shape that an arrow connects to, add the arrow's id to the shape's "boundElements" array:
  "boundElements": [{"id": "<text-id>", "type": "text"}, {"id": "<arrow-id>", "type": "arrow"}]
- Arrow endpoints must land on the EDGE of their connected shapes, NOT at the center:
  - Compute the centre of the source shape (sx = x + w/2, sy = y + h/2) and the centre of the target shape (tx = x + w/2, ty = y + h/2)
  - The start point of the arrow is where the ray from source centre toward target centre exits the source rectangle
  - The end point of the arrow is where that same ray enters the target rectangle
  - Set the arrow's "x","y" to the start edge point
  - Set points[0] to [0, 0] and points[1] to [endX - startX, endY - startY]
- Always verify that every elementId in startBinding/endBinding refers to a real shape id in the elements array

To bind text to a shape:
- On the shape element, set "boundElements": [{"id": "<text-id>", "type": "text"}]
- On the text element, set "containerId": "<shape-id>"
- The text element's x, y, width, and height MUST exactly match the container shape:
  - "x": same as container x
  - "y": same as container y
  - "width": same as container width
  - "height": same as container height
  Excalidraw requires these to match for correct initial placement — do NOT use offsets or center-point coordinates

ARROW LABEL TEXT:
- If an arrow needs a label, create a text element with "containerId": "<arrow-id>" and add {"id": "<label-id>", "type": "text"} to the arrow's "boundElements"
- Size the label text element to fit its content using the same character-width estimate above

LAYOUT GUIDELINES:
- For "large concept" elements (primary nodes, major components, top-level headings): place them at least 96px (roughly 1 inch at 96 DPI) apart edge-to-edge, preferably 150–200px
- For smaller sub-elements or annotations: at least 60px apart edge-to-edge
- Use a left-to-right or top-to-bottom flow layout
- Avoid overlapping elements; account for element width and height when computing positions, not just (x, y) origins
- Group related items visually
- Use colors to distinguish different categories:
  - "#a5d8ff" (light blue) for primary components
  - "#b2f2bb" (light green) for data/storage
  - "#ffd8a8" (light orange) for external services
  - "#d0bfff" (light purple) for processing/logic
  - "#ffc9c9" (light red) for errors/alerts
  - "#fff3bf" (light yellow) for notes/annotations

SOURCE CONTENT TYPE: ${sourceType}
- If "markdown": Parse headings as major nodes, bullet points as sub-nodes, and create hierarchy
- If "text": Identify key concepts, entities, and relationships to create a concept diagram
- If "visio-xml": Parse the XML structure to recreate the diagram layout with shapes and connectors
- If "mermaid": Parse Mermaid syntax (flowchart, sequence, etc.) and convert to Excalidraw elements
- If "architecture": Create an architecture diagram with components, layers, and data flow arrows

SELF-REVIEW CHECKLIST (apply before outputting):
1. Every shape with a label has a bound text element (boundElements contains the text id, text has containerId set)
2. Every arrow has both startBinding and endBinding referencing real element ids in the elements array
3. Every shape connected by an arrow lists that arrow id in its boundElements array
4. No two elements overlap (check x, y, width, height for all pairs)
5. All text fits within its container shape (shape width/height is large enough per the sizing rules above)
6. Arrow labels (if any) have containerId pointing to the arrow id
7. No dangling element ids — every id referenced anywhere exists as an element in the array

Generate a clean, well-organized diagram that visually represents the content. If anything in the source content is ambiguous (e.g. unclear direction of a relationship, unclear grouping), ask the user for clarification rather than guessing.`;
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
        const chatModel = openai.createJsonChatModel();

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

        const systemPrompt = buildSystemPrompt(sourceType);
        const userPrompt = `Convert the following ${sourceType} content into an Excalidraw diagram:\n\n${resolvedContent}`;

        const response = await chatModel.complete([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ]);

        // Clear loading display
        context.actionIO.setDisplay({
            type: "html",
            content: "",
        });

        if (!response.success) {
            return createActionResultFromError(
                `Failed to generate diagram: ${response.message}`,
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

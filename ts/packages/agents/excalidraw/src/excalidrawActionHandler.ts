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
import { DiagramPlan } from "./diagramPlan.js";
import { validateDiagram, ValidationResult } from "./diagramValidator.js";
import {
    buildPlanExtractionPrompt,
    buildExcalidrawGenerationPrompt,
    buildCorrectionPrompt,
} from "./prompts.js";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_CORRECTION_ITERATIONS = 3;

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

function getDefaultOutputDir(): string {
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
        if (!outputPath.endsWith(".excalidraw")) {
            outputPath += ".excalidraw";
        }
        return path.resolve(outputPath);
    }

    const title = diagramTitle ?? "diagram";
    const filename = `${sanitizeFilename(title)}_${Date.now()}.excalidraw`;
    return path.join(getDefaultOutputDir(), filename);
}

function resolveSourceContent(
    sourceContent: string,
    sourceType: string,
): { content: string; type: string } {
    const trimmed = sourceContent.trim();
    const looksLikePath =
        /^[a-zA-Z]:[/\\]/.test(trimmed) ||
        trimmed.startsWith("/") ||
        trimmed.startsWith("./") ||
        trimmed.startsWith("../") ||
        (trimmed.length < 512 && /\.(md|txt|xml|json)$/i.test(trimmed));

    if (looksLikePath) {
        const candidate = path.resolve(trimmed);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            const content = fs.readFileSync(candidate, "utf-8");
            let resolvedType = sourceType;
            if (sourceType === "text" && /\.md$/i.test(candidate)) {
                resolvedType = "markdown";
            }
            return { content, type: resolvedType };
        }
    }

    return { content: sourceContent, type: sourceType };
}

// ---------------------------------------------------------------------------
// Geometry helpers for arrow repair
// ---------------------------------------------------------------------------

/**
 * Returns the point on the border of a rectangle (rx, ry, rw, rh) that is
 * closest to the given external target point (tx, ty).
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

    if (dx === 0 && dy === 0) return [cx, ry]; // top-centre fallback

    const scaleX = dx !== 0 ? rw / 2 / Math.abs(dx) : Infinity;
    const scaleY = dy !== 0 ? rh / 2 / Math.abs(dy) : Infinity;
    const scale = Math.min(scaleX, scaleY);

    return [cx + dx * scale, cy + dy * scale];
}

// ---------------------------------------------------------------------------
// Mechanical repair pass (post-processing safety net)
// ---------------------------------------------------------------------------

/**
 * Post-generation repair pass: fixes common issues LLMs produce.
 * This is the final safety net after iterative correction.
 * - Fixes arrows whose bindings point to non-existent element ids
 * - Ensures connected shapes list their arrows in boundElements
 * - Ensures text containerId references exist
 * - Recomputes arrow geometry for valid connections
 * Returns a list of warning strings describing what was fixed.
 */
function repairExcalidrawDiagram(doc: ExcalidrawDocument): string[] {
    const warnings: string[] = [];
    const elementIds = new Set(doc.elements.map((e) => e.id));
    const elementById = new Map(doc.elements.map((e) => [e.id, e]));

    const validElements: ExcalidrawElement[] = [];
    for (const el of doc.elements) {
        if (el.type === "arrow" || el.type === "line") {
            const startId = (el.startBinding as any)?.elementId;
            const endId = (el.endBinding as any)?.elementId;

            // Null out broken bindings
            if (startId && !elementIds.has(startId)) {
                warnings.push(
                    `Arrow "${el.id}": cleared broken startBinding to "${startId}"`,
                );
                el.startBinding = null;
            }
            if (endId && !elementIds.has(endId)) {
                warnings.push(
                    `Arrow "${el.id}": cleared broken endBinding to "${endId}"`,
                );
                el.endBinding = null;
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
                        `Added arrow "${el.id}" to boundElements of "${connectedId}"`,
                    );
                }
            }

            // Recompute arrow geometry so endpoints land on shape edges
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
                    `Cleared containerId on text "${el.id}": referenced missing "${cid}"`,
                );
                el.containerId = null;
            } else if (cid) {
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
                            `Snapped text "${el.id}" geometry to container "${cid}"`,
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

// ---------------------------------------------------------------------------
// Main pipeline: handleCreateDiagram
// ---------------------------------------------------------------------------

async function handleCreateDiagram(
    action: CreateDiagramAction,
    context: ActionContext<ExcalidrawActionContext>,
): Promise<ActionResult> {
    const { sourceContent, diagramTitle, outputPath } = action.parameters;
    const { sourceType: rawSourceType } = action.parameters;

    // Show loading indicator
    const setStatus = (message: string) => {
        context.actionIO.setDisplay({
            type: "html",
            content: `<div class="generating">${message}</div>`,
        });
    };

    setStatus("Initializing diagram generation...");

    try {
        // 0. Resolve source content (read files if path provided)
        const resolved = resolveSourceContent(sourceContent, rawSourceType);
        const resolvedContent = resolved.content;
        const sourceType = resolved.type;

        // ---------------------------------------------------------------
        // Phase 1: Extract DiagramPlan from source content
        // ---------------------------------------------------------------
        setStatus(
            "Step 1/3: Analyzing content and extracting diagram structure...",
        );

        const planModel = openai.createJsonChatModel();
        const planResponse = await planModel.complete([
            {
                role: "system",
                content: buildPlanExtractionPrompt(sourceType),
            },
            {
                role: "user",
                content: `Analyze the following ${sourceType} content and produce a complete DiagramPlan JSON:\n\n${resolvedContent}`,
            },
        ]);

        if (!planResponse.success) {
            return createActionResultFromError(
                `Failed to extract diagram structure: ${planResponse.message}`,
            );
        }

        let plan: DiagramPlan;
        try {
            plan = JSON.parse(stripMarkdownFences(planResponse.data));
        } catch {
            return createActionResultFromError(
                "Failed to parse DiagramPlan from AI response. The model returned invalid JSON.",
            );
        }

        // Basic plan validation
        if (!plan.nodes || plan.nodes.length === 0) {
            return createActionResultFromError(
                "The AI extracted an empty diagram plan with no nodes. Please provide clearer input content.",
            );
        }
        if (!plan.edges) plan.edges = [];
        if (!plan.groups) plan.groups = [];
        if (!plan.layoutDirection) plan.layoutDirection = "TD";
        if (!plan.title) plan.title = diagramTitle ?? "Diagram";

        // ---------------------------------------------------------------
        // Phase 2: Generate Excalidraw JSON from DiagramPlan
        // ---------------------------------------------------------------
        setStatus(
            `Step 2/3: Generating Excalidraw diagram (${plan.nodes.length} nodes, ${plan.edges.length} edges, ${plan.groups.length} groups)...`,
        );

        const excalidrawModel = openai.createJsonChatModel();
        const genResponse = await excalidrawModel.complete([
            { role: "system", content: buildExcalidrawGenerationPrompt() },
            {
                role: "user",
                content: `Convert this DiagramPlan to a complete Excalidraw JSON document:\n\n${JSON.stringify(plan, null, 2)}`,
            },
        ]);

        if (!genResponse.success) {
            return createActionResultFromError(
                `Failed to generate Excalidraw JSON: ${genResponse.message}`,
            );
        }

        let excalidrawData: ExcalidrawDocument;
        try {
            excalidrawData = JSON.parse(stripMarkdownFences(genResponse.data));
        } catch (parseErr) {
            const snippet = genResponse.data.slice(-200);
            return createActionResultFromError(
                `The AI returned invalid Excalidraw JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n\nLast 200 chars of response: ${snippet}`,
            );
        }

        ensureTopLevelFields(excalidrawData);

        // ---------------------------------------------------------------
        // Phase 3+4: Validate and iteratively correct
        // ---------------------------------------------------------------
        let validation: ValidationResult = validateDiagram(
            excalidrawData,
            plan,
        );
        let iterationCount = 0;

        while (
            !validation.valid &&
            iterationCount < MAX_CORRECTION_ITERATIONS
        ) {
            iterationCount++;
            const errorCount = validation.issues.filter(
                (i) => i.severity === "error",
            ).length;
            setStatus(
                `Step 3/3: Correcting ${errorCount} issues (iteration ${iterationCount}/${MAX_CORRECTION_ITERATIONS})...`,
            );

            const correctionModel = openai.createJsonChatModel();
            const correctionPrompt = buildCorrectionPrompt(
                JSON.stringify(excalidrawData, null, 2),
                validation.issues,
                plan,
            );

            const correctionResponse = await correctionModel.complete([
                {
                    role: "system",
                    content:
                        "You are an Excalidraw diagram repair agent. Fix the listed issues in the JSON and return the complete corrected Excalidraw JSON. Output ONLY valid JSON.",
                },
                {
                    role: "user",
                    content: correctionPrompt,
                },
            ]);

            if (!correctionResponse.success) {
                // If correction fails, break out and use what we have
                break;
            }

            try {
                const corrected: ExcalidrawDocument = JSON.parse(
                    stripMarkdownFences(correctionResponse.data),
                );
                ensureTopLevelFields(corrected);
                excalidrawData = corrected;
            } catch {
                // If corrected JSON is invalid, keep previous version
                break;
            }

            // Re-validate
            validation = validateDiagram(excalidrawData, plan);
        }

        // ---------------------------------------------------------------
        // Final mechanical repair pass (safety net)
        // ---------------------------------------------------------------
        const repairWarnings = repairExcalidrawDiagram(excalidrawData);

        // Clear loading display
        context.actionIO.setDisplay({ type: "html", content: "" });

        // ---------------------------------------------------------------
        // Save output
        // ---------------------------------------------------------------
        const resolvedPath = resolveOutputPath(outputPath, diagramTitle);
        const outputDir = path.dirname(resolvedPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const jsonOutput = JSON.stringify(excalidrawData, null, 2);
        fs.writeFileSync(resolvedPath, jsonOutput, "utf-8");

        // ---------------------------------------------------------------
        // Build result message
        // ---------------------------------------------------------------
        const elementCount = excalidrawData.elements.length;
        const displayTitle = diagramTitle ?? plan.title ?? "Excalidraw diagram";

        let statusDetails = "";

        // Validation stats
        const stats = validation.stats;
        statusDetails += `\n📊 Plan: ${stats.expectedNodes} nodes, ${stats.expectedEdges} edges, ${stats.expectedGroups} groups`;
        statusDetails += `\n📊 Generated: ${stats.foundNodes}/${stats.expectedNodes} nodes, ${stats.foundEdges}/${stats.expectedEdges} edges, ${stats.foundGroups}/${stats.expectedGroups} groups (${elementCount} total elements)`;

        if (iterationCount > 0) {
            statusDetails += `\n🔄 Correction iterations: ${iterationCount}`;
        }

        if (validation.valid) {
            statusDetails += `\n✅ Validation: PASSED`;
        } else {
            const remainingErrors = validation.issues.filter(
                (i) => i.severity === "error",
            ).length;
            const remainingWarnings = validation.issues.filter(
                (i) => i.severity === "warning",
            ).length;
            statusDetails += `\n⚠️ Validation: ${remainingErrors} errors, ${remainingWarnings} warnings remaining`;
        }

        if (repairWarnings.length > 0) {
            statusDetails += `\n🔧 Post-repair fixes: ${repairWarnings.length}`;
        }

        const result = createActionResultFromTextDisplay(
            `📐 ${displayTitle} created successfully!\n\n` +
                `📁 Saved to: ${resolvedPath}` +
                statusDetails +
                `\n\nOpen the .excalidraw file in Excalidraw (https://excalidraw.com) to view and edit.`,
            `Created Excalidraw diagram "${displayTitle}" with ${elementCount} elements at ${resolvedPath}`,
        );

        result.entities.push({
            name: path.basename(resolvedPath),
            type: ["file", "diagram", "excalidraw"],
        });

        return result;
    } catch (error) {
        context.actionIO.setDisplay({ type: "html", content: "" });
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        return createActionResultFromError(
            `Failed to create diagram: ${errorMessage}`,
        );
    }
}

// ---------------------------------------------------------------------------
// Export handler (unchanged)
// ---------------------------------------------------------------------------

function handleExportDiagram(action: ExportDiagramAction): ActionResult {
    const { excalidrawJson, outputPath } = action.parameters;

    try {
        let parsed: ExcalidrawDocument;
        try {
            parsed = JSON.parse(excalidrawJson);
        } catch {
            return createActionResultFromError(
                "The provided Excalidraw JSON is not valid JSON.",
            );
        }

        ensureTopLevelFields(parsed);

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips markdown code fences that some models emit even in json_object mode.
 * Handles ```json ... ```, ``` ... ```, and leading/trailing whitespace.
 */
function stripMarkdownFences(raw: string): string {
    const trimmed = raw.trim();
    const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    return match ? match[1].trim() : trimmed;
}

function ensureTopLevelFields(doc: ExcalidrawDocument): void {
    if (!doc.type) doc.type = "excalidraw";
    if (!doc.version) doc.version = 2;
    if (!doc.source) doc.source = "typeagent-excalidraw";
    if (!doc.elements) doc.elements = [];
    if (!doc.appState) {
        doc.appState = { gridSize: null, viewBackgroundColor: "#ffffff" };
    }
    if (!doc.files) doc.files = {};
}

// ---------------------------------------------------------------------------
// Type definitions for the Excalidraw document format
// ---------------------------------------------------------------------------

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

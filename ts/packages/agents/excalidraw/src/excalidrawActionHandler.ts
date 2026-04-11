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
import { DiagramPlan, MinimalDiagram, MinimalElement } from "./diagramPlan.js";
import { validateDiagram, ValidationResult } from "./diagramValidator.js";
import {
    buildPlanExtractionPrompt,
    buildMinimalDiagramPrompt,
    buildMinimalCorrectionPrompt,
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
// Geometry helpers for arrow computation
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
// expandToExcalidraw — convert MinimalDiagram → full Excalidraw document
// ---------------------------------------------------------------------------

/**
 * Expands a MinimalDiagram (compact LLM output) into a full Excalidraw
 * document with all required fields.  This is the key function that eliminates
 * the need for the LLM to generate verbose Excalidraw JSON.
 */
export function expandToExcalidraw(
    minimal: MinimalDiagram,
): ExcalidrawDocument {
    const elements: ExcalidrawElement[] = [];
    const elementMap = new Map<string, MinimalElement>();

    // Index minimal elements by id for arrow resolution
    for (const el of minimal.elements) {
        elementMap.set(el.id, el);
    }

    // Track which shape ids have which arrows bound to them
    const boundArrows = new Map<string, Array<{ id: string; type: string }>>();

    // First pass: identify arrow bindings so we can populate boundElements on shapes
    for (const el of minimal.elements) {
        if (el.type === "arrow") {
            if (el.from) {
                if (!boundArrows.has(el.from)) boundArrows.set(el.from, []);
                boundArrows.get(el.from)!.push({ id: el.id, type: "arrow" });
            }
            if (el.to) {
                if (!boundArrows.has(el.to)) boundArrows.set(el.to, []);
                boundArrows.get(el.to)!.push({ id: el.id, type: "arrow" });
            }
        }
    }

    // Index counter for element ordering
    let indexCounter = 0;
    function nextIndex(): string {
        const idx = indexCounter++;
        // Generate lexicographic indices: a0, a1, ..., a9, aA, ..., aZ, b0, ...
        return `a${idx}`;
    }

    // Second pass: expand each minimal element
    for (const el of minimal.elements) {
        if (el.type === "arrow") {
            // Handle arrows separately after shapes
            continue;
        }

        const w = el.w ?? 160;
        const h = el.h ?? 60;
        const excalidrawType = el.type === "frame" ? "rectangle" : el.type;

        // Build boundElements: text label + any connected arrows
        const bound: Array<{ id: string; type: string }> = [];
        const textId = el.id.startsWith("group-")
            ? `grouplabel-${el.id.substring("group-".length)}`
            : `text-${el.id.substring("shape-".length)}`;
        if (el.label) {
            bound.push({ id: textId, type: "text" });
        }
        const arrows = boundArrows.get(el.id) ?? [];
        bound.push(...arrows);

        // Determine styling for group frames vs regular shapes
        const isGroupFrame = el.type === "frame" || el.id.startsWith("group-");
        const bgColor = el.color ?? (isGroupFrame ? "#f8f9fa" : "transparent");
        const strokeStyleVal = el.style ?? (isGroupFrame ? "dashed" : "solid");
        const strokeWidthVal = isGroupFrame ? 1 : 2;
        const opacityVal = isGroupFrame ? 60 : 100;

        const shapeElement: ExcalidrawElement = {
            id: el.id,
            type: excalidrawType,
            x: el.x,
            y: el.y,
            width: w,
            height: h,
            angle: 0,
            strokeColor: "#1e1e1e",
            backgroundColor: bgColor,
            fillStyle: "solid",
            strokeWidth: strokeWidthVal,
            strokeStyle: strokeStyleVal,
            roughness: 1,
            opacity: opacityVal,
            groupIds: [],
            frameId: null,
            index: nextIndex(),
            seed: Math.floor(Math.random() * 100000),
            version: 1,
            versionNonce: 0,
            isDeleted: false,
            boundElements: bound,
            updated: Date.now(),
            link: null,
            locked: false,
            roundness: excalidrawType === "rectangle" ? { type: 3 } : null,
        };
        elements.push(shapeElement);

        // Generate paired text label element
        if (el.label) {
            const textElement: ExcalidrawElement = {
                id: textId,
                type: "text",
                x: el.x,
                y: el.y,
                width: w,
                height: h,
                angle: 0,
                strokeColor: "#1e1e1e",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 2,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                groupIds: [],
                frameId: null,
                index: nextIndex(),
                seed: Math.floor(Math.random() * 100000),
                version: 1,
                versionNonce: 0,
                isDeleted: false,
                boundElements: null,
                updated: Date.now(),
                link: null,
                locked: false,
                roundness: null,
                text: el.label,
                fontSize: isGroupFrame ? 16 : 20,
                fontFamily: 1,
                textAlign: isGroupFrame ? "left" : "center",
                verticalAlign: isGroupFrame ? "top" : "middle",
                baseline: 0,
                containerId: el.id,
                originalText: el.label,
                lineHeight: 1.25,
            };
            elements.push(textElement);
        }
    }

    // Third pass: expand arrows
    for (const el of minimal.elements) {
        if (el.type !== "arrow") continue;

        const fromEl = el.from ? elementMap.get(el.from) : undefined;
        const toEl = el.to ? elementMap.get(el.to) : undefined;

        // Compute arrow geometry from source/target positions
        let ax = el.x;
        let ay = el.y;
        let points: number[][] = [
            [0, 0],
            [100, 0],
        ]; // default fallback
        let arrowWidth = 100;
        let arrowHeight = 0;

        if (fromEl && toEl) {
            const fw = fromEl.w ?? 160;
            const fh = fromEl.h ?? 60;
            const tw = toEl.w ?? 160;
            const th = toEl.h ?? 60;

            const fromCx = fromEl.x + fw / 2;
            const fromCy = fromEl.y + fh / 2;
            const toCx = toEl.x + tw / 2;
            const toCy = toEl.y + th / 2;

            const [sx, sy] = edgePoint(fromEl.x, fromEl.y, fw, fh, toCx, toCy);
            const [ex, ey] = edgePoint(toEl.x, toEl.y, tw, th, fromCx, fromCy);

            ax = sx;
            ay = sy;
            points = [
                [0, 0],
                [ex - sx, ey - sy],
            ];
            arrowWidth = Math.abs(ex - sx);
            arrowHeight = Math.abs(ey - sy);
        }

        // Build arrow bindings
        const startBinding = el.from
            ? {
                  elementId: el.from,
                  focus: 0,
                  gap: 4,
              }
            : null;
        const endBinding = el.to
            ? {
                  elementId: el.to,
                  focus: 0,
                  gap: 4,
              }
            : null;

        // Build bound elements (arrow label text if any)
        const arrowBound: Array<{ id: string; type: string }> | null = el.label
            ? [
                  {
                      id: `arrowlabel-${el.id.substring("arrow-".length)}`,
                      type: "text",
                  },
              ]
            : null;

        const arrowElement: ExcalidrawElement = {
            id: el.id,
            type: "arrow",
            x: ax,
            y: ay,
            width: arrowWidth,
            height: arrowHeight,
            angle: 0,
            strokeColor: "#1e1e1e",
            backgroundColor: "transparent",
            fillStyle: "solid",
            strokeWidth: 2,
            strokeStyle: el.style ?? "solid",
            roughness: 1,
            opacity: 100,
            groupIds: [],
            frameId: null,
            index: nextIndex(),
            seed: Math.floor(Math.random() * 100000),
            version: 1,
            versionNonce: 0,
            isDeleted: false,
            boundElements: arrowBound,
            updated: Date.now(),
            link: null,
            locked: false,
            roundness: null,
            points,
            startBinding,
            endBinding,
            startArrowhead: null,
            endArrowhead: "arrow",
            lastCommittedPoint: null,
        };
        elements.push(arrowElement);

        // Generate arrow label text if the edge has a label
        if (el.label) {
            const labelId = `arrowlabel-${el.id.substring("arrow-".length)}`;
            // Position label at midpoint of arrow
            const midX = ax + points[1][0] / 2 - 30;
            const midY = ay + points[1][1] / 2 - 10;

            const arrowLabelElement: ExcalidrawElement = {
                id: labelId,
                type: "text",
                x: midX,
                y: midY,
                width: 60,
                height: 20,
                angle: 0,
                strokeColor: "#1e1e1e",
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 2,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                groupIds: [],
                frameId: null,
                index: nextIndex(),
                seed: Math.floor(Math.random() * 100000),
                version: 1,
                versionNonce: 0,
                isDeleted: false,
                boundElements: null,
                updated: Date.now(),
                link: null,
                locked: false,
                roundness: null,
                text: el.label,
                fontSize: 14,
                fontFamily: 1,
                textAlign: "center",
                verticalAlign: "middle",
                baseline: 0,
                containerId: el.id,
                originalText: el.label,
                lineHeight: 1.25,
            };
            elements.push(arrowLabelElement);
        }
    }

    return {
        type: "excalidraw",
        version: 2,
        source: "typeagent-excalidraw",
        elements,
        appState: {
            gridSize: null,
            viewBackgroundColor: "#ffffff",
        },
        files: {},
    };
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
        // Normalize group fields — LLM sometimes omits arrays
        for (const g of plan.groups) {
            if (!g.childNodeIds) g.childNodeIds = [];
            if (!g.childGroupIds) g.childGroupIds = [];
        }

        // ---------------------------------------------------------------
        // Phase 2: Generate MinimalDiagram from DiagramPlan, then expand
        // ---------------------------------------------------------------
        setStatus(
            `Step 2/3: Generating diagram layout (${plan.nodes.length} nodes, ${plan.edges.length} edges, ${plan.groups.length} groups)...`,
        );

        // Always use the minimal schema approach — it produces compact
        // output that fits within any model's token limit.
        const minimalModel = openai.createJsonChatModel();
        const minimalResponse = await minimalModel.complete([
            {
                role: "system",
                content: buildMinimalDiagramPrompt(),
            },
            {
                role: "user",
                content: `Convert this DiagramPlan to MinimalDiagram JSON:\n\n${JSON.stringify(plan, null, 2)}`,
            },
        ]);

        if (!minimalResponse.success) {
            return createActionResultFromError(
                `Failed to generate diagram layout: ${minimalResponse.message}`,
            );
        }

        let minimalDiagram: MinimalDiagram;
        try {
            minimalDiagram = parseJsonWithRecovery(
                minimalResponse.data,
            ) as MinimalDiagram;
        } catch (parseErr) {
            const snippet = minimalResponse.data.slice(-200);
            return createActionResultFromError(
                `The AI returned invalid MinimalDiagram JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n\nLast 200 chars of response: ${snippet}`,
            );
        }

        // Validate the minimal diagram has an elements array
        if (
            !minimalDiagram.elements ||
            !Array.isArray(minimalDiagram.elements)
        ) {
            return createActionResultFromError(
                "The AI returned a MinimalDiagram without an elements array.",
            );
        }

        // Expand MinimalDiagram → full Excalidraw JSON (deterministic, no LLM)
        let excalidrawData = expandToExcalidraw(minimalDiagram);

        ensureTopLevelFields(excalidrawData);

        // ---------------------------------------------------------------
        // Phase 3+4: Validate and iteratively correct
        // ---------------------------------------------------------------
        let validation: ValidationResult = validateDiagram(
            excalidrawData,
            plan,
        );
        let iterationCount = 0;

        // Keep track of the current minimal JSON for correction prompts
        let currentMinimalJson = JSON.stringify(minimalDiagram);

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

            // Ask the LLM to correct the MinimalDiagram (not full Excalidraw)
            // This keeps the correction in the compact format too
            const correctionModel = openai.createJsonChatModel();
            const correctionPrompt = buildMinimalCorrectionPrompt(
                currentMinimalJson,
                validation.issues,
                plan,
            );

            const correctionResponse = await correctionModel.complete([
                {
                    role: "system",
                    content:
                        "You are a diagram layout repair agent. Fix the listed issues in the MinimalDiagram JSON and return the corrected version. Output ONLY valid JSON.",
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
                const correctedMinimal: MinimalDiagram = parseJsonWithRecovery(
                    correctionResponse.data,
                ) as MinimalDiagram;

                if (
                    correctedMinimal.elements &&
                    Array.isArray(correctedMinimal.elements)
                ) {
                    minimalDiagram = correctedMinimal;
                    currentMinimalJson = JSON.stringify(correctedMinimal);

                    // Re-expand to full Excalidraw
                    excalidrawData = expandToExcalidraw(correctedMinimal);
                    ensureTopLevelFields(excalidrawData);
                } else {
                    break;
                }
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

// ---------------------------------------------------------------------------
// Default injection (Option B) — compact LLM output → full Excalidraw format
// (kept for backward compatibility with tests)
// ---------------------------------------------------------------------------

/** Default field values that the LLM is instructed to omit for compactness. */
const ELEMENT_DEFAULTS: Record<string, unknown> = {
    angle: 0,
    strokeColor: "#1e1e1e",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    isDeleted: false,
    locked: false,
    link: null,
    frameId: null,
    updated: 1,
    seed: 1,
    version: 1,
    versionNonce: 0,
    roundness: null,
    groupIds: [],
};

/**
 * Fills in any missing default fields on each element so the resulting
 * document is fully valid Excalidraw JSON. This allows the LLM to produce
 * compact output that omits fields matching their defaults.
 */
function injectDefaults(elements: Record<string, unknown>[]): void {
    for (const el of elements) {
        for (const [key, defaultValue] of Object.entries(ELEMENT_DEFAULTS)) {
            if (!(key in el)) {
                // Deep-clone arrays/objects so elements don't share references
                el[key] = Array.isArray(defaultValue)
                    ? [...defaultValue]
                    : defaultValue;
            }
        }
        // Ensure boundElements is at least an empty array
        if (!("boundElements" in el) || el.boundElements === undefined) {
            el.boundElements = [];
        }
        // Ensure backgroundColor has a value
        if (!("backgroundColor" in el) || el.backgroundColor === undefined) {
            el.backgroundColor = "transparent";
        }
    }
}

// ---------------------------------------------------------------------------
// Truncation recovery — last-ditch attempt to salvage truncated JSON
// ---------------------------------------------------------------------------

/**
 * Attempts to recover a truncated JSON string by:
 * 1. Finding the last complete object (closing `}`) before the truncation
 * 2. Closing any open arrays `]` and the outer object `}`
 *
 * Works for both top-level `{ "elements": [...] }` format and bare `[...]` arrays.
 * Returns the recovered string, or the original if recovery isn't applicable.
 */
function recoverTruncatedJson(raw: string): string {
    const trimmed = raw.trim();

    // If it already parses, nothing to do
    try {
        JSON.parse(trimmed);
        return trimmed;
    } catch {
        // continue to recovery
    }

    // Strategy: find the last `}` that could end a complete element,
    // then close out the array and/or outer object.
    const lastCloseBrace = trimmed.lastIndexOf("}");
    if (lastCloseBrace < 0) return raw;

    const truncated = trimmed.substring(0, lastCloseBrace + 1);

    // Determine what brackets need closing.
    // Count unmatched `[` and `{` in the truncated string.
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escape = false;

    for (const ch of truncated) {
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === "\\") {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (ch === "{") openBraces++;
        else if (ch === "}") openBraces--;
        else if (ch === "[") openBrackets++;
        else if (ch === "]") openBrackets--;
    }

    // Build the closing suffix
    let suffix = "";
    for (let i = 0; i < openBrackets; i++) suffix += "]";
    for (let i = 0; i < openBraces; i++) suffix += "}";

    const recovered = truncated + suffix;

    // Verify the recovered string is valid JSON
    try {
        JSON.parse(recovered);
        return recovered;
    } catch {
        return raw; // Recovery didn't help — return original
    }
}

/**
 * Parse a JSON string with truncation recovery as a fallback.
 * First tries a direct parse, then strips markdown fences, then attempts
 * truncation recovery.
 */
function parseJsonWithRecovery(raw: string): unknown {
    const stripped = stripMarkdownFences(raw);

    // Try direct parse first
    try {
        return JSON.parse(stripped);
    } catch {
        // Fall through to recovery
    }

    // Try truncation recovery
    const recovered = recoverTruncatedJson(stripped);
    return JSON.parse(recovered); // Let this throw if it still fails
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

// ---------------------------------------------------------------------------
// Exported utilities for unit testing
// ---------------------------------------------------------------------------

export {
    injectDefaults as _injectDefaults,
    recoverTruncatedJson as _recoverTruncatedJson,
    ELEMENT_DEFAULTS as _ELEMENT_DEFAULTS,
    expandToExcalidraw as _expandToExcalidraw,
};

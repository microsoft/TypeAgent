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

For ARROW elements, also include:
  "points": [[0, 0], [<dx>, <dy>]],
  "startBinding": { "elementId": "<source-id>", "focus": 0, "gap": 8 },
  "endBinding": { "elementId": "<target-id>", "focus": 0, "gap": 8 },
  "startArrowhead": null,
  "endArrowhead": "arrow"

To bind text to a shape:
- On the shape element, set "boundElements": [{"id": "<text-id>", "type": "text"}]
- On the text element, set "containerId": "<shape-id>"

LAYOUT GUIDELINES:
- Space elements at least 200px apart horizontally and 150px vertically
- Use a left-to-right or top-to-bottom flow layout
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

Generate a clean, well-organized diagram that visually represents the content. Every shape that has a label MUST have a bound text element.`;
}

async function handleCreateDiagram(
    action: CreateDiagramAction,
    context: ActionContext<ExcalidrawActionContext>,
): Promise<ActionResult> {
    const { sourceContent, sourceType, diagramTitle, outputPath } =
        action.parameters;

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
        const systemPrompt = buildSystemPrompt(sourceType);
        const userPrompt = `Convert the following ${sourceType} content into an Excalidraw diagram:\n\n${sourceContent}`;

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

        const result = createActionResultFromTextDisplay(
            `📐 ${displayTitle} created successfully!\n\n` +
                `📁 Saved to: ${resolvedPath}\n` +
                `📊 Elements: ${elementCount}\n` +
                `📄 Source type: ${sourceType}\n\n` +
                `Open the .excalidraw file in Excalidraw (https://excalidraw.com) to view and edit.`,
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

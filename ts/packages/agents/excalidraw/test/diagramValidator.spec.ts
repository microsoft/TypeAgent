// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the excalidraw agent's iterative generation pipeline.
 * These are unit tests that validate the validator, plan types, prompt builders,
 * and the expandToExcalidraw function WITHOUT requiring API keys or LLM calls.
 */

import { validateDiagram } from "../src/diagramValidator.js";
import {
    DiagramPlan,
    MinimalDiagram,
    MinimalElement,
} from "../src/diagramPlan.js";
import {
    buildPlanExtractionPrompt,
    buildExcalidrawGenerationPrompt,
    buildCorrectionPrompt,
    shouldUseChunkedGeneration,
    buildChunkedGroupsPrompt,
    buildChunkedNodesPrompt,
    buildChunkedEdgesPrompt,
    buildMinimalDiagramPrompt,
    buildMinimalCorrectionPrompt,
} from "../src/prompts.js";
import {
    _injectDefaults as injectDefaults,
    _recoverTruncatedJson as recoverTruncatedJson,
    _ELEMENT_DEFAULTS as ELEMENT_DEFAULTS,
    _expandToExcalidraw as expandToExcalidraw,
} from "../src/excalidrawActionHandler.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createSimplePlan(): DiagramPlan {
    return {
        title: "Simple Flow",
        layoutDirection: "TD",
        nodes: [
            { id: "n1", label: "Start", shape: "ellipse" },
            { id: "n2", label: "Process", shape: "rectangle" },
            { id: "n3", label: "End", shape: "ellipse" },
        ],
        edges: [
            { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
            { id: "e2", sourceNodeId: "n2", targetNodeId: "n3" },
        ],
        groups: [],
    };
}

function createNestedPlan(): DiagramPlan {
    return {
        title: "Pipeline with Stages",
        layoutDirection: "LR",
        nodes: [
            { id: "n1", label: "Input", shape: "rectangle" },
            {
                id: "n2",
                label: "Lint",
                shape: "rectangle",
                parentGroupId: "g1",
            },
            {
                id: "n3",
                label: "Test",
                shape: "rectangle",
                parentGroupId: "g1",
            },
            {
                id: "n4",
                label: "Build",
                shape: "rectangle",
                parentGroupId: "g2",
            },
            {
                id: "n5",
                label: "Deploy",
                shape: "rectangle",
                parentGroupId: "g2",
            },
            { id: "n6", label: "Output", shape: "rectangle" },
        ],
        edges: [
            { id: "e1", sourceNodeId: "n1", targetNodeId: "n2" },
            { id: "e2", sourceNodeId: "n2", targetNodeId: "n3" },
            { id: "e3", sourceNodeId: "n3", targetNodeId: "n4" },
            { id: "e4", sourceNodeId: "n4", targetNodeId: "n5" },
            { id: "e5", sourceNodeId: "n5", targetNodeId: "n6" },
        ],
        groups: [
            {
                id: "g1",
                label: "CI Stage",
                childNodeIds: ["n2", "n3"],
                childGroupIds: [],
                color: "#a5d8ff",
            },
            {
                id: "g2",
                label: "CD Stage",
                childNodeIds: ["n4", "n5"],
                childGroupIds: [],
                color: "#b2f2bb",
            },
        ],
    };
}

/**
 * Create a simple MinimalDiagram for the simple plan.
 */
function createSimpleMinimalDiagram(): MinimalDiagram {
    return {
        elements: [
            {
                id: "shape-n1",
                type: "ellipse",
                x: 100,
                y: 50,
                w: 120,
                h: 60,
                label: "Start",
            },
            {
                id: "shape-n2",
                type: "rectangle",
                x: 100,
                y: 190,
                w: 160,
                h: 60,
                label: "Process",
            },
            {
                id: "shape-n3",
                type: "ellipse",
                x: 100,
                y: 330,
                w: 120,
                h: 60,
                label: "End",
            },
            {
                id: "arrow-e1",
                type: "arrow",
                x: 0,
                y: 0,
                from: "shape-n1",
                to: "shape-n2",
            },
            {
                id: "arrow-e2",
                type: "arrow",
                x: 0,
                y: 0,
                from: "shape-n2",
                to: "shape-n3",
            },
        ],
    };
}

/**
 * Create a MinimalDiagram with groups for the nested plan.
 */
function createNestedMinimalDiagram(): MinimalDiagram {
    return {
        elements: [
            {
                id: "shape-n1",
                type: "rectangle",
                x: 0,
                y: 100,
                w: 120,
                h: 60,
                label: "Input",
            },
            {
                id: "group-g1",
                type: "frame",
                x: 200,
                y: 20,
                w: 300,
                h: 200,
                label: "CI Stage",
                color: "#a5d8ff",
            },
            {
                id: "shape-n2",
                type: "rectangle",
                x: 220,
                y: 70,
                w: 120,
                h: 60,
                label: "Lint",
                group: "g1",
            },
            {
                id: "shape-n3",
                type: "rectangle",
                x: 360,
                y: 70,
                w: 120,
                h: 60,
                label: "Test",
                group: "g1",
            },
            {
                id: "group-g2",
                type: "frame",
                x: 550,
                y: 20,
                w: 300,
                h: 200,
                label: "CD Stage",
                color: "#b2f2bb",
            },
            {
                id: "shape-n4",
                type: "rectangle",
                x: 570,
                y: 70,
                w: 120,
                h: 60,
                label: "Build",
                group: "g2",
            },
            {
                id: "shape-n5",
                type: "rectangle",
                x: 710,
                y: 70,
                w: 120,
                h: 60,
                label: "Deploy",
                group: "g2",
            },
            {
                id: "shape-n6",
                type: "rectangle",
                x: 900,
                y: 100,
                w: 120,
                h: 60,
                label: "Output",
            },
            {
                id: "arrow-e1",
                type: "arrow",
                x: 0,
                y: 0,
                from: "shape-n1",
                to: "shape-n2",
            },
            {
                id: "arrow-e2",
                type: "arrow",
                x: 0,
                y: 0,
                from: "shape-n2",
                to: "shape-n3",
            },
            {
                id: "arrow-e3",
                type: "arrow",
                x: 0,
                y: 0,
                from: "shape-n3",
                to: "shape-n4",
            },
            {
                id: "arrow-e4",
                type: "arrow",
                x: 0,
                y: 0,
                from: "shape-n4",
                to: "shape-n5",
            },
            {
                id: "arrow-e5",
                type: "arrow",
                x: 0,
                y: 0,
                from: "shape-n5",
                to: "shape-n6",
            },
        ],
    };
}

/**
 * Create a valid Excalidraw document that matches the simple plan.
 */
function createValidSimpleExcalidraw(): { elements: any[] } {
    return {
        elements: [
            // Shapes
            {
                id: "shape-n1",
                type: "ellipse",
                x: 100,
                y: 50,
                width: 120,
                height: 60,
                boundElements: [
                    { id: "text-n1", type: "text" },
                    { id: "arrow-e1", type: "arrow" },
                ],
            },
            {
                id: "shape-n2",
                type: "rectangle",
                x: 100,
                y: 200,
                width: 120,
                height: 60,
                boundElements: [
                    { id: "text-n2", type: "text" },
                    { id: "arrow-e1", type: "arrow" },
                    { id: "arrow-e2", type: "arrow" },
                ],
            },
            {
                id: "shape-n3",
                type: "ellipse",
                x: 100,
                y: 350,
                width: 120,
                height: 60,
                boundElements: [
                    { id: "text-n3", type: "text" },
                    { id: "arrow-e2", type: "arrow" },
                ],
            },
            // Text labels
            {
                id: "text-n1",
                type: "text",
                x: 100,
                y: 50,
                width: 120,
                height: 60,
                text: "Start",
                containerId: "shape-n1",
            },
            {
                id: "text-n2",
                type: "text",
                x: 100,
                y: 200,
                width: 120,
                height: 60,
                text: "Process",
                containerId: "shape-n2",
            },
            {
                id: "text-n3",
                type: "text",
                x: 100,
                y: 350,
                width: 120,
                height: 60,
                text: "End",
                containerId: "shape-n3",
            },
            // Arrows
            {
                id: "arrow-e1",
                type: "arrow",
                x: 160,
                y: 110,
                width: 0,
                height: 90,
                startBinding: { elementId: "shape-n1" },
                endBinding: { elementId: "shape-n2" },
            },
            {
                id: "arrow-e2",
                type: "arrow",
                x: 160,
                y: 260,
                width: 0,
                height: 90,
                startBinding: { elementId: "shape-n2" },
                endBinding: { elementId: "shape-n3" },
            },
        ],
    };
}

/**
 * Create a valid Excalidraw document that matches the nested plan.
 */
function createValidNestedExcalidraw(): { elements: any[] } {
    return {
        elements: [
            // Standalone shapes
            {
                id: "shape-n1",
                type: "rectangle",
                x: 0,
                y: 100,
                width: 120,
                height: 60,
                boundElements: [
                    { id: "text-n1", type: "text" },
                    { id: "arrow-e1", type: "arrow" },
                ],
            },
            {
                id: "shape-n6",
                type: "rectangle",
                x: 900,
                y: 100,
                width: 120,
                height: 60,
                boundElements: [
                    { id: "text-n6", type: "text" },
                    { id: "arrow-e5", type: "arrow" },
                ],
            },
            // Group g1 rectangle (CI Stage)
            {
                id: "group-g1",
                type: "rectangle",
                x: 200,
                y: 20,
                width: 300,
                height: 200,
                backgroundColor: "#a5d8ff",
                boundElements: [],
            },
            // Nodes inside g1
            {
                id: "shape-n2",
                type: "rectangle",
                x: 220,
                y: 70,
                width: 120,
                height: 60,
                boundElements: [
                    { id: "text-n2", type: "text" },
                    { id: "arrow-e1", type: "arrow" },
                    { id: "arrow-e2", type: "arrow" },
                ],
            },
            {
                id: "shape-n3",
                type: "rectangle",
                x: 360,
                y: 70,
                width: 120,
                height: 60,
                boundElements: [
                    { id: "text-n3", type: "text" },
                    { id: "arrow-e2", type: "arrow" },
                    { id: "arrow-e3", type: "arrow" },
                ],
            },
            // Group g2 rectangle (CD Stage)
            {
                id: "group-g2",
                type: "rectangle",
                x: 550,
                y: 20,
                width: 300,
                height: 200,
                backgroundColor: "#b2f2bb",
                boundElements: [],
            },
            // Nodes inside g2
            {
                id: "shape-n4",
                type: "rectangle",
                x: 570,
                y: 70,
                width: 120,
                height: 60,
                boundElements: [
                    { id: "text-n4", type: "text" },
                    { id: "arrow-e3", type: "arrow" },
                    { id: "arrow-e4", type: "arrow" },
                ],
            },
            {
                id: "shape-n5",
                type: "rectangle",
                x: 710,
                y: 70,
                width: 120,
                height: 60,
                boundElements: [
                    { id: "text-n5", type: "text" },
                    { id: "arrow-e4", type: "arrow" },
                    { id: "arrow-e5", type: "arrow" },
                ],
            },
            // Group labels
            {
                id: "grouplabel-g1",
                type: "text",
                x: 200,
                y: 20,
                width: 300,
                height: 200,
                text: "CI Stage",
                containerId: "group-g1",
            },
            {
                id: "grouplabel-g2",
                type: "text",
                x: 550,
                y: 20,
                width: 300,
                height: 200,
                text: "CD Stage",
                containerId: "group-g2",
            },
            // Text labels for nodes
            {
                id: "text-n1",
                type: "text",
                x: 0,
                y: 100,
                width: 120,
                height: 60,
                text: "Input",
                containerId: "shape-n1",
            },
            {
                id: "text-n2",
                type: "text",
                x: 220,
                y: 70,
                width: 120,
                height: 60,
                text: "Lint",
                containerId: "shape-n2",
            },
            {
                id: "text-n3",
                type: "text",
                x: 360,
                y: 70,
                width: 120,
                height: 60,
                text: "Test",
                containerId: "shape-n3",
            },
            {
                id: "text-n4",
                type: "text",
                x: 570,
                y: 70,
                width: 120,
                height: 60,
                text: "Build",
                containerId: "shape-n4",
            },
            {
                id: "text-n5",
                type: "text",
                x: 710,
                y: 70,
                width: 120,
                height: 60,
                text: "Deploy",
                containerId: "shape-n5",
            },
            {
                id: "text-n6",
                type: "text",
                x: 900,
                y: 100,
                width: 120,
                height: 60,
                text: "Output",
                containerId: "shape-n6",
            },
            // Arrows
            {
                id: "arrow-e1",
                type: "arrow",
                x: 120,
                y: 130,
                width: 100,
                height: 0,
                startBinding: { elementId: "shape-n1" },
                endBinding: { elementId: "shape-n2" },
            },
            {
                id: "arrow-e2",
                type: "arrow",
                x: 340,
                y: 100,
                width: 20,
                height: 0,
                startBinding: { elementId: "shape-n2" },
                endBinding: { elementId: "shape-n3" },
            },
            {
                id: "arrow-e3",
                type: "arrow",
                x: 480,
                y: 100,
                width: 90,
                height: 0,
                startBinding: { elementId: "shape-n3" },
                endBinding: { elementId: "shape-n4" },
            },
            {
                id: "arrow-e4",
                type: "arrow",
                x: 690,
                y: 100,
                width: 20,
                height: 0,
                startBinding: { elementId: "shape-n4" },
                endBinding: { elementId: "shape-n5" },
            },
            {
                id: "arrow-e5",
                type: "arrow",
                x: 830,
                y: 100,
                width: 70,
                height: 0,
                startBinding: { elementId: "shape-n5" },
                endBinding: { elementId: "shape-n6" },
            },
        ],
    };
}

// ---------------------------------------------------------------------------
// Validator tests
// ---------------------------------------------------------------------------

describe("DiagramValidator", () => {
    describe("valid diagrams", () => {
        test("simple flow passes validation", () => {
            const plan = createSimplePlan();
            const doc = createValidSimpleExcalidraw();
            const result = validateDiagram(doc, plan);

            expect(result.valid).toBe(true);
            expect(
                result.issues.filter((i) => i.severity === "error"),
            ).toHaveLength(0);
            expect(result.stats.foundNodes).toBe(3);
            expect(result.stats.foundEdges).toBe(2);
        });

        test("nested diagram passes validation", () => {
            const plan = createNestedPlan();
            const doc = createValidNestedExcalidraw();
            const result = validateDiagram(doc, plan);

            const errors = result.issues.filter((i) => i.severity === "error");
            expect(errors).toHaveLength(0);
            expect(result.valid).toBe(true);
            expect(result.stats.foundNodes).toBe(6);
            expect(result.stats.foundEdges).toBe(5);
            expect(result.stats.foundGroups).toBe(2);
        });
    });

    describe("missing elements", () => {
        test("detects missing node shapes", () => {
            const plan = createSimplePlan();
            const doc = createValidSimpleExcalidraw();
            // Remove the second shape
            doc.elements = doc.elements.filter((e) => e.id !== "shape-n2");

            const result = validateDiagram(doc, plan);
            expect(result.valid).toBe(false);
            expect(result.stats.foundNodes).toBe(2);

            const missingNodeIssues = result.issues.filter(
                (i) => i.type === "missing_node",
            );
            expect(missingNodeIssues.length).toBeGreaterThanOrEqual(1);
            expect(missingNodeIssues[0].description).toContain("n2");
        });

        test("detects missing text labels", () => {
            const plan = createSimplePlan();
            const doc = createValidSimpleExcalidraw();
            // Remove a text label
            doc.elements = doc.elements.filter((e) => e.id !== "text-n1");

            const result = validateDiagram(doc, plan);
            const textIssues = result.issues.filter(
                (i) => i.type === "missing_text_label",
            );
            expect(textIssues.length).toBeGreaterThanOrEqual(1);
            expect(textIssues[0].elementId).toBe("text-n1");
        });

        test("detects missing arrows", () => {
            const plan = createSimplePlan();
            const doc = createValidSimpleExcalidraw();
            // Remove an arrow
            doc.elements = doc.elements.filter((e) => e.id !== "arrow-e1");

            const result = validateDiagram(doc, plan);
            expect(result.valid).toBe(false);
            expect(result.stats.foundEdges).toBe(1);

            const missingEdgeIssues = result.issues.filter(
                (i) => i.type === "missing_edge",
            );
            expect(missingEdgeIssues.length).toBeGreaterThanOrEqual(1);
            expect(missingEdgeIssues[0].description).toContain("e1");
        });

        test("detects missing group rectangles", () => {
            const plan = createNestedPlan();
            const doc = createValidNestedExcalidraw();
            // Remove group rectangle g1
            doc.elements = doc.elements.filter((e) => e.id !== "group-g1");

            const result = validateDiagram(doc, plan);
            expect(result.valid).toBe(false);
            expect(result.stats.foundGroups).toBe(1);

            const missingGroupIssues = result.issues.filter(
                (i) => i.type === "missing_group",
            );
            expect(missingGroupIssues.length).toBeGreaterThanOrEqual(1);
            expect(missingGroupIssues[0].description).toContain("g1");
        });
    });

    describe("broken references", () => {
        test("detects arrow with broken startBinding", () => {
            const plan = createSimplePlan();
            const doc = createValidSimpleExcalidraw();
            // Break an arrow binding
            const arrow = doc.elements.find((e) => e.id === "arrow-e1");
            arrow.startBinding = { elementId: "nonexistent-id" };

            const result = validateDiagram(doc, plan);
            const brokenRefs = result.issues.filter(
                (i) =>
                    i.type === "broken_reference" && i.elementId === "arrow-e1",
            );
            expect(brokenRefs.length).toBeGreaterThanOrEqual(1);
            expect(brokenRefs[0].description).toContain("nonexistent-id");
        });

        test("detects text with broken containerId", () => {
            const plan = createSimplePlan();
            const doc = createValidSimpleExcalidraw();
            // Break a containerId
            const text = doc.elements.find((e) => e.id === "text-n1");
            text.containerId = "nonexistent-shape";

            const result = validateDiagram(doc, plan);
            const brokenRefs = result.issues.filter(
                (i) =>
                    i.type === "broken_reference" && i.elementId === "text-n1",
            );
            expect(brokenRefs.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("containment violations", () => {
        test("detects node outside its parent group", () => {
            const plan = createNestedPlan();
            const doc = createValidNestedExcalidraw();
            // Move n2 outside the group-g1 bounds
            const n2 = doc.elements.find((e: any) => e.id === "shape-n2");
            n2.x = 0; // Group g1 starts at x=200, so this is outside
            n2.y = 0;

            const result = validateDiagram(doc, plan);
            const containmentIssues = result.issues.filter(
                (i) => i.type === "containment_violation",
            );
            expect(containmentIssues.length).toBeGreaterThanOrEqual(1);
            expect(containmentIssues[0].description).toContain("n2");
        });
    });

    describe("bound elements consistency", () => {
        test("detects arrow not listed in connected shape boundElements", () => {
            const plan = createSimplePlan();
            const doc = createValidSimpleExcalidraw();
            // Remove arrow-e1 from shape-n1's boundElements
            const n1 = doc.elements.find((e: any) => e.id === "shape-n1");
            n1.boundElements = n1.boundElements.filter(
                (b: any) => b.id !== "arrow-e1",
            );

            const result = validateDiagram(doc, plan);
            const boundIssues = result.issues.filter(
                (i) => i.type === "missing_bound_elements",
            );
            expect(boundIssues.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("empty and edge cases", () => {
        test("empty document fails against non-empty plan", () => {
            const plan = createSimplePlan();
            const doc = { elements: [] };
            const result = validateDiagram(doc, plan);

            expect(result.valid).toBe(false);
            expect(result.stats.foundNodes).toBe(0);
            expect(result.stats.foundEdges).toBe(0);
        });

        test("empty plan passes with empty document", () => {
            const plan: DiagramPlan = {
                title: "Empty",
                layoutDirection: "TD",
                nodes: [],
                edges: [],
                groups: [],
            };
            const doc = { elements: [] };
            const result = validateDiagram(doc, plan);

            expect(result.valid).toBe(true);
            expect(
                result.issues.filter((i) => i.severity === "error"),
            ).toHaveLength(0);
        });
    });

    describe("statistics tracking", () => {
        test("stats reflect expected and found counts", () => {
            const plan = createNestedPlan();
            const doc = createValidNestedExcalidraw();
            const result = validateDiagram(doc, plan);

            expect(result.stats.expectedNodes).toBe(6);
            expect(result.stats.expectedEdges).toBe(5);
            expect(result.stats.expectedGroups).toBe(2);
            expect(result.stats.totalElements).toBe(doc.elements.length);
        });
    });
});

// ---------------------------------------------------------------------------
// Prompt builder tests
// ---------------------------------------------------------------------------

describe("Prompt Builders", () => {
    describe("buildPlanExtractionPrompt", () => {
        test("includes source type in prompt", () => {
            const prompt = buildPlanExtractionPrompt("markdown");
            expect(prompt).toContain("markdown");
            expect(prompt).toContain("DiagramPlan");
        });

        test("includes all supported source types", () => {
            for (const type of [
                "markdown",
                "text",
                "visio-xml",
                "mermaid",
                "architecture",
            ]) {
                const prompt = buildPlanExtractionPrompt(type);
                expect(prompt).toContain(type);
            }
        });

        test("includes group/containment instructions", () => {
            const prompt = buildPlanExtractionPrompt("text");
            expect(prompt).toContain("parentGroupId");
            expect(prompt).toContain("childNodeIds");
            expect(prompt).toContain("childGroupIds");
        });
    });

    describe("buildExcalidrawGenerationPrompt", () => {
        test("includes element ID convention", () => {
            const prompt = buildExcalidrawGenerationPrompt();
            expect(prompt).toContain("shape-");
            expect(prompt).toContain("text-");
            expect(prompt).toContain("group-");
            expect(prompt).toContain("arrow-");
        });

        test("includes group rendering instructions", () => {
            const prompt = buildExcalidrawGenerationPrompt();
            expect(prompt).toContain("GROUP RENDERING");
            expect(prompt).toContain("background rectangle");
            expect(prompt).toContain("INSIDE");
        });

        test("includes self-review checklist", () => {
            const prompt = buildExcalidrawGenerationPrompt();
            expect(prompt).toContain("SELF-REVIEW");
        });
    });

    describe("buildMinimalDiagramPrompt", () => {
        test("includes MinimalElement schema", () => {
            const prompt = buildMinimalDiagramPrompt();
            expect(prompt).toContain("MinimalDiagram");
            expect(prompt).toContain("MINIMAL ELEMENT SCHEMA");
            expect(prompt).not.toContain("strokeColor");
            expect(prompt).not.toContain("fillStyle");
            expect(prompt).not.toContain("roughness");
        });

        test("includes element ID convention", () => {
            const prompt = buildMinimalDiagramPrompt();
            expect(prompt).toContain("shape-nX");
            expect(prompt).toContain("group-gX");
            expect(prompt).toContain("arrow-eX");
        });

        test("includes layout rules", () => {
            const prompt = buildMinimalDiagramPrompt();
            expect(prompt).toContain("LAYOUT RULES");
            expect(prompt).toContain("80px gap");
        });

        test("includes compact example", () => {
            const prompt = buildMinimalDiagramPrompt();
            expect(prompt).toContain("EXAMPLE");
            expect(prompt).toContain("shape-n1");
        });

        test("includes self-review checklist", () => {
            const prompt = buildMinimalDiagramPrompt();
            expect(prompt).toContain("SELF-REVIEW");
        });

        test("does NOT include verbose Excalidraw fields", () => {
            const prompt = buildMinimalDiagramPrompt();
            expect(prompt).not.toContain("boundElements");
            expect(prompt).not.toContain("opacity");
            expect(prompt).not.toContain("seed");
            expect(prompt).not.toContain("versionNonce");
        });
    });

    describe("buildMinimalCorrectionPrompt", () => {
        test("includes issues and plan", () => {
            const plan = createSimplePlan();
            const issues = [
                {
                    severity: "error" as const,
                    type: "missing_node" as const,
                    description: 'Plan node "n2" has no corresponding shape',
                    elementId: "shape-n2",
                },
            ];
            const prompt = buildMinimalCorrectionPrompt(
                '{"elements":[]}',
                issues,
                plan,
            );

            expect(prompt).toContain("missing_node");
            expect(prompt).toContain("n2");
            expect(prompt).toContain("Simple Flow");
            expect(prompt).toContain("MinimalDiagram");
        });

        test("uses compact schema not full Excalidraw", () => {
            const plan = createSimplePlan();
            const prompt = buildMinimalCorrectionPrompt(
                '{"elements":[]}',
                [],
                plan,
            );

            expect(prompt).toContain("MinimalDiagram");
            expect(prompt).not.toContain("strokeColor");
            expect(prompt).not.toContain("fillStyle");
        });
    });

    describe("buildCorrectionPrompt", () => {
        test("includes issues and plan in correction prompt", () => {
            const plan = createSimplePlan();
            const issues = [
                {
                    severity: "error" as const,
                    type: "missing_node" as const,
                    description: 'Plan node "n2" has no corresponding shape',
                    elementId: "shape-n2",
                },
            ];
            const prompt = buildCorrectionPrompt(
                '{"elements":[]}',
                issues,
                plan,
            );

            expect(prompt).toContain("missing_node");
            expect(prompt).toContain("n2");
            expect(prompt).toContain("Simple Flow"); // plan title
            expect(prompt).toContain('"elements":[]'); // current JSON
        });

        test("numbers issues in output", () => {
            const plan = createSimplePlan();
            const issues = [
                {
                    severity: "error" as const,
                    type: "missing_node" as const,
                    description: "Issue one",
                },
                {
                    severity: "warning" as const,
                    type: "overlap" as const,
                    description: "Issue two",
                },
            ];
            const prompt = buildCorrectionPrompt("{}", issues, plan);
            expect(prompt).toContain("1. [ERROR]");
            expect(prompt).toContain("2. [WARNING]");
        });
    });
});

// ---------------------------------------------------------------------------
// DiagramPlan type tests (structural)
// ---------------------------------------------------------------------------

describe("DiagramPlan structure", () => {
    test("plan nodes can have optional parentGroupId", () => {
        const plan = createNestedPlan();
        const nodesWithParent = plan.nodes.filter((n) => n.parentGroupId);
        const nodesWithoutParent = plan.nodes.filter((n) => !n.parentGroupId);

        expect(nodesWithParent.length).toBe(4); // n2, n3, n4, n5
        expect(nodesWithoutParent.length).toBe(2); // n1, n6
    });

    test("groups contain correct child references", () => {
        const plan = createNestedPlan();
        const g1 = plan.groups.find((g) => g.id === "g1")!;
        const g2 = plan.groups.find((g) => g.id === "g2")!;

        expect(g1.childNodeIds).toEqual(["n2", "n3"]);
        expect(g2.childNodeIds).toEqual(["n4", "n5"]);
    });

    test("edges reference valid node IDs", () => {
        const plan = createNestedPlan();
        const nodeIds = new Set(plan.nodes.map((n) => n.id));

        for (const edge of plan.edges) {
            expect(nodeIds.has(edge.sourceNodeId)).toBe(true);
            expect(nodeIds.has(edge.targetNodeId)).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// injectDefaults tests
// ---------------------------------------------------------------------------

describe("injectDefaults", () => {
    test("fills in all missing default fields", () => {
        const elements: Record<string, unknown>[] = [
            {
                id: "shape-n1",
                type: "rectangle",
                x: 0,
                y: 0,
                width: 100,
                height: 50,
            },
        ];
        injectDefaults(elements);

        const el = elements[0];
        // Every key from ELEMENT_DEFAULTS should now be present
        for (const key of Object.keys(ELEMENT_DEFAULTS)) {
            expect(key in el).toBe(true);
        }
        expect(el.angle).toBe(0);
        expect(el.strokeColor).toBe("#1e1e1e");
        expect(el.fillStyle).toBe("solid");
        expect(el.strokeWidth).toBe(2);
        expect(el.roughness).toBe(1);
        expect(el.opacity).toBe(100);
        expect(el.isDeleted).toBe(false);
        expect(el.locked).toBe(false);
        expect(el.link).toBeNull();
        expect(el.frameId).toBeNull();
        expect(el.roundness).toBeNull();
        expect(el.groupIds).toEqual([]);
    });

    test("preserves existing values and does not overwrite them", () => {
        const elements: Record<string, unknown>[] = [
            {
                id: "shape-n1",
                type: "rectangle",
                x: 0,
                y: 0,
                width: 100,
                height: 50,
                strokeColor: "#ff0000",
                opacity: 50,
                roughness: 0,
            },
        ];
        injectDefaults(elements);

        const el = elements[0];
        expect(el.strokeColor).toBe("#ff0000");
        expect(el.opacity).toBe(50);
        expect(el.roughness).toBe(0);
    });

    test("sets boundElements to empty array when missing", () => {
        const elements: Record<string, unknown>[] = [
            {
                id: "shape-n1",
                type: "rectangle",
                x: 0,
                y: 0,
                width: 100,
                height: 50,
            },
        ];
        injectDefaults(elements);
        expect(elements[0].boundElements).toEqual([]);
    });

    test("preserves existing boundElements array", () => {
        const elements: Record<string, unknown>[] = [
            {
                id: "shape-n1",
                type: "rectangle",
                x: 0,
                y: 0,
                width: 100,
                height: 50,
                boundElements: [{ id: "text-n1", type: "text" }],
            },
        ];
        injectDefaults(elements);
        expect(elements[0].boundElements).toEqual([
            { id: "text-n1", type: "text" },
        ]);
    });

    test("sets backgroundColor to 'transparent' when missing", () => {
        const elements: Record<string, unknown>[] = [
            {
                id: "shape-n1",
                type: "rectangle",
                x: 0,
                y: 0,
                width: 100,
                height: 50,
            },
        ];
        injectDefaults(elements);
        expect(elements[0].backgroundColor).toBe("transparent");
    });

    test("preserves existing backgroundColor", () => {
        const elements: Record<string, unknown>[] = [
            {
                id: "shape-n1",
                type: "rectangle",
                x: 0,
                y: 0,
                width: 100,
                height: 50,
                backgroundColor: "#a5d8ff",
            },
        ];
        injectDefaults(elements);
        expect(elements[0].backgroundColor).toBe("#a5d8ff");
    });

    test("groupIds arrays are not shared between elements", () => {
        const elements: Record<string, unknown>[] = [
            { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
            { id: "b", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
        ];
        injectDefaults(elements);
        // Mutating one element's groupIds should not affect the other
        (elements[0].groupIds as unknown[]).push("g1");
        expect(elements[1].groupIds).toEqual([]);
    });

    test("handles empty elements array", () => {
        const elements: Record<string, unknown>[] = [];
        injectDefaults(elements);
        expect(elements).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// recoverTruncatedJson tests
// ---------------------------------------------------------------------------

describe("recoverTruncatedJson", () => {
    test("returns valid JSON unchanged", () => {
        const valid = '{"elements":[{"id":"a"}]}';
        expect(recoverTruncatedJson(valid)).toBe(valid);
    });

    test("recovers truncated object with open array", () => {
        // Simulates: {"elements":[{"id":"a"},{"id":"b"  <-- truncated here
        const truncated = '{"elements":[{"id":"a"},{"id":"b"}';
        const recovered = recoverTruncatedJson(truncated);
        const parsed = JSON.parse(recovered);
        expect(parsed.elements).toHaveLength(2);
        expect(parsed.elements[1].id).toBe("b");
    });

    test("recovers truncated bare array", () => {
        const truncated = '[{"id":"a"},{"id":"b"}';
        const recovered = recoverTruncatedJson(truncated);
        const parsed = JSON.parse(recovered);
        expect(parsed).toHaveLength(2);
    });

    test("recovers deeply nested truncation", () => {
        // The inner object and array are complete, but outer array/object are not closed
        const truncated =
            '{"elements":[{"id":"a","boundElements":[{"id":"t1","type":"text"}]}';
        const recovered = recoverTruncatedJson(truncated);
        const parsed = JSON.parse(recovered);
        expect(parsed.elements[0].id).toBe("a");
        expect(parsed.elements[0].boundElements[0].id).toBe("t1");
    });

    test("returns original when recovery is not possible", () => {
        const garbage = "this is not json at all";
        expect(recoverTruncatedJson(garbage)).toBe(garbage);
    });

    test("handles truncation mid-string-value", () => {
        // Truncated in the middle of a string value — last complete } is the first element
        const truncated = '{"elements":[{"id":"a"},{"id":"trun';
        const recovered = recoverTruncatedJson(truncated);
        // Should recover up to the last complete }
        const parsed = JSON.parse(recovered);
        expect(parsed.elements).toHaveLength(1);
        expect(parsed.elements[0].id).toBe("a");
    });
});

// ---------------------------------------------------------------------------
// shouldUseChunkedGeneration tests
// ---------------------------------------------------------------------------

describe("shouldUseChunkedGeneration", () => {
    test("returns false for small diagrams (<=12 items)", () => {
        const plan = {
            nodes: [1, 2, 3, 4, 5],
            edges: [1, 2, 3, 4, 5],
            groups: [1, 2],
        };
        expect(shouldUseChunkedGeneration(plan as any)).toBe(false);
    });

    test("returns false at exactly 12 items", () => {
        const plan = {
            nodes: new Array(6),
            edges: new Array(4),
            groups: new Array(2),
        };
        expect(shouldUseChunkedGeneration(plan as any)).toBe(false);
    });

    test("returns true for large diagrams (>12 items)", () => {
        const plan = {
            nodes: new Array(10),
            edges: new Array(3),
            groups: new Array(0),
        };
        expect(shouldUseChunkedGeneration(plan as any)).toBe(true);
    });

    test("returns true for the bug-triggering case (16+7+2=25)", () => {
        const plan = {
            nodes: new Array(16),
            edges: new Array(7),
            groups: new Array(2),
        };
        expect(shouldUseChunkedGeneration(plan as any)).toBe(true);
    });

    test("returns false for empty plan", () => {
        const plan = { nodes: [], edges: [], groups: [] };
        expect(shouldUseChunkedGeneration(plan as any)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Chunked prompt builder tests (kept for backward compat)
// ---------------------------------------------------------------------------

describe("Chunked prompt builders", () => {
    describe("buildChunkedGroupsPrompt", () => {
        test("includes group rendering instructions", () => {
            const prompt = buildChunkedGroupsPrompt();
            expect(prompt).toContain("group-");
            expect(prompt).toContain("grouplabel-");
            expect(prompt).toContain("background rectangle");
        });

        test("instructs NOT to generate nodes or arrows", () => {
            const prompt = buildChunkedGroupsPrompt();
            expect(prompt).toContain("Do NOT generate node shapes or arrows");
        });

        test("includes compact output instructions", () => {
            const prompt = buildChunkedGroupsPrompt();
            expect(prompt).toContain("COMPACT OUTPUT");
        });
    });

    describe("buildChunkedNodesPrompt", () => {
        test("includes node generation instructions", () => {
            const prompt = buildChunkedNodesPrompt([]);
            expect(prompt).toContain("shape-");
            expect(prompt).toContain("text-");
        });

        test("instructs NOT to generate groups or arrows", () => {
            const prompt = buildChunkedNodesPrompt([]);
            expect(prompt).toContain(
                "Do NOT generate group rectangles or arrows",
            );
        });

        test("includes existing element IDs when provided", () => {
            const existingIds = [
                "group-g1",
                "grouplabel-g1",
                "group-g2",
                "grouplabel-g2",
            ];
            const prompt = buildChunkedNodesPrompt(existingIds);
            expect(prompt).toContain("group-g1");
            expect(prompt).toContain("grouplabel-g1");
            expect(prompt).toContain("group-g2");
        });

        test("omits existing IDs section when empty", () => {
            const prompt = buildChunkedNodesPrompt([]);
            expect(prompt).not.toContain("ALREADY GENERATED ELEMENT IDS");
        });
    });

    describe("buildChunkedEdgesPrompt", () => {
        test("includes arrow generation instructions", () => {
            const prompt = buildChunkedEdgesPrompt(["shape-n1", "shape-n2"]);
            expect(prompt).toContain("arrow-");
            expect(prompt).toContain("arrowlabel-");
        });

        test("instructs NOT to generate shapes or groups", () => {
            const prompt = buildChunkedEdgesPrompt(["shape-n1"]);
            expect(prompt).toContain(
                "Do NOT generate shapes or group rectangles",
            );
        });

        test("includes existing element IDs for binding", () => {
            const existingIds = ["shape-n1", "shape-n2", "text-n1", "text-n2"];
            const prompt = buildChunkedEdgesPrompt(existingIds);
            expect(prompt).toContain("shape-n1");
            expect(prompt).toContain("shape-n2");
            expect(prompt).toContain("text-n1");
        });

        test("references startBinding and endBinding", () => {
            const prompt = buildChunkedEdgesPrompt(["shape-n1"]);
            expect(prompt).toContain("startBinding");
            expect(prompt).toContain("endBinding");
        });
    });
});

// ---------------------------------------------------------------------------
// expandToExcalidraw tests
// ---------------------------------------------------------------------------

describe("expandToExcalidraw", () => {
    describe("basic expansion", () => {
        test("expands a simple MinimalDiagram into valid Excalidraw document", () => {
            const minimal = createSimpleMinimalDiagram();
            const doc = expandToExcalidraw(minimal);

            expect(doc.type).toBe("excalidraw");
            expect(doc.version).toBe(2);
            expect(doc.source).toBe("typeagent-excalidraw");
            expect(doc.elements).toBeDefined();
            expect(Array.isArray(doc.elements)).toBe(true);
        });

        test("generates shape + text for each labeled shape element", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "rectangle",
                        x: 0,
                        y: 0,
                        w: 160,
                        h: 60,
                        label: "Hello",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);

            // Should have the shape and its text label
            const shape = doc.elements.find((e: any) => e.id === "shape-n1");
            const text = doc.elements.find((e: any) => e.id === "text-n1");

            expect(shape).toBeDefined();
            expect(text).toBeDefined();
            expect(shape!.type).toBe("rectangle");
            expect((text as any).type).toBe("text");
            expect((text as any).text).toBe("Hello");
            expect((text as any).containerId).toBe("shape-n1");
        });

        test("generates arrow elements with computed geometry", () => {
            const minimal = createSimpleMinimalDiagram();
            const doc = expandToExcalidraw(minimal);

            const arrow = doc.elements.find((e: any) => e.id === "arrow-e1");
            expect(arrow).toBeDefined();
            expect(arrow!.type).toBe("arrow");
            expect((arrow as any).startBinding).toBeDefined();
            expect((arrow as any).startBinding.elementId).toBe("shape-n1");
            expect((arrow as any).endBinding).toBeDefined();
            expect((arrow as any).endBinding.elementId).toBe("shape-n2");
            // Arrow should have computed points (not [0,0])
            expect((arrow as any).points).toBeDefined();
            expect((arrow as any).points).toHaveLength(2);
        });

        test("total element count matches shapes + texts + arrows", () => {
            const minimal = createSimpleMinimalDiagram();
            const doc = expandToExcalidraw(minimal);

            // 3 shapes + 3 texts + 2 arrows = 8 elements
            expect(doc.elements).toHaveLength(8);
        });
    });

    describe("field completeness", () => {
        test("shape elements have all required Excalidraw fields", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "rectangle",
                        x: 100,
                        y: 200,
                        w: 160,
                        h: 60,
                        label: "Test",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const shape = doc.elements.find((e: any) => e.id === "shape-n1")!;

            // Check all required fields exist
            expect(shape.id).toBe("shape-n1");
            expect(shape.type).toBe("rectangle");
            expect(shape.x).toBe(100);
            expect(shape.y).toBe(200);
            expect(shape.width).toBe(160);
            expect(shape.height).toBe(60);
            expect((shape as any).angle).toBe(0);
            expect((shape as any).strokeColor).toBe("#1e1e1e");
            expect((shape as any).backgroundColor).toBe("transparent");
            expect((shape as any).fillStyle).toBe("solid");
            expect((shape as any).strokeWidth).toBe(2);
            expect((shape as any).strokeStyle).toBe("solid");
            expect((shape as any).roughness).toBe(1);
            expect((shape as any).opacity).toBe(100);
            expect((shape as any).isDeleted).toBe(false);
            expect((shape as any).locked).toBe(false);
            expect((shape as any).link).toBeNull();
            expect((shape as any).frameId).toBeNull();
            expect((shape as any).groupIds).toEqual([]);
            expect((shape as any).seed).toEqual(expect.any(Number));
            expect((shape as any).version).toBe(1);
            expect((shape as any).roundness).toEqual({ type: 3 });
        });

        test("text elements have all required fields", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "rectangle",
                        x: 100,
                        y: 200,
                        w: 160,
                        h: 60,
                        label: "Test",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const text = doc.elements.find((e: any) => e.id === "text-n1")!;

            expect((text as any).text).toBe("Test");
            expect((text as any).fontSize).toBe(20);
            expect((text as any).fontFamily).toBe(1);
            expect((text as any).textAlign).toBe("center");
            expect((text as any).verticalAlign).toBe("middle");
            expect((text as any).containerId).toBe("shape-n1");
            expect((text as any).originalText).toBe("Test");
        });

        test("arrow elements have all required fields", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "rectangle",
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 50,
                    },
                    {
                        id: "shape-n2",
                        type: "rectangle",
                        x: 200,
                        y: 0,
                        w: 100,
                        h: 50,
                    },
                    {
                        id: "arrow-e1",
                        type: "arrow",
                        x: 0,
                        y: 0,
                        from: "shape-n1",
                        to: "shape-n2",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const arrow = doc.elements.find((e: any) => e.id === "arrow-e1")!;

            expect((arrow as any).points).toBeDefined();
            expect((arrow as any).startBinding).toBeDefined();
            expect((arrow as any).endBinding).toBeDefined();
            expect((arrow as any).endArrowhead).toBe("arrow");
            expect((arrow as any).startArrowhead).toBeNull();
            expect((arrow as any).strokeColor).toBe("#1e1e1e");
        });
    });

    describe("group/frame expansion", () => {
        test("frame type elements are expanded as rectangles", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "group-g1",
                        type: "frame",
                        x: 0,
                        y: 0,
                        w: 300,
                        h: 200,
                        label: "Group 1",
                        color: "#a5d8ff",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const group = doc.elements.find((e: any) => e.id === "group-g1")!;

            expect(group.type).toBe("rectangle");
            expect((group as any).backgroundColor).toBe("#a5d8ff");
            expect((group as any).strokeStyle).toBe("dashed");
            expect((group as any).strokeWidth).toBe(1);
            expect((group as any).opacity).toBe(60);
        });

        test("group label text is generated with grouplabel- prefix", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "group-g1",
                        type: "frame",
                        x: 0,
                        y: 0,
                        w: 300,
                        h: 200,
                        label: "Group 1",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const label = doc.elements.find(
                (e: any) => e.id === "grouplabel-g1",
            );

            expect(label).toBeDefined();
            expect((label as any).text).toBe("Group 1");
            expect((label as any).containerId).toBe("group-g1");
            expect((label as any).textAlign).toBe("left");
            expect((label as any).verticalAlign).toBe("top");
        });
    });

    describe("arrow label expansion", () => {
        test("arrow with label generates arrowlabel text element", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "rectangle",
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 50,
                    },
                    {
                        id: "shape-n2",
                        type: "rectangle",
                        x: 200,
                        y: 0,
                        w: 100,
                        h: 50,
                    },
                    {
                        id: "arrow-e1",
                        type: "arrow",
                        x: 0,
                        y: 0,
                        from: "shape-n1",
                        to: "shape-n2",
                        label: "sends",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const arrowLabel = doc.elements.find(
                (e: any) => e.id === "arrowlabel-e1",
            );

            expect(arrowLabel).toBeDefined();
            expect((arrowLabel as any).text).toBe("sends");
            expect((arrowLabel as any).containerId).toBe("arrow-e1");
        });

        test("arrow without label does not generate label text", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "rectangle",
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 50,
                    },
                    {
                        id: "shape-n2",
                        type: "rectangle",
                        x: 200,
                        y: 0,
                        w: 100,
                        h: 50,
                    },
                    {
                        id: "arrow-e1",
                        type: "arrow",
                        x: 0,
                        y: 0,
                        from: "shape-n1",
                        to: "shape-n2",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const arrowLabel = doc.elements.find(
                (e: any) => e.id === "arrowlabel-e1",
            );

            expect(arrowLabel).toBeUndefined();
        });
    });

    describe("boundElements wiring", () => {
        test("shapes include arrow refs in boundElements", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "rectangle",
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 50,
                        label: "A",
                    },
                    {
                        id: "shape-n2",
                        type: "rectangle",
                        x: 200,
                        y: 0,
                        w: 100,
                        h: 50,
                        label: "B",
                    },
                    {
                        id: "arrow-e1",
                        type: "arrow",
                        x: 0,
                        y: 0,
                        from: "shape-n1",
                        to: "shape-n2",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const n1 = doc.elements.find((e: any) => e.id === "shape-n1")!;
            const n2 = doc.elements.find((e: any) => e.id === "shape-n2")!;

            const n1Bounds = (n1 as any).boundElements as any[];
            const n2Bounds = (n2 as any).boundElements as any[];

            expect(n1Bounds.some((b: any) => b.id === "arrow-e1")).toBe(true);
            expect(n2Bounds.some((b: any) => b.id === "arrow-e1")).toBe(true);
            expect(n1Bounds.some((b: any) => b.id === "text-n1")).toBe(true);
            expect(n2Bounds.some((b: any) => b.id === "text-n2")).toBe(true);
        });
    });

    describe("default dimensions", () => {
        test("uses default width=160 and height=60 when not specified", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "rectangle",
                        x: 0,
                        y: 0,
                        label: "Test",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const shape = doc.elements.find((e: any) => e.id === "shape-n1")!;

            expect(shape.width).toBe(160);
            expect(shape.height).toBe(60);
        });
    });

    describe("validates against plan", () => {
        test("expanded simple diagram passes validation", () => {
            const plan = createSimplePlan();
            const minimal = createSimpleMinimalDiagram();
            const doc = expandToExcalidraw(minimal);

            const result = validateDiagram(doc, plan);
            expect(result.stats.foundNodes).toBe(3);
            expect(result.stats.foundEdges).toBe(2);
            // All nodes and edges should be found (no missing_node or missing_edge errors)
            const missingNodes = result.issues.filter(
                (i) => i.type === "missing_node",
            );
            const missingEdges = result.issues.filter(
                (i) => i.type === "missing_edge",
            );
            expect(missingNodes).toHaveLength(0);
            expect(missingEdges).toHaveLength(0);
        });

        test("expanded nested diagram passes validation for completeness", () => {
            const plan = createNestedPlan();
            const minimal = createNestedMinimalDiagram();
            const doc = expandToExcalidraw(minimal);

            const result = validateDiagram(doc, plan);
            expect(result.stats.foundNodes).toBe(6);
            expect(result.stats.foundEdges).toBe(5);
            expect(result.stats.foundGroups).toBe(2);

            const missingNodes = result.issues.filter(
                (i) => i.type === "missing_node",
            );
            const missingEdges = result.issues.filter(
                (i) => i.type === "missing_edge",
            );
            const missingGroups = result.issues.filter(
                (i) => i.type === "missing_group",
            );
            expect(missingNodes).toHaveLength(0);
            expect(missingEdges).toHaveLength(0);
            expect(missingGroups).toHaveLength(0);
        });
    });

    describe("output size comparison", () => {
        test("MinimalDiagram for 18 nodes + 13 edges is well under 4096 tokens", () => {
            // Simulate a large diagram: 18 nodes + 13 edges = 31 elements
            const elements: MinimalElement[] = [];

            // 18 nodes
            for (let i = 1; i <= 18; i++) {
                elements.push({
                    id: `shape-n${i}`,
                    type: "rectangle",
                    x: ((i - 1) % 6) * 200,
                    y: Math.floor((i - 1) / 6) * 150,
                    w: 160,
                    h: 60,
                    label: `Node ${i}`,
                });
            }

            // 13 edges
            for (let i = 1; i <= 13; i++) {
                elements.push({
                    id: `arrow-e${i}`,
                    type: "arrow",
                    x: 0,
                    y: 0,
                    from: `shape-n${i}`,
                    to: `shape-n${i + 1}`,
                });
            }

            const minimalDiagram: MinimalDiagram = { elements };
            const minimalJson = JSON.stringify(minimalDiagram);

            // At ~4 chars per token, 4096 tokens ≈ 16384 chars
            // The minimal format should be WAY under this
            expect(minimalJson.length).toBeLessThan(4000);

            // Verify it expands successfully
            const doc = expandToExcalidraw(minimalDiagram);
            expect(doc.elements.length).toBe(18 * 2 + 13); // 18 shapes + 18 texts + 13 arrows = 49

            // The full Excalidraw JSON will be large, but that's generated in code, not by the LLM
            const fullJson = JSON.stringify(doc);
            expect(fullJson.length).toBeGreaterThan(minimalJson.length);
        });
    });

    describe("empty diagram", () => {
        test("handles empty elements array", () => {
            const minimal: MinimalDiagram = { elements: [] };
            const doc = expandToExcalidraw(minimal);

            expect(doc.elements).toHaveLength(0);
            expect(doc.type).toBe("excalidraw");
        });
    });

    describe("ellipse and diamond types", () => {
        test("ellipse shapes have null roundness", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "ellipse",
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 60,
                        label: "Start",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const shape = doc.elements.find((e: any) => e.id === "shape-n1")!;
            expect((shape as any).roundness).toBeNull();
        });

        test("diamond shapes are preserved", () => {
            const minimal: MinimalDiagram = {
                elements: [
                    {
                        id: "shape-n1",
                        type: "diamond",
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 100,
                        label: "Decision?",
                    },
                ],
            };
            const doc = expandToExcalidraw(minimal);
            const shape = doc.elements.find((e: any) => e.id === "shape-n1")!;
            expect(shape.type).toBe("diamond");
        });
    });
});

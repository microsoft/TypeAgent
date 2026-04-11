// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the excalidraw agent's iterative generation pipeline.
 * These are unit tests that validate the validator, plan types, and prompt builders
 * WITHOUT requiring API keys or LLM calls.
 */

import { validateDiagram } from "../src/diagramValidator.js";
import { DiagramPlan } from "../src/diagramPlan.js";
import {
    buildPlanExtractionPrompt,
    buildExcalidrawGenerationPrompt,
    buildCorrectionPrompt,
    shouldUseChunkedGeneration,
    buildChunkedGroupsPrompt,
    buildChunkedNodesPrompt,
    buildChunkedEdgesPrompt,
} from "../src/prompts.js";
import {
    _injectDefaults as injectDefaults,
    _recoverTruncatedJson as recoverTruncatedJson,
    _ELEMENT_DEFAULTS as ELEMENT_DEFAULTS,
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
// Chunked prompt builder tests
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

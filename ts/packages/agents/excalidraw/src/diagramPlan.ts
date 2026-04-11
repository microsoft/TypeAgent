// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Intermediate representation for diagram structure.
 * This replaces the Mermaid intermediate format with an explicit
 * typed model that captures nodes, edges, groups (containment),
 * and layout direction.
 */

export interface DiagramPlan {
    title: string;
    layoutDirection: "TD" | "LR";
    nodes: PlanNode[];
    edges: PlanEdge[];
    groups: PlanGroup[];
}

export interface PlanNode {
    id: string;
    label: string;
    shape: "rectangle" | "diamond" | "ellipse";
    parentGroupId?: string;
    color?: string;
}

export interface PlanEdge {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    label?: string;
}

export interface PlanGroup {
    id: string;
    label: string;
    childNodeIds: string[];
    childGroupIds: string[];
    parentGroupId?: string;
    color?: string;
}

// ---------------------------------------------------------------------------
// Minimal LLM schema — compact format the LLM generates, which TypeScript
// code then expands into full Excalidraw JSON.  This is ~5x smaller than
// having the LLM emit verbose Excalidraw elements directly.
// ---------------------------------------------------------------------------

export type MinimalElementType =
    | "rectangle"
    | "ellipse"
    | "diamond"
    | "arrow"
    | "text"
    | "frame";

export interface MinimalElement {
    /** Unique element id, e.g. "shape-n1", "arrow-e1", "group-g1" */
    id: string;
    /** Element type */
    type: MinimalElementType;
    /** Display label (for shapes and arrows) */
    label?: string;
    /** X position */
    x: number;
    /** Y position */
    y: number;
    /** Width (not needed for arrows) */
    w?: number;
    /** Height (not needed for arrows) */
    h?: number;
    /** Group/frame ID this belongs to (for containment) */
    group?: string | null;
    /** For arrows: source element ID */
    from?: string;
    /** For arrows: target element ID */
    to?: string;
    /** Optional stroke style */
    style?: "dashed" | "dotted" | "solid";
    /** Optional background color */
    color?: string;
}

export interface MinimalDiagram {
    elements: MinimalElement[];
}

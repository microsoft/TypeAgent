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

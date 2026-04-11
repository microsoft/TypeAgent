// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Programmatic validation of Excalidraw JSON against a DiagramPlan.
 * Detects missing nodes, broken references, overlaps, containment violations, etc.
 * This is deterministic code — no LLM calls — so it's fast and reliable.
 */

import { DiagramPlan } from "./diagramPlan.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IssueSeverity = "error" | "warning";

export type IssueType =
    | "missing_node"
    | "missing_edge"
    | "missing_group"
    | "broken_reference"
    | "overlap"
    | "text_overflow"
    | "containment_violation"
    | "missing_bound_elements"
    | "missing_text_label";

export interface ValidationIssue {
    severity: IssueSeverity;
    type: IssueType;
    description: string;
    elementId?: string;
}

export interface ValidationResult {
    valid: boolean;
    issues: ValidationIssue[];
    stats: {
        expectedNodes: number;
        foundNodes: number;
        expectedEdges: number;
        foundEdges: number;
        expectedGroups: number;
        foundGroups: number;
        totalElements: number;
    };
}

// ---------------------------------------------------------------------------
// Excalidraw element shapes (minimal typing for validation)
// ---------------------------------------------------------------------------

interface ExcalidrawElement {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    containerId?: string | null;
    boundElements?: Array<{ id: string; type: string }> | null;
    startBinding?: { elementId: string } | null;
    endBinding?: { elementId: string } | null;
    [key: string]: unknown;
}

/**
 * Minimal document shape accepted by the validator.
 * Uses a loose type so callers don't need index signatures.
 */
export interface ValidatableDocument {
    elements: Array<Record<string, any>>;
}

// ---------------------------------------------------------------------------
// Main validation entry point
// ---------------------------------------------------------------------------

export function validateDiagram(
    doc: ValidatableDocument,
    plan: DiagramPlan,
): ValidationResult {
    const issues: ValidationIssue[] = [];
    const elements: ExcalidrawElement[] = (doc.elements ??
        []) as ExcalidrawElement[];
    const elementById = new Map(elements.map((e) => [e.id, e]));
    const elementIds = new Set(elements.map((e) => e.id));

    // -----------------------------------------------------------------------
    // 1. Completeness: every plan node has a corresponding shape element
    // -----------------------------------------------------------------------
    let foundNodes = 0;
    for (const node of plan.nodes) {
        const shapeId = `shape-${node.id}`;
        if (elementById.has(shapeId)) {
            foundNodes++;
        } else {
            issues.push({
                severity: "error",
                type: "missing_node",
                description: `Plan node "${node.id}" ("${node.label}") has no corresponding shape element "${shapeId}"`,
                elementId: shapeId,
            });
        }

        // Also check for the bound text label
        const textId = `text-${node.id}`;
        if (!elementById.has(textId)) {
            issues.push({
                severity: "error",
                type: "missing_text_label",
                description: `Plan node "${node.id}" has no text label element "${textId}"`,
                elementId: textId,
            });
        }
    }

    // -----------------------------------------------------------------------
    // 2. Completeness: every plan edge has a corresponding arrow element
    // -----------------------------------------------------------------------
    let foundEdges = 0;
    for (const edge of plan.edges) {
        const arrowId = `arrow-${edge.id}`;
        if (elementById.has(arrowId)) {
            foundEdges++;

            // Check arrow bindings
            const arrow = elementById.get(arrowId)!;
            if (arrow.startBinding?.elementId) {
                if (!elementIds.has(arrow.startBinding.elementId)) {
                    issues.push({
                        severity: "error",
                        type: "broken_reference",
                        description: `Arrow "${arrowId}" startBinding references non-existent element "${arrow.startBinding.elementId}"`,
                        elementId: arrowId,
                    });
                }
            }
            if (arrow.endBinding?.elementId) {
                if (!elementIds.has(arrow.endBinding.elementId)) {
                    issues.push({
                        severity: "error",
                        type: "broken_reference",
                        description: `Arrow "${arrowId}" endBinding references non-existent element "${arrow.endBinding.elementId}"`,
                        elementId: arrowId,
                    });
                }
            }
        } else {
            issues.push({
                severity: "error",
                type: "missing_edge",
                description: `Plan edge "${edge.id}" (${edge.sourceNodeId} → ${edge.targetNodeId}) has no corresponding arrow element "${arrowId}"`,
                elementId: arrowId,
            });
        }
    }

    // -----------------------------------------------------------------------
    // 3. Completeness: every plan group has a corresponding group rectangle
    // -----------------------------------------------------------------------
    let foundGroups = 0;
    for (const group of plan.groups) {
        const groupId = `group-${group.id}`;
        if (elementById.has(groupId)) {
            foundGroups++;
        } else {
            issues.push({
                severity: "error",
                type: "missing_group",
                description: `Plan group "${group.id}" ("${group.label}") has no corresponding group rectangle element "${groupId}"`,
                elementId: groupId,
            });
        }
    }

    // -----------------------------------------------------------------------
    // 4. Reference integrity: all containerId and binding references are valid
    // -----------------------------------------------------------------------
    for (const el of elements) {
        if (el.type === "text" && el.containerId) {
            if (!elementIds.has(el.containerId)) {
                issues.push({
                    severity: "error",
                    type: "broken_reference",
                    description: `Text "${el.id}" containerId references non-existent element "${el.containerId}"`,
                    elementId: el.id,
                });
            }
        }

        if (el.boundElements && Array.isArray(el.boundElements)) {
            for (const ref of el.boundElements) {
                if (!elementIds.has(ref.id)) {
                    issues.push({
                        severity: "warning",
                        type: "broken_reference",
                        description: `Element "${el.id}" boundElements references non-existent element "${ref.id}"`,
                        elementId: el.id,
                    });
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // 5. Containment: nodes with parentGroupId are spatially inside their group
    // -----------------------------------------------------------------------
    for (const node of plan.nodes) {
        if (!node.parentGroupId) continue;

        const shapeId = `shape-${node.id}`;
        const groupId = `group-${node.parentGroupId}`;
        const shape = elementById.get(shapeId);
        const group = elementById.get(groupId);

        if (shape && group) {
            if (!isInsideBounds(shape, group)) {
                issues.push({
                    severity: "error",
                    type: "containment_violation",
                    description:
                        `Node "${node.id}" ("${node.label}") is not spatially inside its parent group "${node.parentGroupId}". ` +
                        `Node bounds: (${shape.x}, ${shape.y}, ${shape.width}x${shape.height}), ` +
                        `Group bounds: (${group.x}, ${group.y}, ${group.width}x${group.height})`,
                    elementId: shapeId,
                });
            }
        }
    }

    // Also check nested groups
    for (const group of plan.groups) {
        if (!group.parentGroupId) continue;

        const innerGroupId = `group-${group.id}`;
        const outerGroupId = `group-${group.parentGroupId}`;
        const innerGroup = elementById.get(innerGroupId);
        const outerGroup = elementById.get(outerGroupId);

        if (innerGroup && outerGroup) {
            if (!isInsideBounds(innerGroup, outerGroup)) {
                issues.push({
                    severity: "error",
                    type: "containment_violation",
                    description: `Group "${group.id}" is not spatially inside its parent group "${group.parentGroupId}"`,
                    elementId: innerGroupId,
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // 6. Overlap detection: non-text shapes at the same level shouldn't overlap
    // -----------------------------------------------------------------------
    const nonTextShapes = elements.filter(
        (e) => e.type !== "text" && e.type !== "arrow" && e.type !== "line",
    );

    for (let i = 0; i < nonTextShapes.length; i++) {
        for (let j = i + 1; j < nonTextShapes.length; j++) {
            const a = nonTextShapes[i];
            const b = nonTextShapes[j];

            // Skip overlap check between a group and its children
            // (children are expected to be inside the group)
            if (isGroupChildPair(a, b, plan)) continue;

            if (shapesOverlap(a, b)) {
                issues.push({
                    severity: "warning",
                    type: "overlap",
                    description:
                        `Shapes "${a.id}" and "${b.id}" overlap. ` +
                        `A: (${a.x}, ${a.y}, ${a.width}x${a.height}), B: (${b.x}, ${b.y}, ${b.width}x${b.height})`,
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // 7. Text fit: text element width should not exceed container width
    // -----------------------------------------------------------------------
    for (const el of elements) {
        if (el.type === "text" && el.containerId && el.text) {
            const container = elementById.get(el.containerId);
            if (container) {
                const estimatedTextWidth = el.text.length * 10 + 10; // ~10px/char + margin
                if (estimatedTextWidth > container.width + 20) {
                    // 20px tolerance
                    issues.push({
                        severity: "warning",
                        type: "text_overflow",
                        description: `Text "${el.text}" (est. ${estimatedTextWidth}px) may overflow container "${el.containerId}" (${container.width}px wide)`,
                        elementId: el.id,
                    });
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // 8. Bound elements consistency: arrows should be listed in connected shapes
    // -----------------------------------------------------------------------
    for (const el of elements) {
        if (el.type !== "arrow") continue;

        for (const binding of [el.startBinding, el.endBinding]) {
            if (!binding?.elementId) continue;
            const shape = elementById.get(binding.elementId);
            if (!shape) continue;

            const bounds = shape.boundElements;
            if (!Array.isArray(bounds) || !bounds.some((b) => b.id === el.id)) {
                issues.push({
                    severity: "warning",
                    type: "missing_bound_elements",
                    description: `Shape "${binding.elementId}" does not list arrow "${el.id}" in its boundElements`,
                    elementId: binding.elementId,
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // Aggregate results
    // -----------------------------------------------------------------------
    const errorCount = issues.filter((i) => i.severity === "error").length;

    return {
        valid: errorCount === 0,
        issues,
        stats: {
            expectedNodes: plan.nodes.length,
            foundNodes,
            expectedEdges: plan.edges.length,
            foundEdges,
            expectedGroups: plan.groups.length,
            foundGroups,
            totalElements: elements.length,
        },
    };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function isInsideBounds(
    inner: ExcalidrawElement,
    outer: ExcalidrawElement,
): boolean {
    // Allow a small tolerance (5px) for minor misalignment
    const tolerance = 5;
    return (
        inner.x >= outer.x - tolerance &&
        inner.y >= outer.y - tolerance &&
        inner.x + inner.width <= outer.x + outer.width + tolerance &&
        inner.y + inner.height <= outer.y + outer.height + tolerance
    );
}

function shapesOverlap(a: ExcalidrawElement, b: ExcalidrawElement): boolean {
    // AABB overlap test
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}

/**
 * Returns true if one shape is a group rectangle and the other is a child
 * within that group (per the plan). In that case, overlap is expected.
 */
function isGroupChildPair(
    a: ExcalidrawElement,
    b: ExcalidrawElement,
    plan: DiagramPlan,
): boolean {
    // Check if a is a group and b is a child (or vice versa)
    return isChildOfGroup(a.id, b.id, plan) || isChildOfGroup(b.id, a.id, plan);
}

/**
 * Returns true if `childId` is the Excalidraw element of a node or group that
 * belongs inside the group whose Excalidraw element id is `groupElId`.
 */
function isChildOfGroup(
    groupElId: string,
    childElId: string,
    plan: DiagramPlan,
): boolean {
    // Group elements have id "group-<planGroupId>"
    if (!groupElId.startsWith("group-")) return false;
    const planGroupId = groupElId.substring("group-".length);

    const group = plan.groups.find((g) => g.id === planGroupId);
    if (!group) return false;

    const childNodeIds: string[] = group.childNodeIds ?? [];
    const childGroupIds: string[] = group.childGroupIds ?? [];

    // Child node elements have id "shape-<planNodeId>"
    if (childElId.startsWith("shape-")) {
        const planNodeId = childElId.substring("shape-".length);
        if (childNodeIds.includes(planNodeId)) return true;
    }

    // Child group elements have id "group-<planGroupId>"
    if (childElId.startsWith("group-")) {
        const childPlanGroupId = childElId.substring("group-".length);
        if (childGroupIds.includes(childPlanGroupId)) return true;
    }

    // Also check text labels of children (grouplabel-, text-)
    if (childElId.startsWith("text-")) {
        const planNodeId = childElId.substring("text-".length);
        if (childNodeIds.includes(planNodeId)) return true;
    }
    if (childElId.startsWith("grouplabel-")) {
        const childPlanGroupId = childElId.substring("grouplabel-".length);
        if (
            childGroupIds.includes(childPlanGroupId) ||
            childPlanGroupId === planGroupId
        )
            return true;
    }

    // Arrow labels
    if (childElId.startsWith("arrowlabel-") || childElId.startsWith("arrow-"))
        return false;

    return false;
}

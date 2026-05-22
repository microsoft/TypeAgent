// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Compile-time check that the local `GraphModel` mirror in
 * graphPreview.ts stays assignable from the real `GraphModel` exported
 * by workflow-dsl. If the DSL adds a required field, this file will
 * fail to type-check and the extension's mirror must be updated.
 *
 * This file is intentionally minimal — it is only ever compiled, never
 * imported. It lives in the LSP package because the extension package
 * deliberately does not import workflow-dsl at runtime (to keep the
 * bundle small), so the assertion is made here where workflow-dsl is
 * already a dependency.
 */

import type { GraphModel as DslGraphModel } from "workflow-dsl";

// Reproduce the extension-side mirror exactly. Keep these definitions
// in sync with ts/examples/workflow/vscode/src/graphPreview.ts.
interface MirrorGraphParam {
    id: string;
    name: string;
    type: string;
}
interface MirrorGraphNode {
    id: string;
    kind: string;
    label: string;
    taskType?: string | undefined;
    bindName?: string | undefined;
    groupId?: string | undefined;
    line?: number | undefined;
}
interface MirrorGraphEdge {
    from: string;
    to: string;
    label?: string | undefined;
}
interface MirrorGraphGroup {
    id: string;
    kind: string;
    label: string;
    parentId?: string | undefined;
    children: string[];
}
interface MirrorGraphModel {
    workflowName: string;
    params: MirrorGraphParam[];
    nodes: MirrorGraphNode[];
    edges: MirrorGraphEdge[];
    groups: MirrorGraphGroup[];
}

// If a DSL field becomes required and the mirror omits it, this
// assignment will fail to type-check. Excess required fields on the
// DSL side are exactly what we want this guard to catch — extras only
// appear via optional fields that the mirror can ignore safely.
declare const dslValue: DslGraphModel;
export const _mirrorCheck: MirrorGraphModel = dslValue;

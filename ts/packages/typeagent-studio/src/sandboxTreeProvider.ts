// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { StudioRuntime } from "@typeagent/core/runtime";
import {
    buildSandboxAgentNodes,
    buildSandboxRootNodes,
    type SandboxTreeNode,
} from "./sandboxTreePresentation.js";

/** View id contributed in package.json. */
export const SANDBOX_VIEW_ID = "typeagentStudioSandboxes";

/**
 * Thin VS Code adapter over the pure `sandboxTreePresentation` descriptors.
 * Structuring/labelling lives in that vscode-free module; this class only
 * resolves children from the runtime and maps descriptors to `TreeItem`s.
 */
export class SandboxTreeProvider
    implements vscode.TreeDataProvider<SandboxTreeNode>, vscode.Disposable
{
    private readonly emitter = new vscode.EventEmitter<
        SandboxTreeNode | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly subscription: { dispose(): void };

    constructor(private readonly runtime: StudioRuntime) {
        this.subscription = runtime.onSandboxChanged(() => this.refresh());
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    getTreeItem(node: SandboxTreeNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.label,
            node.hasChildren
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        item.id = node.id;
        item.description = node.description;
        item.tooltip = node.tooltip;
        item.contextValue = node.contextValue;
        item.iconPath = iconForNode(node);
        return item;
    }

    async getChildren(node?: SandboxTreeNode): Promise<SandboxTreeNode[]> {
        if (!node) {
            return buildSandboxRootNodes(await this.runtime.listSandboxes());
        }
        if (node.kind === "sandbox" && node.sandboxId) {
            const sandboxes = await this.runtime.listSandboxes();
            const match = sandboxes.find((s) => s.id === node.sandboxId);
            return match ? buildSandboxAgentNodes(match) : [];
        }
        return [];
    }

    dispose(): void {
        this.subscription.dispose();
        this.emitter.dispose();
    }
}

function iconForNode(node: SandboxTreeNode): vscode.ThemeIcon | undefined {
    switch (node.kind) {
        case "sandbox":
            return sandboxStateIcon(node.state);
        case "agent":
            return agentHealthIcon(node);
        case "empty":
        default:
            return new vscode.ThemeIcon("info");
    }
}

function sandboxStateIcon(state: SandboxTreeNode["state"]): vscode.ThemeIcon {
    switch (state) {
        case "running":
            return new vscode.ThemeIcon("vm-active");
        case "starting":
        case "stopping":
            return new vscode.ThemeIcon("loading~spin");
        case "crashed":
            return new vscode.ThemeIcon(
                "vm-outline",
                new vscode.ThemeColor("errorForeground"),
            );
        case "stopped":
        default:
            return new vscode.ThemeIcon("vm-outline");
    }
}

function agentHealthIcon(node: SandboxTreeNode): vscode.ThemeIcon {
    switch (node.health) {
        case "healthy":
            return new vscode.ThemeIcon(
                "pass",
                new vscode.ThemeColor("testing.iconPassed"),
            );
        case "warning":
            return new vscode.ThemeIcon(
                "warning",
                new vscode.ThemeColor("testing.iconQueued"),
            );
        case "error":
            return new vscode.ThemeIcon(
                "error",
                new vscode.ThemeColor("testing.iconFailed"),
            );
        case "unknown":
        default:
            return new vscode.ThemeIcon("circle-outline");
    }
}

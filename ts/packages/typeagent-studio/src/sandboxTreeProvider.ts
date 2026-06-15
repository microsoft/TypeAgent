// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import {
    buildSandboxAgentNodes,
    buildSandboxRootNodes,
    type SandboxTreeNode,
} from "./sandboxTreePresentation.js";
import type { SandboxSource } from "./sandboxSource.js";

/** View id contributed in package.json. */
export const SANDBOX_VIEW_ID = "typeagentStudioSandboxes";

/**
 * Thin VS Code adapter over the pure `sandboxTreePresentation` descriptors.
 * Structuring/labelling lives in that vscode-free module; this class only
 * resolves children from a {@link SandboxSource} (the studio service channel)
 * and maps descriptors to `TreeItem`s. Sandboxes have no in-process fallback —
 * when the service is disconnected the view is empty (connection state is
 * surfaced by the dedicated status-bar item, not as a row here).
 */
export class SandboxTreeProvider
    implements vscode.TreeDataProvider<SandboxTreeNode>, vscode.Disposable
{
    private readonly emitter = new vscode.EventEmitter<
        SandboxTreeNode | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly subscription: { dispose(): void };
    private connected = false;

    constructor(private readonly source: SandboxSource) {
        this.subscription = source.onSandboxChanged(() => this.refresh());
    }

    /** Reflect the studio service connection state (drives the empty view). */
    setConnected(connected: boolean): void {
        if (connected === this.connected) {
            return;
        }
        this.connected = connected;
        this.refresh();
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
            if (!this.connected) {
                // Empty when disconnected — the status-bar item shows the
                // connection state; it doesn't belong as a sandbox row.
                return [];
            }
            return buildSandboxRootNodes(await this.source.listSandboxes());
        }
        if (node.kind === "sandbox" && node.sandboxId) {
            const sandboxes = await this.source.listSandboxes();
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

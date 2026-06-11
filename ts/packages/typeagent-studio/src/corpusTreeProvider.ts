// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { StudioRuntime } from "./studioRuntimeCore.js";
import {
    buildCorpusAgentNodes,
    buildCorpusEntryNodes,
    buildCorpusSourceNodes,
    type CorpusTreeNode,
} from "./corpusTreePresentation.js";

/** View id contributed in package.json. */
export const CORPUS_VIEW_ID = "typeagentStudioCorpora";

/**
 * Thin VS Code adapter over the pure `corpusTreePresentation` descriptors.
 * Grouping/labelling lives in that vscode-free module; this class only
 * resolves children from the runtime and maps descriptors to `TreeItem`s.
 */
export class CorpusTreeProvider
    implements vscode.TreeDataProvider<CorpusTreeNode>, vscode.Disposable
{
    private readonly emitter = new vscode.EventEmitter<
        CorpusTreeNode | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly subscription: { dispose(): void };

    constructor(private readonly runtime: StudioRuntime) {
        // Loaded-agent set drives the agent rows, so refresh on sandbox
        // lifecycle changes (agent load/unload) as well as manual refresh.
        this.subscription = runtime.onSandboxChanged(() => this.refresh());
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    getTreeItem(node: CorpusTreeNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.label,
            node.hasChildren
                ? node.kind === "agent"
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );
        item.id = node.id;
        item.description = node.description;
        item.tooltip = node.tooltip;
        item.contextValue = node.contextValue;
        item.iconPath = iconForNode(node);
        return item;
    }

    async getChildren(node?: CorpusTreeNode): Promise<CorpusTreeNode[]> {
        if (!node) {
            return buildCorpusAgentNodes(await this.runtime.listCorpusAgents());
        }
        if (node.kind === "agent" && node.agent) {
            const entries = await this.runtime.listCorpusEntries(node.agent);
            return buildCorpusSourceNodes(node.agent, entries);
        }
        if (node.kind === "source" && node.agent && node.source) {
            const entries = await this.runtime.listCorpusEntries(node.agent);
            return buildCorpusEntryNodes(node.agent, node.source, entries);
        }
        return [];
    }

    dispose(): void {
        this.subscription.dispose();
        this.emitter.dispose();
    }
}

function iconForNode(node: CorpusTreeNode): vscode.ThemeIcon | undefined {
    switch (node.kind) {
        case "agent":
            return new vscode.ThemeIcon("library");
        case "source":
            return new vscode.ThemeIcon("folder");
        case "entry":
            return new vscode.ThemeIcon("comment");
        case "empty":
        default:
            return new vscode.ThemeIcon("info");
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { CorpusSource } from "./serviceRuntimeFacade.js";
import {
    buildCorpusAgentNodes,
    buildCorpusEntryNodes,
    buildCorpusSourceNodes,
    type CorpusTreeNode,
} from "./corpusTreePresentation.js";
import { BaseStudioTreeProvider } from "./baseTreeProvider.js";

/** View id contributed in package.json. */
export const CORPUS_VIEW_ID = "typeagentStudioCorpora";

/**
 * Thin VS Code adapter over the pure `corpusTreePresentation` descriptors.
 * Grouping/labelling lives in that vscode-free module; this class only
 * resolves children from the runtime and maps descriptors to `TreeItem`s.
 */
export class CorpusTreeProvider
    extends BaseStudioTreeProvider<CorpusTreeNode>
    implements vscode.Disposable
{
    private readonly subscription: { dispose(): void };

    constructor(private readonly source: CorpusSource) {
        super();
        // Loaded-agent set drives the agent rows, so refresh on sandbox
        // lifecycle changes (agent load/unload) as well as manual refresh.
        this.subscription = source.onSandboxChanged(() => this.refresh());
    }

    protected collapsibleState(
        node: CorpusTreeNode,
    ): vscode.TreeItemCollapsibleState {
        if (!node.hasChildren) {
            return vscode.TreeItemCollapsibleState.None;
        }
        return node.kind === "agent"
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
    }

    protected decorate(item: vscode.TreeItem, node: CorpusTreeNode): void {
        item.iconPath = iconForNode(node);
        // The seed empty-state row is clickable: selecting it runs the same
        // seed command as its inline button. The command shows a modal
        // confirmation before writing, so a corpus file is never created just
        // by selecting the row — this makes the row's affordance match the
        // obvious expectation (the bare inline `+` was easy to miss).
        if (node.contextValue === "corpusAgentSeed") {
            item.command = {
                command: "typeagent-studio.seedInRepoCorpus",
                title: "Seed in-repo corpus",
                arguments: [node],
            };
        }
    }

    async getChildren(node?: CorpusTreeNode): Promise<CorpusTreeNode[]> {
        if (!node) {
            // Disconnected: render nothing so the view's welcome content
            // ("connect to the Studio service") shows instead of a misleading
            // "No corpora available" placeholder.
            if (!this.connected) {
                return [];
            }
            return buildCorpusAgentNodes(await this.source.listCorpusAgents());
        }
        if (node.kind === "agent" && node.agent) {
            const entries = await this.source.listCorpusEntries(node.agent);
            return buildCorpusSourceNodes(node.agent, entries);
        }
        if (node.kind === "source" && node.agent && node.source) {
            const entries = await this.source.listCorpusEntries(node.agent);
            return buildCorpusEntryNodes(node.agent, node.source, entries);
        }
        return [];
    }

    dispose(): void {
        this.subscription.dispose();
        super.dispose();
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
            return new vscode.ThemeIcon(
                node.contextValue === "corpusAgentSeed" ? "new-file" : "info",
            );
        default:
            return new vscode.ThemeIcon("info");
    }
}

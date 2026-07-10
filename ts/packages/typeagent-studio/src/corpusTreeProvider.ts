// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import * as path from "node:path";
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
        if (node.kind === "source" && node.contextValue === "corpusFile") {
            // Render the row as the file it represents: setting resourceUri
            // gives the themed file icon and git decorations, while the
            // explicit label keeps the file name as the title.
            if (node.filePath) {
                item.resourceUri = vscode.Uri.file(node.filePath);
            }
        } else {
            item.iconPath = iconForNode(node);
        }
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
            // Show the native loading bar while connecting; once connected,
            // fetch and render rows (or the "no corpora" placeholder).
            await this.whenConnected();
            if (!this.connected) {
                return [];
            }
            return buildCorpusAgentNodes(await this.source.listCorpusAgents());
        }
        if (node.kind === "agent" && node.agent) {
            const [entries, inRepoFilePath] = await Promise.all([
                this.source.listCorpusEntries(node.agent),
                this.resolveExistingInRepoFile(node.agent),
            ]);
            return buildCorpusSourceNodes(node.agent, entries, inRepoFilePath);
        }
        if (node.kind === "source" && node.agent) {
            const entries = await this.source.listCorpusEntries(node.agent);
            return buildCorpusEntryNodes(node, entries);
        }
        return [];
    }

    /**
     * Absolute path of the agent's in-repo corpus file if it exists on disk.
     * Lets an existing but empty file still render as a row (rather than the
     * seed action). The path mirrors the service's canonical location.
     */
    private async resolveExistingInRepoFile(
        agent: string,
    ): Promise<string | undefined> {
        const repoRoot = this.source.getRepoRootInfo().repoRoot;
        if (!repoRoot) {
            return undefined;
        }
        const filePath = path.join(
            repoRoot,
            "corpus",
            `${agent}.utterances.jsonl`,
        );
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return filePath;
        } catch {
            return undefined;
        }
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
            // File-backed groups get their icon from resourceUri in `decorate`.
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

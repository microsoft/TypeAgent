// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";

/**
 * The descriptor fields every Studio tree row/node shares. Each view's
 * presentation module produces nodes with at least these; view-specific extras
 * (icon ids, navigation targets, expandability) live on the concrete node type.
 */
export interface StudioTreeNode {
    /** Stable identifier, unique across the displayed tree. */
    id: string;
    label: string;
    description?: string;
    tooltip?: string;
    contextValue?: string;
}

/**
 * Shared scaffolding for the extension's VS Code tree views (Event Log,
 * Collisions, Sandboxes, Corpora). It owns the parts every provider repeated
 * verbatim — the change emitter, the `connected` flag and its `setConnected`
 * gate, `refresh`, and the descriptor→`TreeItem` field mapping — so concrete
 * providers only supply what actually differs: how children are resolved
 * ({@link getChildren}), how a node collapses ({@link collapsibleState}), and
 * how it's decorated with an icon/command ({@link decorate}).
 *
 * Providers that hold a source subscription override {@link dispose} to tear it
 * down and then call `super.dispose()`.
 */
export abstract class BaseStudioTreeProvider<TNode extends StudioTreeNode>
    implements vscode.TreeDataProvider<TNode>, vscode.Disposable
{
    protected readonly emitter = new vscode.EventEmitter<TNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    protected connected = false;

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

    getTreeItem(node: TNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.label,
            this.collapsibleState(node),
        );
        item.id = node.id;
        item.description = node.description;
        item.tooltip = node.tooltip;
        item.contextValue = node.contextValue;
        this.decorate(item, node);
        return item;
    }

    abstract getChildren(node?: TNode): vscode.ProviderResult<TNode[]>;

    /** Leaf by default; expandable views override per node. */
    protected collapsibleState(_node: TNode): vscode.TreeItemCollapsibleState {
        return vscode.TreeItemCollapsibleState.None;
    }

    /** Apply the icon and (optionally) an activation command for a node. */
    protected decorate(_item: vscode.TreeItem, _node: TNode): void {}

    dispose(): void {
        this.emitter.dispose();
    }
}

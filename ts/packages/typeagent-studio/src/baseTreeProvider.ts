// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { TooltipModel } from "./tooltipModel.js";

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
    tooltip?: TooltipModel;
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

    // While disconnected, the root `getChildren` awaits this gate so VS Code
    // keeps the view's native loading bar showing (rather than a premature
    // empty view). It resolves on connect and re-arms on disconnect.
    private connectGate = newGate();

    /** Reflect the studio service connection state (drives the empty view). */
    setConnected(connected: boolean): void {
        if (connected === this.connected) {
            return;
        }
        this.connected = connected;
        if (connected) {
            this.connectGate.resolve();
        } else {
            // Re-arm so a dropped connection re-shows the loading bar.
            this.connectGate = newGate();
        }
        this.refresh();
    }

    /**
     * Hold the native loading bar until the service connects. Call this at the
     * root of {@link getChildren} (before fetching) so every view shows a
     * consistent "loading" state while connecting instead of a stale empty view.
     * Resolves immediately once connected (or on dispose).
     */
    protected async whenConnected(): Promise<void> {
        if (this.connected) {
            return;
        }
        await this.connectGate.promise;
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
        item.tooltip = node.tooltip
            ? renderMarkdownTooltip(node.tooltip)
            : undefined;
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
        // Release anyone awaiting the gate so pending getChildren settle.
        this.connectGate.resolve();
        this.emitter.dispose();
    }
}

/** A one-shot resolvable promise used to gate the loading bar on connection. */
function newGate(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

/**
 * Render a {@link TooltipModel} into a VS Code hover card: an optional bold
 * title, one `**Label:** value` row per field (values in `code` when `mono`),
 * and an optional trailing italic hint. Rows use a hard line break so the card
 * stays compact rather than double-spaced.
 */
function renderMarkdownTooltip(model: TooltipModel): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    const lines: string[] = [];
    if (model.title) {
        lines.push(`**${escapeMarkdown(model.title)}**`);
    }
    for (const field of model.fields) {
        const value = field.mono
            ? `\`${escapeInlineCode(field.value)}\``
            : escapeMarkdown(field.value);
        lines.push(`**${escapeMarkdown(field.label)}:** ${value}`);
    }
    if (model.hint) {
        lines.push(`_${escapeMarkdown(model.hint)}_`);
    }
    // Two trailing spaces force a hard break without a blank paragraph between.
    md.appendMarkdown(lines.join("  \n"));
    return md;
}

/** Escape the markdown control characters that would otherwise format a value. */
function escapeMarkdown(text: string): string {
    return text.replace(/([\\`*_{}\[\]()#+\-.!|<>])/g, "\\$1");
}

/** Backticks can't appear inside an inline code span, so neutralize them. */
function escapeInlineCode(text: string): string {
    return text.replace(/`/g, "'");
}

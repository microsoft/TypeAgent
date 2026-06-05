// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { CollisionDetectedEvent } from "@typeagent/core/events";
import type { StudioRuntime } from "./studioRuntimeCore.js";
import {
    buildCollisionChildRows,
    buildCollisionRows,
    type CollisionEntry,
    type CollisionRow,
} from "./collisionsPresentation.js";

/** View id contributed in package.json. */
export const COLLISIONS_VIEW_ID = "typeagentStudioCollisions";

/** Maximum number of collisions retained for display. */
export const COLLISIONS_CAPACITY = 200;

/**
 * Thin VS Code adapter over the pure `collisionsPresentation` descriptors. It
 * owns a bounded, newest-first list of collisions fed by the runtime's
 * collision subscription; summarization/labelling lives in the pure module.
 */
export class CollisionsTreeProvider
    implements vscode.TreeDataProvider<CollisionRow>, vscode.Disposable
{
    private readonly emitter = new vscode.EventEmitter<
        CollisionRow | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly subscription: { dispose(): void };
    private entries: CollisionEntry[] = [];
    private readonly entryBySeq = new Map<number, CollisionEntry>();
    private seq = 0;

    constructor(private readonly runtime: StudioRuntime) {
        this.subscription = runtime.onCollisionDetected(() => {
            void this.reload();
        });
        void this.reload();
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    /** Re-read collisions from the runtime (e.g. after a scan that may have
     *  cleared prior entries without emitting). */
    async reloadFromRuntime(): Promise<void> {
        await this.reload();
    }

    async clear(): Promise<void> {
        await this.runtime.clearCollisions();
        this.entries = [];
        this.entryBySeq.clear();
        this.refresh();
    }

    getTreeItem(row: CollisionRow): vscode.TreeItem {
        const item = new vscode.TreeItem(
            row.label,
            row.hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );
        item.id = row.id;
        item.description = row.description;
        item.tooltip = row.tooltip;
        item.contextValue = row.contextValue;
        item.iconPath = new vscode.ThemeIcon(row.icon);
        return item;
    }

    getChildren(row?: CollisionRow): CollisionRow[] {
        if (!row) {
            return buildCollisionRows(this.entries);
        }
        if (row.kind !== "collision") {
            return [];
        }
        const seq = parseSeq(row.id);
        const entry = seq === undefined ? undefined : this.entryBySeq.get(seq);
        return entry ? buildCollisionChildRows(entry) : [];
    }

    private async reload(): Promise<void> {
        const collisions = await this.runtime.listCollisions();
        // listCollisions returns newest-first; keep the most recent within cap.
        const capped = collisions.slice(0, COLLISIONS_CAPACITY);
        this.entries = [];
        this.entryBySeq.clear();
        for (const event of capped) {
            this.record(event);
        }
        this.refresh();
    }

    private record(event: CollisionDetectedEvent): void {
        const seq = this.seq++;
        const entry: CollisionEntry = { seq, event };
        this.entries.push(entry);
        this.entryBySeq.set(seq, entry);
    }

    dispose(): void {
        this.subscription.dispose();
        this.emitter.dispose();
    }
}

function parseSeq(id: string): number | undefined {
    const match = /^collision:(\d+)$/.exec(id);
    return match ? Number(match[1]) : undefined;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { CollisionDetectedEvent } from "@typeagent/core/events";
import type { GrammarScanSkip } from "@typeagent/core/collisionScanner";
import {
    buildCollisionChildRows,
    buildCollisionRows,
    buildSkippedRows,
    type CollisionEntry,
    type CollisionRow,
} from "./collisionsPresentation.js";
import { BaseStudioTreeProvider } from "./baseTreeProvider.js";
import type { CollisionsSource } from "./collisionsSource.js";

/** View id contributed in package.json. */
export const COLLISIONS_VIEW_ID = "typeagentStudioCollisions";

/** Maximum number of collisions retained for display. */
export const COLLISIONS_CAPACITY = 200;

/**
 * Thin VS Code adapter over the pure `collisionsPresentation` descriptors. It
 * owns a bounded, newest-first list of collisions fed by a
 * {@link CollisionsSource}; summarization/labelling lives in the pure module.
 *
 * The source can be swapped at runtime via {@link setSource} (cutting over from
 * the in-process runtime to the `studio` agent's service channel, with graceful
 * fallback). Each swap is fenced by a monotonic generation so a stale source's
 * in-flight reload or late collision event can't repopulate the tree.
 */
export class CollisionsTreeProvider
    extends BaseStudioTreeProvider<CollisionRow>
    implements vscode.Disposable
{
    private source: CollisionsSource;
    private subscription: { dispose(): void } | undefined;
    private entries: CollisionEntry[] = [];
    private readonly entryBySeq = new Map<number, CollisionEntry>();
    private skipped: GrammarScanSkip[] = [];
    private seq = 0;
    private generation = 0;

    constructor(source: CollisionsSource) {
        super();
        this.source = source;
        this.install(++this.generation);
    }

    /**
     * Replace the backing source: dispose the prior subscription, clear the
     * list (the new source is a different runtime), and re-read. Safe to call
     * repeatedly.
     */
    setSource(source: CollisionsSource): void {
        this.subscription?.dispose();
        this.subscription = undefined;
        this.entries = [];
        this.entryBySeq.clear();
        this.skipped = [];
        this.refresh();
        this.source = source;
        this.install(++this.generation);
    }

    /** Re-read collisions from the active source (e.g. after a scan). */
    async reload(): Promise<void> {
        await this.reloadFenced(this.generation);
    }

    /**
     * Replace the list of agents the most recent scan skipped. The Collisions
     * tree renders this as a "Skipped (N)" group above any detected
     * collisions so authors can see why an agent doesn't appear in results.
     */
    setSkipped(skipped: readonly GrammarScanSkip[]): void {
        this.skipped = [...skipped];
        this.refresh();
    }

    async clear(): Promise<void> {
        await this.source.clearCollisions();
        this.entries = [];
        this.entryBySeq.clear();
        this.skipped = [];
        this.refresh();
    }

    protected collapsibleState(
        row: CollisionRow,
    ): vscode.TreeItemCollapsibleState {
        return row.hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
    }

    protected decorate(item: vscode.TreeItem, row: CollisionRow): void {
        item.iconPath = new vscode.ThemeIcon(row.icon);
        if (row.openPath !== undefined) {
            item.command = {
                command: "vscode.open",
                title: "Open Grammar Source",
                arguments: [vscode.Uri.file(row.openPath)],
            };
        }
    }

    getChildren(row?: CollisionRow): CollisionRow[] {
        if (!row) {
            // Disconnected with nothing to show: render nothing so the view's
            // welcome content ("connect to the Studio service") shows instead
            // of a misleading "No collisions detected" check — nothing was
            // actually scanned.
            if (
                !this.connected &&
                this.entries.length === 0 &&
                this.skipped.length === 0
            ) {
                return [];
            }
            return buildCollisionRows(this.entries, this.skipped);
        }
        if (row.kind === "skipped-group") {
            return buildSkippedRows(this.skipped);
        }
        if (row.kind !== "collision") {
            return [];
        }
        const seq = parseSeq(row.id);
        const entry = seq === undefined ? undefined : this.entryBySeq.get(seq);
        return entry ? buildCollisionChildRows(entry) : [];
    }

    private install(gen: number): void {
        this.subscription = this.source.onCollisionDetected(() => {
            if (gen !== this.generation) {
                return; // stale source
            }
            void this.reloadFenced(gen);
        });
        void this.reloadFenced(gen);
    }

    private async reloadFenced(gen: number): Promise<void> {
        let collisions: CollisionDetectedEvent[];
        try {
            collisions = await this.source.listCollisions();
        } catch {
            return; // source unreachable; leave the current view
        }
        if (gen !== this.generation) {
            return; // superseded by a newer setSource
        }
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
        this.generation++; // invalidate any in-flight reload
        this.subscription?.dispose();
        this.subscription = undefined;
        super.dispose();
    }
}

function parseSeq(id: string): number | undefined {
    const match = /^collision:(\d+)$/.exec(id);
    return match ? Number(match[1]) : undefined;
}

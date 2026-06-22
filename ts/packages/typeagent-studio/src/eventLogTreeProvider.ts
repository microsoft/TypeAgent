// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { StudioEvent } from "@typeagent/core/events";
import {
    buildEventLogRows,
    iconForEvent,
    type EventLogEntry,
    type EventLogRow,
} from "./eventLogPresentation.js";
import { BaseStudioTreeProvider } from "./baseTreeProvider.js";
import type { EventLogSource } from "./eventLogSource.js";

/** View id contributed in package.json. */
export const EVENT_LOG_VIEW_ID = "typeagentStudioEvents";

/** Maximum number of events retained for display. */
export const EVENT_LOG_CAPACITY = 200;

/**
 * Thin VS Code adapter over the pure `eventLogPresentation` descriptors. It
 * owns a bounded, newest-first ring of recent events fed by an
 * {@link EventLogSource}; summarization/labelling lives in the pure module.
 *
 * The source can be swapped at runtime via {@link setSource} — e.g. cutting
 * over from the extension's in-process runtime to the `studio` agent's service
 * channel (Option B) and falling back on disconnect. Each swap is fenced by a
 * monotonic generation so a stale source's in-flight seed or late event can't
 * repopulate the tree after it's been replaced.
 */
export class EventLogTreeProvider
    extends BaseStudioTreeProvider<EventLogRow>
    implements vscode.Disposable
{
    private subscription: { dispose(): void } | undefined;
    private readonly entries: EventLogEntry[] = [];
    private readonly eventById = new Map<string, StudioEvent>();
    private seq = 0;
    private generation = 0;

    constructor(source: EventLogSource) {
        super();
        this.install(source, ++this.generation);
    }

    /**
     * Replace the backing source. Disposes the previous subscription, clears the
     * ring (the new source is a different runtime — its events are the new
     * truth), and re-seeds. Safe to call repeatedly.
     */
    setSource(source: EventLogSource): void {
        this.subscription?.dispose();
        this.subscription = undefined;
        this.entries.length = 0;
        this.eventById.clear();
        this.refresh();
        this.install(source, ++this.generation);
    }

    clear(): void {
        this.entries.length = 0;
        this.eventById.clear();
        this.refresh();
    }

    protected decorate(item: vscode.TreeItem, row: EventLogRow): void {
        const event = this.eventById.get(row.id);
        item.iconPath = new vscode.ThemeIcon(
            row.kind === "event" && event ? iconForEvent(event) : "info",
        );
    }

    getChildren(row?: EventLogRow): EventLogRow[] {
        if (row) {
            return [];
        }
        // Disconnected with nothing buffered: render nothing so the view's
        // welcome content ("connect to the Studio service") shows instead of a
        // misleading "No events yet" placeholder.
        if (!this.connected && this.entries.length === 0) {
            return [];
        }
        return buildEventLogRows(this.entries);
    }

    /**
     * Subscribe first (buffering live events) then seed from the snapshot, so a
     * burst arriving during the async seed is neither lost nor mis-ordered:
     * seeded events (older) land below buffered live events (newer) in the
     * newest-first ring. All work is fenced by `gen`.
     */
    private install(source: EventLogSource, gen: number): void {
        const buffered: StudioEvent[] = [];
        let seeded = false;
        this.subscription = source.onAnyEvent((event) => {
            if (gen !== this.generation) {
                return; // stale source — superseded by a newer setSource
            }
            if (!seeded) {
                buffered.push(event);
                return;
            }
            this.push(event);
        });
        void (async () => {
            let recent: StudioEvent[] = [];
            try {
                recent = await source.queryRecentEvents(EVENT_LOG_CAPACITY);
            } catch {
                // Source unreachable mid-seed; live events (if any) still flow.
            }
            if (gen !== this.generation) {
                return; // superseded while seeding
            }
            // queryRecentEvents returns oldest-first; record in order so the
            // newest ends up at the head of the newest-first ring.
            for (const event of recent) {
                this.record(event);
            }
            seeded = true;
            // Flush live events that arrived during the seed (oldest-first), so
            // they sit above the seeded snapshot as the newest entries.
            for (const event of buffered) {
                this.record(event);
            }
            buffered.length = 0;
            this.refresh();
        })();
    }

    private push(event: StudioEvent): void {
        this.record(event);
        this.refresh();
    }

    private record(event: StudioEvent): void {
        const id = `event:${this.seq++}`;
        this.entries.unshift({ seq: this.seq - 1, event });
        this.eventById.set(id, event);
        while (this.entries.length > EVENT_LOG_CAPACITY) {
            const removed = this.entries.pop();
            if (removed) {
                this.eventById.delete(`event:${removed.seq}`);
            }
        }
    }

    dispose(): void {
        this.generation++; // invalidate any in-flight seed
        this.subscription?.dispose();
        this.subscription = undefined;
        super.dispose();
    }
}

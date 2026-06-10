// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { StudioEvent } from "@typeagent/core/events";
import type { StudioRuntime } from "./studioRuntimeCore.js";
import {
    buildEventLogRows,
    iconForEvent,
    type EventLogEntry,
    type EventLogRow,
} from "./eventLogPresentation.js";

/** View id contributed in package.json. */
export const EVENT_LOG_VIEW_ID = "typeagentStudioEvents";

/** Maximum number of events retained for display. */
export const EVENT_LOG_CAPACITY = 200;

/**
 * Thin VS Code adapter over the pure `eventLogPresentation` descriptors. It
 * owns a bounded, newest-first ring of recent events fed by the runtime's
 * event subscription; summarization/labelling lives in the pure module.
 */
export class EventLogTreeProvider
    implements vscode.TreeDataProvider<EventLogRow>, vscode.Disposable
{
    private readonly emitter = new vscode.EventEmitter<
        EventLogRow | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;
    private readonly subscription: { dispose(): void };
    private readonly entries: EventLogEntry[] = [];
    private readonly eventById = new Map<string, StudioEvent>();
    private seq = 0;

    constructor(private readonly runtime: StudioRuntime) {
        this.subscription = runtime.onAnyEvent((event) => this.push(event));
        void this.seed();
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    clear(): void {
        this.entries.length = 0;
        this.eventById.clear();
        this.refresh();
    }

    getTreeItem(row: EventLogRow): vscode.TreeItem {
        const item = new vscode.TreeItem(
            row.label,
            vscode.TreeItemCollapsibleState.None,
        );
        item.id = row.id;
        item.description = row.description;
        item.tooltip = row.tooltip;
        item.contextValue = row.contextValue;
        const event = this.eventById.get(row.id);
        item.iconPath = new vscode.ThemeIcon(
            row.kind === "event" && event ? iconForEvent(event) : "info",
        );
        return item;
    }

    getChildren(row?: EventLogRow): EventLogRow[] {
        if (row) {
            return [];
        }
        return buildEventLogRows(this.entries);
    }

    private async seed(): Promise<void> {
        const recent = await this.runtime.queryRecentEvents(EVENT_LOG_CAPACITY);
        // queryRecentEvents returns oldest-first; push in order so the newest
        // ends up at the head of the newest-first ring.
        for (const event of recent) {
            this.record(event);
        }
        this.refresh();
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
        this.subscription.dispose();
        this.emitter.dispose();
    }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChunkGroup, IGroupIndex, TimeRange } from "./types.js";

/**
 * Group index: manages chunk groups (threads, sections, episodes)
 * and resolves temporal queries to groups to chunk ranges.
 *
 * Groups are also indexed as keywords in the inverted index
 * (their labels become searchable terms).
 */
export class GroupIndex implements IGroupIndex {
    private groups: Map<string, ChunkGroup> = new Map();
    /** Groups sorted by start time for efficient range queries */
    private sortedByTime: ChunkGroup[] = [];
    private needsSort = false;

    addGroup(group: ChunkGroup): void {
        this.groups.set(group.groupId, group);
        this.needsSort = true;
    }

    getGroup(groupId: string): ChunkGroup | undefined {
        return this.groups.get(groupId);
    }

    getGroupsByType(groupType: string): ChunkGroup[] {
        const result: ChunkGroup[] = [];
        for (const group of this.groups.values()) {
            if (group.groupType === groupType) result.push(group);
        }
        return result;
    }

    getGroupsInTimeRange(range: TimeRange): ChunkGroup[] {
        this.ensureSorted();
        const result: ChunkGroup[] = [];
        for (const group of this.sortedByTime) {
            if (!group.timeRange) continue;
            if (overlaps(group.timeRange, range)) {
                result.push(group);
            }
        }
        return result;
    }

    getChunkIdsForGroups(groupIds: string[]): Set<number> {
        const result = new Set<number>();
        for (const id of groupIds) {
            const group = this.groups.get(id);
            if (group) {
                for (const chunkId of group.chunkIds) {
                    result.add(chunkId);
                }
            }
        }
        return result;
    }

    getGroupCount(): number {
        return this.groups.size;
    }

    /** Get all groups */
    getAllGroups(): ChunkGroup[] {
        return Array.from(this.groups.values());
    }

    /**
     * Find groups whose label contains the given substring (case-insensitive).
     */
    findGroupsByLabel(labelSubstring: string): ChunkGroup[] {
        const lower = labelSubstring.toLowerCase();
        const result: ChunkGroup[] = [];
        for (const group of this.groups.values()) {
            if (group.label && group.label.toLowerCase().includes(lower)) {
                result.push(group);
            }
        }
        return result;
    }

    private ensureSorted(): void {
        if (!this.needsSort) return;
        this.sortedByTime = Array.from(this.groups.values()).filter(
            (g) => g.timeRange?.start,
        );
        this.sortedByTime.sort((a, b) => {
            const aStart = a.timeRange?.start ?? "";
            const bStart = b.timeRange?.start ?? "";
            return aStart.localeCompare(bStart);
        });
        this.needsSort = false;
    }
}

/** Check if two time ranges overlap */
function overlaps(a: TimeRange, b: TimeRange): boolean {
    // If either range is unbounded, it overlaps
    if (!a.start && !a.end) return true;
    if (!b.start && !b.end) return true;

    // a ends before b starts
    if (a.end && b.start && a.end < b.start) return false;
    // b ends before a starts
    if (b.end && a.start && b.end < a.start) return false;

    return true;
}

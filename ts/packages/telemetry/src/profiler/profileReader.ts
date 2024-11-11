// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
const debugError = registerDebug("typeagent:profiler:reader:error");

// Entries create by ProfileLogger
type ProfileCommonEntry = {
    type: "mark" | "start" | "stop";
    measureId: number;
    timestamp: number;
    data: unknown;
};

type ProfileMarkEntry = ProfileCommonEntry & {
    type: "mark";
    name: string;
};

type ProfileStartEntry = ProfileCommonEntry & {
    type: "start";
    name: string;
    parentId: number | undefined;
};

type ProfileStopEntry = ProfileCommonEntry & {
    type: "stop";
};

export type ProfileEntry =
    | ProfileMarkEntry
    | ProfileStartEntry
    | ProfileStopEntry;

export type UnreadProfileEntries = {
    id: number;
    entries: ProfileEntry[];
};

export type ProfileMeasure = {
    name: string;
    start: number;
    startData: unknown;
    endData?: unknown;
    duration?: number;
    marks: ProfileMark[];
    measures: ProfileMeasure[];
};

export type ProfileMark = {
    name: string;
    data: unknown;
    timestamp: number;
    duration: number;
};

export class ProfileReader {
    private readId = 0;
    private readonly rootMeasures: ProfileMeasure[] = [];
    private readonly pendingEntries = new Map<number, ProfileEntry[]>();
    private readonly measuresById = new Map<number, ProfileMeasure>();
    private readonly measuresByName = new Map<string, ProfileMeasure[]>();
    constructor() {}

    public addEntries(entries: UnreadProfileEntries) {
        if (entries.id === this.readId) {
            this.readId++;
            this.processEntries(entries.entries);
            while (this.pendingEntries.has(this.readId)) {
                const nextEntries = this.pendingEntries.get(this.readId)!;
                this.pendingEntries.delete(this.readId);
                this.readId++;
                this.processEntries(nextEntries);
            }
        } else {
            this.pendingEntries.set(entries.id, entries.entries);
        }
    }

    public getMeasures(
        name: string,
        filter?: unknown | ((data: unknown) => boolean),
    ) {
        const measures = this.measuresByName.get(name);
        if (measures !== undefined && filter !== undefined) {
            return measures.filter(
                typeof filter === "function"
                    ? (m) => filter(m.startData)
                    : (m) => m.startData === filter,
            );
        }
        return measures;
    }

    private processEntries(entries: ProfileEntry[]) {
        for (const entry of entries) {
            switch (entry.type) {
                case "start":
                    this.processStart(entry);
                    break;
                case "mark":
                    this.processMark(entry);
                    break;
                case "stop":
                    this.processStop(entry);
                    break;
            }
        }
    }

    private processStart(entry: ProfileStartEntry) {
        const id = entry.measureId;
        const measure = this.measuresById.get(id);
        if (measure === undefined) {
            const newMeasure = {
                name: entry.name,
                start: entry.timestamp,
                marks: [],
                measures: [],
                startData: entry.data,
            };
            this.measuresById.set(id, newMeasure);
            const measureEntries = this.measuresByName.get(entry.name);
            if (measureEntries === undefined) {
                this.measuresByName.set(entry.name, [newMeasure]);
            } else {
                measureEntries.push(newMeasure);
            }

            if (entry.parentId) {
                const parent = this.measuresById.get(entry.parentId);
                if (parent) {
                    parent.measures.push(newMeasure);
                } else {
                    debugError(
                        `Parent entry for new measure id not found: ${entry.parentId}`,
                    );
                }
            } else {
                this.rootMeasures.push(newMeasure);
            }
        } else {
            debugError(`Start entry for existing measure id: ${id}`);
        }
    }
    private processMark(entry: ProfileMarkEntry) {
        const id = entry.measureId!;
        const measure = this.measuresById.get(id);
        if (measure) {
            const newMark = {
                name: entry.name,
                data: entry.data,
                duration: entry.timestamp - measure.start,
                timestamp: entry.timestamp,
            };
            measure.marks.push(newMark);
        } else {
            debugError(`Mark entry for unknown measure id: ${id}`);
        }
    }
    private processStop(entry: ProfileStopEntry) {
        const id = entry.measureId;
        const measure = this.measuresById.get(id);
        if (measure) {
            measure.duration = entry.timestamp - measure.start;
            measure.endData = entry.data;
        } else {
            debugError(`Stop entry for unknown measure id: ${id}`);
        }
    }
}

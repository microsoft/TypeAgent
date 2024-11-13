// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ProfileEntry, UnreadProfileEntries } from "./profileReader.js";
import registerDebug from "debug";
import { Profiler } from "./profiler.js";

const debug = registerDebug("typeagent:profiler");

export type ProfileLogger = {
    measure(name: string, start?: boolean, data?: unknown): Profiler;
    getUnreadEntries(): UnreadProfileEntries | undefined;
};

export function createProfileLogger(): ProfileLogger {
    return new ProfilerImpl();
}

class ProfilerImpl {
    private readonly readEntries: ProfileEntry[][] = [];
    private unreadEntries: ProfileEntry[] = [];
    private nextMeasureId = 0;
    private nextReadId = 0;

    private addEntry(entry: ProfileEntry) {
        debug(entry);
        this.unreadEntries.push(entry);
    }
    private createMeasure(
        name: string,
        start: boolean,
        data: unknown,
        parentId?: number,
    ): Profiler {
        let started = false;
        let stopped = false;
        const measureId = this.nextMeasureId++;

        const profiler: Profiler = {
            start: (data?: unknown) => {
                if (started) {
                    return false;
                }
                started = true;
                this.addEntry({
                    type: "start",
                    measureId,
                    timestamp: performance.now(),
                    data,
                    parentId,
                    name,
                });
                return true;
            },
            measure: (name: string, start: boolean = true, data?: unknown) => {
                return this.createMeasure(name, start, data, measureId);
            },
            mark: (name: string, data?: unknown) => {
                // continue to allow marks after stop
                if (!started) {
                    return false;
                }
                this.addEntry({
                    type: "mark",
                    measureId,
                    timestamp: performance.now(),
                    data,
                    name,
                });
                return true;
            },
            stop: (data?: unknown) => {
                if (!started || stopped) {
                    return false;
                }
                stopped = true;
                this.addEntry({
                    type: "stop",
                    measureId,
                    timestamp: performance.now(),
                    data,
                });
                return true;
            },
        };

        if (start) {
            profiler.start(data);
        }
        return profiler;
    }

    public measure(
        name: string,
        start: boolean = true,
        data?: unknown,
    ): Profiler {
        return this.createMeasure(name, start, data);
    }

    public getUnreadEntries(): UnreadProfileEntries | undefined {
        const entries = this.unreadEntries;
        if (entries.length === 0) {
            return undefined;
        }
        const id = this.nextReadId++;
        debug(`Reading ${entries.length} entries (${id})`);
        this.readEntries.push(entries);
        this.unreadEntries = [];
        return {
            id,
            entries,
        };
    }
}

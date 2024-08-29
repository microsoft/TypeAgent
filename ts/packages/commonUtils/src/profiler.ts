// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StopWatch } from "common-utils";

export class Profiler {
    private static instance: Profiler;
    private timers: Map<string, StopWatch> = new Map<string, StopWatch>();
    private marks: Map<string, Map<string, number>> = new Map<
        string,
        Map<string, number>
    >();
    private llmCallCount: Map<string, number> = new Map<string, number>();
    private entityCount: Map<string, number> = new Map<string, number>();

    constructor() {
        this.timers = new Map<string, StopWatch>();
    }

    public static getInstance = (): Profiler => {
        if (!Profiler.instance) {
            Profiler.instance = new Profiler();
        }
        return Profiler.instance;
    };

    public start(key: string | undefined) {
        if (key === undefined) {
            return;
        }

        if (!this.timers.has(key)) {
            this.timers.set(key, new StopWatch());
            this.marks.set(key, new Map<string, number>());
            this.llmCallCount.set(key, 0);
            this.entityCount.set(key, 0);
        }

        this.timers.get(key)?.start();
    }

    public stop(key: string | undefined) {
        if (key === undefined) {
            return;
        }

        if (this.timers.has(key)) {
            this.timers.get(key)?.stop();
        }
    }

    public get(key: string | undefined): StopWatch | undefined {
        if (key === undefined) {
            return undefined;
        }

        return this.timers.get(key);
    }

    /**
     * Creates a time mark associated with a specific profiling key.  Typically used
     * to checkpoint multiple times in a set of related operations
     * @parameter the key for the profiler we are marking
     * @param markName the name of the mark
     */
    public mark(key: string | undefined, markName: string): boolean {
        if (key === undefined || !this.marks.has(key)) {
            return false;
        }

        let m = this.marks.get(key);
        m?.set(markName, this.get(key)?.elapsedMs as number);

        return true;
    }

    public getMarks(key: string | undefined) {
        if (key === undefined) {
            return undefined;
        }

        return this.marks.get(key);
    }

    public incrementLLMCallCount(key: string | undefined) {
        if (key === undefined) {
            return undefined;
        }

        let value: number = this.llmCallCount.get(key) as number;
        this.llmCallCount.set(key, value + 1);
    }

    public setEntityCount(key: string | undefined, value: number) {
        if (key === undefined) {
            return undefined;
        }

        this.entityCount.set(key, value);
    }

    public getMetrics(key: string | undefined): any {
        if (key === undefined || !this.marks.has(key)) {
            return undefined;
        }

        return {
            duration: this.get(key)?.elapsedMs,
            llmCallCount: this.llmCallCount.get(key),
            entityCount: this.entityCount.get(key),
            marks: this.getMarks(key),
        };
    }
}

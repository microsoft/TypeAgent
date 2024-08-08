// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InteractiveIo } from "./InteractiveIo";

/**
 * Timer for perf measurements
 */
export class StopWatch {
    private _startTime: number = 0;
    private _elapsedMs: number = 0;

    constructor() {}

    public get elapsedMs(): number {
        return this._elapsedMs;
    }

    public get elapsedSeconds(): number {
        return this._elapsedMs / 1000;
    }

    /**
     * Return time elapsed as a printable string
     * @param inSeconds default is true
     * @returns printable string for time elapsed
     */
    public elapsedString(inSeconds: boolean = true): string {
        return inSeconds
            ? `[${this.elapsedSeconds.toFixed(3)}s]`
            : `[${this._elapsedMs.toFixed(3)}ms]`;
    }

    /**
     * start the stop watch
     */
    public start(): void {
        this._startTime = performance.now();
        this._elapsedMs = 0;
    }

    /**
     * stop the watch
     * @returns elapsed time in milliseconds
     */
    public stop(io?: InteractiveIo): number {
        const endTime = performance.now();
        this._elapsedMs = endTime - this._startTime;
        if (io) {
            io.writer.write(this.elapsedString());
        }
        return this._elapsedMs;
    }

    public reset(): void {
        this._startTime = this._elapsedMs = 0;
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";

/**
 * Timer for perf measurements
 */
export class StopWatch {
    private _startTime: number = 0;
    private _elapsedMs: number = 0;

    constructor(start: boolean = false) {
        if (start) {
            this.start();
        }
    }

    public get elapsedMs(): number {
        if (this._startTime > 0 && this._elapsedMs == 0) {
            return performance.now() - this._startTime;
        }

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
            ? `${this.elapsedSeconds.toFixed(3)}s`
            : `${this._elapsedMs.toFixed(3)}ms`;
    }

    /**
     * start the stop watch
     */
    public start(label?: string): void {
        if (label) {
            console.log(label);
        }
        this._startTime = performance.now();
        this._elapsedMs = 0;
    }

    /**
     * stop the watch
     * @returns elapsed time in milliseconds
     */
    public stop(label?: string): number {
        const endTime = performance.now();
        this._elapsedMs = endTime - this._startTime;
        if (label) {
            this.log(label);
        }
        return this._elapsedMs;
    }

    public reset(): void {
        this._startTime = this._elapsedMs = 0;
    }

    public log(label: string, inSeconds: boolean = true): void {
        let elapsed = `[${this.elapsedString(inSeconds)}]`;
        let text = `${chalk.gray(label)} ${chalk.green(elapsed)}`;
        console.log(text);
    }
}

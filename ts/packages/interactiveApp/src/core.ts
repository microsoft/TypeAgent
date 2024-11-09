// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "child_process";
import { InteractiveIo } from "./InteractiveIo";
import fs from "fs";

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
        return `[${millisecondsToString(this._elapsedMs, inSeconds ? "s" : "ms")}]`;
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

export function millisecondsToString(ms: number, format: "ms" | "s" | "m") {
    let time = ms;
    switch (format) {
        default:
            break;
        case "s":
            time /= 1000;
            break;
        case "m":
            time /= 1000 * 60;
            break;
    }
    return `${time.toFixed(3)}${format}`;
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runExe(
    exePath: string,
    args: string[] | undefined,
    io: InteractiveIo,
): Promise<boolean> {
    if (!fs.existsSync(exePath)) {
        return Promise.resolve(false);
    }
    return new Promise((resolve, reject) => {
        try {
            const process = spawn(exePath, args);
            process.stdout.on("data", (text: string) => {
                io.writer.write(text);
            });
            process.stderr.on("data", (text: string) => {
                io.writer.write(text);
            });
            process.on("error", (error) => {
                reject(error);
            });
            process.on("close", (code) => {
                if (code === 0) {
                    resolve(true);
                } else {
                    reject(`Exit with code ${code}`);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

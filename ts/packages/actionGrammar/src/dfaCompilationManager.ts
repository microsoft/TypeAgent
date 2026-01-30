// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import path from "path";
import { NFA } from "./nfa.js";
import { DFA } from "./dfa.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:grammar:dfa");

/**
 * Status of a DFA compilation
 */
export type DFACompilationStatus =
    | "pending"
    | "compiling"
    | "completed"
    | "failed";

/**
 * Information about a DFA compilation
 */
export interface DFACompilationInfo {
    /** Agent/grammar name */
    name: string;

    /** Current status */
    status: DFACompilationStatus;

    /** Compiled DFA (if completed) */
    dfa?: DFA;

    /** Error message (if failed) */
    error?: string;

    /** Compilation time in milliseconds (if completed or failed) */
    compilationTimeMs?: number;

    /** When compilation started */
    startedAt?: Date;

    /** When compilation completed */
    completedAt?: Date;
}

/**
 * Manages async DFA compilation in worker threads
 */
export class DFACompilationManager {
    private compilations = new Map<string, DFACompilationInfo>();
    private workers: Worker[] = [];
    private workerScriptPath: string;

    constructor() {
        // Resolve path to worker script
        // Note: This assumes we're running from compiled JS in dist/
        const currentFile = fileURLToPath(import.meta.url);
        const currentDir = path.dirname(currentFile);
        this.workerScriptPath = path.join(currentDir, "dfaWorker.js");
    }

    /**
     * Request async compilation of an NFA to DFA
     *
     * @param name Unique name for this compilation (e.g., agent name)
     * @param nfa The NFA to compile
     * @returns Promise that resolves when compilation is complete
     */
    async compileDFA(name: string, nfa: NFA): Promise<DFA> {
        // Check if already compiling or completed
        const existing = this.compilations.get(name);
        if (existing) {
            if (existing.status === "completed" && existing.dfa) {
                debug(`DFA for ${name} already compiled, returning cached`);
                return existing.dfa;
            }

            if (existing.status === "compiling") {
                debug(`DFA for ${name} already compiling, waiting...`);
                return this.waitForCompilation(name);
            }
        }

        // Create compilation info
        const info: DFACompilationInfo = {
            name,
            status: "pending",
            startedAt: new Date(),
        };

        this.compilations.set(name, info);

        // Start compilation
        return this.startCompilation(name, nfa);
    }

    /**
     * Get compilation status for a specific name
     */
    getCompilationStatus(name: string): DFACompilationInfo | undefined {
        return this.compilations.get(name);
    }

    /**
     * Get DFA if compilation is complete, otherwise return undefined
     */
    getDFA(name: string): DFA | undefined {
        const info = this.compilations.get(name);
        return info?.status === "completed" ? info.dfa : undefined;
    }

    /**
     * Cancel all pending/running compilations and cleanup workers
     */
    async shutdown(): Promise<void> {
        debug(`Shutting down DFA compilation manager...`);

        // Terminate all workers
        await Promise.all(this.workers.map((worker) => worker.terminate()));

        this.workers = [];
        this.compilations.clear();

        debug(`DFA compilation manager shut down`);
    }

    /**
     * Start compilation in a worker thread
     */
    private async startCompilation(name: string, nfa: NFA): Promise<DFA> {
        return new Promise((resolve, reject) => {
            const info = this.compilations.get(name);
            if (!info) {
                reject(new Error(`Compilation info not found for ${name}`));
                return;
            }

            info.status = "compiling";

            debug(`Starting DFA compilation for ${name}...`);

            // Create worker
            let worker: Worker;
            try {
                worker = new Worker(this.workerScriptPath);
            } catch (error) {
                debug(`Failed to create worker: ${error}`);
                info.status = "failed";
                info.error = `Failed to create worker: ${error}`;
                info.completedAt = new Date();
                info.compilationTimeMs =
                    info.completedAt.getTime() -
                    (info.startedAt?.getTime() || 0);
                reject(error);
                return;
            }

            // Track worker
            this.workers.push(worker);

            // Handle worker messages
            worker.on("message", (result: any) => {
                debug(
                    `DFA compilation for ${name} completed in ${result.compilationTimeMs}ms`,
                );

                info.completedAt = new Date();
                info.compilationTimeMs = result.compilationTimeMs;

                if (result.success && result.dfa) {
                    info.status = "completed";
                    info.dfa = result.dfa;
                    resolve(result.dfa);
                } else {
                    info.status = "failed";
                    info.error = result.error || "Unknown error";
                    reject(new Error(info.error));
                }

                // Cleanup worker
                worker.terminate();
                const index = this.workers.indexOf(worker);
                if (index !== -1) {
                    this.workers.splice(index, 1);
                }
            });

            // Handle worker errors
            worker.on("error", (error) => {
                debug(`DFA compilation worker error for ${name}: ${error}`);

                info.status = "failed";
                info.error = error.message;
                info.completedAt = new Date();
                info.compilationTimeMs =
                    info.completedAt.getTime() -
                    (info.startedAt?.getTime() || 0);

                reject(error);

                // Cleanup worker
                const index = this.workers.indexOf(worker);
                if (index !== -1) {
                    this.workers.splice(index, 1);
                }
            });

            // Send compilation request to worker
            worker.postMessage({ nfa, name });
        });
    }

    /**
     * Wait for an in-progress compilation to complete
     */
    private async waitForCompilation(name: string): Promise<DFA> {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                const info = this.compilations.get(name);

                if (!info) {
                    clearInterval(checkInterval);
                    reject(new Error(`Compilation ${name} not found`));
                    return;
                }

                if (info.status === "completed" && info.dfa) {
                    clearInterval(checkInterval);
                    resolve(info.dfa);
                } else if (info.status === "failed") {
                    clearInterval(checkInterval);
                    reject(new Error(info.error || "Compilation failed"));
                }
            }, 100);

            // Timeout after 30 seconds
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error(`Compilation timeout for ${name}`));
            }, 30000);
        });
    }
}

/**
 * Global DFA compilation manager instance
 */
export const globalDFACompilationManager = new DFACompilationManager();

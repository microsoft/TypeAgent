// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PipelineTrace } from "./types.mjs";
import registerDebug from "debug";

const debugBenchmark = registerDebug("typeagent:benchmark");

interface DebugLogEntry {
    namespace: string;
    message: string;
    timestamp: number;
}

export class TraceCollector {
    private logs: DebugLogEntry[] = [];
    private originalWrite: typeof process.stderr.write | undefined;
    private collecting = false;

    startCollecting(): void {
        if (this.collecting) return;
        this.collecting = true;
        this.logs = [];

        // Intercept stderr (where debug writes) to capture log output
        this.originalWrite = process.stderr.write;
        const self = this;
        process.stderr.write = function (
            chunk: string | Uint8Array,
            ...args: any[]
        ): boolean {
            const text =
                typeof chunk === "string"
                    ? chunk
                    : new TextDecoder().decode(chunk);
            self.logs.push({
                namespace: self.extractNamespace(text),
                message: text,
                timestamp: Date.now(),
            });
            // Still write to stderr for visibility during development
            return self.originalWrite!.call(process.stderr, chunk, ...args);
        } as typeof process.stderr.write;
    }

    stopCollecting(): void {
        if (!this.collecting) return;
        this.collecting = false;
        if (this.originalWrite) {
            process.stderr.write = this.originalWrite;
            this.originalWrite = undefined;
        }
    }

    buildTrace(utterance: string, startTime: number): PipelineTrace {
        const trace: PipelineTrace = {
            utterance,
            grammarMatchAttempted: false,
            grammarMatchResult: "no-match",
            llmTranslationAttempted: false,
            executionAttempted: false,
            fallbackTriggered: false,
            reasoningInvoked: false,
            totalTimeMs: Date.now() - startTime,
        };

        for (const log of this.logs) {
            this.processLogEntry(log, trace);
        }

        return trace;
    }

    getCollectedLogs(): DebugLogEntry[] {
        return [...this.logs];
    }

    clearLogs(): void {
        this.logs = [];
    }

    private extractNamespace(text: string): string {
        const match = text.match(/^(\s*)(typeagent:\S+)/);
        return match ? match[2] : "unknown";
    }

    private processLogEntry(entry: DebugLogEntry, trace: PipelineTrace): void {
        const msg = entry.message;

        // Grammar match detection
        if (msg.includes("grammarStore") || msg.includes("Cache Validation")) {
            trace.grammarMatchAttempted = true;
            if (
                msg.includes("Validation Success") ||
                msg.includes("accepted")
            ) {
                trace.grammarMatchResult = "match";
            } else if (msg.includes("Rejected") || msg.includes("rejected")) {
                trace.grammarMatchResult = "rejected";
            }
        }

        // Agent/action detection from grammar match
        if (msg.includes("powershell") && msg.includes("executeAction")) {
            trace.matchedAgent = "powershell";
        }

        // Execution detection
        if (msg.includes("powershell:handler")) {
            trace.executionAttempted = true;
        }

        // Fallback detection
        if (msg.includes("fallbackToReasoning")) {
            trace.fallbackTriggered = true;
        }

        // Reasoning detection
        if (msg.includes("executeReasoning") || msg.includes("reasoning")) {
            trace.reasoningInvoked = true;
        }
    }
}

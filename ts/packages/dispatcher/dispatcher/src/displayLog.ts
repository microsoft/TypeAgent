// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AppendDisplayEntry,
    DisplayLogEntry,
    PendingInteractionEntry,
    SetDisplayInfoEntry,
    IAgentMessage,
    RequestId,
    PendingInteractionRequest,
} from "@typeagent/dispatcher-types";

import fs from "node:fs";
import path from "node:path";

export type { DisplayLogEntry } from "@typeagent/dispatcher-types";

// =============================================
// Display Log
// =============================================

const displayLogFileName = "displayLog.json";

export class DisplayLog {
    private entries: DisplayLogEntry[] = [];
    private nextSeq: number = 0;
    private dirty: boolean = false;
    private saveTimer: ReturnType<typeof setImmediate> | undefined = undefined;

    constructor(private readonly dirPath: string | undefined) {}

    /**
     * Load an existing display log from disk.
     * Returns a new DisplayLog instance. If no file exists, returns an empty log.
     */
    static async load(dirPath: string | undefined): Promise<DisplayLog> {
        const log = new DisplayLog(dirPath);
        if (dirPath === undefined) {
            return log;
        }
        const filePath = path.join(dirPath, displayLogFileName);
        try {
            const data = await fs.promises.readFile(filePath, "utf-8");
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                log.entries = parsed;
                log.nextSeq =
                    parsed.length > 0 ? parsed[parsed.length - 1].seq + 1 : 0;
            }
        } catch {
            // File doesn't exist or is malformed — start fresh
        }
        return log;
    }

    /**
     * Append a set-display entry.
     * @returns the assigned sequence number
     */
    logSetDisplay(message: IAgentMessage): number {
        const seq = this.nextSeq++;
        this.entries.push({
            type: "set-display",
            seq,
            timestamp: Date.now(),
            message,
        });
        this.dirty = true;
        return seq;
    }

    /**
     * Append an append-display entry.
     * @returns the assigned sequence number
     */
    logAppendDisplay(
        message: IAgentMessage,
        mode: AppendDisplayEntry["mode"],
    ): number {
        const seq = this.nextSeq++;
        this.entries.push({
            type: "append-display",
            seq,
            timestamp: Date.now(),
            message,
            mode,
        });
        this.dirty = true;
        return seq;
    }

    /**
     * Append a set-display-info entry.
     * @returns the assigned sequence number
     */
    logSetDisplayInfo(
        requestId: RequestId,
        source: string,
        actionIndex?: number | undefined,
        action?: SetDisplayInfoEntry["action"],
    ): number {
        const seq = this.nextSeq++;
        const entry: SetDisplayInfoEntry = {
            type: "set-display-info",
            seq,
            timestamp: Date.now(),
            requestId,
            source,
        };
        if (actionIndex !== undefined) {
            entry.actionIndex = actionIndex;
        }
        if (action !== undefined) {
            entry.action = action;
        }
        this.entries.push(entry);
        this.dirty = true;
        return seq;
    }

    /**
     * Append a notify entry.
     * @returns the assigned sequence number
     */
    logNotify(
        notificationId: string | RequestId | undefined,
        event: string,
        data: any,
        source: string,
    ): number {
        const seq = this.nextSeq++;
        this.entries.push({
            type: "notify",
            seq,
            timestamp: Date.now(),
            notificationId,
            event,
            data,
            source,
        });
        this.dirty = true;
        return seq;
    }

    /**
     * Append a user-request entry.
     * @returns the assigned sequence number
     */
    logUserRequest(requestId: RequestId, command: string): number {
        const seq = this.nextSeq++;
        this.entries.push({
            type: "user-request",
            seq,
            timestamp: Date.now(),
            requestId,
            command,
        });
        this.dirty = true;
        return seq;
    }

    /**
     * Get the current max sequence number, or -1 if the log is empty.
     */
    getSeq(): number {
        return this.nextSeq - 1;
    }

    /**
     * Get entries, optionally filtering to only those after a given sequence number.
     */
    getEntries(afterSeq?: number): DisplayLogEntry[] {
        if (afterSeq === undefined) {
            return [...this.entries];
        }
        // Binary search for the first entry with seq > afterSeq
        let lo = 0;
        let hi = this.entries.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.entries[mid].seq <= afterSeq) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return this.entries.slice(lo);
    }

    /**
     * Clear all entries.
     */
    clear(): void {
        this.entries.length = 0;
        this.nextSeq = 0;
        this.dirty = true;
    }

    /**
     * Append a pending-interaction entry.
     * @returns the assigned sequence number
     */
    logPendingInteraction(interaction: PendingInteractionRequest): number {
        const seq = this.nextSeq++;
        const entry: PendingInteractionEntry = {
            type: "pending-interaction",
            seq,
            timestamp: interaction.timestamp,
            interactionId: interaction.interactionId,
            interactionType: interaction.type,
            source: interaction.source,
        };
        if (interaction.requestId !== undefined) {
            entry.requestId = interaction.requestId;
        }
        if (interaction.type === "askYesNo") {
            entry.message = interaction.message;
            if (interaction.defaultValue !== undefined) {
                entry.defaultValue = interaction.defaultValue;
            }
        } else if (interaction.type === "popupQuestion") {
            entry.message = interaction.message;
            entry.choices = interaction.choices;
            if (interaction.defaultId !== undefined) {
                entry.defaultId = interaction.defaultId;
            }
        } else if (interaction.type === "proposeAction") {
            entry.actionTemplates = interaction.actionTemplates;
        }
        this.entries.push(entry);
        this.dirty = true;
        return seq;
    }

    /**
     * Append an interaction-resolved entry.
     * @returns the assigned sequence number
     */
    logInteractionResolved(interactionId: string, response: unknown): number {
        const seq = this.nextSeq++;
        let safeResponse: unknown;
        try {
            safeResponse = JSON.parse(JSON.stringify(response));
        } catch {
            safeResponse = String(response);
        }
        this.entries.push({
            type: "interaction-resolved",
            seq,
            timestamp: Date.now(),
            interactionId,
            response: safeResponse,
        });
        this.dirty = true;
        return seq;
    }

    /**
     * Append an interaction-cancelled entry.
     * @returns the assigned sequence number
     */
    logInteractionCancelled(interactionId: string): number {
        const seq = this.nextSeq++;
        this.entries.push({
            type: "interaction-cancelled",
            seq,
            timestamp: Date.now(),
            interactionId,
        });
        this.dirty = true;
        return seq;
    }

    /**
     * Schedule a save at the end of the current event-loop tick.
     * Multiple calls within the same tick are coalesced into one write.
     */
    saveQueued(): void {
        if (this.saveTimer !== undefined) return;
        this.saveTimer = setImmediate(() => {
            this.saveTimer = undefined;
            this.save().catch(() => {});
        });
    }

    /**
     * Persist the log to disk. No-op if there's no session directory or nothing changed.
     */
    async save(): Promise<void> {
        if (this.dirPath === undefined || !this.dirty) {
            return;
        }
        const filePath = path.join(this.dirPath, displayLogFileName);
        await fs.promises.writeFile(
            filePath,
            JSON.stringify(this.entries),
            "utf-8",
        );
        this.dirty = false;
    }
}

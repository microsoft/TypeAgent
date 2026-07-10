// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";

import type { CorpusEntry, CorpusService } from "./types.js";
import {
    displayLogToCorpusEntries,
    type CaptureLogEntry,
} from "./captureTransform.js";

/** The subset of the corpus service the importer needs. */
export type CaptureSink = Pick<CorpusService, "list" | "append" | "promote">;

export interface CaptureImportResult {
    /** Entries written, per agent. */
    perAgent: Record<string, number>;
    /** Entries dropped as already present (in-batch or existing), per agent. */
    skipped: Record<string, number>;
    /** Total entries written across all agents. */
    total: number;
    /** Logical ids written, per agent (write order). */
    idsByAgent: Record<string, string[]>;
}

/**
 * Write capture entries to the corpus, one `append` per agent.
 *
 * Entries are bucketed by agent and deduped by logical id: duplicates within
 * the batch collapse (latest wins), and entries whose id already exists in the
 * agent's federated corpus are skipped. Each agent receives a single `append`
 * call, avoiding the capture-file name collision that repeated same-agent
 * appends would cause.
 */
export async function importCaptureEntries(
    corpus: CaptureSink,
    entries: CorpusEntry[],
): Promise<CaptureImportResult> {
    const perAgent: Record<string, number> = {};
    const skipped: Record<string, number> = {};
    const idsByAgent: Record<string, string[]> = {};

    const byAgent = new Map<string, Map<string, CorpusEntry>>();
    for (const entry of entries) {
        let batch = byAgent.get(entry.agent);
        if (batch === undefined) {
            batch = new Map<string, CorpusEntry>();
            byAgent.set(entry.agent, batch);
        }
        if (batch.has(entry.id)) {
            skipped[entry.agent] = (skipped[entry.agent] ?? 0) + 1;
        }
        // Latest wins on a logical-id collision within the batch.
        batch.set(entry.id, entry);
    }

    let total = 0;
    for (const [agent, batch] of byAgent) {
        const existing = await corpus.list(agent);
        const existingIds = new Set(existing.map((e) => e.id));
        const fresh: CorpusEntry[] = [];
        for (const entry of batch.values()) {
            if (existingIds.has(entry.id)) {
                skipped[agent] = (skipped[agent] ?? 0) + 1;
            } else {
                fresh.push(entry);
            }
        }
        if (fresh.length > 0) {
            await corpus.append(agent, fresh);
            perAgent[agent] = fresh.length;
            idsByAgent[agent] = fresh.map((e) => e.id);
            total += fresh.length;
        }
    }

    return { perAgent, skipped, total, idsByAgent };
}

export interface ImportDisplayLogsOptions {
    /** Restrict capture to these agents; omit to accept any non-empty agent. */
    agents?: string[];
    /** Session identifier recorded in provenance. */
    sessionId?: string;
    /** Clock for `capturedAt`; defaults to `Date.now`. */
    now?: () => number;
}

export interface ImportDisplayLogsResult extends CaptureImportResult {
    /** Display-log files that were read and parsed. */
    files: string[];
}

/**
 * Read one or more `displayLog.json` files, turn their entries into corpus
 * entries, and write them into the shared in-repo corpus.
 *
 * Files that are missing, unreadable, or not a JSON array are skipped. When
 * `agents` is supplied it acts as an allowlist; otherwise any non-empty agent is
 * captured. Fresh entries are staged and then promoted into the in-repo file in
 * one step, leaving no private capture staging behind.
 */
export async function importDisplayLogs(
    corpus: CaptureSink,
    paths: string[],
    opts: ImportDisplayLogsOptions = {},
): Promise<ImportDisplayLogsResult> {
    const allow = opts.agents !== undefined ? new Set(opts.agents) : undefined;
    const agentFilter =
        allow !== undefined ? (agent: string) => allow.has(agent) : undefined;

    const all: CorpusEntry[] = [];
    const files: string[] = [];
    for (const filePath of paths) {
        const entries = await readDisplayLog(filePath);
        if (entries === undefined) {
            continue;
        }
        files.push(filePath);
        all.push(
            ...displayLogToCorpusEntries(entries, {
                sourceUri: filePath,
                ...(agentFilter !== undefined ? { agentFilter } : {}),
                ...(opts.sessionId !== undefined
                    ? { sessionId: opts.sessionId }
                    : {}),
                ...(opts.now !== undefined ? { now: opts.now } : {}),
            }),
        );
    }

    const result = await importCaptureEntries(corpus, all);
    for (const [agent, ids] of Object.entries(result.idsByAgent)) {
        if (ids.length > 0) {
            await corpus.promote(agent, ids, "in-repo");
        }
    }
    return { ...result, files };
}

async function readDisplayLog(
    filePath: string,
): Promise<CaptureLogEntry[] | undefined> {
    let text: string;
    try {
        text = await fs.readFile(filePath, "utf8");
    } catch {
        return undefined;
    }
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed)
            ? (parsed as CaptureLogEntry[])
            : undefined;
    } catch {
        return undefined;
    }
}

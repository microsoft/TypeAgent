// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { FeedbackCategory, FeedbackRating } from "../events/types.js";

/**
 * Corpus federation type surface.
 *
 * A "corpus" here is the union of utterance examples used to evaluate an
 * agent. Entries come from four kinds of sources federated into a single
 * view: in-repo files committed alongside the agent, captures recorded
 * locally during interactive use, external sources declared in
 * `.typeagent/studio.json`, and feedback rows.
 */
export type CorpusSource = "in-repo" | "captures" | "external" | "feedback";

/** Label attached to a corpus entry when feedback exists for its requestId. */
export interface FeedbackLabel {
    rating: FeedbackRating;
    category?: FeedbackCategory;
    comment?: string;
    recordedAt: number;
}

export interface CorpusProvenance {
    /** File path or remote URI the entry was loaded from. */
    sourceUri: string;
    /**
     * Original source the entry was captured from (e.g. a displayLog path),
     * preserved across `append`, which overwrites `sourceUri` with the captures
     * file path.
     */
    rawSourceUri?: string;
    /** When the entry was originally captured (epoch ms). */
    capturedAt?: number;
    sessionId?: string;
    requestId?: string;
}

export interface CorpusEntry {
    /** Stable hash of `(utterance, agent, requestId|"")`. */
    id: string;
    utterance: string;
    agent: string;
    source: CorpusSource;
    provenance: CorpusProvenance;
    /** Typed action JSON when known (e.g. captured from a successful run). */
    expectedAction?: unknown;
    feedback?: FeedbackLabel;
    tags?: string[];
}

export interface CorpusFilter {
    /** Restrict to a subset of sources. */
    sources?: CorpusSource[];
    /** Lowercase substring match against `utterance`. */
    utteranceContains?: string;
    /** Entries must include at least one of these tags. */
    tagsAny?: string[];
    /** Entries must include all of these tags. */
    tagsAll?: string[];
    /** Only entries with feedback (true) or without (false). */
    hasFeedback?: boolean;
    /** Restrict by feedback rating; implies `hasFeedback: true`. */
    feedbackRating?: FeedbackRating;
    /** `capturedAt` >= since (epoch ms). */
    since?: number;
    /** `capturedAt` <= until (epoch ms). */
    until?: number;
}

export type ExternalSourceKind = "jsonl-file";

export interface ExternalSourceSpec {
    /** Stable name shown in UI; unique per agent. */
    name: string;
    agent: string;
    kind: ExternalSourceKind;
    /** For `jsonl-file`: absolute path to a JSONL file. */
    filePath: string;
}

/** Minimal writable surface; matches the subset of `node:stream.Writable`
 *  the corpus service uses for export. */
export interface CorpusWritable {
    write(chunk: string): boolean | void;
    end?(): void;
}

export interface CorpusService {
    list(agent: string, filter?: CorpusFilter): Promise<CorpusEntry[]>;
    load(agent: string, filter?: CorpusFilter): AsyncIterable<CorpusEntry>;
    /** Append entries to the captures store for `agent`. Returns the file path written. */
    append(agent: string, entries: CorpusEntry[]): Promise<string>;
    /** Move entries by id from captures into the in-repo corpus file. */
    promote(agent: string, ids: string[], target: "in-repo"): Promise<number>;
    exportJsonl(
        agent: string,
        out: CorpusWritable,
        filter?: CorpusFilter,
    ): Promise<number>;
    addExternalSource(spec: ExternalSourceSpec): Promise<void>;
    removeExternalSource(agent: string, name: string): Promise<void>;
    listExternalSources(agent?: string): Promise<ExternalSourceSpec[]>;
    /**
     * Ensure the in-repo corpus file (`<repoRoot>/corpus/<agent>.utterances.jsonl`)
     * exists so an author can start populating it. Creates an empty file (and
     * its parent directory) when absent. Returns the path and whether it was
     * newly created.
     */
    seedInRepoCorpus(
        agent: string,
    ): Promise<{ path: string; created: boolean }>;
}

/** Thrown when promotion references ids not found in captures. */
export class CorpusEntryNotFoundError extends Error {
    constructor(public readonly ids: string[]) {
        super(`Corpus entries not found in captures: ${ids.join(", ")}`);
        this.name = "CorpusEntryNotFoundError";
    }
}

/** Thrown when an external source registration conflicts on (agent, name). */
export class ExternalSourceExistsError extends Error {
    constructor(
        public readonly agent: string,
        public readonly name: string,
    ) {
        super(`External source already registered: ${agent}/${name}`);
        this.name = "ExternalSourceExistsError";
    }
}

/**
 * Thrown when an agent name can't be used as a single path segment (e.g. it
 * contains a path separator or `..`), which would let corpus file operations
 * escape `<repoRoot>/corpus`.
 */
export class InvalidAgentNameError extends Error {
    constructor(public readonly agent: string) {
        super(`Invalid agent name (must be a single path segment): ${agent}`);
        this.name = "InvalidAgentNameError";
    }
}

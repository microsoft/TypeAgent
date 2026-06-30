// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readJsonlFile, writeJsonlFile } from "./jsonl.js";
import {
    CorpusEntryNotFoundError,
    ExternalSourceExistsError,
    InvalidAgentNameError,
    type CorpusEntry,
    type CorpusFilter,
    type CorpusService,
    type CorpusWritable,
    type ExternalSourceSpec,
    type FeedbackLabel,
} from "./types.js";

/**
 * Provider hook for feedback rows. Supplied as an injected provider against the
 * live dispatcher feedback sink; the default is empty so the corpus service can
 * operate without it.
 */
export type FeedbackEntryProvider = (agent: string) => Promise<CorpusEntry[]>;

export interface FileCorpusServiceOptions {
    /** Repository root; in-repo corpus + studio.json live here. */
    repoRoot: string;
    /** Profile directory; captures live here. */
    profileDir: string;
    /** Optional source for feedback entries; defaults to empty. */
    feedbackProvider?: FeedbackEntryProvider;
    now?: () => number;
}

const STUDIO_CONFIG_RELATIVE = path.join(".typeagent", "studio.json");

interface StudioConfigFile {
    externalSources?: ExternalSourceSpec[];
}

/**
 * Filesystem-backed corpus service.
 *
 * Federates three sources into a single view per agent:
 *  - in-repo  : `<repoRoot>/corpus/<agent>.utterances.jsonl`
 *  - external : files declared in `<repoRoot>/.typeagent/studio.json`
 *  - feedback : supplied by an injected provider
 *
 * `captures/<agent>/` is a private, transient staging area used only while an
 * import promotes entries into the in-repo file; it is never part of the
 * federated view. Promotion is the only write that touches the in-repo file;
 * everything else writes inside the profile directory or the studio config.
 */
export class FileCorpusService implements CorpusService {
    private readonly repoRoot: string;
    private readonly profileDir: string;
    private readonly feedbackProvider: FeedbackEntryProvider;
    private readonly now: () => number;

    constructor(opts: FileCorpusServiceOptions) {
        this.repoRoot = opts.repoRoot;
        this.profileDir = opts.profileDir;
        this.feedbackProvider = opts.feedbackProvider ?? (async () => []);
        this.now = opts.now ?? Date.now;
    }

    async list(agent: string, filter?: CorpusFilter): Promise<CorpusEntry[]> {
        const all = await this.loadAll(agent);
        return filter ? all.filter((e) => matchesFilter(e, filter)) : all;
    }

    async *load(
        agent: string,
        filter?: CorpusFilter,
    ): AsyncIterable<CorpusEntry> {
        for (const e of await this.list(agent, filter)) {
            yield e;
        }
    }

    async append(agent: string, entries: CorpusEntry[]): Promise<string> {
        const dir = this.capturesDir(agent);
        await fs.mkdir(dir, { recursive: true });
        const file = await this.uniqueCaptureFile(dir);
        const stamped = entries.map((e) => ({
            ...e,
            source: "captures" as const,
            provenance: {
                ...e.provenance,
                sourceUri: file,
                capturedAt: e.provenance.capturedAt ?? this.now(),
            },
        }));
        await writeJsonlFile(file, stamped);
        return file;
    }

    /**
     * Pick a capture file path that does not already exist. The base name is a
     * timestamp, so two appends within the same millisecond would otherwise
     * collide and overwrite each other; a numeric suffix disambiguates.
     */
    private async uniqueCaptureFile(dir: string): Promise<string> {
        const stamp = captureFileStamp(this.now());
        let file = path.join(dir, `${stamp}.jsonl`);
        let n = 1;
        for (;;) {
            try {
                await fs.access(file);
            } catch {
                return file;
            }
            file = path.join(dir, `${stamp}-${n}.jsonl`);
            n++;
        }
    }

    async promote(
        agent: string,
        ids: string[],
        target: "in-repo",
    ): Promise<number> {
        if (target !== "in-repo") {
            throw new Error(`Unsupported promotion target: ${target}`);
        }
        const dir = this.capturesDir(agent);
        const files = await listJsonlFiles(dir);
        const idSet = new Set(ids);
        const found = new Map<string, CorpusEntry>();
        const remainingByFile = new Map<string, CorpusEntry[]>();
        for (const file of files) {
            const entries = await readJsonlFile(file);
            const keep: CorpusEntry[] = [];
            for (const e of entries) {
                if (idSet.has(e.id) && !found.has(e.id)) {
                    found.set(e.id, e);
                } else {
                    keep.push(e);
                }
            }
            remainingByFile.set(file, keep);
        }
        if (found.size !== idSet.size) {
            const missing = ids.filter((id) => !found.has(id));
            throw new CorpusEntryNotFoundError(missing);
        }

        const inRepoFile = this.inRepoFile(agent);
        await fs.mkdir(path.dirname(inRepoFile), { recursive: true });
        const existing = await readJsonlFile(inRepoFile);
        const existingIds = new Set(existing.map((e) => e.id));
        const promoted = [...found.values()].map((e) => ({
            ...e,
            source: "in-repo" as const,
            provenance: { ...e.provenance, sourceUri: inRepoFile },
        }));
        const merged = [
            ...existing,
            ...promoted.filter((e) => !existingIds.has(e.id)),
        ];
        await writeJsonlFile(inRepoFile, merged);

        // Rewrite each captures file with the surviving entries.
        for (const [file, keep] of remainingByFile) {
            if (keep.length === 0) {
                await fs.unlink(file).catch(() => undefined);
            } else {
                await writeJsonlFile(file, keep);
            }
        }
        return promoted.length;
    }

    async exportJsonl(
        agent: string,
        out: CorpusWritable,
        filter?: CorpusFilter,
    ): Promise<number> {
        const entries = await this.list(agent, filter);
        for (const e of entries) {
            out.write(JSON.stringify(e) + "\n");
        }
        out.end?.();
        return entries.length;
    }

    async addExternalSource(spec: ExternalSourceSpec): Promise<void> {
        const cfg = await this.readStudioConfig();
        const sources = cfg.externalSources ?? [];
        if (
            sources.some((s) => s.agent === spec.agent && s.name === spec.name)
        ) {
            throw new ExternalSourceExistsError(spec.agent, spec.name);
        }
        sources.push(spec);
        await this.writeStudioConfig({ ...cfg, externalSources: sources });
    }

    async removeExternalSource(agent: string, name: string): Promise<void> {
        const cfg = await this.readStudioConfig();
        const sources = (cfg.externalSources ?? []).filter(
            (s) => !(s.agent === agent && s.name === name),
        );
        await this.writeStudioConfig({ ...cfg, externalSources: sources });
    }

    async listExternalSources(agent?: string): Promise<ExternalSourceSpec[]> {
        const cfg = await this.readStudioConfig();
        const all = cfg.externalSources ?? [];
        return agent ? all.filter((s) => s.agent === agent) : all;
    }

    async seedInRepoCorpus(
        agent: string,
    ): Promise<{ path: string; created: boolean }> {
        const file = this.inRepoFile(agent);
        try {
            await fs.access(file);
            return { path: file, created: false };
        } catch {
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, "", "utf8");
            return { path: file, created: true };
        }
    }

    /* ---------------------------------------------------------------- */
    /* internal                                                          */
    /* ---------------------------------------------------------------- */

    private inRepoFile(agent: string): string {
        assertSafeAgentSegment(agent);
        return path.join(this.repoRoot, "corpus", `${agent}.utterances.jsonl`);
    }

    private capturesDir(agent: string): string {
        assertSafeAgentSegment(agent);
        return path.join(this.profileDir, "captures", agent);
    }

    private studioConfigPath(): string {
        return path.join(this.repoRoot, STUDIO_CONFIG_RELATIVE);
    }

    private async readStudioConfig(): Promise<StudioConfigFile> {
        try {
            const text = await fs.readFile(this.studioConfigPath(), "utf8");
            const parsed = JSON.parse(text);
            return parsed && typeof parsed === "object"
                ? (parsed as StudioConfigFile)
                : {};
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return {};
            }
            throw err;
        }
    }

    private async writeStudioConfig(cfg: StudioConfigFile): Promise<void> {
        const file = this.studioConfigPath();
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    }

    private async loadAll(agent: string): Promise<CorpusEntry[]> {
        const out: CorpusEntry[] = [];
        const seen = new Set<string>();
        const push = (entries: CorpusEntry[]) => {
            for (const e of entries) {
                if (!seen.has(e.id)) {
                    seen.add(e.id);
                    out.push(e);
                }
            }
        };

        push(await readJsonlFile(this.inRepoFile(agent)));

        const externals = await this.listExternalSources(agent);
        for (const spec of externals) {
            if (spec.kind === "jsonl-file") {
                push(await readJsonlFile(spec.filePath));
            }
        }

        push(await this.feedbackProvider(agent));

        return out;
    }
}

function captureFileStamp(ts: number): string {
    return new Date(ts).toISOString().replace(/[:.]/g, "-");
}

/**
 * Guard against path traversal: an agent name is used to build corpus file
 * paths, so it must be a single, separator-free path segment (and not `.` /
 * `..`). Rejects e.g. `"../secrets"` before it can escape the corpus root.
 */
function assertSafeAgentSegment(agent: string): void {
    if (
        agent.length === 0 ||
        agent === "." ||
        agent === ".." ||
        agent.includes("/") ||
        agent.includes("\\") ||
        agent.includes("\0")
    ) {
        throw new InvalidAgentNameError(agent);
    }
}

async function listJsonlFiles(dir: string): Promise<string[]> {
    let entries: import("node:fs").Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
        }
        throw err;
    }
    return entries
        .filter((d) => d.isFile() && d.name.endsWith(".jsonl"))
        .map((d) => path.join(dir, d.name))
        .sort();
}

function attachFeedback(entry: CorpusEntry, label: FeedbackLabel): CorpusEntry {
    return { ...entry, feedback: label };
}

export { attachFeedback };

function matchesFilter(entry: CorpusEntry, filter: CorpusFilter): boolean {
    if (filter.sources && !filter.sources.includes(entry.source)) {
        return false;
    }
    if (filter.utteranceContains) {
        const needle = filter.utteranceContains.toLowerCase();
        if (!entry.utterance.toLowerCase().includes(needle)) {
            return false;
        }
    }
    if (filter.tagsAny && filter.tagsAny.length > 0) {
        const tags = entry.tags ?? [];
        if (!filter.tagsAny.some((t) => tags.includes(t))) {
            return false;
        }
    }
    if (filter.tagsAll && filter.tagsAll.length > 0) {
        const tags = entry.tags ?? [];
        if (!filter.tagsAll.every((t) => tags.includes(t))) {
            return false;
        }
    }
    if (filter.hasFeedback !== undefined) {
        const has = entry.feedback !== undefined;
        if (has !== filter.hasFeedback) {
            return false;
        }
    }
    if (filter.feedbackRating) {
        if (entry.feedback?.rating !== filter.feedbackRating) {
            return false;
        }
    }
    if (filter.since !== undefined) {
        const at = entry.provenance.capturedAt;
        if (at === undefined || at < filter.since) {
            return false;
        }
    }
    if (filter.until !== undefined) {
        const at = entry.provenance.capturedAt;
        if (at === undefined || at > filter.until) {
            return false;
        }
    }
    return true;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { mkdir, readFile, rename, rm, access, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import git from "isomorphic-git";
import lockfile from "proper-lockfile";
import { writeRunbookJson } from "./durableRunbookJson.js";
import { retryProcedurePublication } from "./procedurePublication.js";

const ref = "refs/heads/typeagent-history";

async function exists(file: string): Promise<boolean> {
    try {
        await access(file);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

export interface HistorySnapshot<T> {
    head: string | null;
    state: T;
}

export type ViewHistoryFaultPoint =
    | "blob"
    | "tree"
    | "commit"
    | "ref"
    | "purge-prepared"
    | "purge-swapped"
    | "purge-cleaned";

export class ViewHistory<T> {
    private readonly gitdir: string;
    private readonly gate: string;
    private readonly filesystem;

    public constructor(
        private readonly directory: string,
        private readonly empty: () => T,
        private readonly checkpoint?: (
            point: ViewHistoryFaultPoint,
        ) => Promise<void>,
    ) {
        this.gitdir = path.join(directory, "view-history.git");
        this.gate = path.join(directory, "view-history-purge.json");
        // The ref is the sole commit boundary; readers never use an uncommitted cache.
        this.filesystem = {
            promises: {
                ...fs.promises,
                writeFile: async (
                    file: string,
                    data: string | Uint8Array,
                    options?: fs.WriteFileOptions,
                ) => {
                    if (
                        path.resolve(file) ===
                        path.join(this.gitdir, ...ref.split("/"))
                    )
                        await writeRunbookJson(
                            file,
                            typeof data === "string"
                                ? data
                                : Buffer.from(data).toString("utf8"),
                        );
                    else await fs.promises.writeFile(file, data, options);
                },
            },
        };
    }

    private options() {
        return { fs: this.filesystem, gitdir: this.gitdir };
    }

    private async lock(): Promise<() => Promise<void>> {
        await mkdir(this.directory, { recursive: true });
        return lockfile.lock(this.directory, {
            realpath: false,
            lockfilePath: `${this.gitdir}.lock`,
            retries: 0,
        });
    }

    private async head(): Promise<string | null> {
        if (!(await exists(path.join(this.gitdir, ...ref.split("/")))))
            return null;
        return git.resolveRef({ ...this.options(), ref });
    }

    public async read(
        oid?: string,
        bypassGate = false,
    ): Promise<HistorySnapshot<T>> {
        if (!bypassGate && (await exists(this.gate)))
            throw new Error(
                "View history is quarantined pending privacy purge",
            );
        const head = oid ?? (await this.head());
        if (!head) {
            const legacyEntries = (await exists(this.directory))
                ? await readdir(this.directory)
                : [];
            if (
                legacyEntries.some(
                    (entry) =>
                        entry === "procedures" ||
                        entry === "index.json" ||
                        (entry.startsWith("index.json.") &&
                            entry.endsWith(".bak")),
                )
            )
                throw new Error(
                    "Pre-release procedure storage is incompatible with typed views. Use a new corpus/store; no automatic migration or reset is performed",
                );
            return { head: null, state: this.empty() };
        }
        const blob = await git.readBlob({
            ...this.options(),
            oid: head,
            filepath: "state.json",
        });
        return {
            head,
            state: JSON.parse(Buffer.from(blob.blob).toString("utf8")) as T,
        };
    }

    public async commit(
        expectedHead: string | null,
        state: T,
        views: Record<string, string>,
        actor: string,
        message: string,
    ): Promise<string> {
        if (await exists(this.gate))
            throw new Error(
                "View history is quarantined pending privacy purge",
            );
        const release = await this.lock();
        try {
            if (await exists(this.gate))
                throw new Error(
                    "View history is quarantined pending privacy purge",
                );
            if (
                !(await exists(path.join(this.gitdir, "config"))) ||
                !(await exists(path.join(this.gitdir, "HEAD")))
            )
                await git.init({
                    ...this.options(),
                    bare: true,
                    defaultBranch: "typeagent-history",
                });
            const head = await this.head();
            if (head !== expectedHead)
                throw new Error(
                    `View history head conflict: expected ${expectedHead}, actual ${head}`,
                );
            const previous = head
                ? (await git.readTree({ ...this.options(), oid: head })).tree
                : [];
            const entries = [];
            for (const [name, text] of Object.entries({
                "state.json": JSON.stringify(state),
                ...views,
            })) {
                const oid = await git.writeBlob({
                    ...this.options(),
                    blob: Buffer.from(text, "utf8"),
                });
                const unchanged = previous.find(
                    (entry) => entry.path === name && entry.oid === oid,
                );
                entries.push(
                    unchanged ?? {
                        mode: "100644",
                        path: name,
                        oid,
                        type: "blob" as const,
                    },
                );
            }
            await this.checkpoint?.("blob");
            const tree = await git.writeTree({
                ...this.options(),
                tree: entries,
            });
            await this.checkpoint?.("tree");
            const oid = await git.writeCommit({
                ...this.options(),
                commit: {
                    tree,
                    parent: head ? [head] : [],
                    author: {
                        name: actor,
                        email: "memory@localhost",
                        timestamp: Math.floor(Date.now() / 1000),
                        timezoneOffset: 0,
                    },
                    committer: {
                        name: actor,
                        email: "memory@localhost",
                        timestamp: Math.floor(Date.now() / 1000),
                        timezoneOffset: 0,
                    },
                    message,
                },
            });
            await this.checkpoint?.("commit");
            await this.checkpoint?.("ref");
            await git.writeRef({
                ...this.options(),
                ref,
                value: oid,
                force: true,
            });
            return oid;
        } finally {
            await release();
        }
    }

    public async history(): Promise<Array<{ commitId: string; state: T }>> {
        const snapshot = await this.read();
        if (!snapshot.head) return [];
        const commits = await git.log({
            ...this.options(),
            ref: snapshot.head,
        });
        return Promise.all(
            commits.map(async (entry) => ({
                commitId: entry.oid,
                state: (await this.read(entry.oid)).state,
            })),
        );
    }

    public async purge(
        sourceId: string,
        sanitize: (state: T, sourceId: string) => T,
        views: (state: T) => Record<string, string>,
        removeDerivedData?: () => Promise<void>,
    ): Promise<void> {
        const release = await this.lock();
        try {
            await this.purgeLocked(
                sourceId,
                sanitize,
                views,
                removeDerivedData,
            );
        } finally {
            await release();
        }
    }

    private async purgeLocked(
        sourceId: string,
        sanitize: (state: T, sourceId: string) => T,
        views: (state: T) => Record<string, string>,
        removeDerivedData?: () => Promise<void>,
    ): Promise<void> {
        const operation = (await exists(this.gate))
            ? (JSON.parse(await readFile(this.gate, "utf8")) as {
                  sourceId: string;
                  replacement: string;
                  discarded: string;
              })
            : {
                  sourceId,
                  replacement: `replacement-${randomUUID()}`,
                  discarded: `discarded-${randomUUID()}`,
              };
        if (operation.sourceId !== sourceId)
            throw new Error("Another view privacy purge is pending");
        await writeRunbookJson(this.gate, JSON.stringify(operation));
        const replacement = path.join(this.directory, operation.replacement);
        const discarded = path.join(this.directory, operation.discarded);
        if (!(await exists(discarded))) {
            const state = sanitize(
                (await this.read(undefined, true)).state,
                sourceId,
            );
            const fresh = new ViewHistory<T>(replacement, this.empty);
            const snapshot = await fresh.read();
            if (!snapshot.head)
                await fresh.commit(
                    null,
                    state,
                    views(state),
                    "memory-service",
                    "Privacy reset: retained views only",
                );
            await this.checkpoint?.("purge-prepared");
            if (await exists(this.gitdir))
                await retryProcedurePublication(() =>
                    rename(this.gitdir, discarded),
                );
            // Even an empty corpus has a repository after a privacy reset.
            else await mkdir(discarded, { recursive: true });
        }
        if (!(await exists(this.gitdir)))
            await retryProcedurePublication(() =>
                rename(path.join(replacement, "view-history.git"), this.gitdir),
            );
        await this.checkpoint?.("purge-swapped");
        await removeDerivedData?.();
        await this.checkpoint?.("purge-cleaned");
        // Removing the entire old object database, not GC, removes retained/unreachable blobs.
        await retryProcedurePublication(() =>
            rm(discarded, { recursive: true, force: true }),
        );
        await retryProcedurePublication(() =>
            rm(replacement, { recursive: true, force: true }),
        );
        await rm(this.gate);
    }

    public async recoverPurge(
        sanitize: (state: T, sourceId: string) => T,
        views: (state: T) => Record<string, string>,
        removeDerivedData?: () => Promise<void>,
    ): Promise<void> {
        if (!(await exists(this.gate))) return;
        const operation = JSON.parse(await readFile(this.gate, "utf8")) as {
            sourceId: string;
        };
        await this.purge(
            operation.sourceId,
            sanitize,
            views,
            removeDerivedData,
        );
    }
}

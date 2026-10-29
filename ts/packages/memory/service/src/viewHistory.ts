// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import git, { type TreeEntry } from "isomorphic-git";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { recordSearchTiming, timeSearchStage } from "@typeagent/knowpro";
import { writeRunbookJson } from "./durableRunbookJson.js";
import { retryFilesystemPublication } from "./filesystemPublication.js";
import {
    readViewRecord,
    viewRecordsPath,
    writeViewRecords,
} from "./viewHistoryRecords.js";
import {
    readViewStatePayloads,
    viewStatePayloadPath,
    writeViewStatePayloads,
} from "./viewHistoryPayloads.js";

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
    stateBytes: number;
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
        private readonly records?: (state: T) => Record<string, unknown>,
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

    private async lock(retry = false): Promise<() => Promise<void>> {
        await mkdir(this.directory, { recursive: true });
        return lockfile.lock(this.directory, {
            realpath: false,
            lockfilePath: `${this.gitdir}.lock`,
            retries: retry
                ? { retries: 20, minTimeout: 10, maxTimeout: 100 }
                : 0,
        });
    }

    private async head(): Promise<string | null> {
        if (!(await exists(path.join(this.gitdir, ...ref.split("/")))))
            return null;
        return git.resolveRef({ ...this.options(), ref });
    }

    public async readHead(): Promise<string | null> {
        await this.assertReadable();
        const head = await this.head();
        await this.assertReadable();
        return head;
    }

    public async read(
        oid?: string,
        bypassGate = false,
    ): Promise<HistorySnapshot<T>> {
        return timeSearchStage("view.history.read", () =>
            this.readSnapshot(oid, bypassGate),
        );
    }

    private async readSnapshot(
        oid?: string,
        bypassGate = false,
    ): Promise<HistorySnapshot<T>> {
        if (!bypassGate) await this.assertReadable();
        const head = oid ?? (await this.head());
        if (!head) {
            const state = this.empty();
            return {
                head: null,
                state,
                stateBytes: 0,
            };
        }
        const { tree } = await git.readTree({ ...this.options(), oid: head });
        const payloads = tree.find(
            (entry) =>
                entry.path === viewStatePayloadPath && entry.type === "tree",
        );
        if (payloads) {
            const snapshot = await readViewStatePayloads<T>(
                this.options(),
                payloads,
            );
            if (!bypassGate) await this.assertReadable();
            return { head, ...snapshot };
        }
        const blob = await git.readBlob({
            ...this.options(),
            oid: head,
            filepath: "state.json",
        });
        if (!bypassGate) await this.assertReadable();
        return {
            head,
            state: JSON.parse(Buffer.from(blob.blob).toString("utf8")) as T,
            stateBytes: blob.blob.byteLength,
        };
    }

    public async assertReadable(): Promise<void> {
        if (await exists(this.gate))
            throw new Error(
                "View history is quarantined pending privacy purge",
            );
    }

    public async readEntry<R>(
        name: string,
        oid?: string,
    ): Promise<{ head: string | null; value: R | undefined }> {
        await this.assertReadable();
        const head = oid ?? (await this.head());
        if (!head) return { head, value: undefined };
        const { tree } = await git.readTree({ ...this.options(), oid: head });
        if (
            name === "state.json" &&
            tree.some(
                (entry) =>
                    entry.path === viewStatePayloadPath &&
                    entry.type === "tree",
            )
        ) {
            const snapshot = await this.read(head);
            return { head, value: snapshot.state as unknown as R };
        }
        const entry = tree.find((entry) => entry.path === name);
        if (!entry) return { head, value: undefined };
        const blob = await git.readBlob({ ...this.options(), oid: entry.oid });
        await this.assertReadable();
        return {
            head,
            value: JSON.parse(Buffer.from(blob.blob).toString("utf8")) as R,
        };
    }

    public async assertHead(expected: string | null): Promise<void> {
        await this.assertReadable();
        if ((await this.head()) !== expected)
            throw new Error("View history changed during read operation");
        await this.assertReadable();
    }

    public async commit(
        expectedHead: string | null,
        state: T,
        views: Record<string, string>,
        actor: string,
        message: string,
    ): Promise<string> {
        return timeSearchStage("view.history.commit", () =>
            this.publish(expectedHead, state, views, actor, message),
        );
    }

    private async publish(
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
            const previousByPath = new Map(
                previous.map((entry) => [entry.path, entry]),
            );
            const entries = [];
            const blobsStarted = performance.now();
            const previousPayloads = previousByPath.get(viewStatePayloadPath);
            const payloads = ["state.json", viewStatePayloadPath].some((name) =>
                Object.prototype.hasOwnProperty.call(views, name),
            )
                ? undefined
                : await writeViewStatePayloads(
                      this.options(),
                      state,
                      previousPayloads?.type === "tree"
                          ? previousPayloads
                          : undefined,
                  );
            if (payloads) entries.push(payloads);
            const stateText = payloads ? undefined : JSON.stringify(state);
            let viewBytes = 0;
            for (const [name, text] of Object.entries({
                ...(payloads ? {} : { "state.json": stateText! }),
                ...views,
            })) {
                const blob = Buffer.from(text, "utf8");
                if (Object.prototype.hasOwnProperty.call(views, name))
                    viewBytes += blob.byteLength;
                const oid = await git.writeBlob({
                    ...this.options(),
                    blob,
                });
                const previousEntry = previousByPath.get(name);
                const unchanged =
                    previousEntry?.oid === oid ? previousEntry : undefined;
                entries.push(
                    unchanged ?? {
                        mode: "100644",
                        path: name,
                        oid,
                        type: "blob" as const,
                    },
                );
            }
            if (this.records)
                entries.push(
                    await writeViewRecords(
                        this.options(),
                        this.records(state),
                        previousByPath.get(viewRecordsPath),
                    ),
                );
            recordSearchTiming(
                "view.history.blobs.write",
                performance.now() - blobsStarted,
                {
                    legacySerializedBytes:
                        stateText === undefined
                            ? 0
                            : Buffer.byteLength(stateText),
                    viewBytes,
                    viewFiles: Object.keys(views).length,
                    incrementalState: !!payloads,
                },
            );
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

    public async historyForRecord<R>(
        id: string,
        expectedHead?: string | null,
        validateHead = true,
    ): Promise<Array<{ commitId: string; record: R | undefined }>> {
        await this.assertReadable();
        const head =
            expectedHead === undefined ? await this.head() : expectedHead;
        if (validateHead) await this.assertHead(head);
        if (!head) return [];
        const commits = await git.log({ ...this.options(), ref: head });
        const records = new Map<string, Promise<R>>();
        const trees = new Map<string, Promise<TreeEntry[]>>();
        const readTree = (oid: string) => {
            let tree = trees.get(oid);
            if (!tree) {
                tree = git
                    .readTree({ ...this.options(), oid })
                    .then((result) => result.tree);
                trees.set(oid, tree);
            }
            return tree;
        };
        const roots = await Promise.all(
            commits.map((entry) => readTree(entry.commit.tree)),
        );
        const recordTrees: Array<TreeEntry[] | Promise<TreeEntry[]>> = [];
        for (const [index, entry] of commits.entries()) {
            const recordEntry = roots[index].find(
                (entry) => entry.path === viewRecordsPath,
            );
            recordTrees.push(
                recordEntry
                    ? readTree(recordEntry.oid)
                    : await this.legacyRecordTree(
                          entry.oid,
                          validateHead ? head : undefined,
                      ),
            );
        }
        const result = await Promise.all(
            commits.map(async (entry, index) => ({
                commitId: entry.oid,
                record: await readViewRecord(
                    this.options(),
                    await recordTrees[index],
                    id,
                    records,
                ),
            })),
        );
        if (validateHead) await this.assertHead(head);
        else await this.assertReadable();
        return result;
    }

    private async legacyRecordTree(
        commitId: string,
        expectedHead?: string,
    ): Promise<TreeEntry[]> {
        const cache = path.join(this.gitdir, "view-record-index", commitId);
        const cached = await this.cachedRecordTree(cache);
        if (cached) return cached;
        // Legacy commits are immutable. Rebuild their full-fidelity per-View
        // records once, inside the repository removed by the privacy swap.
        const release = await this.lock(true);
        try {
            if (expectedHead === undefined) await this.assertReadable();
            else await this.assertHead(expectedHead);
            const cached = await this.cachedRecordTree(cache);
            if (cached) return cached;
            if (!this.records)
                throw new Error("View history record selector is required");
            const { oid } = await writeViewRecords(
                this.options(),
                this.records((await this.read(commitId)).state),
            );
            await writeRunbookJson(cache, oid);
            return (await git.readTree({ ...this.options(), oid })).tree;
        } finally {
            await release();
        }
    }

    private async cachedRecordTree(
        cache: string,
    ): Promise<TreeEntry[] | undefined> {
        try {
            const oid = await readFile(cache, "utf8");
            if (/^[a-f0-9]{40}$/.test(oid))
                return (await git.readTree({ ...this.options(), oid })).tree;
        } catch (error) {
            if (
                !["ENOENT", "NotFoundError", "ObjectTypeError"].includes(
                    (error as NodeJS.ErrnoException).code ?? "",
                )
            )
                throw error;
        }
        return undefined;
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
            const fresh = new ViewHistory<T>(
                replacement,
                this.empty,
                undefined,
                this.records,
            );
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
                await retryFilesystemPublication(() =>
                    rename(this.gitdir, discarded),
                );
            // Even an empty corpus has a repository after a privacy reset.
            else await mkdir(discarded, { recursive: true });
        }
        if (!(await exists(this.gitdir)))
            await retryFilesystemPublication(() =>
                rename(path.join(replacement, "view-history.git"), this.gitdir),
            );
        await this.checkpoint?.("purge-swapped");
        await removeDerivedData?.();
        await this.checkpoint?.("purge-cleaned");
        // Removing the entire old object database, not GC, removes retained/unreachable blobs.
        await retryFilesystemPublication(() =>
            rm(discarded, { recursive: true, force: true }),
        );
        await retryFilesystemPublication(() =>
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

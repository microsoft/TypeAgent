// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import git, { type FsClient, type TreeEntry } from "isomorphic-git";
import { createHash } from "node:crypto";
import { recordSearchTiming } from "@typeagent/knowpro";
import { unchangedViewRecord } from "./viewHistoryPayloads.js";

export const viewRecordsPath = "view-records";

export interface ViewRecordGitOptions {
    fs: FsClient;
    gitdir: string;
}

function recordPath(id: string): string {
    return createHash("sha256").update(id).digest("hex") + ".json";
}

export async function writeViewRecords(
    options: ViewRecordGitOptions,
    records: Record<string, unknown>,
    previous?: TreeEntry,
): Promise<TreeEntry> {
    const started = performance.now();
    const previousTree = previous
        ? (await git.readTree({ ...options, oid: previous.oid })).tree
        : [];
    const previousByPath = new Map(
        previousTree.map((entry) => [entry.path, entry]),
    );
    const tree: TreeEntry[] = [];
    let serializedBytes = 0;
    let reusedRecords = 0;
    for (const [id, record] of Object.entries(records)) {
        const previousEntry = previousByPath.get(recordPath(id));
        if (previousEntry) {
            const { blob } = await git.readBlob({
                ...options,
                oid: previousEntry.oid,
            });
            if (
                unchangedViewRecord(
                    record,
                    JSON.parse(Buffer.from(blob).toString("utf8")),
                )
            ) {
                tree.push(previousEntry);
                reusedRecords++;
                continue;
            }
        }
        const blob = Buffer.from(JSON.stringify(record), "utf8");
        serializedBytes += blob.byteLength;
        tree.push({
            mode: "100644",
            path: recordPath(id),
            type: "blob",
            oid: await git.writeBlob({
                ...options,
                blob,
            }),
        });
    }
    const entry: TreeEntry = {
        mode: "040000",
        path: viewRecordsPath,
        type: "tree",
        oid: await git.writeTree({ ...options, tree }),
    };
    recordSearchTiming(
        "view.history.records.write",
        performance.now() - started,
        {
            serializedBytes,
            reusedRecords,
            records: tree.length,
        },
    );
    return entry;
}

export async function readViewRecord<R>(
    options: ViewRecordGitOptions,
    tree: TreeEntry[],
    id: string,
    records: Map<string, Promise<R>>,
): Promise<R | undefined> {
    const entry = tree.find((entry) => entry.path === recordPath(id));
    if (!entry) return undefined;
    if (records.has(entry.oid)) return records.get(entry.oid);
    const record = git
        .readBlob({ ...options, oid: entry.oid })
        .then(
            (blob) => JSON.parse(Buffer.from(blob.blob).toString("utf8")) as R,
        );
    records.set(entry.oid, record);
    return record;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import git, { type FsClient, type TreeEntry } from "isomorphic-git";
import { createHash } from "node:crypto";

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
): Promise<TreeEntry> {
    const tree: TreeEntry[] = [];
    for (const [id, record] of Object.entries(records)) {
        tree.push({
            mode: "100644",
            path: recordPath(id),
            type: "blob",
            oid: await git.writeBlob({
                ...options,
                blob: Buffer.from(JSON.stringify(record), "utf8"),
            }),
        });
    }
    return {
        mode: "040000",
        path: viewRecordsPath,
        type: "tree",
        oid: await git.writeTree({ ...options, tree }),
    };
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

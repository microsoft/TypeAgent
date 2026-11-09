// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import type {
    MemoryChangeListRequest,
    MemoryChangeReceipt,
    MemoryPage,
} from "./types.js";

const retentionMs = 90 * 24 * 60 * 60 * 1000;

export function opaqueChangeReference(
    corpusId: string,
    kind: "source" | "revision",
    id: string,
): string {
    return createHash("sha256")
        .update(JSON.stringify(["memory-change", corpusId, kind, id]))
        .digest("hex");
}

export function createChangeReceipt(
    corpusId: string,
    operation: MemoryChangeReceipt["operation"],
    sourceId: string,
    counts: MemoryChangeReceipt["counts"],
    previousRevisionId?: string,
    revisionId?: string,
): MemoryChangeReceipt {
    return {
        changeId: randomUUID(),
        corpusId,
        operation,
        createdAt: new Date().toISOString(),
        outcome: "committed",
        sourceId: opaqueChangeReference(corpusId, "source", sourceId),
        ...(previousRevisionId === undefined
            ? {}
            : {
                  previousRevisionId: opaqueChangeReference(
                      corpusId,
                      "revision",
                      previousRevisionId,
                  ),
              }),
        ...(revisionId === undefined
            ? {}
            : {
                  revisionId: opaqueChangeReference(
                      corpusId,
                      "revision",
                      revisionId,
                  ),
              }),
        counts: { ...counts },
    };
}

export function pruneChangeReceipts(
    receipts: MemoryChangeReceipt[] = [],
): MemoryChangeReceipt[] {
    const cutoff = Date.now() - retentionMs;
    return receipts.filter((receipt) => Date.parse(receipt.createdAt) > cutoff);
}

interface ChangeCursor {
    corpusId: string;
    pageSize: number;
    through: string;
    after: string;
    snapshot: string;
}

function readCursor(token: string): ChangeCursor {
    try {
        if (token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) {
            throw new Error();
        }
        const value = JSON.parse(
            Buffer.from(token, "base64url").toString("utf8"),
        ) as ChangeCursor;
        if (
            Object.keys(value).sort().join(",") !==
                "after,corpusId,pageSize,snapshot,through" ||
            typeof value.corpusId !== "string" ||
            typeof value.through !== "string" ||
            typeof value.after !== "string" ||
            typeof value.snapshot !== "string"
        ) {
            throw new Error();
        }
        return value;
    } catch {
        throw new Error("Invalid changes continuation token");
    }
}

export function pageChangeReceipts(
    receipts: MemoryChangeReceipt[],
    request: MemoryChangeListRequest,
): MemoryPage<MemoryChangeReceipt> {
    const cursor =
        request.continuationToken === undefined
            ? undefined
            : readCursor(request.continuationToken);
    const pageSize =
        request.pageSize === undefined
            ? (cursor?.pageSize ?? 50)
            : request.pageSize;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
        throw new Error("Changes page size must be an integer from 1 to 200");
    }
    if (
        cursor !== undefined &&
        (cursor.corpusId !== request.corpusId || cursor.pageSize !== pageSize)
    ) {
        throw new Error("Changes continuation token scope does not match");
    }
    const through =
        cursor === undefined
            ? receipts.length - 1
            : receipts.findIndex(
                  (receipt) => receipt.changeId === cursor.through,
              );
    const after =
        cursor === undefined
            ? -1
            : receipts.findIndex(
                  (receipt) => receipt.changeId === cursor.after,
              );
    if (cursor !== undefined && (through < 0 || after < 0 || after > through)) {
        throw new Error("Changes continuation token expired; restart listing");
    }
    const snapshot = createHash("sha256")
        .update(
            JSON.stringify(
                receipts.slice(0, through + 1).map((item) => item.changeId),
            ),
        )
        .digest("hex");
    if (cursor !== undefined && cursor.snapshot !== snapshot) {
        throw new Error("Changes continuation token expired; restart listing");
    }
    const items = receipts.slice(
        after + 1,
        Math.min(after + 1 + pageSize, through + 1),
    );
    const last = items[items.length - 1];
    return {
        items: structuredClone(items),
        total: through + 1,
        ...(last === undefined || after + items.length >= through
            ? {}
            : {
                  nextContinuationToken: Buffer.from(
                      JSON.stringify({
                          corpusId: request.corpusId,
                          pageSize,
                          through: receipts[through]!.changeId,
                          after: last.changeId,
                          snapshot,
                      } satisfies ChangeCursor),
                  ).toString("base64url"),
              }),
    };
}

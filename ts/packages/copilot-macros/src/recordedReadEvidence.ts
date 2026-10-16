// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { isDeepStrictEqual } from "node:util";
import type { RecordedInteractionTrace } from "./contracts.js";

type JsonRecord = Record<string, unknown>;

function equal(left: unknown, right: unknown): boolean {
    return isDeepStrictEqual(
        JSON.parse(JSON.stringify(left)),
        JSON.parse(JSON.stringify(right)),
    );
}

function record(value: unknown): JsonRecord | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as JsonRecord)
        : undefined;
}

function field(value: unknown, ...keys: string[]): unknown {
    for (const key of keys) value = record(value)?.[key];
    return value;
}

function metadata(value: unknown): JsonRecord | undefined {
    const result = record(value);
    const rows = field(result, "structuredContent", "results");
    return result?.isError !== true &&
        Array.isArray(rows) &&
        rows.length === 1 &&
        field(rows[0], "statusCode") === 200
        ? record(field(rows[0], "data"))
        : undefined;
}

function completeMetadata(value: JsonRecord): boolean {
    return (
        ["id", "name", "webUrl", "eTag", "cTag", "lastModifiedDateTime"].every(
            (key) => {
                const item = value[key];
                return typeof item === "string" && item.length > 0;
            },
        ) &&
        typeof value.size === "number" &&
        Number.isSafeInteger(value.size) &&
        value.size >= 0 &&
        typeof value.lastModifiedDateTime === "string" &&
        Number.isFinite(Date.parse(value.lastModifiedDateTime)) &&
        typeof field(value, "file", "mimeType") === "string" &&
        ["siteId", "listId"].every(
            (key) =>
                typeof field(value, "sharepointIds", key) === "string" &&
                (field(value, "sharepointIds", key) as string).length > 0,
        )
    );
}

function scopedReadArguments(
    trace: RecordedInteractionTrace,
    entityUrl: string,
): boolean {
    const [, before, blob, after] = trace.toolCalls;
    const fields = new Set([
        "id",
        "name",
        "size",
        "eTag",
        "cTag",
        "lastModifiedDateTime",
        "file",
        "parentReference",
        "webUrl",
        "sharepointIds",
    ]);
    const args = record(before.arguments);
    if (
        !args ||
        Object.keys(args).length !== 1 ||
        !Array.isArray(args.entityUrls) ||
        args.entityUrls.length !== 1 ||
        typeof args.entityUrls[0] !== "string" ||
        !args.entityUrls[0].startsWith(`${entityUrl}?`)
    )
        return false;
    const query = new URLSearchParams(
        args.entityUrls[0].slice(entityUrl.length + 1),
    );
    const selected = query.get("$select")?.split(",");
    return (
        [...query].length === 1 &&
        selected?.length === fields.size &&
        new Set(selected).size === fields.size &&
        selected.every((field) => fields.has(field)) &&
        equal(before.arguments, after.arguments) &&
        equal(blob.arguments, { path: `${entityUrl}/content` })
    );
}

function matchingHits(
    lookup: JsonRecord,
    before: JsonRecord,
): JsonRecord[] | undefined {
    const hits = lookup.retrievalHits;
    if (
        lookup.stoppedReason !== "completed" ||
        typeof lookup.resultCount !== "number" ||
        !Number.isSafeInteger(lookup.resultCount) ||
        lookup.resultCount < 1 ||
        !Array.isArray(hits) ||
        hits.length === 0
    )
        return undefined;
    const records = hits.map(record);
    return records.every(
        (hit) =>
            hit !== undefined &&
            hit.itemId === before.id &&
            hit.driveId === field(before, "parentReference", "driveId") &&
            typeof hit.driveId === "string" &&
            typeof hit.itemId === "string" &&
            /^[^/\\?#]+$/.test(hit.driveId) &&
            /^[^/\\?#]+$/.test(hit.itemId) &&
            hit.entityUrl === `/drives/${hit.driveId}/items/${hit.itemId}` &&
            hit.isError !== true &&
            hit.denied !== true,
    )
        ? (records as JsonRecord[])
        : undefined;
}

function matchingReadResults(originals: unknown[]) {
    const lookupResult = record(originals[0]);
    const lookup = record(
        field(
            lookupResult,
            "structuredContent",
            "application/vnd.ms-workiq.retrieval",
        ),
    );
    const before = metadata(originals[1]);
    const after = metadata(originals[3]);
    const blob = record(originals[2]);
    return lookupResult?.isError !== true &&
        lookup &&
        before &&
        after &&
        completeMetadata(before) &&
        equal(before, after) &&
        blob?.isError !== true &&
        field(blob, "structuredContent", "statusCode") === 200
        ? { lookup, before, blob }
        : undefined;
}

/**
 * Observations about this recording only, not approved scope, permissions,
 * frozen expected bytes, model consumption or the correctness of its answer.
 */
export function recordedWorkiqReadObservations(
    trace: RecordedInteractionTrace,
    originals: unknown[],
) {
    if (
        trace.toolCalls.map((call) => call.name).join("|") !==
            "workiq-retrieve|workiq-fetch|workiq-fetch_blob|workiq-fetch" ||
        trace.toolCalls.some((call) => call.status !== "completed")
    )
        return undefined;
    const [lookupCall, , blobCall] = trace.toolCalls;
    const observed = matchingReadResults(originals);
    if (!observed) return undefined;
    const { lookup, before, blob } = observed;
    const requested = record(lookupCall.arguments)?.capabilities;
    const items =
        Array.isArray(requested) && requested.length === 1
            ? field(requested[0], "items_by_url")
            : undefined;
    const requestedUrl =
        Array.isArray(items) && items.length === 1
            ? field(items[0], "url")
            : undefined;
    const hits = matchingHits(lookup, before);
    const receipts = blobCall.resultArtifact?.blobs.filter(
        (receipt) =>
            receipt.path.join(".") === "structuredContent.base64Content",
    );
    if (
        typeof requestedUrl !== "string" ||
        requestedUrl !== before.webUrl ||
        !hits ||
        typeof hits[0].entityUrl !== "string" ||
        !scopedReadArguments(trace, hits[0].entityUrl) ||
        receipts?.length !== 1 ||
        receipts[0].sizeBytes !== before.size ||
        field(blob, "structuredContent", "sizeBytes") !== before.size
    )
        return undefined;
    return {
        scope: "recorded-current-results-only" as const,
        sourceToolCallIds: trace.toolCalls.map((call) => call.toolCallId),
        lookupHitCount: hits.length,
        allReturnedHitsMatchRecordedMetadataItemAndDrive: true,
        recordedMetadataUrlMatchesLookupRequestedUrl: true,
        metadataReadsAndBlobUseReturnedEntityBinding: true,
        metadataIdentityLibraryVersionAndSizeUnchanged: true,
        recordedTitleAndIdentityFieldsPresent: true,
        retainedOriginalBlob: {
            sha256: receipts[0].sha256,
            sizeBytes: receipts[0].sizeBytes,
            sizeMatchesRecordedMetadata: true,
        },
    };
}

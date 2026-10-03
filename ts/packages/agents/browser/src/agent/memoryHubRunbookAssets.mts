// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    FileMemoryService,
    MemoryService,
    RevisionAssetDescriptor,
} from "@typeagent/memory-service";
import type {
    RunbookAsset,
    MemoryHubRunbookFunctions,
} from "@typeagent/browser-control-rpc/viewRpc";
import { timed } from "./memoryHubQuery.mjs";

type AssetService = MemoryService &
    Pick<FileMemoryService, "getRevisionAssets" | "readRevisionAsset">;
function supportsAssets(service: MemoryService): service is AssetService {
    return (
        typeof Reflect.get(service, "getRevisionAssets") === "function" &&
        typeof Reflect.get(service, "readRevisionAsset") === "function"
    );
}
function assetDto(
    corpusId: string,
    asset: RevisionAssetDescriptor,
): RunbookAsset {
    const query = new URLSearchParams({
        corpusId,
        sourceId: asset.sourceId,
        revisionId: asset.revisionId,
        assetId: asset.assetId,
        hash: asset.hash,
        variant: "original",
        acknowledgeUnreviewed: "true",
    });
    return {
        ...asset,
        warnings: asset.warnings ?? [],
        originalUrl: `/api/views/runbook-asset?${query}`,
    };
}
export async function listRunbookAssets(
    service: MemoryService,
    corpusId: string,
    sourceId: string,
    revisionId: string,
): Promise<{ assets: RunbookAsset[]; warnings: string[] }> {
    if (!supportsAssets(service))
        return {
            assets: [],
            warnings: [
                "Revision-asset service is unavailable; image evidence cannot be inspected.",
            ],
        };
    const assets = await timed(
        service.getRevisionAssets({ corpusId, sourceId, revisionId }),
    );
    return {
        assets: assets.map((asset) => assetDto(corpusId, asset)),
        warnings: [],
    };
}
export async function readRunbookAsset(
    service: MemoryService,
    request: Parameters<
        MemoryHubRunbookFunctions["memoryHubReadRunbookAsset"]
    >[0],
) {
    if (!supportsAssets(service))
        throw new Error("Revision-asset service is unavailable");
    if (
        request.variant === "original" &&
        request.acknowledgeUnreviewed !== true
    )
        throw new Error(
            "Original pixels are unreviewed; explicit acknowledgement is required",
        );
    const { acknowledgeUnreviewed: _confirmation, ...read } = request;
    const result = await timed(service.readRevisionAsset(read));
    if (result.bytes.length > 6 * 1024 * 1024)
        throw new Error("Revision asset exceeds transport limit");
    return {
        asset: assetDto(request.corpusId, result.descriptor),
        data: Buffer.from(result.bytes).toString("base64"),
    };
}

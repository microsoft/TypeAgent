// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    lstat,
    mkdir,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { redactRunbookText } from "./runbookRedaction.js";

export interface RevisionAssetInput {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
    description?: string;
    instructionBearing?: boolean;
    warnings?: string[];
}

export interface RevisionAssetDescriptor {
    sourceId: string;
    revisionId: string;
    assetId: string;
    mimeType: string;
    name: string;
    size: number;
    hash: string;
    description?: string;
    instructionBearing?: boolean;
    warnings?: string[];
}

export interface RevisionAssetRequest {
    corpusId: string;
    sourceId: string;
    revisionId: string;
}

export interface RevisionAssetReadRequest extends RevisionAssetRequest {
    assetId: string;
    hash: string;
    variant: "original" | "preview";
}

// Base64 plus JSON must fit the existing 10 MB view transport.
export const revisionAssetByteLimit = 6 * 1024 * 1024;
export const revisionAssetSetByteLimit = 6 * 1024 * 1024;

export function assetDigest(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function sniff(bytes: Uint8Array): string | undefined {
    const data = Buffer.from(bytes);
    if (
        data
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
        return "image/png";
    if (data[0] === 255 && data[1] === 216 && data[2] === 255)
        return "image/jpeg";
    if (/^GIF8[79]a/.test(data.subarray(0, 6).toString("ascii")))
        return "image/gif";
    if (
        data.subarray(0, 4).toString() === "RIFF" &&
        data.subarray(8, 12).toString() === "WEBP"
    )
        return "image/webp";
    if (data.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
    return undefined;
}

export function validateAssetInputs(
    assets: readonly RevisionAssetInput[],
): void {
    if (assets.length > 32)
        throw new Error("At most 32 revision assets are supported");
    let total = 0;
    for (const asset of assets) {
        if (
            !(asset.bytes instanceof Uint8Array) ||
            !asset.bytes.length ||
            asset.bytes.length > revisionAssetByteLimit
        )
            throw new Error("Invalid or oversized asset bytes");
        if (
            typeof asset.name !== "string" ||
            !asset.name ||
            asset.name.length > 200 ||
            /[\\/\0]/.test(asset.name) ||
            asset.name === "." ||
            asset.name === ".."
        )
            throw new Error(
                "Asset name must be a bounded display name, not a path",
            );
        if (sniff(asset.bytes) !== asset.mimeType)
            throw new Error(
                "Asset MIME does not match supported byte signature",
            );
        validateAssetMetadata(asset);
        total += asset.bytes.length;
    }

    if (total > revisionAssetSetByteLimit)
        throw new Error("Revision assets exceed transport byte limit");
}

function validateAssetMetadata(asset: RevisionAssetInput): void {
    if (
        asset.description !== undefined &&
        (typeof asset.description !== "string" ||
            asset.description.length > 2000)
    )
        throw new Error("Asset description exceeds the bounded metadata limit");
    if (
        asset.warnings !== undefined &&
        (!Array.isArray(asset.warnings) ||
            asset.warnings.length > 20 ||
            asset.warnings.some(
                (warning) =>
                    typeof warning !== "string" || warning.length > 1000,
            ))
    )
        throw new Error("Asset warnings exceed the bounded metadata limit");
}

export function revisionDigest(
    contentHash: string,
    assets: readonly RevisionAssetInput[],
): string {
    if (!assets.length) return contentHash;
    return assetDigest(
        Buffer.from(
            JSON.stringify([
                contentHash,
                assets.map((asset) => [
                    asset.name,
                    asset.mimeType,
                    assetDigest(asset.bytes),
                ]),
            ]),
        ),
    );
}

export class RevisionAssetStore {
    public constructor(private readonly root: string) {}

    private async directory(
        request: RevisionAssetRequest,
        create = false,
    ): Promise<string> {
        const identities = [
            request.corpusId,
            request.sourceId,
            request.revisionId,
        ];
        if (
            identities.some(
                (identity) =>
                    typeof identity !== "string" ||
                    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(identity),
            )
        )
            throw new Error("Invalid asset identity");
        const parts = [
            request.corpusId,
            "revision-assets",
            assetDigest(Buffer.from(request.sourceId)),
            request.revisionId,
        ];
        if (
            parts.some(
                (part) =>
                    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(part) ||
                    part.includes(":"),
            )
        )
            throw new Error("Invalid asset identity");
        const root = await realpath(this.root);
        let current = root;
        for (const part of parts) {
            current = path.join(current, part);
            if (create)
                await mkdir(current).catch((error: NodeJS.ErrnoException) => {
                    if (error.code !== "EEXIST") throw error;
                });
            const stat = await lstat(current);
            if (stat.isSymbolicLink() || !stat.isDirectory())
                throw new Error("Unsafe asset directory");
            const resolved = await realpath(current);
            if (!resolved.startsWith(`${root}${path.sep}`))
                throw new Error("Asset directory escapes storage root");
        }
        return current;
    }

    public async retain(
        request: RevisionAssetRequest,
        assets: readonly RevisionAssetInput[],
    ): Promise<RevisionAssetDescriptor[]> {
        validateAssetInputs(assets);
        if (!assets.length) return [];
        const directory = await this.directory(request, true);
        const descriptors: RevisionAssetDescriptor[] = [];
        for (const asset of assets) {
            const hash = assetDigest(asset.bytes);
            const assetId = assetDigest(Buffer.from(`${asset.name}\0${hash}`));
            const file = path.join(directory, `${assetId}.bin`);
            await writeFile(file, asset.bytes, { flag: "wx" }).catch(
                async (error: NodeJS.ErrnoException) => {
                    if (error.code !== "EEXIST") throw error;
                    await this.verifyFile(file, hash);
                },
            );
            descriptors.push({
                sourceId: request.sourceId,
                revisionId: request.revisionId,
                assetId,
                hash,
                name: redactRunbookText(asset.name),
                mimeType: asset.mimeType,
                size: asset.bytes.length,
                ...(asset.description === undefined
                    ? {}
                    : { description: redactRunbookText(asset.description) }),
                ...(asset.instructionBearing === undefined
                    ? {}
                    : { instructionBearing: asset.instructionBearing }),
                warnings: [
                    ...(asset.warnings ?? []).map(redactRunbookText),
                    "Original pixels are unreviewed; safe preview unavailable",
                ],
            });
        }
        return descriptors;
    }

    private async verifyFile(file: string, hash: string): Promise<Uint8Array> {
        const stat = await lstat(file);
        if (
            stat.isSymbolicLink() ||
            !stat.isFile() ||
            stat.size > revisionAssetByteLimit
        )
            throw new Error("Unsafe asset file");
        const bytes = await readFile(file);
        if (assetDigest(bytes) !== hash)
            throw new Error("Asset digest mismatch");
        return new Uint8Array(bytes);
    }

    public async read(
        request: RevisionAssetReadRequest,
        descriptor: RevisionAssetDescriptor,
    ): Promise<Uint8Array> {
        if (request.variant !== "original")
            throw new Error(
                "Safe preview unavailable: original pixels have not been redacted and reviewed",
            );
        if (
            request.assetId !== descriptor.assetId ||
            request.hash !== descriptor.hash ||
            request.sourceId !== descriptor.sourceId ||
            request.revisionId !== descriptor.revisionId
        )
            throw new Error("Asset identity or digest mismatch");
        if (!/^[a-f0-9]{64}$/.test(request.assetId))
            throw new Error("Invalid asset ID");
        return this.verifyFile(
            path.join(await this.directory(request), `${request.assetId}.bin`),
            request.hash,
        );
    }

    public async removeRevision(request: RevisionAssetRequest): Promise<void> {
        try {
            await rm(await this.directory(request), { recursive: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
}

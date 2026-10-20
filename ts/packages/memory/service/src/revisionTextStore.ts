// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    lstat,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { retryFilesystemPublication } from "./filesystemPublication.js";

export interface RevisionTextReference {
    sha256: string;
    bytes: number;
}

interface TextRevision {
    sourceId: string;
    revisionId: string;
    contentHash: string;
    content: string;
}

export type SerializedTextRevision<T extends TextRevision> = Omit<
    T,
    "content"
> & {
    text: RevisionTextReference;
};

export type RevisionTextFaultPoint =
    | "blob-written"
    | "blob-verified"
    | "blob-published"
    | "manifest-prepared"
    | "purge-started"
    | "purge-removed";

function digest(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

// This cache is derived from immutable revision identities; the manifest alone
// determines which blobs survive collection. It never retains source text.
export class RevisionTextStore {
    private readonly references = new Map<string, RevisionTextReference>();

    public constructor(
        private readonly directory: string,
        private readonly checkpoint?: (
            point: RevisionTextFaultPoint,
        ) => Promise<void>,
    ) {}

    private key(revision: Omit<TextRevision, "content">): string {
        return JSON.stringify([
            revision.sourceId,
            revision.revisionId,
            revision.contentHash,
        ]);
    }

    private async ensureDirectory(): Promise<void> {
        await mkdir(this.directory, { recursive: true });
        const stat = await lstat(this.directory);
        if (!stat.isDirectory() || stat.isSymbolicLink())
            throw new Error("Unsafe revision text directory");
    }

    private async verified(
        file: string,
        reference: RevisionTextReference,
    ): Promise<Buffer> {
        const before = await lstat(file);
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
            throw new Error("Unsafe revision text blob");
        const bytes = await readFile(file);
        const after = await lstat(file);
        if (
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            bytes.length !== reference.bytes ||
            digest(bytes) !== reference.sha256
        )
            throw new Error(`Corrupt revision text blob '${reference.sha256}'`);
        return bytes;
    }

    public async read(
        revision: SerializedTextRevision<TextRevision>,
    ): Promise<string> {
        const { text } = revision;
        if (
            !text ||
            typeof text.sha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(text.sha256) ||
            !Number.isSafeInteger(text.bytes) ||
            text.bytes < 0 ||
            "content" in revision
        )
            throw new Error(
                "Invalid canonical revision text reference; reset/reimport this corpus",
            );
        await this.ensureDirectory();
        const bytes = await this.verified(
            path.join(this.directory, `${text.sha256}.json`),
            text,
        );
        const content: unknown = JSON.parse(bytes.toString("utf8"));
        if (typeof content !== "string")
            throw new Error("Invalid revision text blob");
        this.references.set(this.key(revision), text);
        return content;
    }

    public async prepare<T extends TextRevision>(
        revision: T,
    ): Promise<SerializedTextRevision<T>> {
        const { content, ...metadata } = revision;
        let text = this.references.get(this.key(revision));
        if (!text) {
            const bytes = Buffer.from(JSON.stringify(content), "utf8");
            text = { sha256: digest(bytes), bytes: bytes.length };
            await this.ensureDirectory();
            const file = path.join(this.directory, `${text.sha256}.json`);
            try {
                await this.verified(file, text);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                    throw error;
                const staged = path.join(
                    this.directory,
                    `${text.sha256}.${randomUUID()}.tmp`,
                );
                try {
                    await writeFile(staged, bytes, { flag: "wx" });
                    await this.checkpoint?.("blob-written");
                    await this.verified(staged, text);
                    await this.checkpoint?.("blob-verified");
                    await retryFilesystemPublication(() =>
                        rename(staged, file),
                    );
                    await this.checkpoint?.("blob-published");
                } finally {
                    await rm(staged, { force: true });
                }
            }
            this.references.set(this.key(revision), text);
        }
        return { ...metadata, text };
    }

    public async prepared(): Promise<void> {
        await this.checkpoint?.("manifest-prepared");
    }

    public async purge(
        sources: readonly { revisions: readonly TextRevision[] }[],
    ): Promise<void> {
        const retainedKeys = new Set<string>();
        const retainedBlobs = new Set<string>();
        for (const source of sources)
            for (const revision of source.revisions) {
                const key = this.key(revision);
                const reference = this.references.get(key);
                if (!reference)
                    throw new Error(
                        "Cannot purge text without a verified manifest reference",
                    );
                retainedKeys.add(key);
                retainedBlobs.add(`${reference.sha256}.json`);
            }
        await this.ensureDirectory();
        for (const key of this.references.keys())
            if (!retainedKeys.has(key)) this.references.delete(key);
        for (const entry of await readdir(this.directory, {
            withFileTypes: true,
        })) {
            if (retainedBlobs.has(entry.name)) continue;
            if (
                !entry.isFile() ||
                !/^[a-f0-9]{64}(?:\.json|\.[a-f0-9-]{36}\.tmp)$/.test(
                    entry.name,
                )
            )
                throw new Error(
                    `Unexpected entry in revision text store: '${entry.name}'`,
                );
            await this.checkpoint?.("purge-started");
            await rm(path.join(this.directory, entry.name));
            await this.checkpoint?.("purge-removed");
        }
    }
}

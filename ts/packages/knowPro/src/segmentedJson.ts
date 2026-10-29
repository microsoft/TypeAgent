// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import * as filesystem from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { deserializeEmbeddings, serializeEmbeddings } from "./fuzzyIndex.js";
import {
    currentSearchTraceId,
    recordSearchTiming,
    timeSearchStage,
} from "./searchTiming.js";

const { lstat, mkdir, open, readFile, readdir, rename, rm } = new Proxy(
    filesystem,
    {
        get(target, property) {
            const method = Reflect.get(target, property, target);
            if (typeof method !== "function") return method;
            const stages: Record<string, string> = {
                lstat: "storage.io.segment.lstat",
                mkdir: "storage.io.segment.mkdir",
                open: "storage.io.segment.open",
                readFile: "storage.io.segment.read",
                readdir: "storage.io.segment.readdir",
                rename: "storage.io.segment.rename",
                rm: "storage.io.segment.remove",
            };
            const stage = stages[String(property)];
            if (!stage) return method;
            return (...args: unknown[]) =>
                timeSearchStage(stage, () =>
                    Reflect.apply(method, target, args),
                );
        },
    },
);

function stringify(value: unknown): string | undefined {
    return timeSearchStage("storage.segment.json.serialize", () =>
        JSON.stringify(value),
    );
}

function parse(value: string): unknown {
    return timeSearchStage("storage.segment.json.parse", () =>
        JSON.parse(value),
    );
}

export const jsonSegmentDirectory = ".segments";
const digestPattern = /^[a-f0-9]{64}$/;
const artifactPattern = /^[a-f0-9]{64}\.(json|bin)$/;
const jsonTargetBytes = 64 * 1024;
const vectorTargetBytes = 1024 * 1024;
const cacheLimitBytes = 64 * 1024 * 1024;
const tails = new Map<string, Promise<void>>();
const collectionReadConcurrency = 8;
const cachedArtifacts = new Map<
    string,
    {
        bytes: Buffer;
        size: number;
        mtimeMs: number;
        ctimeMs: number;
        ino: number;
    }
>();
let cachedBytes = 0;

type VectorBlock = { hash: string; count: number };
type JsonNode =
    | { kind: "value"; value: unknown }
    | { kind: "items" | "chunks"; children: string[] }
    | { kind: "object"; entries: [string, string][] }
    | {
          kind: "vectors";
          dimensions: number;
          count: number;
          blocks: VectorBlock[];
      }
    | { kind: "publication"; child: string; artifacts: string[] };

export interface SegmentedJsonDescriptor {
    segmentedJsonVersion: 1 | 2;
    root: string;
    metadata: Record<string, number>;
}

export interface SegmentedJsonReadOptions {
    skipRootProperties?: readonly string[] | undefined;
    reuseVerified?: boolean;
}

type Checkpoint = (
    point: "segment-written" | "descriptor-prepared",
) => Promise<void>;

async function serialize<T>(
    root: string,
    operation: () => Promise<T>,
): Promise<T> {
    const queuedAt = currentSearchTraceId() ? performance.now() : undefined;
    const result = (tails.get(root) ?? Promise.resolve()).then(() => {
        if (queuedAt !== undefined)
            recordSearchTiming(
                "storage.segment.queue.wait",
                performance.now() - queuedAt,
            );
        return timeSearchStage("storage.segment.queue.work", operation);
    });
    const tail = result.then(
        () => {},
        () => {},
    );
    tails.set(root, tail);
    try {
        return await result;
    } finally {
        if (tails.get(root) === tail) tails.delete(root);
    }
}

function directory(file: string): string {
    return path.join(path.dirname(path.dirname(file)), jsonSegmentDirectory);
}

function digest(bytes: Buffer): string {
    return timeSearchStage("storage.segment.hash", () =>
        createHash("sha256").update(bytes).digest("hex"),
    );
}

export function isSegmentedJson(
    value: unknown,
): value is SegmentedJsonDescriptor {
    if (
        !value ||
        typeof value !== "object" ||
        !("segmentedJsonVersion" in value)
    )
        return false;
    if (
        (value.segmentedJsonVersion !== 1 &&
            value.segmentedJsonVersion !== 2) ||
        !("root" in value) ||
        typeof value.root !== "string" ||
        !digestPattern.test(value.root) ||
        !("metadata" in value) ||
        !value.metadata ||
        typeof value.metadata !== "object" ||
        Object.values(value.metadata).some(
            (item) => !Number.isSafeInteger(item) || item < 0,
        )
    )
        throw new Error(
            "Invalid or unsupported segmented JSON descriptor; rebuild the derived index",
        );
    return true;
}

function forgetCache(file: string): void {
    const previous = cachedArtifacts.get(file);
    if (previous) cachedBytes -= previous.bytes.length;
    cachedArtifacts.delete(file);
}

function cacheArtifact(
    file: string,
    bytes: Buffer,
    info: { size: number; mtimeMs: number; ctimeMs: number; ino: number },
): void {
    forgetCache(file);
    if (bytes.length > cacheLimitBytes) return;
    cachedArtifacts.set(file, {
        bytes,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs,
        ino: info.ino,
    });
    cachedBytes += bytes.length;
    while (cachedBytes > cacheLimitBytes)
        forgetCache(cachedArtifacts.keys().next().value!);
}

export function clearJsonSegmentCache(generationRoot: string): void {
    const prefix = path.join(generationRoot, jsonSegmentDirectory) + path.sep;
    for (const file of cachedArtifacts.keys())
        if (file.startsWith(prefix)) forgetCache(file);
}

async function readArtifact(
    root: string,
    name: string,
    reuseVerified = false,
): Promise<Buffer> {
    if (!artifactPattern.test(name))
        throw new Error("Unsafe JSON segment reference");
    const file = path.join(root, name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
        throw new Error(`Unsafe JSON segment '${file}'`);
    const cached = cachedArtifacts.get(file);
    if (
        reuseVerified &&
        cached &&
        cached.size === info.size &&
        cached.mtimeMs === info.mtimeMs &&
        cached.ctimeMs === info.ctimeMs &&
        cached.ino === info.ino
    ) {
        cachedArtifacts.delete(file);
        cachedArtifacts.set(file, cached);
        return cached.bytes;
    }
    const bytes = await readFile(file);
    if (digest(bytes) !== name.slice(0, 64))
        throw new Error(`Corrupt JSON segment '${file}'`);
    cacheArtifact(file, bytes, info);
    return bytes;
}

async function readNode(
    root: string,
    hash: string,
    reuseVerified = false,
): Promise<JsonNode> {
    if (!digestPattern.test(hash))
        throw new Error("Unsafe JSON segment reference");
    const bytes = await readArtifact(root, `${hash}.json`, reuseVerified);
    const node = parse(bytes.toString("utf8")) as JsonNode;
    if (
        !node ||
        ![
            "value",
            "items",
            "chunks",
            "object",
            "vectors",
            "publication",
        ].includes(node.kind)
    )
        throw new Error("Invalid JSON segment");
    return node;
}

function validatePublication(
    node: Extract<JsonNode, { kind: "publication" }>,
): void {
    if (
        !digestPattern.test(node.child) ||
        !Array.isArray(node.artifacts) ||
        node.artifacts.some(
            (name) => typeof name !== "string" || !artifactPattern.test(name),
        ) ||
        new Set(node.artifacts).size !== node.artifacts.length ||
        !node.artifacts.includes(`${node.child}.json`)
    )
        throw new Error("Invalid JSON publication manifest");
}

async function hydrateVectors(
    root: string,
    node: Extract<JsonNode, { kind: "vectors" }>,
    options: SegmentedJsonReadOptions,
): Promise<Float32Array[]> {
    if (
        !Number.isSafeInteger(node.dimensions) ||
        node.dimensions < 1 ||
        !Number.isSafeInteger(node.count) ||
        node.count < 0 ||
        !Array.isArray(node.blocks)
    )
        throw new Error("Invalid binary vector descriptor");
    const vectors: Float32Array[] = [];
    for (const block of node.blocks) {
        if (
            !digestPattern.test(block.hash) ||
            !Number.isSafeInteger(block.count) ||
            block.count < 1
        )
            throw new Error("Invalid binary vector block");
        const bytes = await readArtifact(
            root,
            `${block.hash}.bin`,
            options.reuseVerified,
        );
        if (bytes.length !== block.count * node.dimensions * 4)
            throw new Error("Binary vector block length mismatch");
        vectors.push(...deserializeEmbeddings(bytes, node.dimensions));
    }
    if (vectors.length !== node.count)
        throw new Error("Binary vector count mismatch");
    return vectors;
}

async function hydrate(
    root: string,
    hash: string,
    options: SegmentedJsonReadOptions,
    ancestors = new Set<string>(),
    payloadRoot = true,
): Promise<unknown> {
    if (ancestors.has(hash)) throw new Error("Cyclic JSON segment reference");
    const next = new Set(ancestors).add(hash);
    const node = await readNode(root, hash, options.reuseVerified);
    const child = (reference: string, isRoot = false) =>
        hydrate(root, reference, options, next, isRoot);
    switch (node.kind) {
        case "value":
            return node.value;
        case "publication":
            validatePublication(node);
            return child(node.child, true);
        case "vectors":
            return hydrateVectors(root, node, options);
        case "object": {
            const value: Record<string, unknown> = {};
            for (const [key, reference] of node.entries) {
                Object.defineProperty(value, key, {
                    value:
                        payloadRoot && options.skipRootProperties?.includes(key)
                            ? {}
                            : await child(reference),
                    enumerable: true,
                    writable: true,
                    configurable: true,
                });
            }
            return value;
        }
        default: {
            const values: unknown[] = [];
            for (const reference of node.children) {
                const value = await child(reference);
                if (node.kind === "chunks") {
                    if (!Array.isArray(value))
                        throw new Error("Invalid JSON array segment");
                    for (const item of value) values.push(item);
                } else values.push(value);
            }
            return values;
        }
    }
}

export async function readSegmentedJson(
    file: string,
    descriptor: SegmentedJsonDescriptor,
    options: SegmentedJsonReadOptions = {},
): Promise<unknown> {
    return serialize(directory(file), () =>
        hydrate(directory(file), descriptor.root, options),
    );
}

/** Verify immutable publication artifacts without rebuilding their object graph. */
export async function verifySegmentedJson(
    file: string,
    descriptor: SegmentedJsonDescriptor,
): Promise<number> {
    const root = directory(file);
    return serialize(root, async () => {
        const node = await readNode(root, descriptor.root, true);
        if (node.kind !== "publication") {
            const value = await hydrate(root, descriptor.root, {
                reuseVerified: true,
            });
            return Buffer.byteLength(stringify(value) ?? "", "utf8");
        }
        validatePublication(node);
        let bytes = 0;
        for (const artifact of node.artifacts)
            bytes += (await readArtifact(root, artifact, true)).byteLength;
        return bytes;
    });
}

async function writeNew(file: string, bytes: Buffer): Promise<void> {
    const handle = await open(file, "wx");
    try {
        await timeSearchStage("storage.io.segment.write", () =>
            handle.writeFile(bytes),
        );
        await timeSearchStage("storage.io.segment.sync", () => handle.sync());
    } finally {
        await timeSearchStage("storage.io.segment.close", () => handle.close());
    }
}

async function publish(file: string, bytes: Buffer): Promise<void> {
    const staging = `${file}.${randomUUID()}.staging`;
    await mkdir(path.dirname(file), { recursive: true });
    try {
        await writeNew(staging, bytes);
        for (let attempt = 0; ; attempt++) {
            try {
                await rename(staging, file);
                return;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (
                    process.platform !== "win32" ||
                    !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") ||
                    attempt >= 79
                )
                    throw error;
                await delay(25);
            }
        }
    } finally {
        await rm(staging, { force: true });
    }
}

class SegmentWriter {
    public readonly artifacts = new Set<string>();

    public constructor(
        private readonly root: string,
        private readonly checkpoint?: Checkpoint,
    ) {}

    private async artifact(bytes: Buffer, suffix: "json" | "bin") {
        const hash = digest(bytes);
        const name = `${hash}.${suffix}`;
        if (this.artifacts.has(name)) return hash;
        const file = path.join(this.root, name);
        try {
            await readArtifact(this.root, name, true);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            await publish(file, bytes);
            cacheArtifact(file, bytes, await lstat(file));
            await this.checkpoint?.("segment-written");
        }
        this.artifacts.add(name);
        return hash;
    }

    public node(value: JsonNode): Promise<string> {
        return this.artifact(Buffer.from(`${stringify(value)}\n`), "json");
    }

    private async vectors(vectors: Float32Array[]): Promise<string> {
        const dimensions = vectors[0].length;
        if (!dimensions) throw new Error("Invalid embedding dimensions");
        const batchSize = Math.max(
            1,
            Math.floor(vectorTargetBytes / (dimensions * 4)),
        );
        const blocks: VectorBlock[] = [];
        for (let offset = 0; offset < vectors.length; offset += batchSize) {
            const batch = vectors.slice(offset, offset + batchSize);
            if (batch.some((vector) => vector.length !== dimensions))
                throw new Error("Embeddings must have equal dimensions");
            blocks.push({
                hash: await this.artifact(serializeEmbeddings(batch), "bin"),
                count: batch.length,
            });
        }
        return this.node({
            kind: "vectors",
            dimensions,
            count: vectors.length,
            blocks,
        });
    }

    private async array(values: unknown[]): Promise<string> {
        const children: string[] = [];
        let records: string[] = [];
        let bytes = 2;
        const flush = async () => {
            if (!records.length) return;
            children.push(
                await this.node({
                    kind: "value",
                    value: parse(`[${records.join(",")}]`),
                }),
            );
            records = [];
            bytes = 2;
        };
        for (const value of values) {
            const json = stringify(value ?? null) ?? "null";
            const size = Buffer.byteLength(json) + 1;
            if (bytes + size > jsonTargetBytes) await flush();
            records.push(json);
            bytes += size;
        }
        await flush();
        return this.node({ kind: "chunks", children });
    }

    public async save(value: unknown): Promise<string> {
        if (value instanceof Date) return this.save(value.toJSON());
        if (Array.isArray(value)) {
            if (
                value.length &&
                value.every(
                    (item): item is Float32Array =>
                        item instanceof Float32Array,
                )
            )
                return this.vectors(value);
            return this.array(value);
        }
        if (value && typeof value === "object") {
            const entries: [string, string][] = [];
            for (const [key, item] of Object.entries(value)) {
                if (
                    item === undefined ||
                    typeof item === "function" ||
                    typeof item === "symbol"
                )
                    continue;
                entries.push([key, await this.save(item)]);
            }
            return this.node({ kind: "object", entries });
        }
        if (stringify(value) === undefined)
            throw new Error("Segmented JSON requires a serializable value");
        return this.node({ kind: "value", value });
    }
}

export async function writeSegmentedJson(
    file: string,
    value: unknown,
    metadata: Record<string, number>,
    checkpoint?: Checkpoint,
): Promise<void> {
    return serialize(directory(file), async () => {
        const root = directory(file);
        await mkdir(root, { recursive: true });
        const writer = new SegmentWriter(root, checkpoint);
        const child = await writer.save(value);
        const hash = await writer.node({
            kind: "publication",
            child,
            artifacts: [...writer.artifacts].sort(),
        });
        await checkpoint?.("descriptor-prepared");
        await publish(
            file,
            Buffer.from(
                `${stringify({
                    segmentedJsonVersion: 2,
                    root: hash,
                    metadata,
                } satisfies SegmentedJsonDescriptor)}\n`,
            ),
        );
    });
}

async function retainGraph(
    root: string,
    hash: string,
    retained: Set<string>,
    scheduled: Set<string>,
): Promise<void> {
    if (scheduled.has(hash) || retained.has(`${hash}.json`)) return;
    scheduled.add(hash);
    const pending = [hash];
    for (let offset = 0; offset < pending.length; ) {
        const batch = pending.slice(offset, offset + collectionReadConcurrency);
        offset += batch.length;
        // Drain every read before releasing the root lock, including on failure.
        const results = await Promise.allSettled(
            batch.map((child) => readNode(root, child)),
        );
        for (let index = 0; index < results.length; index++) {
            const result = results[index];
            if (result.status === "rejected") throw result.reason;
            retained.add(`${batch[index]}.json`);
            for (const child of retainNode(result.value, retained)) {
                if (scheduled.has(child) || retained.has(`${child}.json`))
                    continue;
                scheduled.add(child);
                pending.push(child);
            }
        }
    }
}

function retainNode(node: JsonNode, retained: Set<string>): string[] {
    if (node.kind === "publication") {
        validatePublication(node);
        for (const artifact of node.artifacts) retained.add(artifact);
        return [];
    }
    if (node.kind === "vectors") {
        for (const block of node.blocks) {
            if (!digestPattern.test(block.hash))
                throw new Error("Unsafe binary vector reference");
            retained.add(`${block.hash}.bin`);
        }
        return [];
    }
    return node.kind === "object"
        ? node.entries.map(([, child]) => child)
        : node.kind === "value"
          ? []
          : node.children;
}

async function collectSegments(
    generationRoot: string,
    baseFileName: string,
): Promise<void> {
    const root = path.join(generationRoot, jsonSegmentDirectory);
    let entries;
    try {
        entries = await readdir(generationRoot, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    const retained = new Set<string>();
    const scheduled = new Set<string>();
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === jsonSegmentDirectory)
            continue;
        let value: unknown;
        try {
            value = parse(
                await readFile(
                    path.join(generationRoot, entry.name, baseFileName),
                    "utf8",
                ),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
        }
        if (isSegmentedJson(value))
            await retainGraph(root, value.root, retained, scheduled);
    }
    let files: string[];
    try {
        files = await readdir(root);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    for (const name of files) {
        if (/^[a-f0-9]{64}\.(json|bin)\.[a-f0-9-]{36}\.staging$/.test(name)) {
            await rm(path.join(root, name));
            continue;
        }
        if (!artifactPattern.test(name))
            throw new Error(`Unexpected JSON segment '${name}'`);
        if (!retained.has(name)) {
            await rm(path.join(root, name));
            forgetCache(path.join(root, name));
        }
    }
}

/** Publication nodes authenticate reachability without rereading retained payloads. */
export async function collectJsonSegments(
    generationRoot: string,
    baseFileName = "corpus_data.json",
): Promise<void> {
    return serialize(path.join(generationRoot, jsonSegmentDirectory), () =>
        collectSegments(generationRoot, baseFileName),
    );
}

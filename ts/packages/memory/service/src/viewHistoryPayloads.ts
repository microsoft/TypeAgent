// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import git, { type FsClient, type TreeEntry } from "isomorphic-git";
import { createHash } from "node:crypto";
import { recordSearchTiming } from "@typeagent/knowpro";

export const viewStatePayloadPath = "state-payloads";
const chunkSize = 1024 * 1024;
const migrationSize = 512 * 1024;

interface PayloadGitOptions {
    fs: FsClient;
    gitdir: string;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Node =
    | { blob: string; bytes: number }
    | { array: Node[] }
    | { chunks: Node[] }
    | { object: Array<[string, Node]> };
interface Manifest {
    version: 1;
    stateBytes: number;
    root: Node;
}
interface Decoded {
    manifest: Manifest;
    state: Json;
    values: WeakMap<Node, Json>;
}

class NonPlainJson extends Error {}

function plainContainer(object: object, ancestors: Set<object>): void {
    const prototype = Object.getPrototypeOf(object);
    if (
        ancestors.has(object) ||
        (prototype !== Object.prototype &&
            prototype !== Array.prototype &&
            prototype !== null)
    )
        throw new NonPlainJson();
    const toJSON = Object.getOwnPropertyDescriptor(object, "toJSON");
    if (
        ("toJSON" in object && !toJSON) ||
        (toJSON && (!("value" in toJSON) || typeof toJSON.value === "function"))
    )
        throw new NonPlainJson();
}

function dataProperty(object: object, key: string, array: boolean): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
        (descriptor && !("value" in descriptor)) ||
        (array && !descriptor && key in object)
    )
        throw new NonPlainJson();
    return descriptor?.value;
}

// Own all container values used for comparisons. Caller-owned mutable objects
// are never used as an identity cache or retained after publication.
function normalize(
    value: unknown,
    sizes: WeakMap<object, number>,
    ancestors = new Set<object>(),
): { value: Json | undefined; size: number } {
    if (value === null) return { value: null, size: 4 };
    if (typeof value === "string") return { value, size: value.length + 2 };
    if (typeof value === "boolean") return { value, size: value ? 4 : 5 };
    if (typeof value === "number") {
        const number = Number.isFinite(value) ? value || 0 : null;
        return { value: number, size: String(number).length };
    }
    if (["undefined", "function", "symbol"].includes(typeof value))
        return { value: undefined, size: 0 };
    if (typeof value !== "object") throw new NonPlainJson();
    const object = value as object;
    plainContainer(object, ancestors);
    ancestors.add(object);
    let size = 2;
    const entries: Array<[string, Json]> = [];
    const array = Array.isArray(object);
    const keys = array
        ? Array.from({ length: object.length }, (_, index) => String(index))
        : Object.keys(object);
    for (const key of keys) {
        const child = normalize(
            dataProperty(object, key, array),
            sizes,
            ancestors,
        );
        if (child.value === undefined && !array) continue;
        entries.push([key, child.value ?? null]);
        size +=
            (child.value === undefined ? 4 : child.size) +
            (array ? 0 : key.length + 3) +
            1;
    }
    ancestors.delete(object);
    const result = array
        ? entries.map(([, child]) => child)
        : Object.fromEntries(entries);
    sizes.set(result, size);
    return { value: result, size };
}

function tryNormalize(value: unknown, sizes: WeakMap<object, number>) {
    try {
        return normalize(value, sizes);
    } catch (error) {
        if (error instanceof NonPlainJson) return undefined;
        throw error;
    }
}

function equalJson(left: Json | undefined, right: Json | undefined): boolean {
    if (left === right) return true;
    if (
        !left ||
        !right ||
        typeof left !== "object" ||
        typeof right !== "object" ||
        Array.isArray(left) !== Array.isArray(right)
    )
        return false;
    const keys = Object.keys(left);
    const previousKeys = Object.keys(right);
    if (keys.length !== previousKeys.length) return false;
    return keys.every(
        (key, index) =>
            key === previousKeys[index] &&
            equalJson(
                (left as Record<string, Json>)[key],
                (right as Record<string, Json>)[key],
            ),
    );
}

export function unchangedViewRecord(
    value: unknown,
    previous: unknown,
): boolean {
    const normalized = tryNormalize(value, new WeakMap());
    return !!normalized && equalJson(normalized.value, previous as Json);
}

function payloadError(error: unknown): Error {
    return Object.assign(
        new Error("View history payload is missing or corrupt"),
        {
            cause: error,
        },
    );
}

function blobHash(blob: Uint8Array): string {
    return createHash("sha1")
        .update(`blob ${blob.byteLength}\0`)
        .update(blob)
        .digest("hex");
}

async function checkedBlob(
    options: PayloadGitOptions,
    oid: string,
): Promise<Buffer> {
    const { blob } = await git.readBlob({ ...options, oid });
    if (blobHash(blob) !== oid) throw new Error("Payload object hash mismatch");
    return Buffer.from(blob);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateNode(value: unknown): asserts value is Node {
    if (!isRecord(value)) throw new Error("Invalid payload node");
    if ("blob" in value) {
        if (
            Object.keys(value).length !== 2 ||
            typeof value.blob !== "string" ||
            !/^[a-f0-9]{40}$/.test(value.blob) ||
            !Number.isSafeInteger(value.bytes) ||
            (value.bytes as number) < 1
        )
            throw new Error("Invalid payload reference");
    } else if (Object.keys(value).length !== 1) {
        throw new Error("Invalid payload container");
    } else if (Array.isArray(value.array)) {
        for (const child of value.array) validateNode(child);
    } else if (Array.isArray(value.chunks)) {
        for (const child of value.chunks) validateNode(child);
    } else if (Array.isArray(value.object)) {
        const keys = new Set<string>();
        for (const pair of value.object) {
            if (
                !Array.isArray(pair) ||
                pair.length !== 2 ||
                typeof pair[0] !== "string" ||
                keys.has(pair[0])
            )
                throw new Error("Invalid payload object");
            keys.add(pair[0]);
            validateNode(pair[1]);
        }
    } else throw new Error("Invalid payload node kind");
}

function logicalBytes(node: Node): number {
    if ("blob" in node) return node.bytes;
    if ("chunks" in node)
        return (
            2 +
            Math.max(0, node.chunks.length - 1) +
            node.chunks.reduce((sum, child) => sum + logicalBytes(child) - 2, 0)
        );
    if ("array" in node)
        return (
            2 +
            Math.max(0, node.array.length - 1) +
            node.array.reduce((sum, child) => sum + logicalBytes(child), 0)
        );
    return (
        2 +
        Math.max(0, node.object.length - 1) +
        node.object.reduce(
            (sum, [key, child]) =>
                sum +
                Buffer.byteLength(JSON.stringify(key)) +
                1 +
                logicalBytes(child),
            0,
        )
    );
}

async function decode(
    options: PayloadGitOptions,
    entry: TreeEntry,
): Promise<Decoded> {
    try {
        if (entry.type !== "tree") throw new Error("Invalid payload tree");
        const { tree } = await git.readTree({ ...options, oid: entry.oid });
        const files = new Map(tree.map((entry) => [entry.path, entry]));
        const manifestEntry = files.get("manifest.json");
        if (!manifestEntry || manifestEntry.type !== "blob")
            throw new Error("Missing payload manifest");
        const manifest = JSON.parse(
            (await checkedBlob(options, manifestEntry.oid)).toString("utf8"),
        ) as Manifest;
        if (
            manifest?.version !== 1 ||
            !Number.isSafeInteger(manifest.stateBytes)
        )
            throw new Error("Unsupported payload manifest");
        validateNode(manifest.root);
        if (logicalBytes(manifest.root) !== manifest.stateBytes)
            throw new Error("Payload state length mismatch");
        const values = new WeakMap<Node, Json>();
        const blobs = new Map<string, Buffer>();
        const references = new Set<string>();
        const gather = (node: Node): void => {
            if ("blob" in node) {
                const file = files.get(`${node.blob}.json`);
                if (file?.oid !== node.blob || file.type !== "blob")
                    throw new Error("Dangling payload reference");
                references.add(node.blob);
            } else if ("array" in node) node.array.forEach(gather);
            else if ("chunks" in node) node.chunks.forEach(gather);
            else node.object.forEach(([, child]) => gather(child));
        };
        gather(manifest.root);
        const pending = [...references];
        let next = 0;
        const reads = await Promise.allSettled(
            Array.from({ length: Math.min(8, pending.length) }, async () => {
                while (next < pending.length) {
                    const oid = pending[next++];
                    const bytes = await checkedBlob(options, oid);
                    blobs.set(oid, bytes);
                }
            }),
        );
        const failed = reads.find(
            (result): result is PromiseRejectedResult =>
                result.status === "rejected",
        );
        if (failed) throw failed.reason;
        const visit = (node: Node): Json => {
            let value: Json;
            if ("blob" in node) {
                const bytes = blobs.get(node.blob)!;
                if (bytes.byteLength !== node.bytes)
                    throw new Error("Payload length mismatch");
                // Parse each occurrence independently, preserving JSON's lack
                // of shared mutable object identities after reconstruction.
                value = JSON.parse(bytes.toString("utf8")) as Json;
            } else if ("chunks" in node) {
                value = [];
                for (const child of node.chunks) {
                    const chunk = visit(child);
                    if (!Array.isArray(chunk))
                        throw new Error("Non-array payload chunk");
                    for (const element of chunk) value.push(element);
                }
            } else if ("array" in node) {
                value = [];
                for (const child of node.array) value.push(visit(child));
            } else {
                const entries: Array<[string, Json]> = [];
                for (const [key, child] of node.object)
                    entries.push([key, visit(child)]);
                value = Object.fromEntries(entries);
            }
            values.set(node, value);
            return value;
        };
        return { manifest, state: visit(manifest.root), values };
    } catch (error) {
        throw payloadError(error);
    }
}

export async function readViewStatePayloads<T>(
    options: PayloadGitOptions,
    entry: TreeEntry,
): Promise<{ state: T; stateBytes: number }> {
    const started = performance.now();
    const decoded = await decode(options, entry);
    recordSearchTiming(
        "view.history.payload.read",
        performance.now() - started,
        {
            stateBytes: decoded.manifest.stateBytes,
        },
    );
    return {
        state: decoded.state as T,
        stateBytes: decoded.manifest.stateBytes,
    };
}

function estimatedSize(value: Json, sizes: WeakMap<object, number>): number {
    if (value !== null && typeof value === "object") return sizes.get(value)!;
    return typeof value === "string" ? value.length + 2 : String(value).length;
}

function arrayGroups(value: Json[], sizes: WeakMap<object, number>) {
    const groups: Array<{ value: Json[]; size: number }> = [];
    let offset = 0;
    while (offset < value.length) {
        const group: Json[] = [];
        let size = 2;
        while (offset < value.length) {
            const child = value[offset];
            const childSize = estimatedSize(child, sizes);
            if (group.length && size + childSize > chunkSize) break;
            group.push(child);
            size += childSize + 1;
            offset++;
        }
        groups.push({ value: group, size });
    }
    return groups;
}

async function encodeArray(
    value: Json[],
    prior: Node | undefined,
    sizes: WeakMap<object, number>,
    encode: (value: Json, prior?: Node) => Promise<Node>,
): Promise<Node> {
    const chunks: Node[] = [];
    for (const group of arrayGroups(value, sizes)) {
        const priorChunk =
            prior && "chunks" in prior
                ? prior.chunks[chunks.length]
                : undefined;
        if (group.value.length === 1 && group.size > chunkSize) {
            chunks.push({
                array: [
                    await encode(
                        group.value[0],
                        priorChunk && "array" in priorChunk
                            ? priorChunk.array[0]
                            : undefined,
                    ),
                ],
            });
        } else {
            sizes.set(group.value, 0);
            chunks.push(await encode(group.value, priorChunk));
        }
    }
    return { chunks };
}

export async function writeViewStatePayloads(
    options: PayloadGitOptions,
    state: unknown,
    previous?: TreeEntry,
): Promise<TreeEntry | undefined> {
    const started = performance.now();
    const sizes = new WeakMap<object, number>();
    const normalized = tryNormalize(state, sizes);
    if (
        !normalized ||
        normalized.value === undefined ||
        (!previous && normalized.size < migrationSize)
    )
        return undefined;
    const normalizationMs = performance.now() - started;
    const priorReadStarted = performance.now();
    const old = previous ? await decode(options, previous) : undefined;
    const priorReadMs = performance.now() - priorReadStarted;
    let serializedBytes = 0;
    let reusedPayloadBytes = 0;
    let payloadsWritten = 0;
    const serialize = (value: unknown) => {
        const bytes = Buffer.from(JSON.stringify(value), "utf8");
        serializedBytes += bytes.byteLength;
        return bytes;
    };
    const encode = async (value: Json, prior?: Node): Promise<Node> => {
        if (prior && equalJson(value, old!.values.get(prior))) {
            reusedPayloadBytes += logicalBytes(prior);
            return prior;
        }
        if (
            value !== null &&
            typeof value === "object" &&
            (sizes.get(value) ?? 0) > chunkSize
        ) {
            if (Array.isArray(value))
                return encodeArray(value, prior, sizes, encode);
            const previousChildren = new Map(
                prior && "object" in prior ? prior.object : [],
            );
            const object: Array<[string, Node]> = [];
            for (const [key, child] of Object.entries(value))
                object.push([
                    key,
                    await encode(child, previousChildren.get(key)),
                ]);
            return { object };
        }
        const blob = serialize(value);
        payloadsWritten++;
        return {
            blob: await git.writeBlob({ ...options, blob }),
            bytes: blob.byteLength,
        };
    };
    const root = await encode(normalized.value, old?.manifest.root);
    const stateBytes = logicalBytes(root);
    const leaves = new Map<string, TreeEntry>();
    const collect = (node: Node): void => {
        if ("blob" in node)
            leaves.set(node.blob, {
                mode: "100644",
                path: `${node.blob}.json`,
                type: "blob",
                oid: node.blob,
            });
        else if ("array" in node) node.array.forEach(collect);
        else if ("chunks" in node) node.chunks.forEach(collect);
        else node.object.forEach(([, child]) => collect(child));
    };
    collect(root);
    const manifest: Manifest = { version: 1, stateBytes, root };
    const tree = [
        ...leaves.values(),
        {
            mode: "100644",
            path: "manifest.json",
            type: "blob" as const,
            oid: await git.writeBlob({
                ...options,
                blob: serialize(manifest),
            }),
        },
    ];
    const entry: TreeEntry = {
        mode: "040000",
        path: viewStatePayloadPath,
        type: "tree",
        oid: await git.writeTree({ ...options, tree }),
    };
    recordSearchTiming(
        "view.history.payload.write",
        performance.now() - started,
        {
            stateBytes,
            serializedBytes,
            reusedPayloadBytes,
            payloadsWritten,
            payloadReferences: leaves.size,
            normalizationMs,
            priorReadMs,
        },
    );
    return entry;
}

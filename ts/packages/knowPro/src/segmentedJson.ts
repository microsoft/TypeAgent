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
import { setTimeout as delay } from "node:timers/promises";

export const jsonSegmentDirectory = ".segments";
const digestPattern = /^[a-f0-9]{64}$/;
const verified = new Map<string, Set<string>>();
const tails = new Map<string, Promise<void>>();

async function serialize<T>(
    root: string,
    operation: () => Promise<T>,
): Promise<T> {
    const result = (tails.get(root) ?? Promise.resolve()).then(operation);
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
type JsonNode =
    | { kind: "value"; value: unknown }
    | { kind: "items" | "chunks"; children: string[] }
    | { kind: "object"; entries: [string, string][] };

export interface SegmentedJsonDescriptor {
    segmentedJsonVersion: 1;
    root: string;
    metadata: Record<string, number>;
}

function directory(file: string): string {
    return path.join(path.dirname(path.dirname(file)), jsonSegmentDirectory);
}

function digest(bytes: string | Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
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
        value.segmentedJsonVersion !== 1 ||
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

async function readNode(root: string, hash: string): Promise<JsonNode> {
    if (!digestPattern.test(hash))
        throw new Error("Unsafe JSON segment reference");
    const file = path.join(root, `${hash}.json`);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
        throw new Error(`Unsafe JSON segment '${file}'`);
    const bytes = await readFile(file);
    if (digest(bytes) !== hash)
        throw new Error(`Corrupt JSON segment '${file}'`);
    const node: JsonNode = JSON.parse(bytes.toString("utf8"));
    if (!node || !["value", "items", "chunks", "object"].includes(node.kind))
        throw new Error(`Invalid JSON segment '${file}'`);
    const known = verified.get(root) ?? new Set<string>();
    known.add(hash);
    verified.set(root, known);
    return node;
}

async function hydrate(
    root: string,
    hash: string,
    ancestors = new Set<string>(),
): Promise<unknown> {
    if (ancestors.has(hash)) throw new Error("Cyclic JSON segment reference");
    const next = new Set(ancestors).add(hash);
    const node = await readNode(root, hash);
    switch (node.kind) {
        case "value":
            return node.value;
        case "object": {
            const value: Record<string, unknown> = {};
            for (const [key, child] of node.entries) {
                Object.defineProperty(value, key, {
                    value: await hydrate(root, child, next),
                    enumerable: true,
                    writable: true,
                    configurable: true,
                });
            }
            return value;
        }
        default: {
            const values: unknown[] = [];
            for (const child of node.children) {
                const value = await hydrate(root, child, next);
                if (node.kind === "chunks") {
                    if (!Array.isArray(value))
                        throw new Error("Invalid JSON array segment");
                    values.push(...value);
                } else values.push(value);
            }
            return values;
        }
    }
}

export async function readSegmentedJson(
    file: string,
    descriptor: SegmentedJsonDescriptor,
): Promise<unknown> {
    return serialize(directory(file), () =>
        hydrate(directory(file), descriptor.root),
    );
}

async function publish(file: string, bytes: string): Promise<void> {
    const staging = `${file}.${randomUUID()}.staging`;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(staging, bytes, { flag: "wx" });
    try {
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

async function writeSegments(
    file: string,
    value: unknown,
    metadata: Record<string, number>,
    checkpoint?: (
        point: "segment-written" | "descriptor-prepared",
    ) => Promise<void>,
): Promise<void> {
    const root = directory(file);
    await mkdir(root, { recursive: true });
    const existing = new Set(await readdir(root));
    const known = verified.get(root) ?? new Set<string>();
    verified.set(root, known);
    const save = async (item: unknown): Promise<string> => {
        const json = JSON.stringify(item);
        if (json === undefined)
            throw new Error("Segmented JSON requires a serializable value");
        let node: JsonNode;
        if (
            Buffer.byteLength(json) <= 16_384 ||
            !item ||
            typeof item !== "object"
        )
            node = { kind: "value", value: item };
        else if (Array.isArray(item)) {
            const children: string[] = [];
            if (item.length > 64) {
                for (let i = 0; i < item.length; i += 64)
                    children.push(await save(item.slice(i, i + 64)));
                node = { kind: "chunks", children };
            } else {
                for (const entry of item)
                    children.push(
                        await save(entry === undefined ? null : entry),
                    );
                node = { kind: "items", children };
            }
        } else {
            const entries: [string, string][] = [];
            for (const [key, entry] of Object.entries(item)) {
                if (entry !== undefined) entries.push([key, await save(entry)]);
            }
            node = { kind: "object", entries };
        }
        const bytes = `${JSON.stringify(node)}\n`;
        const hash = digest(bytes);
        const name = `${hash}.json`;
        if (!existing.has(name)) {
            try {
                await writeFile(path.join(root, name), bytes, { flag: "wx" });
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                    throw error;
                await readNode(root, hash);
            }
            existing.add(name);
            known.add(hash);
            await checkpoint?.("segment-written");
        } else if (!known.has(hash)) await readNode(root, hash);
        return hash;
    };
    const hash = await save(value);
    await checkpoint?.("descriptor-prepared");
    await publish(
        file,
        `${JSON.stringify({
            segmentedJsonVersion: 1,
            root: hash,
            metadata,
        } satisfies SegmentedJsonDescriptor)}\n`,
    );
}

export async function writeSegmentedJson(
    file: string,
    value: unknown,
    metadata: Record<string, number>,
    checkpoint?: (
        point: "segment-written" | "descriptor-prepared",
    ) => Promise<void>,
): Promise<void> {
    return serialize(directory(file), () =>
        writeSegments(file, value, metadata, checkpoint),
    );
}

async function collectSegments(
    generationRoot: string,
    baseFileName = "corpus_data.json",
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
    const visit = async (hash: string): Promise<void> => {
        if (retained.has(hash)) return;
        const node = await readNode(root, hash);
        retained.add(hash);
        const children =
            node.kind === "object"
                ? node.entries.map(([, child]) => child)
                : node.kind === "value"
                  ? []
                  : node.children;
        for (const child of children) await visit(child);
    };
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === jsonSegmentDirectory)
            continue;
        let value: unknown;
        try {
            value = JSON.parse(
                await readFile(
                    path.join(generationRoot, entry.name, baseFileName),
                    "utf8",
                ),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
        }
        if (isSegmentedJson(value)) await visit(value.root);
    }
    let files: string[];
    try {
        files = await readdir(root);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    for (const name of files) {
        const hash = name.replace(/\.json$/, "");
        if (!digestPattern.test(hash))
            throw new Error(`Unexpected JSON segment '${name}'`);
        if (!retained.has(hash)) {
            await rm(path.join(root, name));
            verified.get(root)?.delete(hash);
        }
    }
}

/** Generation descriptors pin their immutable nodes; concurrent writers queue behind collection. */
export async function collectJsonSegments(
    generationRoot: string,
    baseFileName = "corpus_data.json",
): Promise<void> {
    return serialize(path.join(generationRoot, jsonSegmentDirectory), () =>
        collectSegments(generationRoot, baseFileName),
    );
}

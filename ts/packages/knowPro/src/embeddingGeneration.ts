// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { EmbeddingIdentity, embeddingIdentityKey } from "@typeagent/aiclient";

export interface GenerationRecord {
    sourceId: string;
    revision: string;
    assetHash?: string;
    [key: string]: unknown;
}

export interface GenerationBuild {
    generationId: string;
    lanes: Record<string, EmbeddingIdentity>;
    artifacts: Record<string, string | Uint8Array>;
    records: GenerationRecord[];
}

export interface GenerationManifest {
    schemaVersion: 1;
    generationId: string;
    lanes: Record<string, EmbeddingIdentity>;
    artifacts: Record<string, { sha256: string; bytes: number }>;
    records: GenerationRecord[];
}

interface StoreState {
    schemaVersion: 1;
    active?: string;
    manifestHashes: Record<string, string>;
    visibility: Record<string, { forgotten?: true; revision?: string }>;
}

export interface LoadedGeneration {
    manifest: GenerationManifest;
    artifacts: Record<string, Buffer>;
    records: GenerationRecord[];
}

const hash = (data: string | Uint8Array) =>
    createHash("sha256").update(data).digest("hex");
const owns = (object: object, key: string) =>
    Object.prototype.hasOwnProperty.call(object, key);

function safeName(name: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
        throw new Error(`Invalid generation/artifact name: ${name}`);
    }
    return name;
}

/** Opt-in local store. Readers must search records, which apply the global ledger. */
export class EmbeddingGenerationStore {
    private mutationQueue: Promise<unknown> = Promise.resolve();
    constructor(public readonly root: string) {}

    public async build(input: GenerationBuild): Promise<GenerationManifest> {
        return this.mutate(async (state) => {
            safeName(input.generationId);
            if (owns(state.manifestHashes, input.generationId)) {
                throw new Error(
                    `Generation already exists: ${input.generationId}`,
                );
            }
            if (Object.keys(input.lanes).length === 0) {
                throw new Error(
                    "Generation requires at least one known lane identity",
                );
            }
            for (const identity of Object.values(input.lanes)) {
                embeddingIdentityKey(identity);
            }
            for (const record of input.records) {
                if (!record.sourceId || !record.revision) {
                    throw new Error(
                        "Generation records require sourceId and revision",
                    );
                }
            }
            const staging = path.join(this.root, `staging-${randomUUID()}`);
            await fs.mkdir(staging);
            try {
                const artifacts: GenerationManifest["artifacts"] = {};
                for (const [name, data] of Object.entries(input.artifacts)) {
                    safeName(name);
                    if (name === "manifest.json") {
                        throw new Error(
                            "Reserved artifact name: manifest.json",
                        );
                    }
                    const bytes =
                        typeof data === "string" ? Buffer.from(data) : data;
                    artifacts[name] = {
                        sha256: hash(bytes),
                        bytes: bytes.length,
                    };
                    await this.writeDurable(path.join(staging, name), bytes);
                }
                const manifest: GenerationManifest = {
                    schemaVersion: 1,
                    generationId: input.generationId,
                    lanes: input.lanes,
                    artifacts,
                    records: input.records,
                };
                const json = JSON.stringify(manifest);
                await this.writeDurable(
                    path.join(staging, "manifest.json"),
                    json,
                );
                await this.renameAtomically(
                    staging,
                    this.generationPath(input.generationId),
                );
                state.manifestHashes[input.generationId] = hash(json);
                await this.saveState(state);
                return manifest;
            } finally {
                await fs.rm(staging, { recursive: true, force: true });
            }
        });
    }

    public async load(
        generationId?: string,
        expectedLanes?: Record<string, EmbeddingIdentity>,
    ): Promise<LoadedGeneration> {
        const state = await this.readState();
        const id = generationId ?? state.active;
        if (!id) {
            throw new Error("No active embedding generation");
        }
        return this.loadWithState(id, state, expectedLanes);
    }

    public async activate(generationId: string): Promise<void> {
        await this.mutate(async (state) => {
            await this.loadWithState(generationId, state);
            state.active = generationId;
            await this.saveState(state);
        });
    }

    public async rollback(generationId: string): Promise<void> {
        await this.activate(generationId);
    }

    public async forget(sourceId: string): Promise<void> {
        await this.mutate(async (state) => {
            if (!sourceId) throw new Error("Forget requires sourceId");
            state.visibility = {
                ...state.visibility,
                [sourceId]: { forgotten: true },
            };
            await this.saveState(state);
        });
    }

    public async correct(sourceId: string, revision: string): Promise<void> {
        if (!sourceId || !revision) {
            throw new Error("Correction requires sourceId and revision");
        }
        await this.mutate(async (state) => {
            if (
                owns(state.visibility, sourceId) &&
                state.visibility[sourceId]?.forgotten
            ) {
                throw new Error(
                    "Forgotten sources cannot be restored by correction",
                );
            }
            state.visibility = {
                ...state.visibility,
                [sourceId]: { revision },
            };
            await this.saveState(state);
        });
    }

    public async deleteGeneration(generationId: string): Promise<void> {
        await this.mutate(async (state) => {
            if (state.active === generationId) {
                throw new Error("Cannot delete the active generation");
            }
            safeName(generationId);
            delete state.manifestHashes[generationId];
            await this.saveState(state);
            await fs.rm(this.generationPath(generationId), {
                recursive: true,
                force: true,
            });
        });
    }

    private generationPath(id: string): string {
        return path.join(this.root, "generations", safeName(id));
    }

    private async loadWithState(
        id: string,
        state: StoreState,
        expectedLanes?: Record<string, EmbeddingIdentity>,
    ): Promise<LoadedGeneration> {
        const dir = this.generationPath(id);
        if (!owns(state.manifestHashes, id)) {
            throw new Error(`Unknown or incomplete generation: ${id}`);
        }
        const json = await this.readArtifact(path.join(dir, "manifest.json"));
        if (hash(json) !== state.manifestHashes[id]) {
            throw new Error(`Corrupt generation manifest: ${id}`);
        }
        const manifest = JSON.parse(json.toString()) as GenerationManifest;
        if (manifest.schemaVersion !== 1 || manifest.generationId !== id) {
            throw new Error(`Unsupported generation manifest: ${id}`);
        }
        for (const identity of Object.values(manifest.lanes)) {
            embeddingIdentityKey(identity);
        }
        for (const [lane, expected] of Object.entries(expectedLanes ?? {})) {
            const stored = manifest.lanes[lane];
            if (
                !stored ||
                embeddingIdentityKey(stored) !== embeddingIdentityKey(expected)
            ) {
                throw new Error(`Embedding identity mismatch in lane: ${lane}`);
            }
        }
        const artifacts: Record<string, Buffer> = {};
        for (const [name, binding] of Object.entries(manifest.artifacts)) {
            const bytes = await this.readArtifact(
                path.join(dir, safeName(name)),
            );
            if (
                bytes.length !== binding.bytes ||
                hash(bytes) !== binding.sha256
            ) {
                throw new Error(`Corrupt generation artifact: ${name}`);
            }
            artifacts[name] = bytes;
        }
        const records = manifest.records.filter((record) => {
            const visibility = owns(state.visibility, record.sourceId)
                ? state.visibility[record.sourceId]
                : undefined;
            return (
                !visibility?.forgotten &&
                (!visibility?.revision ||
                    visibility.revision === record.revision)
            );
        });
        return { manifest: { ...manifest, records }, artifacts, records };
    }

    private async readState(): Promise<StoreState> {
        try {
            const { stateHash, ...state } = JSON.parse(
                await fs.readFile(path.join(this.root, "state.json"), "utf8"),
            ) as StoreState & { stateHash: string };
            if (
                stateHash !== hash(JSON.stringify(state)) ||
                state.schemaVersion !== 1 ||
                !state.visibility ||
                !state.manifestHashes
            ) {
                throw new Error("Corrupt embedding generation state");
            }
            return state;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
            // Missing state is only valid in a new, otherwise empty store.
            const entries = await fs
                .readdir(path.join(this.root, "generations"))
                .catch((e: NodeJS.ErrnoException) => {
                    if (e.code === "ENOENT") return [];
                    throw e;
                });
            if (entries.length)
                throw new Error("Missing embedding generation state");
            return { schemaVersion: 1, manifestHashes: {}, visibility: {} };
        }
    }

    private async readArtifact(file: string): Promise<Buffer> {
        return fs.readFile(file).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                throw new Error(`Missing generation artifact: ${file}`);
            }
            throw error;
        });
    }

    private async saveState(state: StoreState): Promise<void> {
        const staging = path.join(this.root, `state-${randomUUID()}.json`);
        try {
            await this.writeDurable(
                staging,
                JSON.stringify({
                    ...state,
                    stateHash: hash(JSON.stringify(state)),
                }),
            );
            await this.renameAtomically(
                staging,
                path.join(this.root, "state.json"),
            );
        } finally {
            await fs.rm(staging, { force: true });
        }
    }

    private renameFile(source: string, destination: string): Promise<void> {
        return fs.rename(source, destination);
    }

    private async renameAtomically(
        source: string,
        destination: string,
        windows = process.platform === "win32",
    ): Promise<void> {
        const attempts = 8;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                await this.renameFile(source, destination);
                return;
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (
                    !windows ||
                    !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")
                ) {
                    throw error;
                }
                const diagnostic = `Embedding generation atomic rename ${source} -> ${destination}: ${code}, attempt ${attempt}/${attempts}`;
                if (attempt === attempts) {
                    throw Object.assign(
                        new Error(`${diagnostic}; retries exhausted`),
                        {
                            code,
                            cause: error,
                        },
                    );
                }
                const milliseconds = Math.min(25 * 2 ** (attempt - 1), 250);
                console.warn(`${diagnostic}; retrying in ${milliseconds}ms`);
                await delay(milliseconds);
            }
        }
    }

    private async writeDurable(
        file: string,
        data: string | Uint8Array,
    ): Promise<void> {
        const handle = await fs.open(file, "wx");
        try {
            await handle.writeFile(data);
            await handle.sync();
        } finally {
            await handle.close();
        }
    }

    private mutate<T>(action: (state: StoreState) => Promise<T>): Promise<T> {
        const result = this.mutationQueue.then(() =>
            this.mutateExclusive(action),
        );
        this.mutationQueue = result.catch(() => {});
        return result;
    }

    private async mutateExclusive<T>(
        action: (state: StoreState) => Promise<T>,
    ): Promise<T> {
        await fs.mkdir(path.join(this.root, "generations"), {
            recursive: true,
        });
        const lockPath = path.join(this.root, "writer.lock");
        const lock = await fs
            .open(lockPath, "wx")
            .catch((error: NodeJS.ErrnoException) => {
                if (error.code === "EEXIST")
                    throw new Error(
                        "Embedding generation store is locked; concurrent mutation or interrupted writer",
                    );
                throw error;
            });
        try {
            return await action(await this.readState());
        } finally {
            await lock.close();
            await fs.unlink(lockPath);
        }
    }
}

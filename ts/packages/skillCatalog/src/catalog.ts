// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type {
    CatalogEntry,
    CatalogSearchQuery,
    CatalogSearchResult,
    CatalogState,
    InstanceStorage,
    SemanticSkillSearch,
    SkillIdentity,
    SkillPackageInput,
    SkillRevision,
} from "./types.js";
import {
    asBytes,
    canonicalJson,
    qualifySkill,
    sha256,
    skillManifestDigest,
    skillStorageKey,
    validateSkillPath,
} from "./util.js";

const allowedTransitions: Readonly<Record<CatalogState, CatalogState[]>> = {
    draft: ["validated", "archived"],
    validated: ["approved", "draft", "archived"],
    approved: ["active", "disabled", "archived"],
    active: ["approved", "disabled", "archived"],
    disabled: ["approved", "active", "archived"],
    archived: [],
};

interface CatalogIndex {
    identities: Record<string, SkillIdentity>;
}

interface RevisionState {
    state: CatalogState;
}

export class SkillCatalog {
    private readonly root: string;
    private mutation = Promise.resolve();

    public constructor(
        private readonly storage: InstanceStorage,
        root = "skill-catalog/v1",
    ) {
        this.root = root.replace(/\/+$/, "");
    }

    public publish(input: SkillPackageInput): Promise<CatalogEntry> {
        return this.exclusive(() => this.publishCore(input));
    }

    public async get(
        identity: SkillIdentity,
        revision?: string,
    ): Promise<CatalogEntry | undefined> {
        const selectedRevision =
            revision ?? (await this.getActiveRevision(identity));
        if (selectedRevision === undefined) {
            return undefined;
        }
        const base = this.revisionBase(identity, selectedRevision);
        if (!(await this.storage.exists(`${base}/revision.json`))) {
            return undefined;
        }
        const stored = await this.readJson<SkillRevision>(
            `${base}/revision.json`,
        );
        const state = await this.readJson<RevisionState>(`${base}/state.json`);
        return {
            revision: stored,
            state: state.state,
            active:
                (await this.getActiveRevision(identity)) === selectedRevision,
        };
    }

    public async readFile(
        identity: SkillIdentity,
        revision: string,
        path: string,
    ): Promise<Uint8Array> {
        validateSkillPath(path);
        const entry = await this.get(identity, revision);
        if (entry === undefined) {
            throw new Error(`Unknown skill revision: ${revision}`);
        }
        const manifest = entry.revision.manifest.find(
            (file) => file.path === path,
        );
        if (manifest === undefined) {
            throw new Error(`Skill file not found: ${path}`);
        }
        const data = await this.storage.read(
            `${this.revisionBase(identity, revision)}/files/${path}`,
        );
        if (
            data.byteLength !== manifest.size ||
            sha256(data) !== manifest.sha256
        ) {
            throw new Error(`Skill file failed integrity validation: ${path}`);
        }
        return data;
    }

    public transition(
        identity: SkillIdentity,
        revision: string,
        next: CatalogState,
    ): Promise<CatalogEntry> {
        return this.exclusive(async () => {
            const entry = await this.requireEntry(identity, revision);
            if (!allowedTransitions[entry.state].includes(next)) {
                throw new Error(
                    `Invalid catalog transition: ${entry.state} -> ${next}`,
                );
            }
            if (next === "active") {
                return this.activateCore(identity, revision);
            }
            if (entry.active) {
                await this.storage.delete(this.activePath(identity));
            }
            await this.writeJson(
                `${this.revisionBase(identity, revision)}/state.json`,
                { state: next },
            );
            return { ...entry, state: next, active: false };
        });
    }

    public activate(
        identity: SkillIdentity,
        revision: string,
    ): Promise<CatalogEntry> {
        return this.exclusive(() => this.activateCore(identity, revision));
    }

    public rollback(
        identity: SkillIdentity,
        revision: string,
    ): Promise<CatalogEntry> {
        return this.activate(identity, revision);
    }

    public async list(): Promise<CatalogEntry[]> {
        const index = await this.readIndex();
        const entries: CatalogEntry[] = [];
        for (const identity of Object.values(index.identities)) {
            const key = skillStorageKey(identity);
            const revisions = await this.storage.list(
                `${this.root}/skills/${key}/revisions`,
                { dirs: true },
            );
            for (const revision of revisions.sort()) {
                const entry = await this.get(identity, revision);
                if (entry !== undefined) {
                    entries.push(entry);
                }
            }
        }
        return entries.sort((left, right) =>
            `${left.revision.qualifiedName}:${left.revision.revision}`.localeCompare(
                `${right.revision.qualifiedName}:${right.revision.revision}`,
            ),
        );
    }

    public async search(
        query: CatalogSearchQuery,
        semantic?: SemanticSkillSearch,
    ): Promise<readonly CatalogSearchResult[]> {
        const normalized = query.text.trim().toLocaleLowerCase();
        const candidates = (await this.list()).filter(
            (entry) =>
                query.scopes === undefined ||
                query.scopes.includes(entry.revision.identity.scope),
        );
        const exact = candidates
            .filter((entry) => {
                const revision = entry.revision;
                return (
                    revision.identity.name.toLocaleLowerCase() === normalized ||
                    revision.qualifiedName.toLocaleLowerCase() === normalized ||
                    revision.displayName.toLocaleLowerCase() === normalized
                );
            })
            .map((entry) => ({ entry, score: 1, source: "exact" as const }));
        const results =
            exact.length > 0 || semantic === undefined
                ? exact
                : [...(await semantic.search(query, candidates))].sort(
                      compareSearchResults,
                  );
        return results.slice(0, query.limit ?? 20);
    }

    private async publishCore(input: SkillPackageInput): Promise<CatalogEntry> {
        const qualifiedName = qualifySkill(input.identity);
        if (input.schemaFingerprint.length === 0) {
            throw new Error("A skill package requires a schema fingerprint.");
        }
        const paths = new Set<string>();
        const files = input.files
            .map((file) => {
                validateSkillPath(file.path);
                if (paths.has(file.path)) {
                    throw new Error(`Duplicate skill file path: ${file.path}`);
                }
                paths.add(file.path);
                const content = asBytes(file.content);
                return {
                    content,
                    manifest: {
                        path: file.path,
                        sha256: sha256(content),
                        size: content.byteLength,
                    },
                };
            })
            .sort((left, right) =>
                left.manifest.path.localeCompare(right.manifest.path),
            );
        if (files.length === 0) {
            throw new Error("A skill package must contain at least one file.");
        }
        const manifestDigest = skillManifestDigest(
            files.map((file) => file.manifest),
        );
        if (
            input.acquisition !== undefined &&
            input.acquisition.manifestDigest !== manifestDigest
        ) {
            throw new Error(
                "Acquisition manifest digest does not match package files.",
            );
        }
        const revision = sha256(
            canonicalJson({
                identity: input.identity,
                displayName: input.displayName ?? input.identity.name,
                description: input.description ?? "",
                schemaFingerprint: input.schemaFingerprint,
                manifest: files.map((file) => file.manifest),
                acquisition:
                    input.acquisition === undefined
                        ? undefined
                        : {
                              provider: input.acquisition.provider,
                              source: input.acquisition.source,
                              sourceFingerprint:
                                  input.acquisition.sourceFingerprint,
                              manifestDigest: input.acquisition.manifestDigest,
                          },
            }),
        );
        const stored: SkillRevision = {
            identity: structuredClone(input.identity),
            qualifiedName,
            revision,
            displayName: input.displayName ?? input.identity.name,
            description: input.description ?? "",
            schemaFingerprint: input.schemaFingerprint,
            manifest: files.map((file) => file.manifest),
            ...(input.acquisition === undefined
                ? {}
                : { acquisition: structuredClone(input.acquisition) }),
            createdAt: new Date().toISOString(),
        };
        const target = this.revisionBase(input.identity, revision);
        if (await this.storage.exists(`${target}/revision.json`)) {
            return this.requireEntry(input.identity, revision);
        }

        const stage = `${this.root}/staging/${randomUUID()}`;
        try {
            await Promise.all(
                files.map((file) =>
                    this.storage.write(
                        `${stage}/files/${file.manifest.path}`,
                        file.content,
                    ),
                ),
            );
            await this.writeJson(`${stage}/revision.json`, stored);
            for (const file of files) {
                await this.storage.write(
                    `${target}/files/${file.manifest.path}`,
                    file.content,
                );
            }
            await this.writeJson(`${target}/state.json`, { state: "draft" });
            await this.writeJson(`${target}/revision.json`, stored);
            await this.addToIndex(input.identity);
            return { revision: stored, state: "draft", active: false };
        } finally {
            await Promise.all(
                [
                    ...files.map(
                        (file) => `${stage}/files/${file.manifest.path}`,
                    ),
                    `${stage}/revision.json`,
                ].map(async (path) => {
                    if (await this.storage.exists(path)) {
                        await this.storage.delete(path);
                    }
                }),
            );
        }
    }

    private async activateCore(
        identity: SkillIdentity,
        revision: string,
    ): Promise<CatalogEntry> {
        const entry = await this.requireEntry(identity, revision);
        if (!["approved", "active", "disabled"].includes(entry.state)) {
            throw new Error(
                `Only approved or disabled revisions can be activated, not ${entry.state}`,
            );
        }
        const previous = await this.getActiveRevision(identity);
        if (previous !== undefined && previous !== revision) {
            await this.writeJson(
                `${this.revisionBase(identity, previous)}/state.json`,
                { state: "approved" },
            );
        }
        await this.writeJson(
            `${this.revisionBase(identity, revision)}/state.json`,
            { state: "active" },
        );
        await this.storage.write(this.activePath(identity), revision);
        return { ...entry, state: "active", active: true };
    }

    private async requireEntry(
        identity: SkillIdentity,
        revision: string,
    ): Promise<CatalogEntry> {
        const entry = await this.get(identity, revision);
        if (entry === undefined) {
            throw new Error(`Unknown skill revision: ${revision}`);
        }
        return entry;
    }

    private async getActiveRevision(
        identity: SkillIdentity,
    ): Promise<string | undefined> {
        const path = this.activePath(identity);
        return (await this.storage.exists(path))
            ? this.storage.read(path, "utf8")
            : undefined;
    }

    private revisionBase(identity: SkillIdentity, revision: string): string {
        if (!/^[a-f0-9]{64}$/.test(revision)) {
            throw new Error(`Invalid skill revision: ${revision}`);
        }
        return `${this.root}/skills/${skillStorageKey(identity)}/revisions/${revision}`;
    }

    private activePath(identity: SkillIdentity): string {
        return `${this.root}/skills/${skillStorageKey(identity)}/active`;
    }

    private async addToIndex(identity: SkillIdentity): Promise<void> {
        const index = await this.readIndex();
        index.identities[qualifySkill(identity)] = identity;
        await this.writeJson(`${this.root}/index.json`, index);
    }

    private async readIndex(): Promise<CatalogIndex> {
        const path = `${this.root}/index.json`;
        return (await this.storage.exists(path))
            ? this.readJson<CatalogIndex>(path)
            : { identities: {} };
    }

    private async readJson<T>(path: string): Promise<T> {
        return JSON.parse(await this.storage.read(path, "utf8")) as T;
    }

    private writeJson(path: string, value: unknown): Promise<void> {
        return this.storage.write(path, canonicalJson(value));
    }

    private exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutation.then(operation, operation);
        this.mutation = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}

function compareSearchResults(
    left: CatalogSearchResult,
    right: CatalogSearchResult,
): number {
    return (
        right.score - left.score ||
        left.entry.revision.qualifiedName.localeCompare(
            right.entry.revision.qualifiedName,
        ) ||
        left.entry.revision.revision.localeCompare(
            right.entry.revision.revision,
        )
    );
}

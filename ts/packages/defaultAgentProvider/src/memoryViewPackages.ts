// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import lockfile from "proper-lockfile";
import {
    inspectMemoryViewPackage,
    loadMemoryViewPackage,
    parseMemoryViewManifest,
    type MemoryViewPackageInstallation,
} from "@typeagent/memory-service/view-packages";
import type {
    InstallSourceConfig,
    InstalledAgentRecord,
} from "./installSources/config.js";
import { createInstallSourceRegistry } from "./installSources/registry.js";
import { deriveMatchKind } from "./installSources/config.js";
import { isSafeModuleName } from "./installSources/feedSource.js";

export interface InstalledMemoryViewPackage {
    name: string;
    record: InstalledAgentRecord;
    installation: MemoryViewPackageInstallation;
}

export interface MemoryViewPackageManagerOptions {
    directory: string;
    sources: InstallSourceConfig[] | (() => InstallSourceConfig[]);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRecord(value: unknown, name: string): InstalledAgentRecord {
    if (
        !isObject(value) ||
        value.name !== name ||
        value.kind !== "npm" ||
        typeof value.source !== "string" ||
        !value.source ||
        value.extensionKind !== "memory-view"
    )
        throw new Error("Invalid memory-view installation record");
    for (const field of ["path", "module", "ref", "installRoot"])
        if (value[field] !== undefined && typeof value[field] !== "string")
            throw new Error("Invalid memory-view package resolution handle");
    if (value.loaderConfig !== undefined && !isObject(value.loaderConfig))
        throw new Error("Invalid memory-view package loader configuration");
    return {
        name,
        kind: "npm",
        source: value.source,
        extensionKind: "memory-view",
        ...(typeof value.path === "string" ? { path: value.path } : {}),
        ...(typeof value.module === "string" ? { module: value.module } : {}),
        ...(typeof value.ref === "string" ? { ref: value.ref } : {}),
        ...(typeof value.installRoot === "string"
            ? { installRoot: value.installRoot }
            : {}),
        ...(isObject(value.loaderConfig)
            ? { loaderConfig: value.loaderConfig }
            : {}),
    };
}

function parseInstallation(value: unknown): MemoryViewPackageInstallation {
    if (
        !isObject(value) ||
        value.schemaVersion !== 1 ||
        typeof value.packageRoot !== "string" ||
        !path.isAbsolute(value.packageRoot) ||
        typeof value.packageName !== "string" ||
        typeof value.packageVersion !== "string" ||
        typeof value.packId !== "string" ||
        typeof value.fingerprint !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.fingerprint)
    )
        throw new Error("Invalid memory-view installation identity");
    const manifest = parseMemoryViewManifest(value.manifest);
    if (manifest.packId !== value.packId)
        throw new Error("Invalid memory-view installed pack identity");
    return {
        schemaVersion: 1,
        packageRoot: value.packageRoot,
        packageName: value.packageName,
        packageVersion: value.packageVersion,
        packId: value.packId,
        fingerprint: value.fingerprint,
        manifest,
    };
}

function parseInventoryEntry(value: unknown): InstalledMemoryViewPackage {
    if (
        !isObject(value) ||
        typeof value.name !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value.name)
    )
        throw new Error("Invalid memory-view installation record");
    return {
        name: value.name,
        record: parseRecord(value.record, value.name),
        installation: parseInstallation(value.installation),
    };
}

export function createMemoryViewPackageManager(
    options: MemoryViewPackageManagerOptions,
) {
    if (!path.isAbsolute(options.directory))
        throw new Error("Memory-view installation directory must be absolute");
    const directory = path.resolve(options.directory);
    const installDir = path.join(directory, "packages");
    const store = path.join(directory, "memory-views.json");
    const registry = () =>
        createInstallSourceRegistry(
            (typeof options.sources === "function"
                ? options.sources()
                : options.sources
            ).filter((source) =>
                ["path", "catalog", "feed"].includes(source.kind),
            ),
            { installDir, extensionKind: "memory-view" },
        );

    async function read(): Promise<InstalledMemoryViewPackage[]> {
        let text: string;
        try {
            text = await readFile(store, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
        }
        const value: unknown = JSON.parse(text);
        if (
            !value ||
            typeof value !== "object" ||
            !("schemaVersion" in value) ||
            value.schemaVersion !== 1 ||
            !("packages" in value) ||
            !Array.isArray(value.packages) ||
            value.packages.length > 64
        )
            throw new Error("Invalid memory-view installation inventory");
        const entries: unknown[] = value.packages;
        const packages = entries.map(parseInventoryEntry);
        if (new Set(packages.map((item) => item.name)).size !== packages.length)
            throw new Error("Duplicate memory-view installation record");
        return packages;
    }

    async function write(
        packages: InstalledMemoryViewPackage[],
    ): Promise<void> {
        const temp = `${store}.${randomUUID()}.tmp`;
        try {
            await writeFile(
                temp,
                JSON.stringify({ schemaVersion: 1, packages }, null, 2) + "\n",
                { flag: "wx" },
            );
            await rename(temp, store);
        } finally {
            await unlink(temp).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
            });
        }
    }

    async function exclusive<T>(work: () => Promise<T>): Promise<T> {
        await mkdir(directory, { recursive: true });
        const release = await lockfile.lock(directory, {
            retries: { retries: 20, minTimeout: 25, maxTimeout: 100 },
        });
        try {
            return await work();
        } finally {
            await release();
        }
    }

    function packageRoot(record: InstalledAgentRecord): string {
        if (record.path) {
            if (!path.isAbsolute(record.path))
                throw new Error(
                    "Memory-view package resolution path must be absolute",
                );
            return record.path;
        }
        if (
            !record.module ||
            !isSafeModuleName(record.module) ||
            !record.installRoot ||
            path.basename(record.installRoot) !== record.installRoot
        )
            throw new Error("Invalid memory-view package resolution handle");
        return path.join(
            installDir,
            "agents",
            record.installRoot,
            "node_modules",
            ...record.module.split("/"),
        );
    }

    async function checked(
        item: InstalledMemoryViewPackage,
    ): Promise<InstalledMemoryViewPackage> {
        const current = await inspectMemoryViewPackage(
            packageRoot(item.record),
        );
        if (JSON.stringify(current) !== JSON.stringify(item.installation))
            throw new Error(
                `Memory-view package '${item.name}' changed or is unavailable; update explicitly`,
            );
        return item;
    }

    async function install(target: string, sourceName?: string) {
        return exclusive(async () => {
            const packages = await read();
            const sources = registry();
            const preview = await sources.preview(
                target,
                undefined,
                sourceName,
            );
            if (!preview)
                throw new Error(
                    `No source could resolve memory-view package '${target}'`,
                );
            const winner = preview.winner;
            const result = await sources.resolveExpected(target, {
                ...winner.candidate,
                source: winner.source,
                sourceKind: winner.sourceKind,
                sourceIdentity: winner.sourceIdentity,
                sourceGeneration: winner.sourceGeneration,
                name: winner.name,
                matchKind: deriveMatchKind({
                    matchedByName: winner.matchedByName,
                    path: winner.candidate.path,
                }),
            });
            const record = {
                ...result.record,
                extensionKind: "memory-view" as const,
            };
            const installation = await inspectMemoryViewPackage(
                packageRoot(record),
            );
            const existing = packages.find((item) => item.name === record.name);
            if (existing) {
                if (
                    existing.installation.fingerprint !==
                    installation.fingerprint
                )
                    throw new Error(
                        `Memory-view package '${record.name}' is installed; update explicitly`,
                    );
                return checked(existing);
            }
            if (packages.length >= 64)
                throw new Error("Memory-view installation bound exceeded");
            const item = { name: record.name, record, installation };
            await write([...packages, item]);
            return item;
        });
    }

    return {
        install,
        async preview(target: string, sourceName?: string) {
            return registry().preview(target, undefined, sourceName);
        },
        async available(sourceName?: string) {
            const sources = registry();
            const infos = sourceName
                ? sources.list().filter((source) => source.name === sourceName)
                : sources.list();
            if (sourceName && !infos.length)
                throw new Error(`Unknown source '${sourceName}'`);
            const rows = [];
            for (const info of infos)
                rows.push(
                    ...((await sources.get(info.name)!.listAgents?.()) ?? []),
                );
            return rows;
        },
        async list() {
            return exclusive(async () =>
                Promise.all((await read()).map(checked)),
            );
        },
        async update(name: string, range?: string) {
            return exclusive(async () => {
                const packages = await read();
                const previous = packages.find((item) => item.name === name);
                if (!previous)
                    throw new Error(
                        `Memory-view package '${name}' is not installed`,
                    );
                const sources = registry();
                let record: InstalledAgentRecord;
                if (previous.record.path) {
                    const loaded = sources.load(previous.record);
                    record = { ...loaded, name, extensionKind: "memory-view" };
                } else {
                    const result = await sources.update(previous.record, {
                        range,
                    });
                    record = {
                        ...result.record,
                        name,
                        extensionKind: "memory-view",
                    };
                }
                const installation = await inspectMemoryViewPackage(
                    packageRoot(record),
                );
                const item = { name, record, installation };
                await write(
                    packages.map((entry) =>
                        entry.name === name ? item : entry,
                    ),
                );
                return item;
            });
        },
        async uninstall(name: string) {
            return exclusive(async () => {
                const packages = await read();
                if (!packages.some((item) => item.name === name))
                    throw new Error(
                        `Memory-view package '${name}' is not installed`,
                    );
                await write(packages.filter((item) => item.name !== name));
            });
        },
        async load(
            name: string,
            selections: Parameters<typeof loadMemoryViewPackage>[1],
        ) {
            const item = await exclusive(async () => {
                const item = (await read()).find(
                    (entry) => entry.name === name,
                );
                if (!item)
                    throw new Error(
                        `Memory-view package '${name}' is not installed`,
                    );
                await checked(item);
                return item;
            });
            return loadMemoryViewPackage(item.installation, selections);
        },
    };
}

export type MemoryViewPackageManager = ReturnType<
    typeof createMemoryViewPackageManager
>;

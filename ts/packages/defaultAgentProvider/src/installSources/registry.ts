// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InstallSource,
    InstallSourceConfig,
    InstallSourceInfo,
    InstalledAgentRecord,
    ResolvedCandidate,
} from "./config.js";
import { createPathSource } from "./pathSource.js";
import { createCatalogSource } from "./catalogSource.js";
import { createFeedSource, FeedSourceDeps } from "./feedSource.js";
import { AsyncMutex } from "./mutex.js";

/**
 * The host's install-source registry. Owns source listing, ordering,
 * configuration, ordered resolution (design §4.1), and the typed `add(config)`
 * used by seeding, tests, and the host's `@source` command handlers. This is
 * entirely host-internal - the dispatcher core has no registry interface; it
 * receives the `@source` command table via `AppAgentInstaller.sourceCommands()`.
 */
export interface DefaultInstallSourceRegistry {
    // Host-rendered summaries for `@source list`.
    list(): InstallSourceInfo[];
    get(name: string): InstallSource | undefined;
    // Reprioritize the single source list (which is the resolution priority
    // order, first match wins): the named sources move to the front (in the
    // given order); every unnamed source keeps its current relative position
    // after them. The list itself is read back via list().
    setOrder(names: string[]): void;
    add(config: InstallSourceConfig): void;
    remove(name: string): void;
    // resolve a ref: explicit source, else walk the configured order.
    resolve(ref: string, sourceName?: string): Promise<InstalledAgentRecord>;
    // dry-run: report which source would win without materializing.
    where(ref: string): Promise<ResolvedCandidate | undefined>;
}

export interface RegistryDeps {
    // Shared npm root all feed sources install into (design §4.1, §12 Q20).
    installDir: string;
    // Feed-source dependency overrides (token runner, fetch, npm install) for
    // testing; installDir is supplied separately.
    feedDeps?: Omit<FeedSourceDeps, "installDir">;
    // Shared async mutex; the installer (M2) reuses it so the record write
    // joins the same serialization domain (design §12 Q5). Defaults to a fresh
    // mutex when omitted.
    mutex?: AsyncMutex;
    // Persist the ordered source list to instance config (wired in M2.5 / M3).
    // Called after add/remove/setOrder.
    persist?: (configs: InstallSourceConfig[]) => void;
}

function buildSource(
    config: InstallSourceConfig,
    deps: RegistryDeps,
): InstallSource {
    switch (config.kind) {
        case "path":
            return createPathSource(config);
        case "catalog":
            return createCatalogSource(config);
        case "feed":
            return createFeedSource(config, {
                installDir: deps.installDir,
                ...deps.feedDeps,
            });
        default: {
            const exhaustive: never = config;
            throw new Error(
                `unknown install source kind: ${JSON.stringify(exhaustive)}`,
            );
        }
    }
}

export function createInstallSourceRegistry(
    initialConfigs: InstallSourceConfig[],
    deps: RegistryDeps,
): DefaultInstallSourceRegistry {
    const mutex = deps.mutex ?? new AsyncMutex();
    type Entry = { config: InstallSourceConfig; source: InstallSource };
    // One map holds each source's config and built source together (always in
    // lockstep). The map iteration order IS the resolution priority order
    // (first match wins, §4.1).
    let entries = new Map<string, Entry>();

    for (const config of initialConfigs) {
        if (entries.has(config.name)) {
            throw new Error(`duplicate install source name: '${config.name}'`);
        }
        entries.set(config.name, { config, source: buildSource(config, deps) });
    }

    function persist(): void {
        deps.persist?.(Array.from(entries.values(), (e) => e.config));
    }

    // The host-rendered one-line summary the core shows for `@source list`. This
    // is where the kind taxonomy is interpreted (the core never sees it).
    function describe(config: InstallSourceConfig): string {
        switch (config.kind) {
            case "feed":
                return config.registry ?? "(env: TYPEAGENT_FEED_REGISTRY)";
            case "catalog":
                return config.catalog;
            case "path":
                return config.baseDir ?? "(default base)";
            default: {
                const exhaustive: never = config;
                return String(exhaustive);
            }
        }
    }

    function addConfig(config: InstallSourceConfig): void {
        if (entries.has(config.name)) {
            throw new Error(`source '${config.name}' already exists`);
        }
        entries.set(config.name, { config, source: buildSource(config, deps) });
        persist();
    }

    async function resolveUnlocked(
        ref: string,
        sourceName?: string,
    ): Promise<InstalledAgentRecord> {
        if (sourceName !== undefined) {
            const entry = entries.get(sourceName);
            if (entry === undefined) {
                throw new Error(`unknown source '${sourceName}'`);
            }
            const candidate = await entry.source.find(ref);
            if (candidate === undefined) {
                // Explicit --source non-match is a hard error (§4.1, §12 Q4).
                throw new Error(`'${ref}' not found in source '${sourceName}'`);
            }
            return entry.source.materialize(candidate);
        }
        // Probe the sources in resolution (map iteration) order; first match
        // wins (§4.1).
        const ordered = Array.from(entries.values(), (e) => e.source);
        const candidates = await Promise.all(ordered.map((s) => s.find(ref)));
        const index = candidates.findIndex((c) => c !== undefined);
        if (index < 0) {
            throw new Error(
                `no source could resolve '${ref}'. order: [${ordered
                    .map((s) => s.name)
                    .join(", ")}]`,
            );
        }
        return ordered[index].materialize(candidates[index]!);
    }

    return {
        list(): InstallSourceInfo[] {
            return Array.from(entries.values(), ({ config }) => ({
                name: config.name,
                kind: config.kind,
                detail: describe(config),
            }));
        },
        get(name: string): InstallSource | undefined {
            return entries.get(name)?.source;
        },
        setOrder(names: string[]): void {
            // Pull the named sources to the front in the requested order; then
            // append every source not already placed, in its current order.
            // newEntries.has() doubles as the "already placed" set, so duplicate
            // and unknown names fall away. This is the resolution order.
            const newEntries = new Map<string, Entry>();
            const place = (name: string) => {
                const entry = entries.get(name);
                if (entry !== undefined && !newEntries.has(name)) {
                    newEntries.set(name, entry);
                }
            };
            for (const name of names) {
                place(name);
            }
            for (const name of entries.keys()) {
                place(name);
            }
            entries = newEntries;
            persist();
        },
        add(config: InstallSourceConfig): void {
            addConfig(config);
        },
        remove(name: string): void {
            if (!entries.has(name)) {
                throw new Error(`unknown source '${name}'`);
            }
            entries.delete(name);
            persist();
        },
        async resolve(
            ref: string,
            sourceName?: string,
        ): Promise<InstalledAgentRecord> {
            // The whole install op (resolve -> materialize) runs under the
            // shared mutex (design §12 Q5). The installer (M2) reuses the same
            // mutex for the record write.
            return mutex.runExclusive(() => resolveUnlocked(ref, sourceName));
        },
        async where(ref: string): Promise<ResolvedCandidate | undefined> {
            // Dry-run: report which source would win without materializing.
            const ordered = Array.from(entries.values(), (e) => e.source);
            const candidates = await Promise.all(
                ordered.map((s) => s.find(ref)),
            );
            return candidates.find((c) => c !== undefined);
        },
    };
}

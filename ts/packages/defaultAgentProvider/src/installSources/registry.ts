// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InstallSource,
    InstallSourceConfig,
    InstallSourceInfo,
    InstallSourceUpdateResult,
    InstalledAgentRecord,
    MaterializedInstallRecord,
    ResolvedCandidate,
    SourceStatus,
    SourceWarning,
} from "./config.js";
import { createPathSource } from "./pathSource.js";
import { createCatalogSource } from "./catalogSource.js";
import { createFeedSource } from "./feedSource.js";
import { createLimiter, Limiter } from "@typeagent/common-utils";

/**
 * The host's install-source registry. Handles source listing, ordering,
 * configuration, ordered resolution, and the typed `add(config)`
 * used by seeding, tests, and the host's `@package source` command handlers.
 * This is host-internal - the dispatcher core has no registry
 * interface; it receives the `@package source` command table via
 * `InstalledAgentSourceApi.sourceCommands()`.
 */
export interface DefaultInstallSourceRegistry {
    // Host-rendered summaries for `@package source list`.
    list(): InstallSourceInfo[];
    get(name: string): InstallSource | undefined;
    // Reprioritize the single source list (which is the resolution priority
    // order, first match wins): the named sources move to the front (in the
    // given order); every unnamed source keeps its current relative position
    // after them. The list itself is read back via list().
    setOrder(names: string[]): void;
    add(config: InstallSourceConfig): void;
    remove(name: string): void;
    // Give the recorded source a chance to refresh a persisted record before
    // provider construction. Sources without a load hook use the record as-is.
    load(
        record: InstalledAgentRecord,
        onWarn?: SourceWarning,
    ): InstalledAgentRecord;
    // resolve a ref: explicit source, else walk the configured order
    // sequentially, first match wins. `onWarn`, when supplied, receives
    // non-fatal source problem messages (e.g. a corrupt catalog) for the caller
    // to show on the triggering command. `onStatus`, when supplied, is
    // called with the name of each source as it is probed so the caller can
    // show a live status line.
    resolve(
        ref: string,
        sourceName?: string,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<MaterializedInstallRecord>;
    // Update a previously-installed record via its recorded source. The source
    // owns whether update is supported and how its persisted record is
    // interpreted; the registry only performs source lookup and limiter
    // coordination.
    update(
        record: InstalledAgentRecord,
        opts?: {
            range?: string | undefined;
        },
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<InstallSourceUpdateResult>;
    // dry-run: report which source would win without materializing. Walks the
    // configured order sequentially like resolve().
    where(
        ref: string,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<ResolvedCandidate | undefined>;
}

export async function listAvailableAgents(
    registry: DefaultInstallSourceRegistry,
    onError?: (sourceName: string, error: unknown) => void,
): Promise<string[]> {
    const lists = await Promise.all(
        registry.list().map(async (info) => {
            const source = registry.get(info.name);
            try {
                return (await source?.listAgents?.()) ?? [];
            } catch (error) {
                onError?.(info.name, error);
                return [];
            }
        }),
    );
    return [...new Set(lists.flat())];
}

export interface RegistryDeps {
    // Shared npm root all feed sources install into.
    installDir: string;
    // Shared serialize-to-one limiter; the installer reuses it so the
    // record write joins the same serialization domain.
    // Defaults to a fresh createLimiter(1) when omitted.
    limiter?: Limiter;
    // Persist the ordered source list to instance config.
    // Called after add/remove/setOrder.
    persist?: (configs: InstallSourceConfig[]) => void;
    // Runtime-only resolution filter for hosts without a usable local
    // filesystem (e.g. the web API server): when set, `path` sources are
    // skipped during the implicit resolution walk so their refs never resolve
    // against the server's own filesystem. This never touches the persisted or
    // seeded source list - only which sources are probed at resolve time.
    excludePathSources?: boolean;
}

export type InstallSourceFactory = (
    config: InstallSourceConfig,
) => InstallSource;

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
    /** Host extension point for supplying alternate source implementations. */
    sourceFactory: InstallSourceFactory = (config) => buildSource(config, deps),
): DefaultInstallSourceRegistry {
    const limiter = deps.limiter ?? createLimiter(1);
    type Entry = { config: InstallSourceConfig; source: InstallSource };
    // One map holds each source's config and built source together (always in
    // lockstep). The map iteration order IS the resolution priority order
    // (first match wins).
    let entries = new Map<string, Entry>();

    // Process-lifetime dedup for the server log: a source problem (corrupt
    // catalog, dropped entry) is logged at most once per distinct
    // message, regardless of which read path hit it (resolve, where,
    // listAgents, seeding) or whether a command supplied its own callback. The
    // sources hold no dedup state - they report every problem
    // via `onWarn`; this is the only place that does the once-per-process
    // console dedup. A caller's per-command callback runs on top (below),
    // so an install/where still shows the message to the user every time
    // while the server log stays deduped.
    const backgroundWarned = new Set<string>();
    function composeWarn(caller?: SourceWarning): SourceWarning {
        return (message) => {
            if (!backgroundWarned.has(message)) {
                backgroundWarned.add(message);
                console.warn(`Warning: ${message}`);
            }
            caller?.(message);
        };
    }
    // Wrap a built source so every warning-bearing call (find / update /
    // listAgents) routes its warnings through the combined background+caller
    // callback. Wrapping here, at the one place sources are built, means every
    // access path - resolve, where, get()->listAgents - gets the server-log
    // dedup. Optional methods are only re-wrapped when the source provides them.
    function build(config: InstallSourceConfig): InstallSource {
        const { find, update, load, listAgents, ...rest } =
            sourceFactory(config);
        const wrapped: InstallSource = {
            ...rest,
            find: (ref, onWarn) => find(ref, composeWarn(onWarn)),
        };
        if (update !== undefined) {
            wrapped.update = (record, opts, onWarn) =>
                update(record, opts, composeWarn(onWarn));
        }
        if (load !== undefined) {
            wrapped.load = (record, onWarn) =>
                load(record, composeWarn(onWarn));
        }
        if (listAgents !== undefined) {
            wrapped.listAgents = (onWarn) => listAgents(composeWarn(onWarn));
        }
        return wrapped;
    }

    for (const config of initialConfigs) {
        if (entries.has(config.name)) {
            throw new Error(`duplicate install source name: '${config.name}'`);
        }
        entries.set(config.name, { config, source: build(config) });
    }

    function persist(): void {
        deps.persist?.(Array.from(entries.values(), (e) => e.config));
    }

    // Sources eligible for the implicit resolution walk, in priority order.
    // `excludePathSources` is a runtime-only filter (hosts without a usable
    // local filesystem) that narrows what gets probed here; it does
    // not touch `entries`, `list()`, or `persist()`, so the persisted and
    // displayed source list keeps every source.
    function resolutionSources(): InstallSource[] {
        const all = Array.from(entries.values());
        const eligible = deps.excludePathSources
            ? all.filter((e) => e.config.kind !== "path")
            : all;
        return eligible.map((e) => e.source);
    }

    // The host-rendered one-line summary the core shows for `@package source list`. This
    // is where the kind is interpreted (the core never sees it).
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
        entries.set(config.name, { config, source: build(config) });
        persist();
    }

    // Probe the sources sequentially in resolution (map iteration) order; first
    // match wins, so a later source is never probed once an earlier one matches.
    // Shared by the implicit resolve walk and `where` (dry-run).
    async function walk(
        ref: string,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<
        { source: InstallSource; candidate: ResolvedCandidate } | undefined
    > {
        for (const source of resolutionSources()) {
            onStatus?.(`Trying source '${source.name}'...`);
            const candidate = await source.find(ref, onWarn);
            if (candidate !== undefined) {
                return { source, candidate };
            }
        }
        return undefined;
    }

    async function resolveUnlocked(
        ref: string,
        sourceName?: string,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<MaterializedInstallRecord> {
        if (sourceName !== undefined) {
            const entry = entries.get(sourceName);
            if (entry === undefined) {
                throw new Error(`unknown source '${sourceName}'`);
            }
            if (deps.excludePathSources && entry.config.kind === "path") {
                // Path sources are unusable on this host (no local filesystem),
                // so an explicit --source path would resolve against the
                // server's own filesystem; reject it rather than honor it.
                throw new Error(
                    `source '${sourceName}' is not available on this host`,
                );
            }
            onStatus?.(`Resolving '${ref}' from source '${sourceName}'...`);
            const candidate = await entry.source.find(ref, onWarn);
            if (candidate === undefined) {
                // Explicit --source non-match is a hard error.
                throw new Error(`'${ref}' not found in source '${sourceName}'`);
            }
            return entry.source.materialize(candidate, onStatus);
        }
        const match = await walk(ref, onWarn, onStatus);
        if (match === undefined) {
            throw new Error(
                `no source could resolve '${ref}'. order: [${resolutionSources()
                    .map((s) => s.name)
                    .join(", ")}]`,
            );
        }
        return match.source.materialize(match.candidate, onStatus);
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
        load(
            record: InstalledAgentRecord,
            onWarn?: SourceWarning,
        ): InstalledAgentRecord {
            const entry = entries.get(record.source);
            if (entry?.source.load === undefined) {
                return record;
            }
            const loaded = entry.source.load(record, onWarn);
            if (loaded === undefined) {
                throw new Error(
                    `agent '${record.name}' is no longer resolvable from source '${record.source}'.`,
                );
            }
            return { ...loaded, name: record.name };
        },
        async resolve(
            ref: string,
            sourceName?: string,
            onWarn?: SourceWarning,
            onStatus?: SourceStatus,
        ): Promise<MaterializedInstallRecord> {
            // The whole install op (resolve -> materialize) runs under the
            // shared limiter. The installer reuses the
            // same limiter for the record write.
            return limiter(() =>
                resolveUnlocked(ref, sourceName, onWarn, onStatus),
            );
        },
        async update(
            record: InstalledAgentRecord,
            opts?: {
                range?: string | undefined;
            },
            onWarn?: SourceWarning,
            onStatus?: SourceStatus,
        ): Promise<InstallSourceUpdateResult> {
            // Mirror resolve(): the whole source-owned update runs under the
            // shared limiter.
            return limiter(async () => {
                const entry = entries.get(record.source);
                if (entry === undefined) {
                    // The recorded source was removed since install.
                    throw new Error(
                        `Source '${record.source}' for agent '${record.name}' is no longer configured; ` +
                            `re-add it with '@package source add' to update, or '@package uninstall ${record.name}'.`,
                    );
                }
                if (entry.source.update === undefined) {
                    throw new Error(
                        `Source '${record.source}' does not support updating agent '${record.name}'. ` +
                            `Only feed-sourced agents can be updated; uninstall and reinstall this agent to pick up changes.`,
                    );
                }
                onStatus?.(
                    `Updating '${record.name}' from source '${record.source}'...`,
                );
                return entry.source.update(
                    record,
                    { range: opts?.range },
                    onWarn,
                );
            });
        },
        async where(
            ref: string,
            onWarn?: SourceWarning,
            onStatus?: SourceStatus,
        ): Promise<ResolvedCandidate | undefined> {
            // Dry-run: report which source would win without materializing.
            // Walks the sources sequentially in resolution order, first match
            // wins, so it never probes a later source than the winner.
            return (await walk(ref, onWarn, onStatus))?.candidate;
        },
    };
}

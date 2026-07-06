// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InstallSource,
    InstallSourceConfig,
    InstallSourceInfo,
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
 * The host's install-source registry. Owns source listing, ordering,
 * configuration, ordered resolution, and the typed `add(config)`
 * used by seeding, tests, and the host's `@package source` command handlers.
 * This is entirely host-internal - the dispatcher core has no registry
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
    // resolve a ref: explicit source, else walk the configured order
    // sequentially, first match wins. `onWarn`, when supplied, receives
    // non-fatal source degrade messages (e.g. a corrupt catalog) for the caller
    // to surface on the triggering command. `onStatus`, when supplied, is
    // called with the name of each source as it is probed so the caller can
    // show a live status line.
    resolve(
        ref: string,
        sourceName?: string,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<MaterializedInstallRecord>;
    // Re-resolve + re-materialize a previously-installed record against its
    // recorded source, for `@package update`. The source that
    // produced the record owns the whole policy (which handle to read, how a
    // version `range` applies, corrupt-record validation) via
    // {@link InstallSource.reresolve}; the registry just runs it + materialize
    // under the shared limiter and carries the source's re-resolution handle
    // (`ref`) through so the next update still works. Throws when the source is
    // gone, does not support update, or no longer resolves the record.
    reresolve(
        record: InstalledAgentRecord,
        opts?: {
            range?: string | undefined;
        },
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<MaterializedInstallRecord>;
    // dry-run: report which source would win without materializing. Walks the
    // configured order sequentially like resolve().
    where(
        ref: string,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<ResolvedCandidate | undefined>;
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
    // Test-only seam: how a config is turned into a live source. Production
    // never passes this - it defaults to the real per-kind builder. Tests
    // override it to inject a source with mocked dependencies (e.g. a feed
    // source with a stubbed npm install) without any test-only field leaking
    // onto the production {@link RegistryDeps} interface.
    buildSourceFn: (config: InstallSourceConfig) => InstallSource = (config) =>
        buildSource(config, deps),
): DefaultInstallSourceRegistry {
    const limiter = deps.limiter ?? createLimiter(1);
    type Entry = { config: InstallSourceConfig; source: InstallSource };
    // One map holds each source's config and built source together (always in
    // lockstep). The map iteration order IS the resolution priority order
    // (first match wins).
    let entries = new Map<string, Entry>();

    // Process-lifetime background sink: a source degrade (corrupt catalog,
    // dropped entry) is surfaced to the server log at most once per distinct
    // message, regardless of which read path hit it (resolve, where,
    // listAgents, seeding) or whether a command supplied its own sink. The
    // sources themselves hold NO dedup state - they just report every problem
    // via `onWarn`; this is the single place the "once per process" policy for
    // the console lives. A caller's per-command sink composes on top (below),
    // so an install/where still surfaces the message to the user every time
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
    // Wrap a built source so every find/listAgents call routes its warnings
    // through the composed background+caller sink. Wrapping at this single build
    // choke point means every access path - resolve, where, get()->listAgents
    // - gets the server-log dedup for free.
    function build(config: InstallSourceConfig): InstallSource {
        const source = buildSourceFn(config);
        return {
            ...source,
            find: (ref, onWarn) => source.find(ref, composeWarn(onWarn)),
            ...(source.reresolve !== undefined
                ? {
                      reresolve: (candidate, opts, onWarn) =>
                          source.reresolve!(
                              candidate,
                              opts,
                              composeWarn(onWarn),
                          ),
                  }
                : {}),
            ...(source.listAgents !== undefined
                ? {
                      listAgents: (onWarn) =>
                          source.listAgents!(composeWarn(onWarn)),
                  }
                : {}),
        };
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
    // local filesystem) that narrows what gets probed here; it deliberately
    // does NOT touch `entries`, `list()`, or `persist()`, so the persisted and
    // displayed source list keeps every source.
    function resolutionSources(): InstallSource[] {
        const all = Array.from(entries.values());
        const eligible = deps.excludePathSources
            ? all.filter((e) => e.config.kind !== "path")
            : all;
        return eligible.map((e) => e.source);
    }

    // The host-rendered one-line summary the core shows for `@package source list`. This
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
        entries.set(config.name, { config, source: build(config) });
        persist();
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
            return entry.source.materialize(candidate);
        }
        // Probe the sources sequentially in resolution (map iteration) order;
        // first match wins , so a later source is never probed once an
        // earlier one matches.
        const ordered = resolutionSources();
        for (const source of ordered) {
            onStatus?.(`Trying source '${source.name}'...`);
            const candidate = await source.find(ref, onWarn);
            if (candidate !== undefined) {
                return source.materialize(candidate);
            }
        }
        throw new Error(
            `no source could resolve '${ref}'. order: [${ordered
                .map((s) => s.name)
                .join(", ")}]`,
        );
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
        async reresolve(
            record: InstalledAgentRecord,
            opts?: {
                range?: string | undefined;
            },
            onWarn?: SourceWarning,
            onStatus?: SourceStatus,
        ): Promise<MaterializedInstallRecord> {
            // Mirror resolve(): the whole re-resolve -> materialize runs under
            // the shared limiter.
            return limiter(async () => {
                const entry = entries.get(record.source);
                if (entry === undefined) {
                    // Friendly, actionable message: the recorded source was
                    // removed since install.
                    throw new Error(
                        `Source '${record.source}' for agent '${record.name}' is no longer configured; ` +
                            `re-add it with '@package source add' to update, or '@package uninstall ${record.name}'.`,
                    );
                }
                if (entry.source.reresolve === undefined) {
                    throw new Error(
                        `Source '${record.source}' does not support updating agent '${record.name}'.`,
                    );
                }
                onStatus?.(
                    `Re-resolving '${record.name}' from source '${record.source}'...`,
                );
                // The source speaks only ResolvedCandidate. Recover the
                // candidate this source produced at install time from the
                // record's fields, dropping the persistence-only `name`/`kind`
                // so they never leak into a source.
                const prior: ResolvedCandidate = { source: record.source };
                if (record.module !== undefined) {
                    prior.module = record.module;
                }
                if (record.path !== undefined) {
                    prior.path = record.path;
                }
                if (record.ref !== undefined) {
                    prior.ref = record.ref;
                }
                if (record.loaderConfig !== undefined) {
                    prior.loaderConfig = record.loaderConfig;
                }
                const candidate = await entry.source.reresolve(
                    prior,
                    { range: opts?.range },
                    onWarn,
                );
                if (candidate === undefined) {
                    throw new Error(
                        `agent '${record.name}' is no longer resolvable from source '${record.source}'.`,
                    );
                }
                // The source's `materialize` persists its own re-resolution
                // handle (feed: spec; catalog: key; path: path), so the
                // re-materialized record is already self-sufficient for the next
                // update - no host-side carry needed. It builds a fresh
                // version-scoped root labeled by the package name.
                return entry.source.materialize(candidate);
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
            const ordered = resolutionSources();
            for (const source of ordered) {
                onStatus?.(`Trying source '${source.name}'...`);
                const candidate = await source.find(ref, onWarn);
                if (candidate !== undefined) {
                    return candidate;
                }
            }
            return undefined;
        },
    };
}

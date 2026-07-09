// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InstallSource,
    InstallSourceConfig,
    InstallSourceInfo,
    InstallSourceUpdateResult,
    InstalledAgentRecord,
    ResolveResult,
    ResolvedCandidate,
    AvailableInstallRow,
    SourceStatus,
    SourceWarning,
} from "./config.js";
import { createPathSource } from "./pathSource.js";
import { createCatalogSource } from "./catalogSource.js";
import { createFeedSource } from "./feedSource.js";
import { readPackageMeta, isLegalAgentName } from "./packageMeta.js";
import { createLimiter, Limiter } from "@typeagent/common-utils";

/**
 * The host's install-source registry. Handles source listing, ordering,
 * configuration, ordered resolution, and the typed `add(config)`
 * used by seeding, tests, and the host's `@package source` command handlers.
 * This is host-internal - the dispatcher core has no registry
 * interface; it receives the `@package source` command table via
 * `InstalledAgentSourceApi.sourceCommands()`.
 */
/**
 * One match produced by a resolution walk, used by the dry-run preview to show
 * the winner and the full shadow set. `matchedByName` is `true` for a phase-1
 * default-agent-name (`findName`) match and `false` for a phase-2/explicit ref
 * (`find`) match. `name` is the dispatcher name the install would use (the
 * inferred default name, or the explicit override in two-argument mode).
 */
export interface PreviewMatch {
    source: string;
    matchedByName: boolean;
    name: string;
    candidate: ResolvedCandidate;
}

/**
 * A dry-run preview: the winning match plus every other match in priority order
 * across both phases (so an incidental shadow is visible). Produced without
 * materializing; nothing is installed.
 */
export interface PreviewResult {
    winner: PreviewMatch;
    matches: PreviewMatch[];
}

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
    // Resolve an install. Overloaded on whether `ref` is supplied:
    //  - `ref` omitted (one-argument `@package install <target>`): INFER mode -
    //    `nameOrTarget` is the target; walk the two-phase inferred walk
    //    (`findName` across sources first, then `find`) and derive the installed
    //    name from the resolved package.
    //  - `ref` defined (two-argument `@package install <ref> <name>`): EXPLICIT
    //    mode - resolve `ref` via the ordered ref walk and stamp `nameOrTarget`
    //    as the installed name.
    // Either way the winning candidate is materialized into a named record.
    // `onWarn`, when supplied, receives non-fatal source problem messages;
    // `onStatus`, when supplied, reports each source as it is probed.
    resolve(
        nameOrTarget: string,
        ref?: string,
        sourceName?: string,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<ResolveResult>;
    // Dry-run: report which source would win (and the full shadow set) without
    // materializing. Mirrors `resolve`'s arity: `ref` omitted runs the inferred
    // two-phase walk; `ref` defined runs the explicit ref walk. Returns
    // undefined when nothing would resolve.
    preview(
        nameOrTarget: string,
        ref?: string,
        sourceName?: string,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<PreviewResult | undefined>;
    // Refresh cache-backed source metadata (feed descriptor caches). When
    // `sourceName` is given, only that source is refreshed. A fetch failure
    // throws (the prior cache is left intact) so `--refresh` fails the command.
    refresh(sourceName?: string, onWarn?: SourceWarning): Promise<void>;
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
}

export async function listAvailableAgents(
    registry: DefaultInstallSourceRegistry,
    onError?: (sourceName: string, error: unknown) => void,
): Promise<AvailableInstallRow[]> {
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
    // De-duplicate by (source, ref): one source can surface the same entry
    // under both its default agent name and its package name.
    const seen = new Set<string>();
    const rows: AvailableInstallRow[] = [];
    for (const row of lists.flat()) {
        const key = `${row.source}\u0000${row.ref}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        rows.push(row);
    }
    return rows;
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
        const { find, findName, update, load, listAgents, refresh, ...rest } =
            sourceFactory(config);
        const wrapped: InstallSource = {
            ...rest,
            find: (ref, onWarn) => find(ref, composeWarn(onWarn)),
        };
        if (findName !== undefined) {
            wrapped.findName = (name, onWarn) =>
                findName(name, composeWarn(onWarn));
        }
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
        if (refresh !== undefined) {
            wrapped.refresh = (onWarn) => refresh(composeWarn(onWarn));
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

    // The ordered source list to walk for a resolution. With no explicit
    // source, this is the full resolution priority order (respecting the
    // runtime `excludePathSources` filter). An explicit source narrows to that
    // single source, hard-failing on an unknown or host-unavailable name.
    function sourcesFor(sourceName?: string): InstallSource[] {
        if (sourceName === undefined) {
            return resolutionSources();
        }
        const entry = entries.get(sourceName);
        if (entry === undefined) {
            throw new Error(`Unknown source '${sourceName}'`);
        }
        if (deps.excludePathSources && entry.config.kind === "path") {
            // Path sources are unusable on this host (no local filesystem), so
            // an explicit --source path would resolve against the server's own
            // filesystem; reject it rather than honor it.
            throw new Error(
                `${describeSource(sourceName)} is not available on this host`,
            );
        }
        return [entry.source];
    }

    // A single match yielded by a resolution walk. `matchedByName` is `true`
    // for a phase-1 default-agent-name (`findName`) match and `false` for a
    // phase-2 / explicit ref (`find`) match.
    type WalkMatch = {
        source: InstallSource;
        candidate: ResolvedCandidate;
        matchedByName: boolean;
    };

    // Lazily yield every ref (phase-2 / explicit) match across the sources in
    // priority order. A consumer that stops after the first value stops the
    // probing (first-match-wins); one that drains it gets the full shadow set.
    // A ref match is never a name match, so `matchedByName` is always false
    // (kept so this shares `inferMatches`' shape).
    async function* refMatches(
        ref: string,
        sourceName: string | undefined,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): AsyncGenerator<WalkMatch> {
        for (const source of sourcesFor(sourceName)) {
            onStatus?.(
                sourceName !== undefined
                    ? `Resolving '${ref}' from source '${source.name}'...`
                    : `Trying source '${source.name}'...`,
            );
            const candidate = await source.find(ref, onWarn);
            if (candidate !== undefined) {
                yield { source, candidate, matchedByName: false };
            }
        }
    }

    // Lazily yield the two-phase inferred matches for a one-argument install:
    // phase 1 (`findName`, only when `target` is a legal agent name - which also
    // avoids forcing a feed cache refresh just to reject a path) first, then
    // phase 2 (`find`). A name match always precedes a ref match, so the first
    // value yielded is the winner; a consumer that stops there gets
    // first-match-wins, one that drains gets the full shadow set.
    async function* inferMatches(
        target: string,
        sourceName: string | undefined,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): AsyncGenerator<WalkMatch> {
        const sources = sourcesFor(sourceName);
        // Phase 1: default agent name.
        if (isLegalAgentName(target)) {
            for (const source of sources) {
                if (source.findName === undefined) {
                    continue;
                }
                onStatus?.(`Trying source '${source.name}'...`);
                const candidate = await source.findName(target, onWarn);
                if (candidate !== undefined) {
                    yield { source, candidate, matchedByName: true };
                }
            }
        }
        // Phase 2: ref (package name / path).
        for (const source of sources) {
            onStatus?.(`Trying source '${source.name}'...`);
            const candidate = await source.find(target, onWarn);
            if (candidate !== undefined) {
                yield { source, candidate, matchedByName: false };
            }
        }
    }

    // Take the first match a walk yields (first-match-wins), leaving the walk
    // suspended so no later source is probed. Returns undefined for no match.
    async function firstMatch(
        matches: AsyncGenerator<WalkMatch>,
    ): Promise<WalkMatch | undefined> {
        for await (const match of matches) {
            return match;
        }
        return undefined;
    }

    // Drain every match a walk yields, in priority order (for the dry-run
    // shadow set).
    async function allMatches(
        matches: AsyncGenerator<WalkMatch>,
    ): Promise<WalkMatch[]> {
        const out: WalkMatch[] = [];
        for await (const match of matches) {
            out.push(match);
        }
        return out;
    }

    // "<kind> source '<name>'" for user-facing messages (e.g. "catalog source
    // 'workspace'"); falls back to just the name if the source is unknown.
    function describeSource(name: string): string {
        const kind = entries.get(name)?.config.kind;
        return kind !== undefined
            ? `${kind} source '${name}'`
            : `source '${name}'`;
    }

    // Derive the installed dispatcher name for a one-argument install from the
    // winning candidate: the candidate's own declared default name, backfilled
    // from the resolved path's package.json for a phase-2 path match. A missing
    // or illegal default name is a hard error whose message points at the
    // two-argument form.
    function requireInferredName(
        candidate: ResolvedCandidate,
        target: string,
    ): string {
        let defaultAgentName = candidate.defaultAgentName;
        if (defaultAgentName === undefined && candidate.path !== undefined) {
            defaultAgentName = readPackageMeta(candidate.path).defaultAgentName;
        }
        if (defaultAgentName !== undefined) {
            return defaultAgentName;
        }
        // A user-facing package name means the target matched as a PACKAGE
        // (catalog or feed) - even a catalog entry that resolves to a local
        // `path` carries one, whereas a bare path-source match does not. Prefer
        // the package wording so the message reflects how the target actually
        // matched (the `path` branch is only for a genuine path-source match).
        if (candidate.packageName !== undefined) {
            const pkg = candidate.packageName;
            throw new Error(
                `Package '${pkg}' from ${describeSource(candidate.source)} has no default agent name. Use '@package install ${pkg} <name>'.`,
            );
        }
        if (candidate.path !== undefined) {
            throw new Error(
                `Path '${target}' from ${describeSource(candidate.source)} has no default agent name. Use '@package install ${target} <name>'.`,
            );
        }
        throw new Error(
            `'${target}' from ${describeSource(candidate.source)} has no default agent name. Use '@package install ${target} <name>'.`,
        );
    }

    async function resolveUnlocked(
        nameOrTarget: string,
        ref: string | undefined,
        sourceName?: string,
        onWarn?: SourceWarning,
        onStatus?: SourceStatus,
    ): Promise<ResolveResult> {
        // EXPLICIT (ref supplied) and INFER (ref omitted) modes differ only in
        // which walk runs and how the installed name is chosen; the not-found
        // error, materialize, and result shaping below are shared.
        const target = ref ?? nameOrTarget;
        const match =
            ref !== undefined
                ? await firstMatch(
                      refMatches(ref, sourceName, onWarn, onStatus),
                  )
                : await firstMatch(
                      inferMatches(nameOrTarget, sourceName, onWarn, onStatus),
                  );
        if (match === undefined) {
            throw sourceName !== undefined
                ? new Error(
                      `'${target}' not found in ${describeSource(sourceName)}`,
                  )
                : new Error(
                      `No source could resolve '${target}'. Order: [${resolutionSources()
                          .map((s) => s.name)
                          .join(", ")}]`,
                  );
        }
        // EXPLICIT stamps the user-supplied name; INFER derives it from the
        // resolved package (the two-argument override vs. one-argument inference).
        const name =
            ref !== undefined
                ? nameOrTarget
                : requireInferredName(match.candidate, nameOrTarget);
        const record = await match.source.materialize(match.candidate);
        const result: ResolveResult = {
            record: { ...record, name },
            matchedByName: match.matchedByName,
        };
        if (match.candidate.packageName !== undefined) {
            result.packageName = match.candidate.packageName;
        }
        return result;
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
            nameOrTarget: string,
            ref?: string,
            sourceName?: string,
            onWarn?: SourceWarning,
            onStatus?: SourceStatus,
        ): Promise<ResolveResult> {
            // The whole install op (resolve -> materialize) runs under the
            // shared limiter. The installer reuses the
            // same limiter for the record write.
            return limiter(() =>
                resolveUnlocked(
                    nameOrTarget,
                    ref,
                    sourceName,
                    onWarn,
                    onStatus,
                ),
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
        async preview(
            nameOrTarget: string,
            ref?: string,
            sourceName?: string,
            onWarn?: SourceWarning,
            onStatus?: SourceStatus,
        ): Promise<PreviewResult | undefined> {
            // Dry-run: reuse the exact walks resolve uses, but DRAIN them
            // (nothing is installed) to collect the full shadow set in priority
            // order.
            const raw =
                ref !== undefined
                    ? await allMatches(
                          refMatches(ref, sourceName, onWarn, onStatus),
                      )
                    : await allMatches(
                          inferMatches(
                              nameOrTarget,
                              sourceName,
                              onWarn,
                              onStatus,
                          ),
                      );
            if (raw.length === 0) {
                return undefined;
            }
            // Only the winner (index 0) needs a resolved installed name - it is
            // the one that would actually install, and the only match whose
            // `name` the caller displays. Requiring a name for a shadow would
            // wrongly abort the whole preview when an incidental shadow matched
            // by package name has no default agent name (a legal, common case).
            // Shadows carry a best-effort name that is never shown.
            const matches: PreviewMatch[] = raw.map((m, i) => ({
                source: m.source.name,
                matchedByName: m.matchedByName,
                // EXPLICIT stamps the user-supplied name; INFER derives the
                // winner's name from the resolved package (same rule as
                // resolve) and leaves shadows best-effort.
                name:
                    ref !== undefined
                        ? nameOrTarget
                        : i === 0
                          ? requireInferredName(m.candidate, nameOrTarget)
                          : (m.candidate.defaultAgentName ?? nameOrTarget),
                candidate: m.candidate,
            }));
            return { winner: matches[0], matches };
        },
        async refresh(
            sourceName?: string,
            onWarn?: SourceWarning,
        ): Promise<void> {
            // Refresh cache-backed sources. A fetch failure throws (leaving the
            // prior cache intact) so the caller's --refresh fails the command.
            // `sourcesFor(undefined)` is the full resolution order, so no
            // explicit-source special case is needed here.
            for (const source of sourcesFor(sourceName)) {
                if (source.refresh !== undefined) {
                    await source.refresh(onWarn);
                }
            }
        },
    };
}

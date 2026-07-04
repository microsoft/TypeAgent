// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgentProvider,
    AppAgentSource,
    AppAgentConnection,
    AppAgentHost,
    InstalledAgentInfo,
    IndexingServiceRegistry,
    DefaultIndexingServiceRegistry,
    DispatcherOptions,
} from "agent-dispatcher";
import {
    InstallSourceConfig,
    InstalledAgentRecord,
    SourceStatus,
} from "./installSources/config.js";
import {
    createPackageAppAgentProvider,
    InstalledAgentSourceApi,
} from "./installSources/packageAgent.js";

import path from "node:path";
import {
    getInstanceConfigProvider,
    getInstallDir,
    getProviderConfig,
    getResolvedInstallSources,
    InstallSourcesResolveOptions,
    InstanceConfig,
    InstanceConfigProvider,
} from "./utils/config.js";
import { getDefaultMcpAppAgentProvider } from "./mcpDefaultAgentProvider.js";
import {
    createBundledAppAgentProvider,
    createInstalledAppAgentProvider,
    createInstalledAppAgentProviders,
    getBundledAgentNames,
    loadInstalledRecords,
    readAgentsJson,
    writeAgentsJson,
} from "./installSources/installedAgents.js";
import { createInstallSourceRegistry } from "./installSources/registry.js";
import { getSourceCommands } from "./installSources/sourceCommands.js";
import { createLimiter } from "@typeagent/common-utils";
import registerDebug from "debug";

const debug = registerDebug("typeagent:defaultAgentProvider:source");

/**
 * Get the default STATIC app agent providers.
 *
 * Returns the static bundled-agent provider (the app's shipped agents, always
 * present) plus the MCP provider when configured. The installed agents
 * (`agents.json`) are NO LONGER returned here — they are vended by the connected
 * {@link getDefaultAppAgentSource} as per-agent providers (design §3.3), so a
 * host injects them via `appAgentSources`, not `appAgentProviders`. The bundled
 * agents are their own static provider and are never installed/uninstalled.
 *
 * @param instanceDirOrConfigProvider - Either the instance directory string or
 *   an InstanceConfigProvider. Undefined builds only the bundled provider.
 * @param configName - Optional config name (e.g. "test" -> config.test.json).
 */
export function getDefaultAppAgentProviders(
    instanceDirOrConfigProvider: string | InstanceConfigProvider | undefined,
    configName?: string,
): AppAgentProvider[] {
    // The bundled agents are always present as their own static provider.
    const providers: AppAgentProvider[] = [
        createBundledAppAgentProvider(configName),
    ];
    const instanceConfigs =
        typeof instanceDirOrConfigProvider === "string"
            ? getInstanceConfigProvider(instanceDirOrConfigProvider)
            : instanceDirOrConfigProvider;
    const mcpProvider = getDefaultMcpAppAgentProvider(instanceConfigs);
    if (mcpProvider !== undefined) {
        providers.push(mcpProvider);
    }
    return providers;
}

/**
 * Build the installed-agent provider(s) from `agents.json`. Used only for static
 * enumeration (e.g. the indexing-service registry) where the live connection
 * lifecycle is not involved. The dispatcher runtime instead gets installed
 * agents from {@link getDefaultAppAgentSource}. Returns a per-root-group list
 * (possibly spanning installDir + app bundle) so no combined routing facade is
 * needed; empty when no instance dir is available.
 */
function getInstalledAppAgentProviders(
    instanceConfigs: InstanceConfigProvider | undefined,
): AppAgentProvider[] {
    const instanceDir = instanceConfigs?.getInstanceDir();
    if (instanceDir === undefined) {
        return [];
    }
    const installDir = getInstallDir(instanceConfigs);
    if (installDir === undefined) {
        return [];
    }
    const records = loadInstalledRecords(instanceDir);
    return createInstalledAppAgentProviders(records, installDir);
}

/**
 * Return dispatcher-level options derived from the provider config.json.
 * Spread the result into DispatcherOptions alongside appAgentProviders so
 * config.json fields like `promptAppend` reach the Claude reasoning prompt.
 */
export function getDefaultDispatcherOptions(
    configName?: string,
): Pick<DispatcherOptions, "promptAppend"> {
    const cfg = getProviderConfig(configName);
    const options: Pick<DispatcherOptions, "promptAppend"> = {};
    if (cfg.promptAppend) {
        options.promptAppend = cfg.promptAppend;
    }
    return options;
}

/**
 * Options for {@link getDefaultAppAgentSource}. Remote hosts (e.g. the web API
 * server) set `excludePathSources` to skip `path` sources during resolution,
 * whose refs would otherwise resolve against the server's own filesystem.
 */
export type DefaultAppAgentSourceOptions = InstallSourcesResolveOptions;

/**
 * Build the registry-backed {@link AppAgentSource} for the default host (design
 * §3.2, §3.3). It owns the `agents.json` record store + the source registry and:
 *
 * - vends **one single-agent provider per installed record** (shared instances,
 *   refcounted) at `connect()`, plus the host-owned `@package` app agent
 *   (design §3.4) bound to that session's {@link AppAgentHost};
 * - implements install/uninstall/update by mutating the record store and, in
 *   Phase 1 (this milestone), registering/tearing down on the **issuing session
 *   only** — the handler reaches its own `AppAgentHost` off the package agent's
 *   `agentContext`. Cross-session fan-out over the client registry is added in
 *   Milestone 3.
 */
/**
 * Build the registry-backed {@link AppAgentSource} for the default host (design
 * §3.2, §3.3). Thin wrapper over {@link createDefaultInstalledAgentSource} that
 * **strips the test-only `testApi`** via destructuring, returning a runtime
 * object with only `connect()` — so a host can never reach the write surface,
 * not even by casting.
 */
export function getDefaultAppAgentSource(
    instanceDir: string,
    options?: DefaultAppAgentSourceOptions,
): AppAgentSource {
    // Object rest drops `testApi` from the runtime object (not just the type),
    // so the write surface is unreachable through the host-facing handle.
    const { testApi, ...source } = createDefaultInstalledAgentSource(
        instanceDir,
        options,
    );
    void testApi;
    return source;
}

/**
 * Per-name lifecycle entry for a dynamic (installed) agent (design §7.2). A name
 * is either `active` (installed and vended) or `removing` (draining across the
 * connected sessions before the name is freed / reused). No two versions of a
 * name ever coexist: install/uninstall/update transition through these states,
 * and a name that is `removing` is off-limits until every session has acked the
 * teardown.
 */
type DynamicAgentEntry =
    | { status: "active"; provider: AppAgentProvider }
    | {
          status: "removing";
          // The provider being torn down (kept for the load tombstone, §7.3).
          provider: AppAgentProvider;
          // Hosts that have not yet acked the removal. Empty ⇒ drained.
          pending: Set<AppAgentHost>;
          // Queued follow-up run once drained (an update's post-drain add, §7.2).
          then?: () => Promise<void>;
      };

/**
 * The concrete installed-agent source (design §3.2). Besides the dispatcher-
 * facing `connect()`, it also carries the write/command surface (`testApi`).
 * The `@package` agent reaches that surface through the per-session closure set
 * up in `connect()`, so the dispatcher is handed only the narrow
 * `AppAgentSource` view (see {@link getDefaultAppAgentSource}); `testApi` is a
 * direct handle for unit tests to drive install/uninstall/update without the
 * command layer.
 */
export function createDefaultInstalledAgentSource(
    instanceDir: string,
    options?: DefaultAppAgentSourceOptions,
): AppAgentSource & { readonly testApi: InstalledAgentSourceApi } {
    const instanceConfigs = getInstanceConfigProvider(instanceDir);
    const installDir = getInstallDir(instanceConfigs);
    // The installer always has a concrete instanceDir, so installDir is
    // resolved; this invariant guards the registry/provider below (which
    // require a real install root) and turns any future regression into a
    // loud failure rather than a silent CWD-relative write.
    if (installDir === undefined) {
        throw new Error(
            "Internal error: install directory could not be resolved (no instance directory).",
        );
    }
    const sources = getResolvedInstallSources(instanceConfigs);
    // One shared limiter serializes the whole install op (resolve + materialize +
    // record write) and uninstall (design §12 Q5).
    const limiter = createLimiter(1);

    function persistSources(configs: InstallSourceConfig[]): void {
        const current = instanceConfigs.getInstanceConfig();
        // Reconstruct installSources from the known fields only, dropping any
        // legacy fields (e.g. a stored `order` array or `installDir` override,
        // both no longer used; the source list order is the resolution order
        // and installDir is always derived at runtime).
        const next: InstanceConfig = {
            ...current,
            installSources: {
                sources: configs,
            },
        };
        instanceConfigs.setInstanceConfig(next);
    }

    const registry = createInstallSourceRegistry(sources, {
        installDir,
        limiter,
        persist: persistSources,
        ...(options?.excludePathSources !== undefined
            ? { excludePathSources: options.excludePathSources }
            : {}),
    });

    // Builtins are the app's shipped bundled agents (their own static
    // provider), so they can never be installed-over, uninstalled, or updated.
    function isBuiltin(name: string): boolean {
        return getBundledAgentNames().has(name);
    }

    // Per-name lifecycle tracker (design §7.2): the source of truth for the
    // dynamic agent set. A name is `active` (vended) or `removing` (draining).
    const entries = new Map<string, DynamicAgentEntry>();

    // Wrap a provider with a load tombstone (design §7.3): while its name is
    // `removing`, refuse to load it even if a draining session still holds the
    // instance, so nothing resurrects a name mid-teardown.
    function withTombstone(
        name: string,
        provider: AppAgentProvider,
    ): AppAgentProvider {
        return {
            ...provider,
            loadAppAgent: async (agentName: string) => {
                if (entries.get(name)?.status === "removing") {
                    throw new Error(
                        `Agent '${name}' is being removed; cannot load.`,
                    );
                }
                return provider.loadAppAgent(agentName);
            },
        };
    }

    // Build the shared, tombstoned provider for a record (design §5, §7.3).
    // Installed agents honor their manifest default just like bundled agents
    // (design §5, Model B): the register-time state derivation uses
    // `config[name] ?? manifestDefault`, and a user's explicit per-session
    // `@config agent` override still wins.
    function buildAgentProvider(
        name: string,
        record: InstalledAgentRecord,
    ): AppAgentProvider {
        // installDir is guaranteed resolved above (the source throws otherwise);
        // the `!` bridges TS's lack of narrowing across this nested closure.
        return withTombstone(
            name,
            createInstalledAppAgentProvider(name, record, installDir!),
        );
    }

    // Seed active entries from agents.json (design §3.3). One single-agent,
    // single-root provider per record; shared (the same instance) across every
    // connected session.
    for (const [name, record] of Object.entries(
        loadInstalledRecords(instanceDir),
    )) {
        entries.set(name, {
            status: "active",
            provider: buildAgentProvider(name, record),
        });
    }

    // The providers to vend to a connecting session: the `active` set only —
    // never a draining name (design §7.3 connect-during-removing).
    function activeProviders(): AppAgentProvider[] {
        const providers: AppAgentProvider[] = [];
        for (const entry of entries.values()) {
            if (entry.status === "active") {
                providers.push(entry.provider);
            }
        }
        return providers;
    }

    // The client registry of connected AppAgentHosts (design §3.3), used for
    // cross-session fan-out (design §4). connect() adds; dispose() removes.
    const clients = new Set<AppAgentHost>();

    // Per-name in-flight guard (design §7.3 point 6: per-name serialization lives
    // in the entry, not only in the global write limiter). A name is `busy` for
    // the synchronous span of an install/uninstall/update op (resolve +
    // materialize + record write); `removing` covers the subsequent async drain.
    // Together they serialize concurrent ops on one name — e.g. an `update`
    // materializing cannot be overtaken by a concurrent `uninstall` starting a
    // drain of the same name.
    const busy = new Set<string>();

    // Reject a mutating op on a name that is still draining (design §7.3
    // name-reuse-during-removing): the name is off-limits until fully torn down.
    function assertNotRemoving(name: string): void {
        if (entries.get(name)?.status === "removing") {
            throw new Error(
                `Agent '${name}' is still being removed; retry shortly.`,
            );
        }
    }

    // Reject if the name is draining OR another op on it is in flight (design
    // §7.3 per-name serialization).
    function assertNameFree(name: string): void {
        assertNotRemoving(name);
        if (busy.has(name)) {
            throw new Error(
                `Agent '${name}' has an operation in progress; retry shortly.`,
            );
        }
    }

    // Drop a host from a draining name's `pending` set (an ack, a per-client
    // failure, or a disconnect). When the last host drains, free the name and
    // run any queued follow-up (an update's post-drain add, §7.2).
    function drainDrop(name: string, host: AppAgentHost): void {
        const entry = entries.get(name);
        if (entry?.status !== "removing") {
            return;
        }
        entry.pending.delete(host);
        if (entry.pending.size === 0) {
            const then = entry.then;
            // Free the name first so `then` (or a new op) sees `absent`.
            entries.delete(name);
            if (then !== undefined) {
                then().catch((e) => {
                    debug(`post-drain follow-up for '${name}' failed: ${e}`);
                });
            }
        }
    }

    // Begin draining a name across every connected session (design §7.2): the
    // issuing host is awaited (errors surface); siblings are best-effort +
    // notified. Every host's ack — success, failure, or disconnect — drops it
    // from `pending` so a failed/gone session never wedges name reuse.
    //
    // `dropConfig` (design §5, Model B): forwarded to every session's
    // `removeProvider`. An uninstall passes `true` so each session clears the
    // agent's persisted enable preference; an update passes `false` so the
    // remove leg of its remove-then-add swap preserves that preference across
    // the version bump.
    async function startDrain(
        name: string,
        provider: AppAgentProvider,
        issuingHost: AppAgentHost,
        dropConfig: boolean,
        then?: () => Promise<void>,
    ): Promise<void> {
        const pending = new Set<AppAgentHost>(clients);
        // The issuing host is always part of the drain even if it never
        // formally connected (defensive).
        pending.add(issuingHost);
        entries.set(name, {
            status: "removing",
            provider,
            pending,
            ...(then ? { then } : {}),
        });

        for (const host of clients) {
            if (host === issuingHost) {
                continue;
            }
            host.removeProvider(provider, true, dropConfig)
                .catch((e) => {
                    debug(`sibling removeProvider failed: ${e}`);
                })
                .finally(() => drainDrop(name, host));
        }
        try {
            // The issuing session dispatches this from within its own `@package`
            // command (holding the command lock), so it must apply INLINE
            // (immediate) — the idle-gated queue would deadlock on that lock
            // (design §7.1).
            await issuingHost.removeProvider(provider, false, dropConfig, true);
        } finally {
            drainDrop(name, issuingHost);
        }
    }

    // Fan out an add to every connected session (design §4, §5): the ISSUING
    // session is awaited (errors surface to the user) and reports inline; every
    // SIBLING is best-effort/async (applied at its next idle) and notified with
    // a system message. Each session derives the agent's enabled state from its
    // own config with the manifest default as fallback (Model B). A sibling
    // throw is caught and logged per client, never failing the committed op.
    async function fanOutAdd(
        provider: AppAgentProvider,
        issuingHost: AppAgentHost,
    ): Promise<void> {
        for (const host of clients) {
            if (host === issuingHost) {
                continue;
            }
            host.addProvider(provider, true).catch((e) => {
                debug(`sibling addProvider failed: ${e}`);
            });
        }
        // The issuing session dispatches this from within its own `@package`
        // command (holding the command lock), so it must apply INLINE
        // (immediate) — the idle-gated queue would deadlock on that lock
        // (design §7.1).
        await issuingHost.addProvider(provider, false, true);
    }

    const source: InstalledAgentSourceApi = {
        async install(
            name: string,
            ref: string,
            sourceName: string | undefined,
            issuingHost: AppAgentHost,
            onStatus?: SourceStatus,
        ): Promise<{ source: string; warnings?: string[] }> {
            if (isBuiltin(name)) {
                throw new Error(
                    `Agent '${name}' is built-in and cannot be shadowed by an install`,
                );
            }
            // Serialize on the name; reject if it is draining or busy (§7.3).
            assertNameFree(name);
            busy.add(name);
            try {
                // resolve + materialize is serialized by the registry's limiter
                // (design §4.1). After it returns, we re-take the same shared
                // limiter to write the record (sequential, not nested). Collect
                // any non-fatal source degrade warnings raised during resolve.
                const warningSet = new Set<string>();
                const resolved = await registry.resolve(
                    ref,
                    sourceName,
                    (m) => warningSet.add(m),
                    onStatus,
                );
                // The source assigns the authoritative dispatcher name. The
                // source's `materialize` already persists its own re-resolution
                // handle (feed: the spec; catalog: the key; path: the path), so
                // `@update` can reconstruct the candidate later (design §5, §12
                // Q13) - no host-side key backfill needed.
                const record: InstalledAgentRecord = { ...resolved, name };
                // Persist the record under the same serialization domain.
                await limiter(async () => {
                    const current = readAgentsJson(instanceDir) ?? {
                        agents: {},
                    };
                    if (current.agents[name] !== undefined) {
                        throw new Error(`Agent '${name}' already exists`);
                    }
                    current.agents[name] = record;
                    writeAgentsJson(instanceDir, current);
                });
                // Build the shared per-agent provider and mark the name active
                // so later connects vend it (design §7.2 absent → active).
                const provider = buildAgentProvider(name, record);
                entries.set(name, { status: "active", provider });
                // Fan out to every connected session (design §4): issuing
                // awaited + enabled; siblings best-effort + disabled + notified.
                await fanOutAdd(provider, issuingHost);
                return {
                    source: record.source,
                    ...(warningSet.size > 0
                        ? { warnings: [...warningSet] }
                        : {}),
                };
            } finally {
                busy.delete(name);
            }
        },
        async uninstall(
            name: string,
            issuingHost: AppAgentHost,
        ): Promise<void> {
            if (isBuiltin(name)) {
                throw new Error(
                    `Agent '${name}' is built-in and cannot be uninstalled`,
                );
            }
            // Serialize on the name; reject if it is draining or busy (§7.3).
            assertNameFree(name);
            busy.add(name);
            try {
                const entry = entries.get(name);
                await limiter(async () => {
                    const current = readAgentsJson(instanceDir) ?? {
                        agents: {},
                    };
                    if (current.agents[name] === undefined) {
                        throw new Error(`Agent '${name}' not found`);
                    }
                    delete current.agents[name];
                    writeAgentsJson(instanceDir, current);
                });
                // The record write is the commit point (design §7.4). Now drain
                // the live agent across every connected session (active →
                // removing → absent, design §7.2). The name stays off-limits
                // until fully drained (the `removing` state outlives this op).
                // Uninstall drops each session's persisted enable preference
                // (dropConfig=true) so a fresh reinstall starts from the
                // manifest default (design §5, Model B).
                if (entry?.status === "active") {
                    await startDrain(name, entry.provider, issuingHost, true);
                }
            } finally {
                busy.delete(name);
            }
        },
        async update(
            name: string,
            range: string | undefined,
            issuingHost: AppAgentHost,
        ): Promise<void> {
            if (isBuiltin(name)) {
                throw new Error(
                    `Agent '${name}' is built-in and cannot be updated`,
                );
            }
            // Serialize on the name; reject if it is draining or busy (§7.3).
            assertNameFree(name);
            busy.add(name);
            try {
                // Look up the recorded provenance and re-resolve against its
                // recorded source (design §5). The whole materialize runs
                // first; the old record is overwritten only after it succeeds,
                // so a failed update is a no-op (design §4.7, §12 Q13).
                const existing = readAgentsJson(instanceDir)?.agents[name];
                if (existing === undefined) {
                    throw new Error(`Agent '${name}' not found`);
                }
                // Re-resolve + materialize against the recorded source. The
                // source that produced the record owns the whole re-resolution
                // policy (which handle to read, how `range` applies, and
                // corrupt-record validation) via InstallSource.reresolve; the
                // registry runs it + materialize under the shared limiter and
                // preserves the re-resolution handle so a later update still
                // works (design §5, §12 Q13).
                const resolved = await registry.reresolve(existing, { range });
                const record: InstalledAgentRecord = { ...resolved, name };
                // Overwrite only after a successful materialize (§12 Q13). This
                // is the commit point (design §7.4); a failed materialize above
                // is a no-op that leaves the old record + agent intact.
                await limiter(async () => {
                    const current = readAgentsJson(instanceDir) ?? {
                        agents: {},
                    };
                    current.agents[name] = record;
                    writeAgentsJson(instanceDir, current);
                });
                // Disruptive update (design §7.2): drain the OLD version across
                // every session first, then (post-drain) add the NEW one — so no
                // two versions of the name ever coexist. No-coexistence is
                // REQUIRED because an agent's persisted storage is keyed by agent
                // name and cannot be shared, so two versions loaded at once would
                // collide on that storage. The freshly materialized provider is
                // added as the drain's `then`. If there is no active entry to
                // drain, add directly. The drain passes dropConfig=false so a
                // version bump preserves each session's per-session enable
                // preference (design §5, Model B).
                const oldEntry = entries.get(name);
                const newProvider = buildAgentProvider(name, record);
                const addNew = () => {
                    entries.set(name, {
                        status: "active",
                        provider: newProvider,
                    });
                    return fanOutAdd(newProvider, issuingHost);
                };
                if (oldEntry?.status === "active") {
                    await startDrain(
                        name,
                        oldEntry.provider,
                        issuingHost,
                        false,
                        addNew,
                    );
                } else {
                    await addNew();
                }
            } finally {
                busy.delete(name);
            }
        },
        sourceCommands() {
            // The host owns the entire `@source` surface (list/order/where/
            // remove/add): the kind taxonomy, typed flags, validation, and any
            // auth UI. The dispatcher core merges this table in as `@source`.
            return getSourceCommands({
                registry,
                recordsUsingSource: (sourceName: string) => {
                    const agents = readAgentsJson(instanceDir)?.agents ?? {};
                    return Object.values(agents)
                        .filter((record) => record.source === sourceName)
                        .map((record) => record.name);
                },
            });
        },
        listInstalled(): InstalledAgentInfo[] {
            // The source owns only mutable install records (`agents.json`).
            // Bundled agents are provided separately by the bundled provider and
            // are intentionally excluded from these install summaries. A record
            // carries exactly one resolution handle (ref / module / path). A
            // name that is currently `removing` (draining) is hidden — it is not
            // an installed agent anymore (design §7.3).
            const agents = readAgentsJson(instanceDir)?.agents ?? {};
            return Object.values(agents)
                .filter(
                    (record) => entries.get(record.name)?.status !== "removing",
                )
                .map((record) => {
                    const handle = record.ref ?? record.module ?? record.path;
                    return {
                        name: record.name,
                        source: record.source,
                        ...(handle !== undefined ? { handle } : {}),
                    };
                });
        },
        listSources(): string[] {
            // Source names in resolution order, for `@package install --source`
            // completion.
            return registry.list().map((info) => info.name);
        },
        async listAvailable(): Promise<string[]> {
            // Enumerable agent refs across the sources (catalog/feed advertise
            // theirs; path sources don't), de-duplicated, for `@package install`
            // ref completion.
            const lists = await Promise.all(
                registry
                    .list()
                    .map((info) => registry.get(info.name))
                    .map((entry) => entry?.listAgents?.() ?? []),
            );
            return [...new Set(lists.flat())];
        },
    };

    // The dispatcher-facing AppAgentSource surface (design §3.2): connect() is
    // the only view the dispatcher gets, so it can never drive an install. The
    // concrete object also carries `testApi` (the write/command surface) as a
    // direct handle for unit tests; the `@package` agent gets the same surface
    // through the per-session closure below, not via `testApi`.
    return {
        testApi: source,
        connect(host: AppAgentHost): AppAgentConnection {
            clients.add(host);
            // The package agent is per-connection (its agentContext carries this
            // session's AppAgentHost); the installed providers are shared. A
            // connecting session registers only from `active` entries — never a
            // draining name (design §7.3 connect-during-removing).
            const packageProvider = createPackageAppAgentProvider({
                appAgentHost: host,
                source,
            });
            const providers: AppAgentProvider[] = [
                packageProvider,
                ...activeProviders(),
            ];
            return {
                providers,
                dispose() {
                    // Deregister this host from the fan-out registry (design §6).
                    // Does NOT tear down the shared providers — other sessions
                    // still hold them; the dispatcher unregisters them from its
                    // own manager at teardown.
                    clients.delete(host);
                    // Disconnect while draining (design §7.3): a gone session has
                    // removed everything, so drop it from every draining name's
                    // pending set (which may complete a drain).
                    for (const name of [...entries.keys()]) {
                        drainDrop(name, host);
                    }
                },
            };
        },
    };
}

/**
 * Build indexing service registry from all available app agent providers
 * @param instanceDirOrConfigProvider - Either a string pointing to the instance directory where external agent config is stored, or a InstanceConfigProvider.
 * @param configName - Optional config name to load specific configuration file (e.g. "test" to load "config.test.json"). If not provided, it will load "config.json".
 * @returns IndexingServiceRegistry containing all registered indexing services
 */
export async function getIndexingServiceRegistry(
    instanceDirOrConfigProvider?: string | InstanceConfigProvider,
    configName?: string,
): Promise<IndexingServiceRegistry> {
    const providers = getDefaultAppAgentProviders(
        instanceDirOrConfigProvider,
        configName,
    );
    // Installed agents are vended by the AppAgentSource at runtime, but their
    // indexing services must still be discovered here, so enumerate them from
    // the static installed provider list too (design §3.3).
    const instanceConfigs =
        typeof instanceDirOrConfigProvider === "string"
            ? getInstanceConfigProvider(instanceDirOrConfigProvider)
            : instanceDirOrConfigProvider;
    providers.push(...getInstalledAppAgentProviders(instanceConfigs));
    const registry = new DefaultIndexingServiceRegistry();

    for (const provider of providers) {
        const agentNames = provider.getAppAgentNames();

        for (const agentName of agentNames) {
            try {
                const manifest = await provider.getAppAgentManifest(agentName);

                if (manifest.indexingServices) {
                    for (const [indexSource, serviceConfig] of Object.entries(
                        manifest.indexingServices,
                    )) {
                        // Resolve the absolute path to the service script
                        let resolvedServicePath: string;
                        try {
                            // Resolve via the bundled config.json `agents` map,
                            // which covers the builtins that declare indexing
                            // services (e.g. browser). Non-builtin installs
                            // (feed / path) are absent here and intentionally
                            // skip indexing-service registration (warn-only
                            // below), not a hard failure.
                            //
                            // TODO: two gaps for installed (feed/path) agents:
                            //  1. their indexing-service scripts can't be
                            //     resolved through the builtin `agents` map
                            //     (they aren't in it), so they are warn-skipped
                            //     here - resolve service paths from the
                            //     installed record's module root instead.
                            //  2. this registry is a STATIC snapshot built at
                            //     startup; it does NOT react to runtime
                            //     @package install/uninstall/update (which the
                            //     AppAgentSource fans out live). So installing an
                            //     agent that declares an indexing service won't
                            //     register it until restart, and an uninstall
                            //     won't unregister it - hook the registry into
                            //     the source lifecycle.
                            const agentConfigs = getProviderConfig().agents;
                            const agentConfig = agentConfigs[agentName];

                            if (agentConfig) {
                                const { createRequire } = await import(
                                    "module"
                                );
                                const requirePath = agentConfig.path
                                    ? `${path.resolve(agentConfig.path)}${path.sep}package.json`
                                    : import.meta.url;
                                const require = createRequire(requirePath);

                                // Try to resolve the service script directly using the package exports
                                // For browser agent, this will resolve "./agent/indexing" export
                                try {
                                    resolvedServicePath = require.resolve(
                                        `${agentConfig.name}/agent/indexing`,
                                    );
                                } catch (exportError) {
                                    // Fallback: resolve relative to the agent's main module
                                    const agentMainPath = require.resolve(
                                        agentConfig.name,
                                    );
                                    const agentPackageDir =
                                        path.dirname(agentMainPath);
                                    resolvedServicePath = path.resolve(
                                        agentPackageDir,
                                        serviceConfig.serviceScript,
                                    );
                                }
                            } else {
                                throw new Error(
                                    `Agent config not found for ${agentName}`,
                                );
                            }
                        } catch (pathError) {
                            console.warn(
                                `Failed to resolve service path for ${agentName}/${indexSource}: ${pathError}`,
                            );
                            continue;
                        }

                        const serviceInfo = {
                            agentName,
                            serviceScript: resolvedServicePath, // Now an absolute path
                            ...(serviceConfig.description && {
                                description: serviceConfig.description,
                            }),
                        };

                        registry.register(indexSource, serviceInfo);
                    }
                }
            } catch (error) {
                // Agent manifest loading failed, skip this agent
                continue;
            }
        }
    }

    return registry;
}

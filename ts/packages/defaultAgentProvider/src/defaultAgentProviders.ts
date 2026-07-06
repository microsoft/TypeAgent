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
    UpdateOutcomeStatus,
    UninstallOutcomeStatus,
    AGENT_INSTALL_ROOTS_SUBDIR,
} from "./installSources/config.js";
import {
    createPackageAppAgentProvider,
    InstalledAgentSourceApi,
} from "./installSources/packageAgent.js";

import fs from "node:fs";
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

// The directory under `installDir` that holds every per-agent, version-scoped
// install root (design §5.5). GC (prune-on-swap + startup orphan sweep) operates
// only within this directory, never the legacy shared `installDir/node_modules`,
// the marker `package.json`, or feed caches.
function agentRootsDir(installDir: string): string {
    return path.join(installDir, AGENT_INSTALL_ROOTS_SUBDIR);
}

// Remove a single per-agent install root after its version is confirmed gone
// (design §5.5 GC — prune on swap / after uninstall drain). Best-effort: a
// prune failure is logged, never fatal (the startup orphan sweep is the
// backstop). A record without an `installRoot` (path/catalog/legacy) has no
// dedicated root to prune.
function pruneAgentRoot(
    installDir: string,
    installRoot: string | undefined,
): void {
    // Guard against any falsy root (undefined, or a corrupt empty string): an
    // empty `installRoot` would join to the whole `agents/` dir and a recursive
    // rm would wipe every agent's root. A record without a dedicated root
    // (path/catalog/legacy) simply has nothing to prune.
    if (!installRoot) {
        return;
    }
    // Defense-in-depth: the root must be a single path segment. A corrupt or
    // hand-edited `agents.json` carrying a traversal (`..` or a path separator)
    // must never let the recursive rm escape the `agents/` roots dir.
    if (path.basename(installRoot) !== installRoot) {
        debug(`refusing to prune non-segment install root '${installRoot}'`);
        return;
    }
    const dir = path.join(agentRootsDir(installDir), installRoot);
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
        debug(`prune of install root '${dir}' failed: ${e}`);
    }
}

// Startup orphan sweep (design §5.5 GC): remove any per-agent install root under
// `installDir/agents/` that is NOT the recorded-current root of some installed
// agent — e.g. a `v2` dir from a crashed update, or a `v1` dir that should have
// been pruned on a swap that never completed. Best-effort: a missing agents dir
// or a failed removal is non-fatal.
function sweepOrphanAgentRoots(
    installDir: string,
    keep: ReadonlySet<string>,
): void {
    const dir = agentRootsDir(installDir);
    let dirents: fs.Dirent[];
    try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return; // no agents dir yet (nothing installed via a version-scoped root)
    }
    for (const dirent of dirents) {
        if (!dirent.isDirectory() || keep.has(dirent.name)) {
            continue;
        }
        try {
            fs.rmSync(path.join(dir, dirent.name), {
                recursive: true,
                force: true,
            });
        } catch (e) {
            debug(`orphan sweep of install root '${dirent.name}' failed: ${e}`);
        }
    }
}

// Is `installRoot` still the recorded root of some agent OTHER than
// `excludeName` (design §5.5 refcount GC)? Content-addressed roots
// (`module@version`) are SHARED: two agents that resolve to the same
// package+version point at ONE root, so a root may be reclaimed only once no
// remaining record references it. Prune-on-swap and prune-after-uninstall
// consult this so tearing one agent down never deletes a sibling's live files.
function isRootReferenced(
    instanceDir: string,
    installRoot: string | undefined,
    excludeName: string,
): boolean {
    if (!installRoot) {
        return false;
    }
    const agents = readAgentsJson(instanceDir)?.agents ?? {};
    for (const [name, record] of Object.entries(agents)) {
        if (name !== excludeName && record.installRoot === installRoot) {
            return true;
        }
    }
    return false;
}

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
 * Tunables for the coordinated update/uninstall barrier (design §5.3). All
 * optional; conservative defaults apply when omitted. Injected by tests to drive
 * the timeout/rollback paths deterministically.
 */
export type UpdateCoordinationOptions = {
    // Phase-1 (quiesce) timeout in ms: abandon a straggler that won't idle — or a
    // `v1` whose refcount never reaches 0 (verify-0 never passes) — and roll back
    // (design §5.3). The ultimate backstop for a wedged teardown.
    quiesceTimeoutMs?: number | undefined;
    // Overridable verify-0 probe (design §5.6): reports whether the shared OLD
    // version is still loaded so the barrier can confirm it is fully released
    // before starting `v2` / freeing the name. Default reads the provider's
    // `isLoaded`. Injected by tests to force the "straggler still holds a ref"
    // park that the quiesce timeout then rolls back.
    isLoaded?:
        | ((provider: AppAgentProvider, name: string) => boolean | undefined)
        | undefined;
};

/**
 * Options for {@link getDefaultAppAgentSource}. Remote hosts (e.g. the web API
 * server) set `excludePathSources` to skip `path` sources during resolution,
 * whose refs would otherwise resolve against the server's own filesystem.
 */
export type DefaultAppAgentSourceOptions = InstallSourcesResolveOptions & {
    // Tunables for the coordinated update/uninstall barrier (design §5.3).
    updateCoordination?: UpdateCoordinationOptions | undefined;
};

// Conservative default for the update-coordination barrier (design §5.3): a
// short quiesce window (abandon a straggler fast). A wall-clock backstop, not a
// hot path.
const DEFAULT_QUIESCE_TIMEOUT_MS = 15_000;

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
 * is either `active` (installed and vended) or `removing` (a coordinated
 * teardown/swap is in flight across the connected sessions before the name is
 * freed / reused). No two versions of a name ever coexist: install/uninstall/
 * update transition through these states, and a name that is `removing` is
 * off-limits until the barrier completes.
 */
type DynamicAgentEntry =
    | { status: "active"; provider: AppAgentProvider }
    | {
          status: "removing";
          // The provider being torn down (kept for the load tombstone, §7.3).
          provider: AppAgentProvider;
          // The in-flight teardown/swap barrier (design §5.6, §5.7).
          barrier: ReplaceBarrier;
      };

/**
 * A source-coordinated teardown/swap barrier (design §5.6, §5.7) hardened with
 * the §5.3 timeout/cancel/rollback envelope. Every target host runs
 * `replaceProvider`, tears down the shared old (`v1`) version, and fills its slot
 * via `quiesce`. Once every slot is filled AND verify-0 confirms the shared `v1`
 * refcount is 0, the source COMMITS — releasing the hosts to add `v2` (update) /
 * settle (uninstall). Any stall — a straggler that won't idle or a `v1` that
 * won't terminate — or an out-of-band abort resolves to ROLLBACK instead: `v1` is
 * restored in every
 * session and `v2` is discarded, as if the op never happened (design §5.3). The
 * outcome is decided BEFORE the hosts are released, so a host only ever adds one
 * version (`v2` on commit, `v1` on rollback) — never a second swap round.
 */
type ReplaceOutcome = "committed" | "rolledback";

// Barrier lifecycle: collect quiesces → (verify-0 passes) → release hosts with
// the decided outcome → GC the superseded root once every host has swapped.
type ReplacePhase = "quiescing" | "releasing" | "done";

type ReplaceBarrier = {
    readonly name: string;
    // The shared old (`v1`) provider: verify-0 checks its refcount, and it is
    // re-added to every session on rollback (design §5.3, §5.6).
    readonly oldProvider: AppAgentProvider;
    // The new (`v2`) provider added on a committed update; undefined for an
    // uninstall (nothing to start; `old → ∅`).
    readonly newProvider: AppAgentProvider | undefined;
    // Phase 1: hosts that have not yet quiesced (torn `v1` down). Empty ⇒ every
    // host removed `v1`.
    readonly pending: Set<AppAgentHost>;
    // Phase 3: released hosts whose add leg has not yet settled. Once empty
    // (after release) ⇒ every host finished its swap → run the GC finalizer, so
    // `v1` is never pruned before `v2` is confirmed serving (design §5.3).
    readonly settling: Set<AppAgentHost>;
    // Resolves (exactly once, when the outcome is decided) with the version a
    // session that connected mid-`removing` should install: `v2` on a committed
    // update, `v1` on a rollback, or nothing (`undefined`) on a committed
    // uninstall. Such a late joiner is NOT a participant (it never held `v1`, so
    // it neither quiesces nor counts toward verify-0/GC); the dispatcher instead
    // blocks its connect on this promise (under the held command lock) and
    // installs the result inline. Deferring the load past the decision means it
    // can neither pollute verify-0 nor run a command with the agent absent
    // (design §7.3 connect-during-removing).
    readonly whenDecided: Promise<AppAgentProvider | undefined>;
    // Resolves `whenDecided` (called once in `decide`).
    readonly resolveDecided: (provider: AppAgentProvider | undefined) => void;
    // Resolves every parked host's `whenReady` so it runs its (decided) add leg.
    readonly release: () => void;
    // Run once when the outcome is decided (at release, before hosts add): flip
    // the entry to active(`v2`)/absent on commit, or restore active(`v1`) + the
    // record on rollback.
    readonly onDecided: (outcome: ReplaceOutcome) => void;
    // Run once when the last host settles (`v2` confirmed serving everywhere):
    // prune the superseded install root (commit: `v1`; rollback: `v2`) per the
    // Milestone 1 GC rules.
    readonly finalizeGc: (outcome: ReplaceOutcome) => void;
    // Report the terminal outcome to the issuing conversation (design §5.4).
    readonly onOutcome: ((status: UpdateOutcomeStatus) => void) | undefined;
    phase: ReplacePhase;
    // undefined until decided; set exactly once (commit XOR rollback).
    outcome: ReplaceOutcome | undefined;
    // Why a rollback was chosen (design §5.4): an out-of-band abort
    // (`cancelled`) vs the quiesce timeout (`failed`). Undefined on commit.
    rollbackKind: "cancelled" | "failed" | undefined;
    // Phase-1 backstop timer (straggler / `v1` won't die → rollback, §5.3).
    quiesceTimer: ReturnType<typeof setTimeout> | undefined;
    // Detaches the out-of-band abort listener (design §5.3 cancel).
    detachAbort: (() => void) | undefined;
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

    // Resolved update-coordination tunables (design §5.3). Conservative defaults;
    // tests inject a tiny quiesce timeout to drive the rollback paths
    // deterministically.
    const coord = options?.updateCoordination;
    const quiesceTimeoutMs =
        coord?.quiesceTimeoutMs ?? DEFAULT_QUIESCE_TIMEOUT_MS;
    const isLoadedProbe =
        coord?.isLoaded ??
        ((p: AppAgentProvider, n: string) => p.isLoaded?.(n));

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

    // Build the shared provider for a freshly-resolved install/update record AND
    // structurally validate its materialized manifest before we commit (design
    // §5.3). Source-agnostic: a missing/corrupt manifest is equally fatal whether
    // the agent came from a feed, a catalog `module`, or a local `path`, so
    // failing HERE means an install records nothing and an update leaves `v1`
    // untouched — instead of committing a broken agent that then fails per
    // session (with `v1` already pruned). Cheap and non-forking: the real agent
    // process only launches when a host loads it, so a manifest that reads but
    // throws on `instantiate()` still surfaces as an ordinary per-session load
    // error (TypeAgent never forks a probe, by design). NOT used for startup
    // seeding — an already-committed record must load lazily and must never fail
    // the whole source construction on a since-corrupted on-disk manifest.
    async function buildValidatedAgentProvider(
        name: string,
        record: InstalledAgentRecord,
    ): Promise<AppAgentProvider> {
        const provider = buildAgentProvider(name, record);
        await provider.getAppAgentManifest(name);
        return provider;
    }

    // Seed active entries from agents.json (design §3.3). One single-agent,
    // single-root provider per record; shared (the same instance) across every
    // connected session.
    const installedRecords = loadInstalledRecords(instanceDir);
    for (const [name, record] of Object.entries(installedRecords)) {
        entries.set(name, {
            status: "active",
            provider: buildAgentProvider(name, record),
        });
    }

    // Startup orphan sweep (design §5.5 GC): keep only each installed agent's
    // recorded-current version-scoped root; remove any stray root left by a
    // crashed update (a `v2` dir) or an un-pruned swap (a `v1` dir).
    sweepOrphanAgentRoots(
        installDir,
        new Set(
            Object.values(installedRecords)
                .map((record) => record.installRoot)
                .filter((root): root is string => root !== undefined),
        ),
    );

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

    // Verify the shared OLD provider is fully released (design §5.6): it is no
    // longer loaded anywhere — an EXPLICIT check, never inferred from quiesce
    // ACKs. A provider that does not refcount (omits `isLoaded`) makes the ACKs
    // authoritative (treated as released).
    function verifyZero(barrier: ReplaceBarrier): boolean {
        return isLoadedProbe(barrier.oldProvider, barrier.name) !== true;
    }

    // Cancel any live phase timers + the abort listener (design §5.3). Idempotent.
    function clearBarrierTimers(barrier: ReplaceBarrier): void {
        if (barrier.quiesceTimer !== undefined) {
            clearTimeout(barrier.quiesceTimer);
            barrier.quiesceTimer = undefined;
        }
        barrier.detachAbort?.();
        barrier.detachAbort = undefined;
    }

    // The provider each host adds AFTER the barrier releases (design §5.3). The
    // source decides post-barrier: `v1` (the old provider) on a rollback so every
    // session restores the exact version it had, `v2` (the new provider) on a
    // committed update, or nothing (undefined) on a committed uninstall.
    function decideAdd(barrier: ReplaceBarrier): AppAgentProvider | undefined {
        return barrier.outcome === "rolledback"
            ? barrier.oldProvider
            : barrier.newProvider;
    }

    // Decide the barrier's outcome and advance to phase 3 (design §5.3). Runs
    // exactly once (guarded by `outcome`): flips the entry (+ restores the record
    // on rollback), releases every parked host to run its decided add leg, then
    // GCs immediately if they have all already settled.
    function decide(barrier: ReplaceBarrier, outcome: ReplaceOutcome): void {
        if (barrier.outcome !== undefined) {
            return;
        }
        barrier.outcome = outcome;
        barrier.phase = "releasing";
        clearBarrierTimers(barrier);
        // Flip source state BEFORE releasing hosts (name active(v2)/absent on
        // commit; active(v1) + record restored on rollback). A throw here (e.g. a
        // synchronous agents.json write error during a rollback restore) must NOT
        // skip `release()` — the parked hosts would deadlock. They add the decided
        // provider off `barrier.outcome` (via `decideAdd`), independent of the
        // entry flip, so releasing after a partial `onDecided` still restores the
        // right version everywhere.
        try {
            barrier.onDecided(outcome);
        } catch (e) {
            debug(
                `barrier '${barrier.name}': onDecided(${outcome}) threw: ${e}`,
            );
        }
        barrier.release();
        // Unblock any session that connected mid-`removing` (design §7.3): it was
        // not a participant, so the parked add-legs above never reached it.
        // Resolved AFTER `onDecided` flips the entry, with the decided version to
        // install (`v2` commit / `v1` rollback / nothing on a committed
        // uninstall), so late joiner and participants converge on one version.
        barrier.resolveDecided(decideAdd(barrier));
        // Surface the terminal status to the issuing conversation (design §5.4):
        // a commit is `updated`; a rollback is `cancelled-reverted` (abort) or
        // `failed-reverted` (quiesce timeout).
        const status: UpdateOutcomeStatus =
            outcome === "committed"
                ? "updated"
                : barrier.rollbackKind === "cancelled"
                  ? "cancelled-reverted"
                  : "failed-reverted";
        // A throwing user `onOutcome` (a display wrapper) must not escape as an
        // unhandled rejection nor skip `finalizeIfReady`.
        try {
            barrier.onOutcome?.(status);
        } catch (e) {
            debug(
                `barrier '${barrier.name}': onOutcome(${status}) threw: ${e}`,
            );
        }
        finalizeIfReady(barrier);
    }

    function commit(barrier: ReplaceBarrier): void {
        decide(barrier, "committed");
    }

    // Roll back the swap (design §5.3): keep `v1`, discard `v2`. Triggered by the
    // quiesce timeout (`kind: "failed"`) or an out-of-band abort
    // (`kind: "cancelled"`).
    function rollback(
        barrier: ReplaceBarrier,
        kind: "cancelled" | "failed",
        reason: string,
    ): void {
        if (barrier.outcome !== undefined) {
            return;
        }
        barrier.rollbackKind = kind;
        debug(`barrier '${barrier.name}': rolling back (${reason})`);
        decide(barrier, "rolledback");
    }

    // End of phase 1 (a quiesce arrived): once every host has torn `v1` down AND
    // verify-0 confirms the shared refcount is 0, COMMIT (add `v2` on an update /
    // free the name on an uninstall). If verify-0 has not passed (a straggler
    // still holds a ref), stay parked — the quiesce timer is the backstop that
    // rolls back on expiry, so the no-coexistence guarantee holds without an
    // unbounded wait (design §5.3).
    function maybeAdvance(barrier: ReplaceBarrier): void {
        if (barrier.outcome !== undefined || barrier.phase !== "quiescing") {
            return;
        }
        if (barrier.pending.size > 0) {
            return;
        }
        if (!verifyZero(barrier)) {
            debug(
                `barrier '${barrier.name}': all hosts quiesced but refcount != 0; waiting for straggler (quiesce timeout is the backstop)`,
            );
            return;
        }
        // `v1` is confirmed down everywhere — commit directly (add `v2` on an
        // update / free the name on an uninstall). `v2`'s materialized manifest
        // was already structurally validated before the barrier was armed
        // (design §5.3), so there is nothing left to probe here.
        commit(barrier);
    }

    // Drop a host from a draining name's phase-1 barrier — a quiesce ACK, a
    // per-host teardown failure, or a disconnect (design §7.3). A disconnected
    // session has torn everything down, so it is treated exactly like a quiesce.
    // When the last slot fills, the barrier advances (verify-0 permitting).
    function quiesce(name: string, host: AppAgentHost): void {
        const entry = entries.get(name);
        if (entry?.status !== "removing") {
            return;
        }
        if (!entry.barrier.pending.delete(host)) {
            return;
        }
        maybeAdvance(entry.barrier);
    }

    // A host finished (or failed / auto-acked) its `replaceProvider` op — its
    // phase-3 add leg is done. Once every released host has settled, the swap is
    // applied in every session, so it is safe to GC the superseded install root
    // (design §5.3: `v1` is never pruned before `v2` is confirmed serving).
    function hostSettled(barrier: ReplaceBarrier, host: AppAgentHost): void {
        if (!barrier.settling.delete(host)) {
            return;
        }
        finalizeIfReady(barrier);
    }

    function finalizeIfReady(barrier: ReplaceBarrier): void {
        // Only after the outcome is decided (hosts released) and every host has
        // finished its add leg. A wedged straggler that never settles leaves the
        // GC to the Milestone 1 startup orphan sweep (the parked sessions have
        // already rolled back to `v1` and are serving).
        if (barrier.phase !== "releasing" || barrier.settling.size > 0) {
            return;
        }
        barrier.phase = "done";
        barrier.finalizeGc(barrier.outcome!);
    }

    // Begin a coordinated teardown/swap across every connected session (design
    // §5.6, §5.7) wrapped in the §5.3 timeout/cancel/rollback envelope. Every host
    // — INCLUDING the issuing one — runs `replaceProvider` on its own idle-gated
    // applicator: under a SINGLE held command lock it removes the old version,
    // quiesces (fills its barrier slot), then awaits the shared `whenReady` before
    // adding whatever the barrier decides — so no request interleaves the swap on
    // any session and no two versions coexist. Returns immediately once the
    // barrier is wired; the swap resolves to COMMIT (`v2`/free the name) once the
    // last host quiesces and verify-0 confirms the shared old refcount is 0 — or
    // to ROLLBACK (`v1` restored, `v2` discarded) on a quiesce timeout or an
    // out-of-band abort (design §5.3). A per-host
    // failure is treated as a quiesce so a failed/gone session never wedges it.
    //
    // `dropConfig` (design §5, Model B): forwarded to every remove leg — `true`
    // for uninstall (clear the enable preference), `false` for update (preserve
    // it across the version bump).
    function startReplace(params: {
        name: string;
        oldProvider: AppAgentProvider;
        issuingHost: AppAgentHost;
        dropConfig: boolean;
        // The new version to add on commit; undefined for an uninstall.
        newProvider: AppAgentProvider | undefined;
        // Flip the entry (+ restore the record on rollback) at release.
        onDecided: (outcome: ReplaceOutcome) => void;
        // Prune the superseded install root once every host has swapped.
        finalizeGc: (outcome: ReplaceOutcome) => void;
        // Report the terminal outcome to the issuing conversation (§5.4).
        onOutcome?: ((status: UpdateOutcomeStatus) => void) | undefined;
        // Out-of-band cancel (design §5.3): abort → rollback. Rides the abort
        // path, NEVER the command queue (which would deadlock behind the frozen
        // op).
        abortSignal?: AbortSignal | undefined;
    }): void {
        const {
            name,
            oldProvider,
            issuingHost,
            dropConfig,
            newProvider,
            onDecided,
            finalizeGc,
            onOutcome,
            abortSignal,
        } = params;
        // The issuing host is always part of the barrier even if it never
        // formally connected (defensive); it is otherwise treated as a sibling.
        const targets = new Set<AppAgentHost>(clients);
        targets.add(issuingHost);
        let release!: () => void;
        const whenReady = new Promise<void>((resolve) => {
            release = resolve;
        });
        let resolveDecided!: (provider: AppAgentProvider | undefined) => void;
        const whenDecided = new Promise<AppAgentProvider | undefined>(
            (resolve) => {
                resolveDecided = resolve;
            },
        );
        const barrier: ReplaceBarrier = {
            name,
            oldProvider,
            newProvider,
            pending: new Set(targets),
            settling: new Set(targets),
            whenDecided,
            resolveDecided,
            release,
            onDecided,
            finalizeGc,
            onOutcome,
            phase: "quiescing",
            outcome: undefined,
            rollbackKind: undefined,
            quiesceTimer: undefined,
            detachAbort: undefined,
        };
        entries.set(name, {
            status: "removing",
            provider: oldProvider,
            barrier,
        });

        // Phase-1 backstop (design §5.3 liveness): a straggler that won't idle or
        // a `v1` that won't terminate (verify-0 never passes) rolls back.
        barrier.quiesceTimer = setTimeout(
            () => rollback(barrier, "failed", "quiesce timeout"),
            quiesceTimeoutMs,
        );
        // Out-of-band cancel (design §5.3): the abort maps to a source-coordinated
        // rollback. It rides the abort path, not the command queue — a queued
        // `cancel` would deadlock behind the frozen command lock.
        if (abortSignal !== undefined) {
            if (abortSignal.aborted) {
                queueMicrotask(() => rollback(barrier, "cancelled", "aborted"));
            } else {
                const onAbort = () => rollback(barrier, "cancelled", "aborted");
                abortSignal.addEventListener("abort", onAbort, { once: true });
                barrier.detachAbort = () =>
                    abortSignal.removeEventListener("abort", onAbort);
            }
        }

        for (const host of targets) {
            host.replaceProvider(oldProvider, () => decideAdd(barrier), {
                onQuiesced: () => quiesce(name, host),
                whenReady,
                notify: true,
                dropConfig,
            }).then(
                () => {
                    // A host that was already closed at enqueue time auto-acks
                    // its op WITHOUT running `onQuiesced` (§5.4). Quiesce here too
                    // (idempotent — `pending.delete` guards it) so such a host
                    // fills its phase-1 slot from the success path and never
                    // wedges the barrier until the quiesce timeout.
                    quiesce(name, host);
                    hostSettled(barrier, host);
                },
                (e: unknown) => {
                    // A per-host teardown/add failure must not wedge the barrier:
                    // unblock phase 1 (if the remove leg threw) and phase 3.
                    debug(`replaceProvider failed for '${name}': ${e}`);
                    quiesce(name, host);
                    hostSettled(barrier, host);
                },
            );
        }
    }

    // Fan out an add to every connected session (design §4, §5, §5.4): every
    // host — INCLUDING the issuing one — enqueues the add on its own idle-gated
    // applicator and is notified with a system message; none is applied inline
    // under a held command lock (§5.4). Each session derives the agent's enabled
    // state from its own config with the manifest default as fallback (Model B).
    // A per-host throw is caught and logged, never failing the committed op.
    // Returns immediately; each add lands at that session's next idle.
    function fanOutAdd(
        provider: AppAgentProvider,
        issuingHost: AppAgentHost,
    ): void {
        const targets = new Set<AppAgentHost>(clients);
        targets.add(issuingHost);
        for (const host of targets) {
            host.addProvider(provider, true).catch((e) => {
                debug(`addProvider failed: ${e}`);
            });
        }
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
                // Build the shared per-agent provider AND structurally validate
                // its freshly-materialized manifest BEFORE persisting (design
                // §5.3, §7.2 absent → active): a corrupt/unresolvable agent — from
                // ANY source (feed, catalog `module`, or local `path`) — fails
                // here, so a broken agent is never recorded.
                const provider = await buildValidatedAgentProvider(
                    name,
                    record,
                );
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
                // Mark the name active so later connects vend it (design §7.2
                // absent → active).
                entries.set(name, { status: "active", provider });
                // Fan out the add to every connected session — including the
                // issuing one — through each session's idle-gated applicator
                // (design §4, §5.4). Non-blocking: the record is already
                // committed, so the load lands at each session's next idle and
                // the terminal state is reported via the fan-out notification.
                fanOutAdd(provider, issuingHost);
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
            onOutcome?: (status: UninstallOutcomeStatus) => void,
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
                // Capture the version-scoped install root before the barrier: its
                // directory is pruned once the agent is confirmed down everywhere
                // (design §5.5 GC).
                const deletedRecord = readAgentsJson(instanceDir)?.agents[name];
                if (deletedRecord === undefined) {
                    throw new Error(`Agent '${name}' not found`);
                }
                const uninstalledRoot = deletedRecord.installRoot;
                // Drop the record only at the barrier COMMIT (in `onDecided`
                // below), NOT here: while the teardown is in flight the agent
                // stays the recorded-current install, so a crash mid-uninstall
                // recovers to the still-installed agent rather than a half-removed
                // state, and a rollback needs nothing restored (design §5.3, §5.5).
                const deleteInstalledRecord = () => {
                    const current = readAgentsJson(instanceDir) ?? {
                        agents: {},
                    };
                    delete current.agents[name];
                    writeAgentsJson(instanceDir, current);
                };
                // The barrier decision is the commit point (design §7.4). Now tear
                // the live agent down across every connected session through the
                // coordinated barrier (active → removing → absent, design §5.6,
                // §5.7, §7.2): each session's `replaceProvider` (no new-version
                // thunk) unloads under one held command lock, then the name is
                // freed only once verify-0 confirms the shared process is down
                // everywhere. The name stays off-limits until the barrier
                // completes. Uninstall drops each session's persisted enable
                // preference (dropConfig=true) so a fresh reinstall starts from
                // the manifest default (design §5, Model B). Once confirmed down,
                // the agent's version-scoped install root is pruned (design §5.5
                // GC; the startup orphan sweep is the backstop). If a straggler
                // never idles the barrier times out and ROLLS BACK (design §5.3):
                // `v1` is re-added everywhere and the record restored, so the name
                // is never freed while its process may still be running.
                if (entry?.status === "active") {
                    startReplace({
                        name,
                        oldProvider: entry.provider,
                        issuingHost,
                        dropConfig: true,
                        newProvider: undefined,
                        onDecided: (outcome) => {
                            if (outcome === "committed") {
                                // Flip in-memory FIRST (never throws) so the name
                                // is never stranded in `removing`, then drop the
                                // record — the durable commit point (design §7.4).
                                entries.delete(name);
                                deleteInstalledRecord();
                            } else {
                                // Rollback: the record was never dropped, so there
                                // is nothing to restore — just keep v1 live (design
                                // §5.3).
                                entries.set(name, {
                                    status: "active",
                                    provider: entry.provider,
                                });
                            }
                        },
                        finalizeGc: (outcome) => {
                            // Prune the version-scoped root only on a committed
                            // uninstall whose record drop actually landed; a
                            // rollback (or a commit-drop write that failed, leaving
                            // the record present) keeps `v1` intact (design §5.3,
                            // §5.5 GC).
                            if (outcome === "committed") {
                                const stillRecorded =
                                    readAgentsJson(instanceDir)?.agents[name];
                                if (
                                    stillRecorded === undefined &&
                                    !isRootReferenced(
                                        instanceDir,
                                        uninstalledRoot,
                                        name,
                                    )
                                ) {
                                    pruneAgentRoot(installDir, uninstalledRoot);
                                }
                            }
                        },
                        // Surface the terminal async status (design §5.4): a
                        // committed uninstall is `uninstalled`; a straggler-timeout
                        // rollback is `reverted` (the agent stays installed), so the
                        // issuing conversation is never left believing a reverted
                        // uninstall succeeded.
                        onOutcome: onOutcome
                            ? (status) =>
                                  onOutcome(
                                      status === "updated"
                                          ? "uninstalled"
                                          : "reverted",
                                  )
                            : undefined,
                    });
                } else {
                    deleteInstalledRecord();
                    if (!isRootReferenced(instanceDir, uninstalledRoot, name)) {
                        pruneAgentRoot(installDir, uninstalledRoot);
                    }
                    onOutcome?.("uninstalled");
                }
            } finally {
                busy.delete(name);
            }
        },
        async update(
            name: string,
            range: string | undefined,
            issuingHost: AppAgentHost,
            abortSignal?: AbortSignal,
            onOutcome?: (status: UpdateOutcomeStatus) => void,
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
                const resolved = await registry.reresolve(existing, {
                    range,
                });
                const record: InstalledAgentRecord = { ...resolved, name };
                // Persist the v2 record only at the barrier COMMIT (in
                // `onDecided` below), NOT here: while the swap is in flight the
                // recorded-current version must stay v1, so a crash mid-swap
                // recovers to v1 (the already-materialized v2 root is then an
                // orphan the startup sweep reclaims) instead of coming up on an
                // unverified v2 with v1 already pruned (design §5.3, §5.5). A
                // failed materialize above is a no-op that leaves v1 intact.
                const writeInstalledRecord = () => {
                    const current = readAgentsJson(instanceDir) ?? {
                        agents: {},
                    };
                    current.agents[name] = record;
                    writeAgentsJson(instanceDir, current);
                };
                // Same-version no-op (design §5.5): a content-addressed feed
                // re-resolution that lands on a byte-identical install root means
                // the exact same package+version is already installed and serving
                // — the disruptive barrier swap would tear the live agent down
                // and bring the identical version back up for nothing. Skip it:
                // refresh the record (the resolve may pin a moving tag/range to a
                // concrete ref) and report success without touching the live
                // provider or GC. Gated on `installRoot` being DEFINED so
                // path/catalog/legacy records (no root) always re-swap and still
                // pick up an in-place manifest edit.
                if (
                    record.installRoot !== undefined &&
                    record.installRoot === existing.installRoot
                ) {
                    writeInstalledRecord();
                    onOutcome?.("updated");
                    return;
                }
                // Coordinated update (design §5.6, §5.7, §7.2): tear the OLD
                // version down across every session and add the NEW one as ONE
                // coordinated barrier — each session's `replaceProvider` removes
                // v1 then (after verify-0 confirms v1 is down everywhere) adds v2,
                // all under one held command lock, so no two versions of the name
                // ever coexist and no session observes it absent. No-coexistence
                // is REQUIRED because an agent's persisted storage is keyed by
                // agent name and cannot be shared, so two versions loaded at once
                // would collide on that storage. The barrier passes
                // dropConfig=false so the version bump preserves each session's
                // per-session enable preference (design §5, Model B). The update
                // is cancelable (abortSignal) and time-bounded: a straggler that
                // won't idle or a v1 that won't die ROLLS BACK to v1 (design §5.3)
                // — v2 is discarded and v1 stays the recorded-current version, as
                // if it never happened.
                const oldEntry = entries.get(name);
                // Build v2's provider AND structurally validate its
                // freshly-materialized manifest while v1 is still live (design
                // §5.3): a corrupt/unresolvable v2 — from ANY source (feed,
                // catalog `module`, or local `path`) — fails HERE (the update
                // rejects, v1 untouched, v2's root left for the startup sweep)
                // rather than committing and failing per-session with v1 already
                // pruned.
                const newProvider = await buildValidatedAgentProvider(
                    name,
                    record,
                );
                // The OLD (v1) version's install root, kept intact until the
                // swap succeeds so a rollback can restart v1 (design §5.3), and
                // pruned only after v2 is confirmed serving everywhere AND no
                // other agent still references it (content-addressed roots are
                // shared, so the prune is refcount-guarded). The new root differs
                // whenever the version changed (roots are keyed `module@version`,
                // design §5.5); an update that resolves the same version is a
                // no-op handled above and never reaches the barrier.
                const oldRoot = existing.installRoot;
                const newRoot = record.installRoot;
                if (oldEntry?.status === "active") {
                    startReplace({
                        name,
                        oldProvider: oldEntry.provider,
                        issuingHost,
                        dropConfig: false,
                        newProvider,
                        onDecided: (outcome) => {
                            if (outcome === "committed") {
                                // Flip in-memory FIRST (never throws) so the name
                                // is never stranded in `removing` (the tombstone
                                // would otherwise brick it), then persist v2 — the
                                // durable commit point (design §7.4). If that write
                                // throws, v1 stays the recorded-current version and
                                // the finalizeGc guard below keeps v1's root.
                                entries.set(name, {
                                    status: "active",
                                    provider: newProvider,
                                });
                                writeInstalledRecord();
                            } else {
                                // Rollback: v1 was never overwritten in the store,
                                // so there is nothing to restore — just keep v1
                                // live and discard v2, as if the update never
                                // happened (design §5.3).
                                entries.set(name, {
                                    status: "active",
                                    provider: oldEntry.provider,
                                });
                            }
                        },
                        finalizeGc: (outcome) => {
                            // Prune the superseded root only after every host has
                            // swapped (design §5.3: v1 never pruned before v2 is
                            // serving). Commit discards v1 — but only once v2 is
                            // actually the persisted record, so a commit-write that
                            // failed (leaving v1 recorded) keeps v1's root and
                            // orphans v2 for the startup sweep. Rollback discards
                            // v2 (v1 stays recorded + serving).
                            if (outcome === "committed") {
                                const committed =
                                    readAgentsJson(instanceDir)?.agents[name];
                                if (
                                    committed?.installRoot === newRoot &&
                                    oldRoot !== newRoot &&
                                    !isRootReferenced(
                                        instanceDir,
                                        oldRoot,
                                        name,
                                    )
                                ) {
                                    pruneAgentRoot(installDir, oldRoot);
                                }
                            } else {
                                if (
                                    oldRoot !== newRoot &&
                                    !isRootReferenced(
                                        instanceDir,
                                        newRoot,
                                        name,
                                    )
                                ) {
                                    pruneAgentRoot(installDir, newRoot);
                                }
                            }
                        },
                        onOutcome,
                        abortSignal,
                    });
                } else {
                    // No live old version to tear down: commit v2 directly (write
                    // the record + add to every session); there is no barrier
                    // (nothing to coordinate), so surface the terminal status
                    // directly (§5.4).
                    writeInstalledRecord();
                    entries.set(name, {
                        status: "active",
                        provider: newProvider,
                    });
                    if (
                        oldRoot !== record.installRoot &&
                        !isRootReferenced(instanceDir, oldRoot, name)
                    ) {
                        pruneAgentRoot(installDir, oldRoot);
                    }
                    fanOutAdd(newProvider, issuingHost);
                    onOutcome?.("updated");
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
            // A name that is `removing` right now was excluded from `providers`
            // above (its post-swap version is still undecided). This host
            // connected AFTER the in-flight barrier snapshotted its targets, so
            // it is NOT a participant and would otherwise never receive the
            // swapped-in version until it reconnected. Instead it hands back a
            // `whenReady` the dispatcher awaits (still holding this session's
            // command lock) before going live: it resolves to the decided
            // version(s) once every in-flight barrier has decided, which the
            // dispatcher then installs inline. Deferring that install past the
            // decision means this session never loads a doomed version (verify-0
            // pollution) and never processes a command with the upgrading agent
            // absent (design §7.3 connect-during-removing).
            const joinedBarriers: ReplaceBarrier[] = [];
            for (const entry of entries.values()) {
                if (entry.status === "removing") {
                    joinedBarriers.push(entry.barrier);
                }
            }
            // `whenReady` resolves once EVERY barrier in flight at connect time
            // has decided, to the decided version(s) to install (a committed
            // uninstall contributes nothing). Resolves to `[]` immediately when
            // nothing was in flight. The barriers decide independently of this
            // session (bounded by their quiesce timeout), so this never hangs.
            const whenReady: Promise<AppAgentProvider[]> =
                joinedBarriers.length === 0
                    ? Promise.resolve([])
                    : Promise.all(
                          joinedBarriers.map((barrier) => barrier.whenDecided),
                      ).then((decided) =>
                          decided.filter(
                              (p): p is AppAgentProvider => p !== undefined,
                          ),
                      );
            return {
                providers,
                whenReady,
                dispose() {
                    // Deregister this host from the fan-out registry (design §6).
                    // Does NOT tear down the shared providers — other sessions
                    // still hold them; the dispatcher unregisters them from its
                    // own manager at teardown.
                    clients.delete(host);
                    // Disconnect while a teardown/swap is in flight (design
                    // §7.3): a gone session has removed everything, so drop it
                    // from every barrier's pending set (which may complete one).
                    for (const name of [...entries.keys()]) {
                        quiesce(name, host);
                        // Re-poll verify-0 even when this host had already left
                        // `pending`. The dispatcher tears this session's agents
                        // down — dropping the shared `v1` refcount — BEFORE it
                        // disposes the connection, so a barrier parked on "all
                        // quiesced but refcount != 0" (because an auto-acked op
                        // emptied `pending` before that decrement landed) would
                        // otherwise sit until the quiesce timeout and spuriously
                        // roll back. `maybeAdvance` only commits when verify-0
                        // genuinely passes and is idempotent, so re-polling on a
                        // disconnect is always safe (design §5.7 close race).
                        const entry = entries.get(name);
                        if (entry?.status === "removing") {
                            maybeAdvance(entry.barrier);
                        }
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

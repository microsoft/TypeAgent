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
    AvailableInstallRow,
    InstallMatchKind,
    InstallPreview,
    InstallPreviewMatch,
    InstallResult,
    deriveMatchKind,
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
import {
    createInstallSourceRegistry,
    type InstallSourceFactory,
    type PreviewMatch,
} from "./installSources/registry.js";
import { getSourceCommands } from "./installSources/sourceCommands.js";
import { createLimiter } from "@typeagent/common-utils";
import registerDebug from "debug";

const debug = registerDebug("typeagent:defaultAgentProvider:source");

// The directory under `installDir` that holds every per-agent, version-scoped
// install root. GC (prune-on-swap + startup orphan sweep) operates
// only within this directory, never the legacy shared `installDir/node_modules`,
// the marker `package.json`, or feed caches.
function agentRootsDir(installDir: string): string {
    return path.join(installDir, AGENT_INSTALL_ROOTS_SUBDIR);
}

// Remove a single per-agent install root after its version is confirmed gone
// during prune-on-swap / after uninstall drain. Best-effort: a
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

// Startup orphan sweep: remove any per-agent install root under
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
// `excludeName`? Content-addressed roots
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
 * {@link getDefaultAppAgentSource} as per-agent providers, so a
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
 * (possibly spanning installDir + app bundle) so no combined router is needed;
 * empty when no instance dir is available.
 */
function getInstalledAppAgentProviders(
    instanceConfigs: InstanceConfigProvider | undefined,
    configName?: string,
): AppAgentProvider[] {
    const instanceDir = instanceConfigs?.getInstanceDir();
    if (instanceDir === undefined) {
        return [];
    }
    const installDir = getInstallDir(instanceConfigs);
    if (installDir === undefined) {
        return [];
    }
    const records = loadInstalledRecords(instanceDir, configName);
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
 * Tunables for the coordinated update/uninstall barrier. All
 * optional; conservative defaults apply when omitted. Injected by tests to drive
 * the timeout/rollback paths deterministically.
 */
export type UpdateCoordinationOptions = {
    // Phase-1 (quiesce) timeout in ms: abandon a straggler that won't idle — or a
    // `v1` whose refcount never reaches 0 (verify-0 never passes) — and roll back
    // if needed. The ultimate backstop for a wedged teardown.
    quiesceTimeoutMs?: number | undefined;
    // Overridable verify-0 probe: reports whether the shared OLD
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
    // Provider config name whose bundled agents are reserved from install names.
    configName?: string | undefined;
    // Tunables for the coordinated update/uninstall barrier.
    updateCoordination?: UpdateCoordinationOptions | undefined;
};

type InstalledAgentSourceForTest = AppAgentSource & {
    /** @internal Test-only handle for driving installed-agent source mutations directly. */
    readonly testApi: InstalledAgentSourceApi;
};

// Conservative default for the update-coordination barrier: a
// short quiesce window (abandon a straggler fast). A wall-clock backstop, not a
// hot path.
const DEFAULT_QUIESCE_TIMEOUT_MS = 15_000;

/**
 * Per-name lifecycle entry for a dynamic (installed) agent. A name is:
 * - `active`: installed and vended;
 * - `removing`: an `update` swap is coordinating a `v1 → v2` replacement across
 *   the connected sessions through the barrier (no two versions ever coexist);
 * - `draining`: an `uninstall` is tearing the agent down across the connected
 *   sessions and awaiting the shared process to close before the name is freed.
 * A name that is `removing` or `draining` is off-limits (concurrent mutations
 * are rejected and a connecting session parks) until it settles.
 */
type DynamicAgentEntry =
    | { status: "active"; provider: AppAgentProvider }
    | {
          status: "removing";
          // The in-flight update-swap barrier.
          barrier: ReplaceBarrier;
      }
    | {
          status: "draining";
          // Resolves when the uninstall teardown settles (freed or reverted), so
          // a session connecting mid-teardown can park until the name is quiet.
          whenDone: Promise<void>;
      };

/**
 * A source-coordinated teardown/swap barrier that either commits or, on a
 * timeout or abort, rolls back. Every target host runs `replaceProvider`, tears
 * down the shared old
 * (`v1`) version, and fills its slot via `quiesce`. Once every slot is filled and
 * verify-0 confirms the shared `v1` refcount is 0, the source commits and each
 * host adds `v2`. Any stall — a straggler
 * that won't idle or a `v1` that won't terminate — or an out-of-band abort
 * resolves to rollback instead: `v1` is restored in every session and `v2` is
 * discarded, as if the op never happened. The outcome is decided before hosts
 * resume, so a host only ever adds one version (`v2` on commit, `v1` on
 * rollback) — never a second swap round.
 */
type ReplaceOutcome = "committed" | "rolledback";

// Barrier lifecycle: collect quiesces → (verify-0 passes) → decide the outcome
// → unblock hosts/late joiners → GC the superseded root (verify-0 already
// confirmed the old version is fully unloaded).
type ReplaceBarrier = {
    readonly name: string;
    // The shared old (`v1`) provider: verify-0 checks its refcount, and it is
    // re-added to every session on rollback.
    readonly oldProvider: AppAgentProvider;
    // The new (`v2`) provider added on a committed swap.
    readonly newProvider: AppAgentProvider;
    // Phase 1: hosts that have not yet quiesced (torn `v1` down). Empty ⇒ every
    // host removed `v1`.
    readonly pending: Set<AppAgentHost>;
    // Resolves (exactly once) when the barrier's outcome is decided (commit or
    // rollback), as a pure signal. A session that connects mid-`removing` is NOT
    // a participant (it never held `v1`, so it neither quiesces nor counts toward
    // verify-0/GC); instead its `connect` parks on this signal until every
    // in-flight barrier has been decided, then joins the fan-out set and
    // snapshots the now-quiet active set — which already reflects the decided
    // outcome (`v2` on commit / `v1` on rollback), so no separate decided-version
    // fold is needed. Parking
    // past the decision means it can neither pollute verify-0 nor run a command
    // with the agent mid-swap.
    readonly whenDecided: Promise<void>;
    // Resolves `whenDecided` (called once in `decide`).
    readonly resolveDecided: () => void;
    // Run once when the outcome is decided: flip the entry to active(`v2`) on
    // commit, or restore active(`v1`) on rollback.
    readonly onDecided: (outcome: ReplaceOutcome) => void;
    // Run once when the outcome is decided (the superseded old version is already
    // fully unloaded — verify-0 passed before commit — and a rollback's discarded
    // `v2` was never added): prune the superseded install root (commit: `v1`;
    // rollback: `v2`).
    readonly finalizeGc: (outcome: ReplaceOutcome) => void;
    // Report the terminal outcome to the issuing conversation.
    readonly onOutcome: ((status: UpdateOutcomeStatus) => void) | undefined;
    // undefined until decided; set exactly once (commit XOR rollback).
    outcome: ReplaceOutcome | undefined;
    // Phase-1 backstop timer (straggler / `v1` won't die → rollback).
    quiesceTimer: ReturnType<typeof setTimeout> | undefined;
};

/**
 * Public runtime entry point for the installed-agent source. Returns only the
 * dispatcher-facing {@link AppAgentSource}; the test-only handle is stripped
 * from the runtime object before handing it to hosts.
 */
export function getDefaultAppAgentSource(
    instanceDir: string,
    options?: DefaultAppAgentSourceOptions,
): AppAgentSource {
    const { testApi, ...source } = createDefaultInstalledAgentSource(
        instanceDir,
        options,
    );
    void testApi;
    return source;
}

/**
 * @internal Exported for focused unit tests only. Runtime callers must use
 * {@link getDefaultAppAgentSource}, which strips the test-only handle before
 * handing the source to hosts.
 */
export function createDefaultInstalledAgentSource(
    instanceDir: string,
    options?: DefaultAppAgentSourceOptions,
    /** Host extension point for supplying alternate install sources. */
    sourceFactory?: InstallSourceFactory,
): InstalledAgentSourceForTest {
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
    // record write) and uninstall.
    const limiter = createLimiter(1);

    // Resolved update-coordination tunables. Conservative defaults;
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

    const registry = createInstallSourceRegistry(
        sources,
        {
            installDir,
            limiter,
            persist: persistSources,
            ...(options?.excludePathSources !== undefined
                ? { excludePathSources: options.excludePathSources }
                : {}),
        },
        sourceFactory,
    );

    // Builtins are the app's shipped bundled agents (their own static
    // provider), so they can never be installed-over, uninstalled, or updated.
    function isBuiltin(name: string): boolean {
        return getBundledAgentNames(options?.configName).has(name);
    }

    // Per-name lifecycle tracker: the current state of the
    // dynamic agent set. A name is `active` (vended) or `removing` (draining).
    const entries = new Map<string, DynamicAgentEntry>();

    // Build the shared provider for a record.
    // Installed agents honor their manifest default just like bundled agents
    //: the register-time state derivation uses
    // `config[name] ?? manifestDefault`, and a user's explicit per-session
    // `@config agent` override still wins.
    //
    // A draining name is never loaded on the normal path: throughout the
    // `removing` window every participant session holds its command lock (parked
    // in `replaceProvider` awaiting `whenDecided`), and a session that connects
    // mid-`removing` parks on `whenDecided` before joining fan-out — so no
    // command, and therefore no `loadAppAgent`, runs against a draining name.
    function buildAgentProvider(
        name: string,
        record: InstalledAgentRecord,
    ): AppAgentProvider {
        const loadRecord = registry.load(record);
        // installDir is guaranteed resolved above (the source throws otherwise);
        // the `!` bridges TS's lack of narrowing across this nested closure.
        return createInstalledAppAgentProvider(name, loadRecord, installDir!);
    }

    // Build the shared provider for a freshly-resolved install/update record AND
    // structurally validate its materialized manifest before we commit.
    // Source-agnostic: a missing/corrupt manifest is equally fatal whether
    // the agent came from a feed, a catalog `module`, or a local `path`, so
    // failing HERE means an install records nothing and an update leaves `v1`
    // untouched — instead of committing a broken agent that then fails per
    // session (with `v1` already pruned). Cheap and non-forking: the real agent
    // process only launches when a host loads it, so a manifest that reads but
    // throws on `instantiate()` still uses the ordinary per-session load
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

    // Seed active entries from agents.json. One single-agent,
    // single-root provider per record; shared (the same instance) across every
    // connected session.
    const installedRecords = loadInstalledRecords(
        instanceDir,
        options?.configName,
    );
    for (const [name, record] of Object.entries(installedRecords)) {
        entries.set(name, {
            status: "active",
            provider: buildAgentProvider(name, record),
        });
    }

    // Startup orphan sweep: keep only each installed agent's
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
    // never a draining name.
    function activeProviders(): AppAgentProvider[] {
        const providers: AppAgentProvider[] = [];
        for (const entry of entries.values()) {
            if (entry.status === "active") {
                providers.push(entry.provider);
            }
        }
        return providers;
    }

    // The client registry of connected AppAgentHosts, used for
    // cross-session fan-out. connect() adds; dispose() removes.
    const clients = new Set<AppAgentHost>();

    // Per-name in-flight guard: per-name serialization lives
    // in the entry, not only in the global write limiter). A name is `busy` for
    // the synchronous span of an install/uninstall/update op (resolve +
    // materialize + record write); `removing` covers the subsequent async drain.
    // Together they serialize concurrent ops on one name — e.g. an `update`
    // materializing cannot be overtaken by a concurrent `uninstall` starting a
    // drain of the same name.
    const busy = new Set<string>();

    // Reject a mutating op on a name that is still tearing down (an `update`
    // swap `removing`, or an `uninstall` `draining`): the name is off-limits
    // until it settles.
    function assertNotRemoving(name: string): void {
        const status = entries.get(name)?.status;
        if (status === "removing" || status === "draining") {
            throw new Error(
                `Agent '${name}' is still being removed; retry shortly.`,
            );
        }
    }

    // Reject if the name is draining OR another op on it is in flight.
    function assertNameFree(name: string): void {
        assertNotRemoving(name);
        if (busy.has(name)) {
            throw new Error(
                `Agent '${name}' has an operation in progress; retry shortly.`,
            );
        }
    }

    // Verify the shared OLD provider is fully released: it is no
    // longer loaded anywhere — an EXPLICIT check, never inferred from quiesce
    // ACKs. A provider that does not refcount (omits `isLoaded`) makes the ACKs
    // authoritative (treated as released).
    function verifyZero(barrier: ReplaceBarrier): boolean {
        return isLoadedProbe(barrier.oldProvider, barrier.name) !== true;
    }

    // Cancel the live quiesce backstop timer. Idempotent.
    function clearBarrierTimers(barrier: ReplaceBarrier): void {
        if (barrier.quiesceTimer !== undefined) {
            clearTimeout(barrier.quiesceTimer);
            barrier.quiesceTimer = undefined;
        }
    }

    // The provider each host adds AFTER the barrier is decided: `v1` (the old
    // provider) on a rollback so every session restores the exact version it
    // had, or `v2` (the new provider) on a committed update.
    function decideAdd(barrier: ReplaceBarrier): AppAgentProvider {
        return barrier.outcome === "rolledback"
            ? barrier.oldProvider
            : barrier.newProvider;
    }

    // Decide the barrier's outcome and unblock parked hosts / late joiners.
    // Runs exactly once (guarded by `outcome`): flips the entry (+ restores the
    // record on rollback), unblocks parked hosts / late joiners, then GCs the
    // superseded root (verify-0 already confirmed the old version is fully
    // unloaded).
    function decide(barrier: ReplaceBarrier, outcome: ReplaceOutcome): void {
        if (barrier.outcome !== undefined) {
            return;
        }
        barrier.outcome = outcome;
        clearBarrierTimers(barrier);
        // Flip source state BEFORE unblocking hosts (name active(v2)/absent on
        // commit; active(v1) + record restored on rollback). A throw here (e.g. a
        // synchronous agents.json write error during a rollback restore) must NOT
        // skip `resolveDecided()` — the parked hosts would deadlock. They add the
        // decided provider off `barrier.outcome` (via `decideAdd`), independent
        // of the entry flip, so unblocking after a partial `onDecided` still
        // restores the right version everywhere.
        try {
            barrier.onDecided(outcome);
        } catch (e) {
            debug(
                `barrier '${barrier.name}': onDecided(${outcome}) threw: ${e}`,
            );
        }
        // Unblock participant hosts parked in `replaceProvider` and late joiners
        // parked in `connect()`. `onDecided` already flipped the entry, so late
        // joiners re-snapshot the decided version (`v2` on commit / `v1` on
        // rollback).
        barrier.resolveDecided();
        // Report the final status to the issuing conversation:
        // a commit is `updated`; a rollback is `reverted` (the quiesce timeout
        // abandoned a straggler and restored `v1`).
        const status: UpdateOutcomeStatus =
            outcome === "committed" ? "updated" : "reverted";
        // A throwing user `onOutcome` (a display wrapper) must not escape as an
        // unhandled rejection nor skip the GC.
        try {
            barrier.onOutcome?.(status);
        } catch (e) {
            debug(
                `barrier '${barrier.name}': onOutcome(${status}) threw: ${e}`,
            );
        }
        // Prune the superseded install root now the outcome is decided. On a
        // commit `v1` is already fully unloaded everywhere (verify-0 passed
        // before commit); on a rollback the discarded `v2` was never added — so
        // the superseded root is safe to reclaim immediately without waiting on
        // the hosts' async add legs. A per-host add that later fails prunes the
        // same root anyway, and the startup orphan sweep remains the backstop. A
        // throwing finalizer must not escape `decide`.
        try {
            barrier.finalizeGc(outcome);
        } catch (e) {
            debug(
                `barrier '${barrier.name}': finalizeGc(${outcome}) threw: ${e}`,
            );
        }
    }

    function commit(barrier: ReplaceBarrier): void {
        decide(barrier, "committed");
    }

    // Roll back the swap: keep `v1`, discard `v2`. Triggered by the
    // quiesce timeout (a straggler that won't idle, or a `v1` that won't die).
    function rollback(barrier: ReplaceBarrier, reason: string): void {
        if (barrier.outcome !== undefined) {
            return;
        }
        debug(`barrier '${barrier.name}': rolling back (${reason})`);
        decide(barrier, "rolledback");
    }

    // End of phase 1 (a quiesce arrived): once every host has torn `v1` down AND
    // verify-0 confirms the shared refcount is 0, COMMIT (add `v2`). If verify-0
    // has not passed (a straggler
    // still holds a ref), stay parked — the quiesce timer is the backstop that
    // rolls back on expiry, so the no-coexistence guarantee holds without an
    // unbounded wait.
    function maybeAdvance(barrier: ReplaceBarrier): void {
        if (barrier.outcome !== undefined) {
            return;
        }
        if (barrier.pending.size > 0) {
            return;
        }
        if (!verifyZero(barrier)) {
            // Parked: every host quiesced but the shared `v1` ref is still held.
            // In practice this is only reached via the closing-session race (a
            // slot auto-acked before its `agents.close()` decrement landed),
            // which the disconnect re-poll in connect().dispose() resolves — NOT
            // the timeout. The quiesce timer is the backstop for a genuinely
            // wedged ref that never drops; a ref that self-drops with no
            // disconnect is not reachable today.
            debug(
                `barrier '${barrier.name}': all hosts quiesced but refcount != 0; waiting for straggler (quiesce timeout is the backstop)`,
            );
            return;
        }
        // `v1` is confirmed down everywhere — commit directly (add `v2`). `v2`'s
        // materialized manifest
        // was already structurally validated before the barrier was armed
        //, so there is nothing left to probe here.
        commit(barrier);
    }

    // Drop a host from a draining name's phase-1 barrier — a quiesce ACK, a
    // per-host teardown failure, or a disconnect. A disconnected
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

    // The fan-out target set for a mutation: every connected session PLUS the
    // issuing one (which may not have formally connected). A fresh copy so a
    // concurrent connect/disconnect can't mutate it mid-iteration.
    function fanOutTargets(issuingHost: AppAgentHost): Set<AppAgentHost> {
        const targets = new Set<AppAgentHost>(clients);
        targets.add(issuingHost);
        return targets;
    }

    // Prune a version-scoped install root once its version is confirmed down —
    // but only if no other agent's record still references it (content-addressed
    // roots are shared). A no-op for an undefined root.
    function pruneRootIfUnreferenced(
        root: string | undefined,
        excludeName: string,
    ): void {
        if (!isRootReferenced(instanceDir, root, excludeName)) {
            // installDir is guaranteed resolved above (the source throws
            // otherwise); the `!` bridges TS's lack of narrowing across this
            // nested closure.
            pruneAgentRoot(installDir!, root);
        }
    }

    // Read `agents.json`, apply `mutate` to its record map, and write it back.
    // The single read-modify-write site for the store; a throw from `mutate`
    // (e.g. the install existing-name check) aborts before the write.
    function mutateAgentsJson(
        mutate: (agents: Record<string, InstalledAgentRecord>) => void,
    ): void {
        const current = readAgentsJson(instanceDir) ?? { agents: {} };
        mutate(current.agents);
        writeAgentsJson(instanceDir, current);
    }

    // Begin a coordinated teardown/swap across every connected session,
    // time-bounded so a stall rolls it back. Every host
    // — INCLUDING the issuing one — runs `replaceProvider` on its own idle-gated
    // applicator: under a SINGLE held command lock it removes the old version,
    // quiesces (fills its barrier slot), then awaits the shared `whenDecided`
    // before adding whatever the barrier decides — so no request interleaves the
    // swap on any session and no two versions coexist. Returns immediately once
    // the barrier is wired; the swap resolves to COMMIT (add `v2`) once
    // the last host quiesces and verify-0 confirms the shared old refcount is 0 —
    // or to ROLLBACK (`v1` restored, `v2` discarded) on a quiesce timeout. A
    // per-host failure is treated as a quiesce so a failed/gone session never
    // wedges it. Every remove leg preserves each session's enable preference
    // (dropConfig=false): an update is a version bump, not a removal.
    function startReplace(params: {
        name: string;
        oldProvider: AppAgentProvider;
        issuingHost: AppAgentHost;
        // The new (`v2`) version to add on commit.
        newProvider: AppAgentProvider;
        // Flip the entry (+ restore the record on rollback) at release.
        onDecided: (outcome: ReplaceOutcome) => void;
        // Prune the superseded install root once the outcome is decided.
        finalizeGc: (outcome: ReplaceOutcome) => void;
        // Report the terminal outcome to the issuing conversation.
        onOutcome?: ((status: UpdateOutcomeStatus) => void) | undefined;
    }): void {
        const {
            name,
            oldProvider,
            issuingHost,
            newProvider,
            onDecided,
            finalizeGc,
            onOutcome,
        } = params;
        // The issuing host is always part of the barrier even if it never
        // formally connected (defensive); it is otherwise treated as a sibling.
        const targets = fanOutTargets(issuingHost);
        let resolveDecided!: () => void;
        const whenDecided = new Promise<void>((resolve) => {
            resolveDecided = resolve;
        });
        const barrier: ReplaceBarrier = {
            name,
            oldProvider,
            newProvider,
            pending: new Set(targets),
            whenDecided,
            resolveDecided,
            onDecided,
            finalizeGc,
            onOutcome,
            outcome: undefined,
            quiesceTimer: undefined,
        };
        entries.set(name, {
            status: "removing",
            barrier,
        });

        // Phase-1 backstop: a straggler that won't idle or
        // a `v1` that won't terminate (verify-0 never passes) rolls back.
        barrier.quiesceTimer = setTimeout(
            () => rollback(barrier, "quiesce timeout"),
            quiesceTimeoutMs,
        );

        for (const host of targets) {
            host.replaceProvider(
                oldProvider,
                async () => {
                    quiesce(name, host);
                    await whenDecided;
                    return decideAdd(barrier);
                },
                true,
                // dropConfig=false: an update is a version bump, so every
                // session's per-session enable preference is preserved.
                false,
            ).then(
                () => {
                    // A host that was already closed at enqueue time auto-acks
                    // without running the replacement resolver. Quiesce here too
                    // (idempotent — `pending.delete` guards it) so such a host
                    // fills its phase-1 slot from the success path and never
                    // wedges the barrier until the quiesce timeout.
                    quiesce(name, host);
                },
                (e: unknown) => {
                    // A per-host teardown/add failure must not wedge the barrier:
                    // unblock phase 1 (if the remove leg threw).
                    debug(`replaceProvider failed for '${name}': ${e}`);
                    quiesce(name, host);
                },
            );
        }
    }

    // Fan out an add to every connected session: every
    // host — INCLUDING the issuing one — enqueues the add on its own idle-gated
    // applicator and is notified with a system message; none is applied inline
    // under a held command lock. Each session derives the agent's enabled
    // state from its own config with the manifest default as fallback.
    // A per-host throw is caught and logged, never failing the committed op.
    // Returns immediately; each add lands at that session's next idle.
    function fanOutAdd(
        provider: AppAgentProvider,
        issuingHost: AppAgentHost,
    ): void {
        const targets = fanOutTargets(issuingHost);
        for (const host of targets) {
            host.addProvider(provider, true).catch((e) => {
                debug(`addProvider failed: ${e}`);
            });
        }
    }

    const source: InstalledAgentSourceApi = {
        async install(
            nameOrTarget: string,
            ref: string | undefined,
            sourceName: string | undefined,
            issuingHost: AppAgentHost,
            onStatus?: SourceStatus,
            abortSignal?: AbortSignal,
        ): Promise<InstallResult> {
            const explicit = ref !== undefined;
            // Explicit (two-argument) mode knows the installed name up front, so
            // fail fast on a built-in / busy / draining name before resolving.
            if (explicit) {
                if (isBuiltin(nameOrTarget)) {
                    throw new Error(
                        `Agent '${nameOrTarget}' is built-in and cannot be shadowed by an install`,
                    );
                }
                assertNameFree(nameOrTarget);
                busy.add(nameOrTarget);
            }
            let inferredBusy: string | undefined;
            try {
                // resolve + materialize is serialized by the registry's limiter.
                // In infer mode this derives the installed name from the resolved
                // package; in explicit mode it stamps the supplied name. Collect
                // any non-fatal source warnings raised during resolve.
                const warningSet = new Set<string>();
                const resolved = await registry.resolve(
                    nameOrTarget,
                    ref,
                    sourceName,
                    (m) => warningSet.add(m),
                    onStatus,
                    abortSignal,
                );
                const record = resolved.record;
                const name = record.name;
                // Infer (one-argument) mode learns the name only now: run the
                // same built-in / busy / draining guards on the derived name.
                // These are synchronous (no await between deriving the name and
                // reserving it), so a concurrent op cannot slip in.
                if (!explicit) {
                    if (isBuiltin(name)) {
                        throw new Error(
                            `Agent '${name}' is built-in and cannot be shadowed by an install`,
                        );
                    }
                    assertNameFree(name);
                    busy.add(name);
                    inferredBusy = name;
                }
                // Build the shared per-agent provider AND structurally validate
                // its freshly-materialized manifest BEFORE persisting: a
                // corrupt/unresolvable agent — from
                // ANY source (feed, catalog `module`, or local `path`) — fails
                // here, so a broken agent is never recorded.
                const provider = await buildValidatedAgentProvider(
                    name,
                    record,
                );
                // Persist the record under the same serialization domain. The
                // serialized write is the true install-vs-install collision
                // point: a second install (including another one-argument
                // install that resolved to the same inferred name) cannot enter
                // until the first commits, so the existing-agent check catches it.
                await limiter(async () => {
                    mutateAgentsJson((agents) => {
                        if (agents[name] !== undefined) {
                            throw new Error(`Agent '${name}' already exists`);
                        }
                        agents[name] = record;
                    });
                });
                // Mark the name active so later connects vend it.
                entries.set(name, { status: "active", provider });
                // Fan out the add to every connected session — including the
                // issuing one — through each session's idle-gated applicator.
                fanOutAdd(provider, issuingHost);
                const result: InstallResult = {
                    name,
                    source: record.source,
                    matchedByName: resolved.matchedByName,
                };
                // The source kind (path / catalog / feed) for user-facing
                // messages; the built source knows its own kind.
                const sourceKind = registry.get(record.source)?.kind;
                if (sourceKind !== undefined) {
                    result.sourceKind = sourceKind;
                }
                if (resolved.packageName !== undefined) {
                    result.packageName = resolved.packageName;
                }
                if (record.path !== undefined) {
                    result.path = record.path;
                }
                // Only surface a durable ref for feed (`module`) installs, whose
                // ref is the user-facing feed specifier. A catalog record's ref
                // is the internal key, which is never shown.
                if (record.module !== undefined && record.ref !== undefined) {
                    result.ref = record.ref;
                }
                if (warningSet.size > 0) {
                    result.warnings = [...warningSet];
                }
                return result;
            } finally {
                if (inferredBusy !== undefined) {
                    busy.delete(inferredBusy);
                }
                if (explicit) {
                    busy.delete(nameOrTarget);
                }
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
            // Serialize on the name; reject if it is already tearing down or
            // busy. `busy` covers only this synchronous prologue; the `draining`
            // tombstone below covers the subsequent async drain.
            assertNameFree(name);
            busy.add(name);
            try {
                const deletedRecord = readAgentsJson(instanceDir)?.agents[name];
                if (deletedRecord === undefined) {
                    throw new Error(`Agent '${name}' not found`);
                }
                // The version-scoped root to reclaim once the agent is confirmed
                // down everywhere.
                const uninstalledRoot = deletedRecord.installRoot;
                const entry = entries.get(name);

                // Invariant: a recorded name is `active` in this source (a name
                // mid-teardown — `removing`/`draining` — was already rejected by
                // `assertNameFree` above). Reaching here with no active entry
                // means `agents.json` and this source's live set disagree, which
                // can only come from an OUT-OF-BAND mutation of the store: the
                // instance-dir lock keeps one process per `agents.json`, and both
                // multi-dispatcher hosts (agent server + web API) run a single
                // shared source per process, so no concurrent sibling source can
                // add a record this source never seeded. Fail loudly rather than
                // silently mutating the store on an inconsistency.
                if (entry?.status !== "active") {
                    throw new Error(
                        `Agent '${name}' is recorded but not active in this source; the install store may have been modified out of band.`,
                    );
                }
                const provider = entry.provider;

                // Mark the name `draining` so a session that connects mid-teardown
                // PARKS (never loads the going-away agent — which would re-hold the
                // shared process after we verified it down) and concurrent
                // mutations are rejected, until the teardown settles. The record
                // stays on disk until success, so a crash mid-teardown recovers to
                // the still-installed agent.
                let resolveDone!: () => void;
                const whenDone = new Promise<void>((resolve) => {
                    resolveDone = resolve;
                });
                entries.set(name, { status: "draining", whenDone });

                // Fan the unload out to every connected session — INCLUDING the
                // issuing one — mirroring how install fans an add out; each host
                // unloads under its own idle-gated command lock and is notified
                // ("Agent 'x' was removed."). dropConfig=true clears each
                // session's persisted enable preference so a fresh reinstall
                // starts from the manifest default.
                const drains = [...fanOutTargets(issuingHost)].map((host) =>
                    host.removeProvider(provider, true, true),
                );

                // The issuing session's OWN unload is enqueued behind THIS command
                // on the same command lock, so it can only run once this command
                // returns — we must not await it inline (that would deadlock). So
                // finalize in a detached continuation: free the name once every
                // session has unloaded (the shared provider is refcounted, so the
                // last unload closing the process IS verify-0, for free), or
                // revert on a wedged-session timeout. This is why uninstall
                // returns "started" and the terminal outcome arrives via
                // `onOutcome`.
                void (async () => {
                    let timer: ReturnType<typeof setTimeout> | undefined;
                    const timedOut = new Promise<"timeout">((resolve) => {
                        timer = setTimeout(
                            () => resolve("timeout"),
                            quiesceTimeoutMs,
                        );
                    });
                    // `allSettled` absorbs a per-host unload failure (still
                    // "settled") so one bad session never wedges the teardown;
                    // only a session that never idles trips the timeout.
                    const outcome = await Promise.race([
                        Promise.allSettled(drains).then(
                            () => "drained" as const,
                        ),
                        timedOut,
                    ]);
                    if (timer !== undefined) {
                        clearTimeout(timer);
                    }
                    try {
                        if (outcome === "timeout") {
                            // A session never idled to run its unload, so the
                            // shared process may still be live there. Do NOT free
                            // the name over a possibly-running process: re-add
                            // everywhere (responsive sessions that already unloaded
                            // restore it; a wedged one still holds it) and keep the
                            // record, as if the uninstall never happened.
                            entries.set(name, { status: "active", provider });
                            fanOutAdd(provider, issuingHost);
                            debug(
                                `uninstall of '${name}' timed out; reverted (a session did not idle)`,
                            );
                            onOutcome?.("reverted");
                            return;
                        }
                        // Every session unloaded ⇒ the shared process is down:
                        // free the name (drop the record + entry) and prune the
                        // version-scoped root if no other agent references it.
                        mutateAgentsJson((agents) => {
                            delete agents[name];
                        });
                        entries.delete(name);
                        pruneRootIfUnreferenced(uninstalledRoot, name);
                        onOutcome?.("uninstalled");
                    } catch (e) {
                        // Never strand the name in `draining` on an unexpected
                        // failure (e.g. a record-write error): restore it active so
                        // the agent stays consistently installed.
                        entries.set(name, { status: "active", provider });
                        debug(
                            `uninstall of '${name}' failed to finalize: ${e}`,
                        );
                    } finally {
                        resolveDone();
                    }
                })();
            } finally {
                busy.delete(name);
            }
        },
        async update(
            name: string,
            range: string | undefined,
            issuingHost: AppAgentHost,
            onOutcome?: (status: UpdateOutcomeStatus) => void,
        ): Promise<void> {
            if (isBuiltin(name)) {
                throw new Error(
                    `Agent '${name}' is built-in and cannot be updated`,
                );
            }
            // Serialize on the name; reject if it is draining or busy.
            assertNameFree(name);
            busy.add(name);
            try {
                // Look up the recorded provenance and ask its source to update
                // it. The source-owned update runs first; the old record is
                // overwritten only after it succeeds, so a failed update is a
                // no-op.
                const existing = readAgentsJson(instanceDir)?.agents[name];
                if (existing === undefined) {
                    throw new Error(`Agent '${name}' not found`);
                }
                const updateResult = await registry.update(existing, {
                    range,
                });
                const resolved = updateResult.record;
                const record: InstalledAgentRecord = { ...resolved, name };
                // Persist the v2 record only at the barrier COMMIT (in
                // `onDecided` below), NOT here: while the swap is in flight the
                // recorded-current version must stay v1, so a crash mid-swap
                // recovers to v1 (the already-materialized v2 root is then an
                // orphan the startup sweep reclaims) instead of coming up on an
                // unverified v2 with v1 already pruned. A
                // failed materialize above is a no-op that leaves v1 intact.
                const writeInstalledRecord = () => {
                    mutateAgentsJson((agents) => {
                        agents[name] = record;
                    });
                };
                // Same-version no-op: a source-owned update that lands on a
                // byte-identical content-addressed install root means
                // the exact same package+version is already installed and serving
                // — the disruptive barrier swap would tear the live agent down
                // and bring the identical version back up for nothing. Skip it:
                // refresh the record (the resolve may pin a moving tag/range to a
                // concrete ref) and report success without touching the live
                // provider or GC. Gated on `installRoot` being DEFINED so
                // path/catalog/legacy records (no root) always re-swap and still
                // pick up an in-place manifest edit.
                if (updateResult.status === "no-op") {
                    writeInstalledRecord();
                    // Nothing swapped in any session, so the cross-session
                    // fan-out has nothing to announce; report the no-op to the
                    // issuing conversation directly so `@package update` on an
                    // already-current agent is not silent.
                    onOutcome?.("unchanged");
                    return;
                }
                // Coordinated update: tear the OLD
                // version down across every session and add the NEW one as ONE
                // coordinated barrier — each session's `replaceProvider` removes
                // v1 then (after verify-0 confirms v1 is down everywhere) adds v2,
                // all under one held command lock, so no two versions of the name
                // ever coexist and no session observes it absent. No-coexistence
                // is REQUIRED because an agent's persisted storage is keyed by
                // agent name and cannot be shared, so two versions loaded at once
                // would collide on that storage. The barrier passes
                // dropConfig=false so the version bump preserves each session's
                // per-session enable preference. The update
                // is time-bounded: a straggler that won't idle or a v1 that won't
                // die ROLLS BACK to v1 — v2 is discarded and v1 stays
                // the recorded-current version, as if it never happened.
                const oldEntry = entries.get(name);
                // Build v2's provider AND structurally validate its
                // freshly-materialized manifest while v1 is still live: a
                // corrupt/unresolvable v2 — from ANY source (feed,
                // catalog `module`, or local `path`) — fails HERE (the update
                // rejects, v1 untouched, v2's root left for the startup sweep)
                // rather than committing and failing per-session with v1 already
                // pruned.
                const newProvider = await buildValidatedAgentProvider(
                    name,
                    record,
                );
                // The OLD (v1) version's install root, kept intact until the
                // swap succeeds so a rollback can restart v1, and
                // pruned once the swap commits — v1 is already fully unloaded
                // everywhere (verify-0 passed before commit) AND no other agent
                // still references it (content-addressed roots are shared, so the
                // prune is refcount-guarded). The new root differs
                // whenever the version changed (roots are keyed
                // `module@version`); an update that resolves the same version is
                // a no-op handled above and never reaches the barrier.
                const oldRoot = existing.installRoot;
                const newRoot = record.installRoot;
                if (oldEntry?.status === "active") {
                    startReplace({
                        name,
                        oldProvider: oldEntry.provider,
                        issuingHost,
                        newProvider,
                        onDecided: (outcome) => {
                            if (outcome === "committed") {
                                // Flip in-memory FIRST (never throws) so the name
                                // is never stranded in `removing` (the tombstone
                                // would otherwise brick it), then persist v2 — the
                                // durable commit point. If that write
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
                                // happened.
                                entries.set(name, {
                                    status: "active",
                                    provider: oldEntry.provider,
                                });
                            }
                        },
                        finalizeGc: (outcome) => {
                            // Prune the superseded root only after every host has
                            // swapped: v1 is never pruned before v2 is
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
                                    oldRoot !== newRoot
                                ) {
                                    pruneRootIfUnreferenced(oldRoot, name);
                                }
                            } else if (oldRoot !== newRoot) {
                                pruneRootIfUnreferenced(newRoot, name);
                            }
                        },
                        onOutcome,
                    });
                } else {
                    // No live old version to tear down: commit v2 directly (write
                    // the record + add to every session); there is no barrier
                    // (nothing to coordinate), so report the final status
                    // directly.
                    writeInstalledRecord();
                    entries.set(name, {
                        status: "active",
                        provider: newProvider,
                    });
                    if (oldRoot !== record.installRoot) {
                        pruneRootIfUnreferenced(oldRoot, name);
                    }
                    fanOutAdd(newProvider, issuingHost);
                    onOutcome?.("updated");
                }
            } finally {
                busy.delete(name);
            }
        },
        sourceCommands() {
            // The host owns the entire `@package source` command set (list/order/
            // where/remove/add): the kind taxonomy, typed flags, validation, and
            // any auth UI. The dispatcher core merges this table in under
            // `@package` as `source`.
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
            // an installed agent anymore.
            const agents = readAgentsJson(instanceDir)?.agents ?? {};
            return Object.values(agents)
                .filter((record) => {
                    // Hide a name that is mid-teardown (an update swap or an
                    // uninstall drain) — it is no longer a stable installed agent.
                    const status = entries.get(record.name)?.status;
                    return status !== "removing" && status !== "draining";
                })
                .map((record) => {
                    const ref = record.ref ?? record.module ?? record.path;
                    return {
                        name: record.name,
                        source: record.source,
                        ...(ref !== undefined ? { ref } : {}),
                    };
                });
        },
        listSources(): string[] {
            // Source names in resolution order, for `@package install --source`
            // completion.
            return registry.list().map((info) => info.name);
        },
        async listAvailableAgents(opts?: {
            sourceName?: string;
        }): Promise<AvailableInstallRow[]> {
            // Source-aware install rows for `@package available` and filtered
            // completion in `@package install`.
            const rows: AvailableInstallRow[] = [];
            for (const info of registry.list()) {
                if (
                    opts?.sourceName !== undefined &&
                    info.name !== opts.sourceName
                ) {
                    continue;
                }
                const src = registry.get(info.name);
                if (src?.listAgents === undefined) {
                    continue;
                }
                try {
                    rows.push(...(await src.listAgents()));
                } catch (e) {
                    debug(`listAgents failed for source '${info.name}': ${e}`);
                }
            }
            return rows;
        },
        async preview(
            nameOrTarget: string,
            ref: string | undefined,
            sourceName: string | undefined,
            onStatus?: SourceStatus,
        ): Promise<InstallPreview | undefined> {
            // Dry-run: reuse the registry's pre-materialize walks so the preview
            // can never drift from install; nothing is installed here.
            const result = await registry.preview(
                nameOrTarget,
                ref,
                sourceName,
                undefined,
                onStatus,
            );
            if (result === undefined) {
                return undefined;
            }
            const toMatch = (m: PreviewMatch): InstallPreviewMatch => {
                // The registry only commits to name-vs-ref; the finer label is
                // derived here from the resolved candidate's own fields.
                const matchKind: InstallMatchKind = deriveMatchKind({
                    matchedByName: m.matchedByName,
                    path: m.candidate.path,
                });
                const im: {
                    source: string;
                    sourceKind?: string;
                    matchKind: InstallMatchKind;
                    name: string;
                    packageName?: string;
                    path?: string;
                    ref?: string;
                } = { source: m.source, matchKind, name: m.name };
                const sourceKind = registry.get(m.source)?.kind;
                if (sourceKind !== undefined) {
                    im.sourceKind = sourceKind;
                }
                if (m.candidate.packageName !== undefined) {
                    im.packageName = m.candidate.packageName;
                }
                if (m.candidate.path !== undefined) {
                    im.path = m.candidate.path;
                }
                if (
                    m.candidate.module !== undefined &&
                    m.candidate.ref !== undefined
                ) {
                    im.ref = m.candidate.ref;
                }
                return im;
            };
            return {
                winner: toMatch(result.winner),
                matches: result.matches.map(toMatch),
            };
        },
        async refresh(sourceName?: string): Promise<void> {
            // Refresh cache-backed source metadata; a fetch failure propagates
            // so the `--refresh` command fails rather than acting on stale data.
            await registry.refresh(sourceName);
        },
    };

    // The dispatcher-facing AppAgentSource API is connect(); the write API is
    // captured by the per-session `@package` agent below. The
    // concrete object keeps an unadvertised test handle for focused unit tests,
    // but the exported constructor returns only AppAgentSource.
    const appAgentSource: InstalledAgentSourceForTest = {
        testApi: source,
        connect(host: AppAgentHost): AppAgentConnection {
            // The package agent is per-connection (its agentContext carries this
            // session's AppAgentHost); the installed providers are shared.
            const packageProvider = createPackageAppAgentProvider({
                appAgentHost: host,
                source,
            });
            // Torn down before the initial set resolved: a connection disposed
            // while still parked on an in-flight barrier must NOT join the
            // fan-out set when it finally wakes.
            let disposed = false;
            // Resolve this session's initial provider set: park until no
            // teardown/swap barrier is in flight, THEN — in ONE synchronous
            // step — join the fan-out client set and snapshot the active
            // providers. Joining at a quiet moment means this session is
            // never a participant in a swap it raced, and the snapshot already
            // reflects every decided outcome (`v2` on a committed update, absent
            // on an uninstall, `v1` on a rollback) with no separate late-joiner
            // fold. The dispatcher awaits this UNDER its held command lock during
            // connect, so it neither loads a doomed version (verify-0 pollution)
            // nor runs a command while an agent is mid-swap; any fan-out that
            // arrives once we join is queued behind the initial install (FIFO).
            // The barriers decide independently (bounded by their quiesce
            // timeout), so this never hangs.
            const resolveProviders = async (): Promise<AppAgentProvider[]> => {
                // Loop rather than snapshot-once: a fresh drain can start (on
                // another name) while we park, so re-check after each wait and
                // only join+snapshot once the set is quiet.
                while (true) {
                    if (disposed) {
                        return [];
                    }
                    const inFlight: Promise<void>[] = [];
                    for (const entry of entries.values()) {
                        if (entry.status === "removing") {
                            inFlight.push(entry.barrier.whenDecided);
                        } else if (entry.status === "draining") {
                            inFlight.push(entry.whenDone);
                        }
                    }
                    if (inFlight.length === 0) {
                        // Atomic (synchronous) join + snapshot: no barrier can
                        // start between these two statements, so client
                        // membership and the snapshot agree exactly. A session
                        // that installs an agent while we parked lands it in this
                        // snapshot; one that installs after we join gets it via
                        // fan-out — exactly once either way.
                        clients.add(host);
                        return [packageProvider, ...activeProviders()];
                    }
                    await Promise.all(inFlight);
                }
            };
            const providers = resolveProviders();
            return {
                providers,
                dispose() {
                    // Abandon a still-parked join so a late wake never adds this
                    // host to the fan-out set after teardown.
                    disposed = true;
                    // Deregister this host from the fan-out registry (a no-op if
                    // it never finished joining). Does NOT tear down the shared
                    // providers — other sessions still hold them; the dispatcher
                    // unregisters them from its own manager at teardown.
                    clients.delete(host);
                    // Disconnect while a teardown/swap is in flight: a gone
                    // session has removed everything, so drop it
                    // from every barrier's pending set (which may complete one).
                    // Only relevant for a barrier this host actually joined as a
                    // participant (it was in `clients` before that barrier
                    // started); a barrier it merely parked on never listed it in
                    // `pending`, so the `quiesce` there is a no-op.
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
                        // disconnect is always safe.
                        const entry = entries.get(name);
                        if (entry?.status === "removing") {
                            maybeAdvance(entry.barrier);
                        }
                    }
                },
            };
        },
    };
    return appAgentSource;
}

/**
 * Build indexing service registry from all available app agent providers
 * @param instanceDirOrConfigProvider - Either a string pointing to the instance directory where external agent config is stored, or a InstanceConfigProvider.
 * @param configName - Optional config name to load specific configuration file (e.g. "test" to load "config.test.json"). If not provided, it will load "config.json".
 * @returns IndexingServiceRegistry containing all registered indexing services
 */
// code-complexity-allow: aggregates indexing services across all agent providers
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
    // the static installed provider list too.
    const instanceConfigs =
        typeof instanceDirOrConfigProvider === "string"
            ? getInstanceConfigProvider(instanceDirOrConfigProvider)
            : instanceDirOrConfigProvider;
    providers.push(
        ...getInstalledAppAgentProviders(instanceConfigs, configName),
    );
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

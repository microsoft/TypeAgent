// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Concrete install-source *config* taxonomy plus the host-side `InstallSource`,
// `InstallSourceInfo`, and the install-record shapes (`ResolvedCandidate` /
// `InstalledAgentRecord`). These are owned by the host
// (default-agent-provider), NOT the dispatcher core: the core knows nothing
// about how sources are configured, listed, resolved, or recorded - it only
// contributes the live-session `@install`/`@uninstall`/`@update` commands and
// receives the whole `@source` command table from the host via
// `InstalledAgentSourceApi.sourceCommands()`. Keeping these here frees the core of
// npm / Azure Artifacts vocabulary (registry URLs, scopes, catalog paths) and
// lets the host own how a source is added, listed, ordered, removed, and
// persisted - including any future auth UI.

/**
 * The result of a source's `find`: which source matched and how the agent
 * should be acquired. A match is a commitment - if `find` returns a candidate,
 * `materialize` must succeed (design §4.1, Q4). The registry's `find ->
 * materialize` handoff type; not seen outside this implementation.
 */
export interface ResolvedCandidate {
    source: string; // which source matched
    module?: string; // package name (npm-resolved; omitted when path-resolved)
    ref?: string; // feed specifier/version
    path?: string; // catalog / path result
    // Opaque, kind-specific metadata for the loader named by the resulting
    // record's `kind` (e.g. npm: `{ execMode }`). Interpreted by the owning
    // source/loader, not by generic code.
    loaderConfig?: Record<string, unknown>;
}

/**
 * The subdirectory under `installDir` that holds the per-agent, version-scoped
 * install roots (design §5.5). Each feed install materializes into its own
 * `installDir/<AGENT_INSTALL_ROOTS_SUBDIR>/<installRoot>/node_modules/...` so a
 * new version never clobbers a still-running one; the startup orphan sweep and
 * prune-on-swap GC operate on this directory alone (never the legacy shared
 * `installDir/node_modules`, the marker `package.json`, or feed caches).
 */
export const AGENT_INSTALL_ROOTS_SUBDIR = "agents";

/**
 * The single shape the installed-agent provider loads (design §4.2) and the
 * `agents.json` persistence schema. A record carries exactly one resolution
 * handle: `module` (package name, npm-resolved) OR `path` (filesystem-resolved).
 * The presence of `path` is the load-time discriminator (§12 Q17).
 */
export interface InstalledAgentRecord {
    name: string; // dispatcher agent name
    kind: string; // loading mechanism; "npm" today (reserved seam, see §10)
    module?: string; // package name; present only for npm-resolved records
    path?: string; // present for catalog / path installs
    source: string; // provenance, required
    ref?: string; // feed specifier/version
    // The per-agent, version-scoped install root leaf name (design §5.5): the
    // subdir under `installDir/<AGENT_INSTALL_ROOTS_SUBDIR>/` a feed install
    // materialized into, so the provider derives its require-root from the
    // record instead of the shared `installDir`. Present only for feed
    // (`module`) installs that own a dedicated root; ABSENT for `path`
    // (absolute), bundled/catalog, and legacy pre-version-scoping records — the
    // provider falls back to the shared `installDir` for those (back-compat).
    installRoot?: string;
    // The concrete resolved version read from the installed package.json at
    // materialize time (design §5.5), informational (display / diagnostics).
    // Optional/back-compat: absent for path/catalog/legacy records.
    version?: string;
    // Opaque, kind-specific metadata interpreted by the loader named by `kind`
    // (e.g. npm: `{ execMode }`).
    loaderConfig?: Record<string, unknown>;
}

/**
 * Source-produced record data before the installer assigns the authoritative
 * dispatcher name.
 */
export type MaterializedInstallRecord = Omit<InstalledAgentRecord, "name">;

/**
 * A per-operation sink a source calls to surface a non-fatal degrade (e.g. a
 * corrupt catalog file or a dropped malformed entry) so the host can show it to
 * the user for the command that triggered it (`@package install`, `@source
 * where`). Distinct from the source's own process-lifetime debug/console log:
 * this is scoped to the current resolve so the warning is surfaced once per
 * command rather than once per process.
 */
export type SourceWarning = (message: string) => void;

/**
 * A per-operation sink the registry's ordered resolution walk calls to report
 * progress - which source it is currently probing - so the host can surface a
 * live status line for the triggering command (`@package install`, `@source
 * where`). Like {@link SourceWarning} it is scoped to the current resolve, not
 * the process.
 */
export type SourceStatus = (message: string) => void;

/**
 * The terminal outcome the issuing conversation is told about after a coordinated
 * `@update` settles asynchronously (design §5.3, §5.4). `updated` = the swap
 * committed to `v2`; `cancelled-reverted` = an out-of-band abort rolled back to
 * `v1`; `failed-reverted` = a phase timeout / a `v2` that would not start rolled
 * back to `v1`. Both reverted outcomes leave `v1` serving in every session.
 */
export type UpdateOutcomeStatus =
    | "updated"
    | "cancelled-reverted"
    | "failed-reverted";

/**
 * The terminal outcome the issuing conversation is told about after a coordinated
 * `@uninstall` settles asynchronously (design §5.3, §5.4). `uninstalled` = the
 * teardown committed and the name is free; `reverted` = a phase timeout rolled
 * back and the agent is still installed and serving in every session.
 */
export type UninstallOutcomeStatus = "uninstalled" | "reverted";

/**
 * The three install-source kinds (design §3). There is deliberately no
 * `builtin` kind: the bundled agents that ship in the app are a separate static
 * provider, not an install source (they are never installed/uninstalled/
 * updated). Install sources only resolve user-installed agents.
 */
export type InstallSourceKind = "path" | "catalog" | "feed";

/**
 * A `path` source validates a filesystem path the user supplies. `ref` is a
 * filesystem path; `find` is a `stat` (instant); not enumerable.
 */
export interface PathSourceConfig {
    kind: "path";
    name: string; // conventionally "path"
    baseDir?: string; // base for relative refs; no default (relative ref without it is a non-match)
}

/**
 * A `feed` source resolves agents from an npm package registry (e.g. Azure
 * Artifacts). `ref` is an npm specifier / name; `find` is a membership check
 * against a cached package list; enumerable (cached list).
 *
 * `registry` and `scopes` are declarative config only. How the implementation
 * authenticates to and installs from the registry is private to the concrete
 * feed source (see feedAuth.ts / feedSource.ts).
 */
export interface FeedSourceConfig {
    kind: "feed";
    name: string; // e.g. "typeagent"
    // Optional: when omitted, the source resolves registry/scopes from
    // TYPEAGENT_FEED_REGISTRY / TYPEAGENT_FEED_SCOPES.
    registry?: string; // Azure Artifacts npm registry URL
    scopes?: string[]; // e.g. ["@typeagent"]
}

/**
 * A `catalog` source looks up a JSON list of available agents (name ->
 * `NpmAppAgentInfo`). `ref` is an agent short name; `find` is a map lookup
 * (instant); enumerable. Nothing in a catalog is installed automatically; a
 * catalog only resolves an agent on explicit `@install`.
 *
 * The catalog is a local filesystem path; remote URLs are not supported (§12
 * Q19). Relative package paths resolve against the catalog's dir.
 */
export interface CatalogSourceConfig {
    kind: "catalog";
    name: string; // e.g. "workspace"
    catalog: string; // local filesystem path to the catalog JSON
}

export type InstallSourceConfig =
    | PathSourceConfig
    | FeedSourceConfig
    | CatalogSourceConfig;

/**
 * The host-rendered summary of one configured source for `@source list`.
 * `kind` and `detail` are display strings the host produces from the config
 * taxonomy above.
 */
export interface InstallSourceInfo {
    readonly name: string;
    readonly kind: string; // e.g. "feed" / "catalog" / "path"
    readonly detail: string; // one-line summary, e.g. the registry URL
}

/**
 * A live install source built from a host config. Implements a two-phase
 * contract so the registry can probe cheaply (`find`) before doing any real
 * work (`materialize`) (design §4.1). `ResolvedCandidate` /
 * `MaterializedInstallRecord` (defined above) are host-owned record shapes;
 * everything here is host-internal.
 */
export interface InstallSource {
    readonly name: string;
    readonly kind: string;
    /**
     * CHEAP + side-effect free: can this source resolve `ref`? A match is a
     * commitment - if `find` returns a candidate, `materialize` must succeed.
     * Returning `undefined` is a non-match; the registry's ordered walk
     * continues to the next source (§4.1, Q4). `onWarn`, when supplied, is a
     * per-command sink for non-fatal degrade messages (corrupt catalog /
     * dropped entry) so the host can surface them for the triggering command.
     */
    find(
        ref: string,
        onWarn?: SourceWarning,
    ): Promise<ResolvedCandidate | undefined>;
    /**
     * The INVERSE of {@link find}, in candidate space: given the
     * `ResolvedCandidate` this source produced for an agent at install time
     * (recovered by the host from the persisted record), produce a FRESH
     * candidate for the current version - so `@update` never has to know which
     * candidate field is this source's re-resolution handle, or how a version
     * `range` applies (design §5, §12 Q13). The source owns that policy
     * entirely: which handle it reads (`module` / `path` / the catalog key in
     * `ref`), how `opts.range` narrows the target, and validating a corrupt
     * candidate. Because the source speaks only `ref` / `ResolvedCandidate`, the
     * persisted `InstalledAgentRecord` (its dispatcher `name`, loader `kind`)
     * never leaks in - the host maps record <-> candidate.
     *
     * Like `find` this is CHEAP + side-effect free and its match is a
     * commitment (the returned candidate must `materialize`). Returns
     * `undefined` when the agent no longer resolves (path deleted, catalog key
     * gone, feed package removed) so the host can surface a clear "no longer
     * resolvable" error. Optional so a test-double source can omit it (its
     * agents are then not updatable).
     */
    reresolve?(
        candidate: ResolvedCandidate,
        opts?: { range?: string | undefined },
        onWarn?: SourceWarning,
    ): Promise<ResolvedCandidate | undefined>;
    /** Does the actual work (npm install / copy / record data). `opts.installName`
     * is the authoritative dispatcher agent name the install is targeting
     * (the `agents.json` key), so a source can materialize into a per-agent,
     * version-scoped install root (design §5.5). Sources whose materialize is
     * already non-destructive (`path`, `catalog`) ignore it. */
    materialize(
        candidate: ResolvedCandidate,
        opts?: { installName?: string | undefined },
    ): Promise<MaterializedInstallRecord>;
    /** Enumerable sources (`path` is not) advertise their agents. */
    listAgents?(onWarn?: SourceWarning): Promise<string[]>;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The install-source config types plus the host-side `InstallSource`,
// `InstallSourceInfo`, and the install-record shapes (`ResolvedCandidate` /
// `InstalledAgentRecord`). These live in the host (default-agent-provider), not
// the dispatcher core: the core knows nothing about how sources are configured,
// listed, resolved, or recorded - it only exposes the per-session `AppAgentHost`
// the host uses to register and tear down agents. The host contributes the whole
// `@package` command table (`@package install`/`uninstall`/`update`/`list`, with
// the source table nested as `@package source`) via
// `InstalledAgentSourceApi.sourceCommands()`. Keeping these here keeps npm /
// Azure Artifacts details (registry URLs, scopes, catalog paths) out of the
// core, and lets the host decide how a source is added, listed, ordered,
// removed, and persisted, including any future auth UI.

/**
 * The result of a source's `find`: which source matched and how the agent
 * should be acquired. If `find` returns a candidate, `materialize` must
 * succeed. Passed from `find` to `materialize`; not used outside this file.
 */
export interface ResolvedCandidate {
    source: string; // which source matched
    module?: string; // package name (npm-resolved; omitted when path-resolved)
    ref?: string; // feed specifier/version
    path?: string; // catalog / path result
    // The concrete package version this candidate resolves to, when the source
    // can determine it cheaply during `find`/`update`: the feed
    // source reads the packument during the membership check and pins the
    // dist-tag/range to an exact version here. It lets `materialize` name the
    // content-addressed install root (`module@version`) up front and skip the
    // npm install when that root already exists (dedup / same-version
    // no-op). Optional: a source that cannot resolve offline leaves it undefined
    // and `materialize` derives the version from the installed package.json.
    version?: string;
    // Opaque, kind-specific metadata for the loader named by the resulting
    // record's `kind` (e.g. npm: `{ execMode }`). Interpreted by the owning
    // source/loader, not by generic code.
    loaderConfig?: Record<string, unknown>;
}

/**
 * The subdirectory under `installDir` that holds the per-agent, version-scoped
 * install roots. Each feed install materializes into its own
 * `installDir/<AGENT_INSTALL_ROOTS_SUBDIR>/<installRoot>/node_modules/...` so a
 * new version never clobbers a still-running one; the startup orphan sweep and
 * prune-on-swap GC operate on this directory alone (never the legacy shared
 * `installDir/node_modules`, the marker `package.json`, or feed caches).
 */
export const AGENT_INSTALL_ROOTS_SUBDIR = "agents";

/**
 * The single shape the installed-agent provider loads and the
 * `agents.json` persistence schema. A record carries exactly one resolution
 * handle: `module` (package name, npm-resolved) OR `path` (filesystem-resolved).
 * The presence of `path` is the load-time discriminator.
 */
export interface InstalledAgentRecord {
    name: string; // dispatcher agent name
    kind: string; // loading mechanism; "npm" today (reserved for future kinds)
    module?: string; // package name; present only for npm-resolved records
    path?: string; // present for catalog / path installs
    source: string; // provenance, required
    ref?: string; // feed specifier/version
    // The per-agent, version-scoped install root leaf name: the
    // subdir under `installDir/<AGENT_INSTALL_ROOTS_SUBDIR>/` a feed install
    // materialized into, so the provider derives its require-root from the
    // record instead of the shared `installDir`. Present only for feed
    // (`module`) installs that own a dedicated root; ABSENT for `path`
    // (absolute), bundled/catalog, and legacy pre-version-scoping records — the
    // provider falls back to the shared `installDir` for those (back-compat).
    // The concrete resolved version is not stored separately: it is already
    // embedded in `installRoot` (`sanitize(module)@version`).
    installRoot?: string;
    // Opaque, kind-specific metadata interpreted by the loader named by `kind`
    // (e.g. npm: `{ execMode }`).
    loaderConfig?: Record<string, unknown>;
}

/**
 * Source-produced record data before the installer assigns the final
 * dispatcher name.
 */
export type MaterializedInstallRecord = Omit<InstalledAgentRecord, "name">;

/**
 * A source-owned update result. `updated` returns a freshly materialized record
 * that must be swapped in; `no-op` returns the record to persist without a
 * provider swap (e.g. a feed range that resolves to the currently installed
 * concrete version).
 */
export type InstallSourceUpdateResult =
    | { status: "updated"; record: MaterializedInstallRecord }
    | { status: "no-op"; record: MaterializedInstallRecord };

/**
 * A per-command callback a source calls to report a non-fatal problem (e.g. a
 * corrupt catalog file or a dropped malformed entry) so the host can show it to
 * the user for the command that triggered it (`@package install`,
 * `@package source where`). Distinct from the source's own process-lifetime
 * debug/console log: it is scoped to the current resolve, so the warning is
 * shown once per command rather than once per process.
 */
export type SourceWarning = (message: string) => void;

/**
 * A per-command callback the registry's resolution walk calls to report
 * progress - which source it is currently probing - so the host can show a
 * live status line for the triggering command (`@package install`,
 * `@package source where`). Like {@link SourceWarning} it is scoped to the
 * current resolve, not the process.
 */
export type SourceStatus = (message: string) => void;

/**
 * The terminal outcome the issuing conversation is told about after a coordinated
 * `@package update` settles asynchronously. `updated` = the swap
 * committed to `v2`; `reverted` = a phase timeout (a straggler that would not
 * idle, or a `v2` that would not start) rolled back to `v1`, leaving `v1` serving
 * in every session.
 */
export type UpdateOutcomeStatus = "updated" | "reverted";

/**
 * The terminal outcome the issuing conversation is told about after a coordinated
 * `@package uninstall` settles asynchronously. `uninstalled` = the
 * teardown committed and the name is free; `reverted` = a phase timeout rolled
 * back and the agent is still installed and serving in every session.
 */
export type UninstallOutcomeStatus = "uninstalled" | "reverted";

/**
 * The three install-source kinds. There is no
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
 * catalog only resolves an agent on explicit `@package install`.
 *
 * The catalog is a local filesystem path; remote URLs are not supported.
 * Relative package paths resolve against the catalog's dir.
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
 * The host-rendered summary of one configured source for `@package source list`.
 * `kind` and `detail` are display strings the host produces from the config
 * taxonomy above.
 */
export interface InstallSourceInfo {
    readonly name: string;
    readonly kind: string; // e.g. "feed" / "catalog" / "path"
    readonly detail: string; // one-line summary, e.g. the registry URL
}

/**
 * A live install source built from a host config. Two phases so the registry can
 * probe cheaply (`find`) before doing the install (`materialize`).
 * `ResolvedCandidate` / `MaterializedInstallRecord` (defined above) are
 * host-owned record shapes; everything here is host-internal.
 */
export interface InstallSource {
    readonly name: string;
    readonly kind: string;
    /**
     * Cheap and side-effect free: can this source resolve `ref`? If `find`
     * returns a candidate, `materialize` must succeed. Returning `undefined` is
     * a non-match; the registry's ordered walk continues to the next source.
     * `onWarn`, when supplied, is a per-command callback for non-fatal problems
     * (corrupt catalog / dropped entry) so the host can show them for the
     * triggering command.
     */
    find(
        ref: string,
        onWarn?: SourceWarning,
    ): Promise<ResolvedCandidate | undefined>;
    /** Optional source-owned update capability. The common layer only performs
     * source lookup, locking, persistence, and provider swap/no-op orchestration;
     * the source decides whether records it owns are updateable, how `range`
     * applies, what persisted ref should drive future updates, and what counts
     * as an update no-op. */
    update?(
        record: InstalledAgentRecord,
        opts?: { range?: string | undefined },
        onWarn?: SourceWarning,
    ): Promise<InstallSourceUpdateResult>;
    /** Optional source-owned load refresh. A source whose persisted record is a
     * live pointer (for example, a catalog key) can re-read its current source
     * data before the provider is built. Returning `undefined` means the record
     * no longer resolves. Sources with fully materialized records omit this and
     * the common layer loads the persisted record as-is. */
    load?(
        record: InstalledAgentRecord,
        onWarn?: SourceWarning,
    ): MaterializedInstallRecord | undefined;
    /** Performs the install (npm install / copy / record data). A source that
     * needs a per-agent, version-scoped install root names it from the
     * candidate's package name. Sources whose materialize is already
     * non-destructive (`path`, `catalog`) have no such root. `onStatus`, when
     * supplied, is a per-command callback the source calls with live progress
     * messages during a long install (the feed source's `npm install`); sources
     * that materialize instantly ignore it. `abortSignal`, when supplied, lets
     * the caller cancel a long install (the feed source's `npm install`) mid
     * flight; sources that materialize instantly ignore it. */
    materialize(
        candidate: ResolvedCandidate,
        onStatus?: SourceStatus,
        abortSignal?: AbortSignal,
    ): Promise<MaterializedInstallRecord>;
    /** Sources that can list their agents (catalog, feed) implement this; `path` cannot. */
    listAgents?(onWarn?: SourceWarning): Promise<string[]>;
}

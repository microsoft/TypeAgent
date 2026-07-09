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
    // Which source matched.
    source: string;

    // --- Acquisition handles: what `materialize` / `load` use to obtain the
    // agent. Which of these are set is source-owned: a feed sets
    // `module` + `ref` + `version`; a catalog sets `path` (or `module`) + `ref`
    // (the catalog key); a path source sets only `path`. ---
    module?: string; // package name (npm-resolved; omitted when path-resolved)
    path?: string; // filesystem-resolved (catalog `path` entry / path source)
    ref?: string; // durable handle: feed specifier / catalog key
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

    // --- User-facing identity: used for display (`@package available`, success
    // messages) and one-argument install name inference, never as a durable
    // load handle (that is `ref`). ---
    // The user-facing npm package name for catalog and feed matches. Omitted for
    // path-only matches.
    //
    // NOTE: this is deliberately NOT the same field as `module`, even though the
    // two carry the same value whenever both are set (feed matches and catalog
    // module-only entries). `module` is the npm LOAD HANDLE and is undefined for
    // a path-resolved candidate; `packageName` is the display IDENTITY and is
    // also populated for a catalog `path` entry (read from its package.json
    // `name`), where `module` stays undefined. Keeping them separate lets a
    // path-resolved candidate advertise its package identity without ever
    // becoming a module-resolved record.
    packageName?: string;
    // The package's declared `typeagent.defaultAgentName`, when the source can
    // discover it during lookup. Required whenever the installed name is
    // inferred (one-argument install, including path installs). A phase-2 path
    // candidate may leave this unset for the registry to backfill from the
    // resolved directory's package.json before materialization.
    defaultAgentName?: string;
}

/**
 * One enumerable install target advertised by a source for `@package available`
 * and install completion. `ref` is the source's internal durable/identity
 * handle used only to de-duplicate rows - it is never displayed. The invariant
 * is that at least one of `defaultAgentName` / `packageName` is present, so
 * every row has something the user can type into `@package install`.
 */
export interface AvailableInstallRow {
    readonly source: string;
    readonly ref: string; // internal durable/identity handle; dedup key only
    readonly defaultAgentName?: string | undefined; // shown as the install name
    readonly packageName?: string | undefined; // shown as the package; absent for path-only
}

/**
 * How a one/two-argument install target matched, for user feedback. Derived at
 * the display layer from the resolved candidate's own fields - the registry
 * itself only commits to the binary name-vs-ref phase.
 */
export type InstallMatchKind = "defaultAgentName" | "packageName" | "path";

/**
 * Derive the finer user-facing {@link InstallMatchKind} from the binary
 * name-vs-ref phase the registry commits to plus the resolved candidate's own
 * `path`. Shared by the install success message and the dry-run preview so the
 * three-way label is computed in exactly one place.
 */
export function deriveMatchKind(m: {
    matchedByName: boolean;
    path?: string | undefined;
}): InstallMatchKind {
    return m.matchedByName
        ? "defaultAgentName"
        : m.path !== undefined
          ? "path"
          : "packageName";
}

/**
 * One match in a `@package install --dry-run` preview: the source that would
 * match, how it matched, the name it would install as, and the user-facing
 * package identity / path when known.
 */
export interface InstallPreviewMatch {
    readonly source: string;
    readonly matchKind: InstallMatchKind;
    readonly name: string; // dispatcher name it would install as
    readonly packageName?: string;
    readonly path?: string;
    readonly ref?: string; // durable handle
}

/**
 * A `@package install --dry-run` preview: the winning match plus every other
 * match in priority order across both phases (so an incidental shadow is
 * visible). Nothing is installed to produce it.
 */
export interface InstallPreview {
    readonly winner: InstallPreviewMatch;
    readonly matches: InstallPreviewMatch[];
}

/**
 * The result of a committed `@package install` (one- or two-argument). Returned
 * by `InstalledAgentSourceApi.install` and consumed by the command handler to
 * build the success message. `name` is the installed dispatcher name (derived in
 * infer mode, explicit in two-argument mode); `matchedByName` records which
 * resolution phase won; `sourceKind` / `packageName` / `path` / `ref` are the
 * user-facing identity fields, populated only when the winning source knows
 * them.
 */
export interface InstallResult {
    name: string; // installed dispatcher name (derived or explicit)
    source: string;
    sourceKind?: string; // path / catalog / feed, for the success message
    matchedByName: boolean; // which phase won
    packageName?: string; // user-facing package identity when known
    path?: string; // present for a path match (for the match-kind line)
    ref?: string; // durable handle, when it differs from the package
    warnings?: string[];
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
 * The registry's `resolve` result: a fully-named record plus which resolution
 * phase matched. `matchedByName` is `true` when the inferred default-agent-name
 * walk (`findName`) won and `false` when the ref walk (`find`) won. That binary
 * phase is all the registry commits to - the finer user-facing label (default
 * agent name / package name / path) is derived at the display layer from the
 * resolved candidate's own fields. `packageName` carries the user-facing package
 * identity when the winning source populated it.
 */
export interface ResolveResult {
    record: InstalledAgentRecord; // name already assigned
    matchedByName: boolean;
    packageName?: string;
}

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
 * the user for the command that triggered it (`@package install`, including
 * `--dry-run`). Distinct from the source's own process-lifetime
 * debug/console log: it is scoped to the current resolve, so the warning is
 * shown once per command rather than once per process.
 */
export type SourceWarning = (message: string) => void;

/**
 * A per-command callback the registry's resolution walk calls to report
 * progress - which source it is currently probing - so the host can show a
 * live status line for the triggering command (`@package install`, including
 * `--dry-run`). Like {@link SourceWarning} it is scoped to the
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
    /**
     * Optional default-agent-name lookup for one-argument install (phase 1).
     * Matches the package's declared `typeagent.defaultAgentName`. Returning a
     * candidate means this source owns a package whose default agent name equals
     * `name`; returning `undefined` is a non-match and the ordered walk
     * continues. Sources that cannot support default-name lookup (e.g. `path`)
     * omit this. A source that has two entries declaring the same default agent
     * name must throw (ambiguous) rather than pick one.
     */
    findName?(
        name: string,
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
     * non-destructive (`path`, `catalog`) have no such root. */
    materialize(
        candidate: ResolvedCandidate,
    ): Promise<MaterializedInstallRecord>;
    /** Sources that can list their agents (catalog, feed) implement this; `path` cannot.
     * Returns one row per default agent name and/or package name it can offer. */
    listAgents?(onWarn?: SourceWarning): Promise<AvailableInstallRow[]>;
    /** Optional cache-backed metadata refresh. Sources with a cache (feed) fetch
     * fresh metadata and atomically swap it in on success. The prior cache is
     * never destroyed up front, so a failed refresh leaves it intact; the source
     * throws the fetch error so the command can fail rather than guess from stale
     * data. Cacheless sources (path, catalog) omit this. */
    refresh?(onWarn?: SourceWarning): Promise<void>;
}

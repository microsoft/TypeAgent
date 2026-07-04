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
    /** Does the actual work (npm install / copy / record data). */
    materialize(
        candidate: ResolvedCandidate,
    ): Promise<MaterializedInstallRecord>;
    /** Enumerable sources (`path` is not) advertise their agents. */
    listAgents?(onWarn?: SourceWarning): Promise<string[]>;
}

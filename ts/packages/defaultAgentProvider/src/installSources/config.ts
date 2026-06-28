// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Concrete install-source *config* taxonomy plus the host-side `InstallSource`,
// `InstallSourceInfo`, and the install-record shapes (`ResolvedCandidate` /
// `InstalledAgentRecord`). These are owned by the host
// (default-agent-provider), NOT the dispatcher core: the core knows nothing
// about how sources are configured, listed, resolved, or recorded - it only
// contributes the live-session `@install`/`@uninstall`/`@update` commands and
// receives the whole `@source` command table from the host via
// `AppAgentInstaller.sourceCommands()`. Keeping these here frees the core of
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
 * The three install-source kinds (design §3). There is deliberately no separate
 * `builtin` kind: the bundled agents are a `catalog` source whose JSON ships in
 * the app (`catalog: "<bundled>"`).
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
 * `NpmAppAgentInfo` plus an optional `preinstall` flag). `ref` is an agent
 * short name; `find` is a map lookup (instant); enumerable.
 *
 * The catalog is a local filesystem path (or the sentinel `"<bundled>"` for the
 * catalog that ships in the app); remote URLs are not supported (§12 Q19).
 * Relative package paths resolve against the catalog's dir.
 */
export interface CatalogSourceConfig {
    kind: "catalog";
    name: string; // e.g. "builtin", "workspace"
    catalog: string; // local filesystem path to the catalog JSON, or "<bundled>"
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
 * `InstalledAgentRecord` (defined above) are host-owned record shapes;
 * everything here is host-internal.
 */
export interface InstallSource {
    readonly name: string;
    readonly kind: string;
    /**
     * CHEAP + side-effect free: can this source resolve `ref`? A match is a
     * commitment - if `find` returns a candidate, `materialize` must succeed.
     * Returning `undefined` is a non-match; the registry's ordered walk
     * continues to the next source (§4.1, Q4).
     */
    find(ref: string): Promise<ResolvedCandidate | undefined>;
    /** Does the actual work (npm install / copy / record). */
    materialize(candidate: ResolvedCandidate): Promise<InstalledAgentRecord>;
    /** Enumerable sources (`path` is not) advertise their agents. */
    listAgents?(): Promise<string[]>;
}

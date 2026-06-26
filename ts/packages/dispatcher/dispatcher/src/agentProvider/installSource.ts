// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Install-source interfaces (design §3, §4.1, §4.2).
//
// These are pure interfaces that live in the dispatcher core. The concrete
// implementations (path / catalog / feed sources, the registry, feed auth,
// npm install, REST enumeration) live in `default-agent-provider`. The
// dispatcher core never learns what a feed, an npm registry, or `az` is.
//
// Two layers, deliberately distinct:
//   *SourceConfig  - plain declarative data (what's in instance config)
//   InstallSource  - the live runtime object the registry builds from a config

/**
 * The execution mode for a loaded agent. Mirrors the values used by the npm
 * provider's loader (`"separate"` => SeparateProcess, `"dispatcher"` =>
 * DispatcherProcess). Defined here as a string union so the dispatcher core
 * does not depend on `dispatcher-node-providers` (which would be a cycle).
 */
export type ExecutionMode = "separate" | "dispatcher";

/**
 * The three install-source kinds (design §3). There is deliberately no
 * separate `builtin` kind: the bundled agents are a `catalog` source whose
 * JSON ships in the app (`catalog: "<bundled>"`).
 */
export type InstallSourceKind = "path" | "catalog" | "feed";

/**
 * A `path` source validates a filesystem path the user supplies. `ref` is a
 * filesystem path; `find` is a `stat` (instant); not enumerable.
 */
export interface PathSourceConfig {
    kind: "path";
    name: string; // conventionally "path"
    baseDir?: string; // base for relative refs; default cwd / instance dir
}

/**
 * A `feed` source `npm install`s against an Azure Artifacts registry. `ref` is
 * an npm specifier / name; `find` is a membership check against a cached
 * package list; enumerable (cached list).
 *
 * Auth: a short-lived bearer token minted by the Azure CLI
 * (`az account get-access-token`), injected into a transient npm auth config -
 * no persistent .npmrc creds / vsts-npm-auth / azureauth state.
 */
export interface FeedSourceConfig {
    kind: "feed";
    name: string; // e.g. "typeagent"
    registry: string; // Azure Artifacts npm registry URL
    scopes: string[]; // e.g. ["@typeagent", "@secretagents"]
}

/**
 * A `catalog` source looks up a JSON list of available agents (name ->
 * `NpmAppAgentInfo` plus an optional `preinstall` flag). `ref` is an agent
 * short name; `find` is a map lookup (instant); enumerable.
 *
 * The catalog is a local filesystem path (or the sentinel `"<bundled>"` for
 * the catalog that ships in the app); remote URLs are not supported (§12 Q19).
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
 * The result of a source's `find`: which source matched and how the agent
 * should be acquired. A match is a commitment - if `find` returns a candidate,
 * `materialize` must succeed (design §4.1, Q4).
 */
export interface ResolvedCandidate {
    source: string; // which source matched
    module?: string; // package name (npm-resolved; omitted when path-resolved)
    ref?: string; // feed specifier/version
    path?: string; // catalog / path result
    execMode?: ExecutionMode;
}

/**
 * The single shape the provider loads (design §4.2). A record carries exactly
 * one resolution handle: `module` (package name, npm-resolved) OR `path`
 * (filesystem-resolved). The presence of `path` is the load-time discriminator
 * (§12 Q17).
 */
export interface InstalledAgentRecord {
    name: string; // dispatcher agent name
    kind: string; // loading mechanism; "npm" today (reserved seam, see §10)
    module?: string; // package name; present only for npm-resolved records
    path?: string; // present for catalog / path installs
    source: string; // provenance, required
    ref?: string; // feed specifier/version
    execMode?: ExecutionMode;
}

/**
 * A live install source built from an `InstallSourceConfig`. Implements a
 * two-phase contract so the registry can probe cheaply (`find`) before doing
 * any real work (`materialize`) (design §4.1).
 */
export interface InstallSource {
    readonly name: string;
    readonly kind: InstallSourceKind;
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

/**
 * Owns source listing, ordering, configuration, and ordered resolution
 * (design §4.1). `@source` talks to the registry; the installer just uses it.
 */
export interface InstallSourceRegistry {
    list(): InstallSourceConfig[];
    get(name: string): InstallSource | undefined;

    // user-configurable resolution ORDER (first match wins).
    order(): InstallSource[];
    setOrder(names: string[]): void;

    // runtime configuration, persisted to instance config.
    add(config: InstallSourceConfig): void;
    remove(name: string): void;

    // resolve a ref: explicit source, else walk the configured order.
    resolve(ref: string, sourceName?: string): Promise<InstalledAgentRecord>;
    // dry-run: report which source would win without materializing.
    where(ref: string): Promise<ResolvedCandidate | undefined>;
}

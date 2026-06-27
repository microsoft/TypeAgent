// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Concrete install-source *config* taxonomy. These declarative shapes are owned
// by the host (default-agent-provider), NOT the dispatcher core: the core knows
// only the opaque `InstallSourceInfo` it renders for `@source list` and the
// `addSource(spec)` seam it delegates to. Moving these here keeps the core free
// of npm / Azure Artifacts vocabulary (registry URLs, scopes, catalog paths)
// and lets the host own how a source is added - including any future auth UI.

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
    baseDir?: string; // base for relative refs; default cwd / instance dir
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
    registry: string; // Azure Artifacts npm registry URL
    scopes: string[]; // e.g. ["@typeagent", "@secretagents"]
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

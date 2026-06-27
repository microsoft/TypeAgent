// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Install-source interfaces (design §3, §4.1, §4.2).
//
// These are pure interfaces that live in the dispatcher core. The concrete
// implementations (path / catalog / feed sources, the registry, feed auth,
// npm install, REST enumeration) AND the concrete source *config* taxonomy
// (what a feed / catalog / path source is configured with) live in
// `default-agent-provider`. The dispatcher core never learns what a feed, an
// npm registry, or `az` is: it knows only the opaque `InstallSourceInfo` it
// renders for `@source list`. The host owns "how a source is added" - it
// contributes the typed `@source add` command handlers (via
// `AppAgentInstaller.sourceCommands`), including any auth UI.

/**
 * The opaque, host-rendered summary of one configured source for `@source
 * list`. `kind` and `detail` are display strings the host produces; the core
 * does not interpret them (it deliberately does not know the kind taxonomy or
 * each kind's config fields).
 */
export interface InstallSourceInfo {
    readonly name: string;
    readonly kind: string; // host's label, e.g. "feed" / "catalog" / "path"
    readonly detail: string; // host's one-line summary, e.g. the registry URL
}

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
    // Opaque, kind-specific metadata for the loader named by the resulting
    // record's `kind` (e.g. npm: `{ execMode }`). The dispatcher core does not
    // interpret it; the owning provider does.
    loaderConfig?: Record<string, unknown>;
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
    // Opaque, kind-specific metadata interpreted by the loader named by `kind`
    // (e.g. npm: `{ execMode }`). The dispatcher core does not interpret it.
    loaderConfig?: Record<string, unknown>;
}

/**
 * A live install source built from a host config. Implements a two-phase
 * contract so the registry can probe cheaply (`find`) before doing any real
 * work (`materialize`) (design §4.1).
 */
export interface InstallSource {
    readonly name: string;
    readonly kind: string; // host's kind label; the core does not interpret it
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
    // Opaque, host-rendered summaries for `@source list`. The core does not
    // know the kind taxonomy or each kind's config fields.
    list(): InstallSourceInfo[];
    get(name: string): InstallSource | undefined;

    // user-configurable resolution ORDER (first match wins).
    order(): InstallSource[];
    setOrder(names: string[]): void;

    remove(name: string): void;

    // resolve a ref: explicit source, else walk the configured order.
    resolve(ref: string, sourceName?: string): Promise<InstalledAgentRecord>;
    // dry-run: report which source would win without materializing.
    where(ref: string): Promise<ResolvedCandidate | undefined>;
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import semver from "semver";
import {
    InstallSource,
    FeedSourceConfig,
    InstalledAgentRecord,
    MaterializedInstallRecord,
    ResolvedCandidate,
    SourceStatus,
    AGENT_INSTALL_ROOTS_SUBDIR,
} from "./config.js";
import {
    AzTokenRunner,
    getFeedAccessToken,
    writeTransientNpmAuth,
    removeTransientNpmAuth,
} from "./feedAuth.js";

const execFileAsync = promisify(execFile);

// The sentinel keyword an app agent declares in its package.json.
export const AGENT_KEYWORD = "typeagent-agent";

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // ~1h

function resolveFeedRegistry(config: FeedSourceConfig): string | undefined {
    const fromConfig = config.registry?.trim();
    if (fromConfig) {
        return fromConfig;
    }
    const fromEnv = process.env.TYPEAGENT_FEED_REGISTRY?.trim();
    return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

function resolveFeedScopes(config: FeedSourceConfig): string[] {
    if (config.scopes !== undefined) {
        return config.scopes;
    }
    const raw = process.env.TYPEAGENT_FEED_SCOPES;
    if (!raw) {
        return [];
    }
    return raw
        .split(",")
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0);
}

// Strip a trailing version/range from an npm specifier to get the module name.
// "@scope/name@1.2.3" -> "@scope/name"; "name@^1" -> "name".
// @internal Exported for focused tests; runtime use is inside this module.
export function moduleNameFromSpec(spec: string): string {
    const at = spec.lastIndexOf("@");
    return at > 0 ? spec.slice(0, at) : spec;
}

// A syntactically valid npm package name (optionally scoped). Used to reject a
// corrupt record that would otherwise inject shell metacharacters into the
// install spec on the Windows `.cmd` path.
// @internal Exported for focused tests; runtime use is inside this module.
export function isSafeModuleName(name: string): boolean {
    return /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name);
}

// A concrete, published npm version (no range operators) -- the only version
// shape ever handed to `npm install`. Ranges/tags are resolved to one of these
// by `resolveConcreteVersion` BEFORE materialize.
// @internal Exported for focused tests; runtime use is inside this module.
export function isConcreteVersion(version: string): boolean {
    return semver.valid(version) !== null;
}

// A user-supplied `@package update <range>`: either a real semver range (which may
// legitimately contain spaces, `||`, `>`, `<`, `-`) or an npm dist-tag. Anything
// else is rejected early (defense in depth) rather than flowing toward npm; a
// naive metacharacter blocklist would wrongly reject valid `||` OR-ranges, so we
// validate against the real semver-range grammar instead.
// @internal Exported for focused tests; runtime use is inside this module.
export function isSafeVersionRange(range: string): boolean {
    if (range.length === 0) {
        return false;
    }
    if (semver.validRange(range) !== null) {
        return true;
    }
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(range);
}

// Mirrors npm package.json `os` semantics: omitted means compatible, `linux`
// style entries allow only those platforms, and `!win32` style entries deny.
// @internal Exported for focused tests; runtime use is inside this module.
export function isCompatiblePlatform(
    packageOs: unknown,
    platform: NodeJS.Platform = process.platform,
): boolean {
    if (packageOs === undefined) {
        return true;
    }
    const osEntries = Array.isArray(packageOs) ? packageOs : [packageOs];
    const values = osEntries.filter(
        (entry): entry is string => typeof entry === "string",
    );
    if (values.length === 0) {
        return true;
    }
    if (values.includes(`!${platform}`)) {
        return false;
    }
    const allowed = values.filter((entry) => !entry.startsWith("!"));
    return allowed.length === 0 || allowed.includes(platform);
}

// Sanitize an arbitrary label (dispatcher name / module name / source name)
// into a filesystem-safe directory-name component so it can never escape the
// install root or a cache filename.
function sanitizeLabel(label: string): string {
    return label.replace(/[^A-Za-z0-9._-]/g, "_");
}

function installRootFor(moduleName: string, version: string): string {
    return `${sanitizeLabel(moduleName)}@${version}`;
}

// A short, unique, filesystem-safe install-id. Used to
// name the TEMPORARY install root (`.tmp-<id>`) a slow-path materialize installs
// into before atomically adopting it as the content-addressed `module@version`
// root, so concurrent installs never collide on the temp dir.
function makeInstallId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** @internal Arguments passed to the test-only npm installer override. */
export interface NpmInstallArgs {
    spec: string;
    cwd: string;
    registry: string;
    userconfig: string;
}

export interface FeedSourceDeps {
    // npm root all feed installs land in. Holds a
    // private package.json marker; packages go under its node_modules/.
    installDir: string;
    // Test-only overrides used by feed source specs; production callers rely on
    // the default Azure CLI, fetch, npm install, clock, TTL, and cache path.
    tokenRunner?: AzTokenRunner;
    fetchFn?: typeof fetch;
    npmInstall?: (args: NpmInstallArgs) => Promise<void>;
    now?: () => number;
    cacheTtlMs?: number;
    // Override the on-disk cache location (defaults under installDir).
    cacheFilePath?: string;
}

type FeedCache = { fetchedAt: number; packages: string[] };

interface AzureFeedInfo {
    org: string;
    project?: string;
    feed: string;
}

interface AzurePackagesResponse {
    value?: Array<{
        normalizedName?: string;
        name?: string;
    }>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

// Parse an Azure Artifacts npm registry URL into { org, project?, feed }.
// project-scoped: https://pkgs.dev.azure.com/{org}/{project}/_packaging/{feed}/npm/registry/
// org-scoped:     https://pkgs.dev.azure.com/{org}/_packaging/{feed}/npm/registry/
export function parseAzureFeed(registry: string): AzureFeedInfo | undefined {
    const withProject = registry.match(
        /^https:\/\/pkgs\.dev\.azure\.com\/([^/]+)\/([^/]+)\/_packaging\/([^/]+)\/npm\/registry\/?$/i,
    );
    if (withProject) {
        return {
            org: withProject[1],
            project: withProject[2],
            feed: withProject[3],
        };
    }
    const orgScoped = registry.match(
        /^https:\/\/pkgs\.dev\.azure\.com\/([^/]+)\/_packaging\/([^/]+)\/npm\/registry\/?$/i,
    );
    if (orgScoped) {
        return { org: orgScoped[1], feed: orgScoped[2] };
    }
    return undefined;
}

function feedsApiBase(info: AzureFeedInfo): string {
    return info.project
        ? `https://feeds.dev.azure.com/${info.org}/${info.project}`
        : `https://feeds.dev.azure.com/${info.org}`;
}

async function defaultNpmInstall(args: NpmInstallArgs): Promise<void> {
    // Security: on Windows `npm` is a batch shim, so we
    // invoke `npm.cmd` explicitly under a shell (Node refuses to spawn a
    // `.cmd`/`.bat` without `shell:true`). On every other platform we run the
    // real `npm` binary with NO shell, so an argument is never re-parsed. The
    // install `spec` is additionally validated to a strict `name@concrete-
    // version` shape by the caller (see `materialize`), so no shell metacharacter
    // can reach the command line even on the Windows path.
    const isWindows = process.platform === "win32";
    await execFileAsync(
        isWindows ? "npm.cmd" : "npm",
        [
            "install",
            args.spec,
            "--save=false",
            "--registry",
            args.registry,
            "--userconfig",
            args.userconfig,
        ],
        { cwd: args.cwd, shell: isWindows },
    );
}

function ensureInstallRoot(installDir: string): void {
    fs.mkdirSync(installDir, { recursive: true });
    const packageJsonPath = path.join(installDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
        fs.writeFileSync(
            packageJsonPath,
            JSON.stringify(
                { name: "typeagent-installed-agents", private: true },
                null,
                2,
            ),
        );
    }
}

// Walk the paged Azure DevOps Artifacts packages endpoint, filtered to the
// configured scopes.
async function listScopedPackages(
    info: AzureFeedInfo,
    scopes: string[],
    token: string,
    fetchFn: typeof fetch,
): Promise<string[]> {
    const base = feedsApiBase(info);
    const top = 100;
    let skip = 0;
    const names: string[] = [];
    // Walk pages to completion.
    for (;;) {
        const url =
            `${base}/_apis/packaging/feeds/${info.feed}/packages` +
            `?protocolType=Npm&$top=${top}&$skip=${skip}&api-version=7.1-preview.1`;
        const res = await fetchFn(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            throw new Error(
                `Azure Artifacts packages query failed (${res.status} ${res.statusText})`,
            );
        }
        const data = (await res.json()) as AzurePackagesResponse;
        const page = Array.isArray(data.value) ? data.value : [];
        for (const pkg of page) {
            const nameValue = pkg.normalizedName ?? pkg.name;
            const name = typeof nameValue === "string" ? nameValue : undefined;
            if (
                name &&
                (scopes.length === 0 ||
                    scopes.some((s) => name.startsWith(`${s}/`)))
            ) {
                names.push(name);
            }
        }
        if (page.length < top) {
            break;
        }
        skip += top;
    }
    return names;
}

// Read a package's packument keywords and decide whether it is an app agent
// based on the sentinel keyword.
async function isAgentPackage(
    registry: string,
    packageName: string,
    token: string,
    fetchFn: typeof fetch,
): Promise<boolean> {
    const url = `${registry.replace(/\/$/, "")}/${packageName.replace("/", "%2F")}`;
    const res = await fetchFn(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        return false;
    }
    const packument = asRecord(await res.json());
    const keywords: unknown = packument?.keywords;
    return Array.isArray(keywords) && keywords.includes(AGENT_KEYWORD);
}

// Fetch and parse a package's packument. Returns undefined
// on any network / HTTP / parse failure so callers can fall back gracefully
// (offline -> resolve the version at install time instead).
async function fetchPackument(
    registry: string,
    packageName: string,
    token: string,
    fetchFn: typeof fetch,
): Promise<unknown | undefined> {
    const url = `${registry.replace(/\/$/, "")}/${packageName.replace("/", "%2F")}`;
    try {
        const res = await fetchFn(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            return undefined;
        }
        return await res.json();
    } catch {
        return undefined;
    }
}

// Resolve the version part of an npm specifier against a package's packument to
// a single concrete published version. Handles the four request
// shapes npm accepts: no version (the `latest` dist-tag), a dist-tag, an exact
// version, and a semver range (highest satisfying published version). Returns
// undefined when it cannot be pinned (no packument, unknown tag, unsatisfiable
// range) so the caller defers to npm's own resolution at install time.
function resolveConcreteVersion(
    spec: string,
    packument: unknown,
): string | undefined {
    const packumentRecord = asRecord(packument);
    const versionsRecord = asRecord(packumentRecord?.versions);
    const versions =
        versionsRecord !== undefined ? Object.keys(versionsRecord) : [];
    const distTagsRecord = asRecord(packumentRecord?.["dist-tags"]);
    const distTags: Record<string, string> = Object.fromEntries(
        Object.entries(distTagsRecord ?? {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
    );
    // The part after the module name: "" (no version) | exact | tag | range.
    const at = spec.lastIndexOf("@");
    const range = at > 0 ? spec.slice(at + 1) : "";
    if (range === "") {
        return distTags.latest;
    }
    if (Object.prototype.hasOwnProperty.call(distTags, range)) {
        return distTags[range];
    }
    if (versions.includes(range)) {
        return range;
    }
    if (semver.validRange(range) !== null && versions.length > 0) {
        return semver.maxSatisfying(versions, range) ?? undefined;
    }
    return undefined;
}

function packageManifestForVersion(
    packument: unknown,
    version: string,
): Record<string, unknown> | undefined {
    const packumentRecord = asRecord(packument);
    const versions = asRecord(packumentRecord?.versions);
    const manifest = versions?.[version];
    return asRecord(manifest);
}

function hasAgentKeywordForVersion(
    packument: unknown,
    version: string,
): boolean {
    const keywords: unknown = packageManifestForVersion(
        packument,
        version,
    )?.keywords;
    return Array.isArray(keywords) && keywords.includes(AGENT_KEYWORD);
}

function packageOsForVersion(packument: unknown, version: string): unknown {
    return packageManifestForVersion(packument, version)?.os;
}

// Full enumeration: scoped package list narrowed to packages carrying the
// agent keyword.
// @internal Exported for focused tests; runtime use is inside this module.
export async function enumerateFeedAgents(
    config: FeedSourceConfig,
    token: string,
    fetchFn: typeof fetch,
): Promise<string[]> {
    const registry = resolveFeedRegistry(config);
    if (registry === undefined) {
        return [];
    }
    const info = parseAzureFeed(registry);
    if (info === undefined) {
        throw new Error(
            `feed '${config.name}': unrecognized Azure Artifacts registry URL '${registry}'`,
        );
    }
    const scopes = resolveFeedScopes(config);
    const scoped = await listScopedPackages(info, scopes, token, fetchFn);
    const flags = await Promise.all(
        scoped.map((name) => isAgentPackage(registry, name, token, fetchFn)),
    );
    return scoped.filter((_, i) => flags[i]);
}

// `feed` source.
//   find        = membership check against a cached package list (~1h TTL),
//                 then a live registry round-trip to pin a concrete version;
//                 unresolvable (offline / auth / no matching version) -> no match
//   materialize = npm install the pinned `module@version` into its own root
// `ref` is an npm specifier / name.
export function createFeedSource(
    config: FeedSourceConfig,
    deps: FeedSourceDeps,
): InstallSource {
    const fetchFn = deps.fetchFn ?? fetch;
    const tokenRunner = deps.tokenRunner;
    const npmInstall = deps.npmInstall ?? defaultNpmInstall;
    const now = deps.now ?? Date.now;
    const cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    // Sanitize the source name before embedding it in a filename so a stray
    // path separator in config can't escape installDir.
    const safeName = sanitizeLabel(config.name);
    const cacheFilePath =
        deps.cacheFilePath ??
        path.join(deps.installDir, `.feed-cache-${safeName}.json`);

    let memoryCache: FeedCache | undefined;

    function isFeedCache(value: unknown): value is FeedCache {
        if (typeof value !== "object" || value === null) {
            return false;
        }
        const cache = value as Partial<FeedCache>;
        return (
            typeof cache.fetchedAt === "number" &&
            Array.isArray(cache.packages) &&
            cache.packages.every((name) => typeof name === "string")
        );
    }

    function readDiskCache(): FeedCache | undefined {
        try {
            const parsed = JSON.parse(fs.readFileSync(cacheFilePath, "utf8"));
            return isFeedCache(parsed) ? parsed : undefined;
        } catch {
            return undefined;
        }
    }

    function writeDiskCache(cache: FeedCache): void {
        try {
            fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
            fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2));
        } catch {
            // best effort; the in-memory cache still serves this session
        }
    }

    async function getPackageList(): Promise<string[]> {
        if (resolveFeedRegistry(config) === undefined) {
            return [];
        }
        const current = now();
        if (
            memoryCache === undefined ||
            current - memoryCache.fetchedAt >= cacheTtlMs
        ) {
            memoryCache ??= readDiskCache();
        }
        const fresh =
            memoryCache !== undefined &&
            current - memoryCache.fetchedAt < cacheTtlMs;
        if (fresh) {
            return memoryCache!.packages;
        }
        // Stale or missing: try to refresh. On any failure (offline / REST
        // error) serve the stale cache (or empty) rather than failing the walk
        // and continue source resolution.
        try {
            const token = await getFeedAccessToken(tokenRunner);
            const packages = await enumerateFeedAgents(config, token, fetchFn);
            memoryCache = { fetchedAt: current, packages };
            writeDiskCache(memoryCache);
            return packages;
        } catch {
            return memoryCache?.packages ?? [];
        }
    }

    async function find(ref: string): Promise<ResolvedCandidate | undefined> {
        const moduleName = moduleNameFromSpec(ref);
        const packages = await getPackageList();
        if (!packages.includes(moduleName)) {
            return undefined; // non-match (or skipped when offline+empty)
        }
        // Membership matched: resolve the concrete version so
        // every candidate carries a pinned `version`. `materialize` names the
        // content-addressed install root (`module@version`) from it and skips
        // the npm install entirely when that root already exists (dedup
        // across agents / same-version update no-op). Resolving requires a
        // live registry round-trip (an access token + the packument); if we
        // can't pin a concrete published version -- offline, auth failure, or
        // no published version satisfies the ref -- the agent is not
        // installable, so we fail the find (the host reports it unresolved).
        let version: string | undefined;
        const registry = resolveFeedRegistry(config);
        if (registry !== undefined) {
            try {
                const token = await getFeedAccessToken(tokenRunner);
                const packument = await fetchPackument(
                    registry,
                    moduleName,
                    token,
                    fetchFn,
                );
                if (packument !== undefined) {
                    version = resolveConcreteVersion(ref, packument);
                    if (
                        version !== undefined &&
                        !hasAgentKeywordForVersion(packument, version)
                    ) {
                        return undefined;
                    }
                    if (
                        version !== undefined &&
                        !isCompatiblePlatform(
                            packageOsForVersion(packument, version),
                        )
                    ) {
                        return undefined;
                    }
                }
            } catch {
                // offline / auth failure -> leave version unresolved
            }
        }
        if (version === undefined) {
            return undefined;
        }
        return {
            source: config.name,
            module: moduleName,
            // Retain the user-specified spec/range in `ref` as the durable
            // update selector; the concrete resolved version is carried
            // separately in `version`.
            ref,
            version,
            loaderConfig: { execMode: "separate" },
        };
    }

    return {
        name: config.name,
        kind: "feed",
        find,
        async update(
            record: InstalledAgentRecord,
            opts?: { range?: string | undefined },
        ) {
            const moduleName = record.module;
            if (moduleName === undefined) {
                throw new Error(
                    `feed record for agent '${record.name}' is missing its 'module' (corrupt record).`,
                );
            }
            if (record.ref === undefined) {
                throw new Error(
                    `feed record for agent '${record.name}' is missing its 'ref' (corrupt record).`,
                );
            }
            // Validate the user-supplied range against the real semver-range
            // grammar (or an npm dist-tag) before it is ever embedded in a spec
            // (guards against `@package update <range>`
            // shell injection on Windows).
            if (opts?.range !== undefined && !isSafeVersionRange(opts.range)) {
                throw new Error(
                    `feed source '${config.name}': invalid version range '${opts.range}' for '${moduleName}'`,
                );
            }
            const ref =
                opts?.range !== undefined
                    ? `${moduleName}@${opts.range}`
                    : record.ref;
            const candidate = await find(ref);
            if (candidate === undefined) {
                throw new Error(
                    `agent '${record.name}' is no longer resolvable from source '${record.source}'.`,
                );
            }
            if (
                candidate.version !== undefined &&
                record.installRoot ===
                    installRootFor(moduleName, candidate.version)
            ) {
                const noOpRecord: MaterializedInstallRecord = {
                    kind: record.kind,
                    module: moduleName,
                    source: record.source,
                    ref,
                    installRoot: record.installRoot,
                };
                if (record.loaderConfig !== undefined) {
                    noOpRecord.loaderConfig = record.loaderConfig;
                }
                return {
                    status: "no-op" as const,
                    record: noOpRecord,
                };
            }
            return {
                status: "updated" as const,
                record: await this.materialize(candidate),
            };
        },
        async materialize(
            candidate: ResolvedCandidate,
            onStatus?: SourceStatus,
        ): Promise<MaterializedInstallRecord> {
            const registry = resolveFeedRegistry(config);
            if (registry === undefined) {
                throw new Error(
                    `feed source '${config.name}' has no registry configured (set source.registry or TYPEAGENT_FEED_REGISTRY)`,
                );
            }
            const moduleName = candidate.module;
            // The user-facing ref (tag/range/version) is retained as the
            // default update selector.
            const ref = candidate.ref;
            // `find`/`update` always pin a concrete version, so a candidate
            // reaching materialize must carry one (it names the content-addressed
            // root and the exact install spec).
            const version = candidate.version;
            if (
                moduleName === undefined ||
                ref === undefined ||
                version === undefined
            ) {
                throw new Error(
                    `feed source '${config.name}' got a candidate without a module/ref/version`,
                );
            }
            // Install the exact resolved version -- reproducible, and it matches
            // the content-addressed root name.
            const installSpec = `${moduleName}@${version}`;
            // Only a strict `name@concrete-version` spec is ever handed to `npm
            // install`, so a corrupt record or an unresolved range can never
            // inject shell metacharacters into the install command (the Windows
            // path runs npm under a shell).
            if (!isSafeModuleName(moduleName) || !isConcreteVersion(version)) {
                throw new Error(
                    `feed source '${config.name}': refusing to install unsafe spec '${installSpec}'`,
                );
            }
            // Content-addressed install roots: the install unit is
            // the PACKAGE, keyed by `sanitize(module)@version`. Two agents that
            // resolve to the same package+version share ONE root (dedup), a new
            // version coexists in its own root (non-destructive), and installing
            // the same version again is an idempotent no-op. The refcount-aware
            // startup sweep + prune-on-swap GC (in the provider) reclaim a root
            // only once no record references it.
            const rootsDir = path.join(
                deps.installDir,
                AGENT_INSTALL_ROOTS_SUBDIR,
            );
            const installRoot = installRootFor(moduleName, version);
            const finalRoot = path.join(rootsDir, installRoot);
            const installedPkgJsonUnder = (root: string): string =>
                path.join(
                    root,
                    "node_modules",
                    ...moduleName.split("/"),
                    "package.json",
                );
            const buildRecord = (): MaterializedInstallRecord => ({
                kind: "npm",
                module: moduleName,
                source: config.name,
                ref,
                installRoot,
                loaderConfig: {
                    execMode: candidate.loaderConfig?.execMode ?? "separate",
                },
            });

            // FAST PATH: a completed install already sits at the
            // content-addressed root -> reuse it with no npm install at all
            // (dedup / same-version no-op).
            if (fs.existsSync(installedPkgJsonUnder(finalRoot))) {
                onStatus?.(`Reusing installed ${moduleName}@${version}...`);
                return buildRecord();
            }

            // SLOW PATH: install into a UNIQUE TEMP root first so a failed or
            // partial install never leaves a usable content-addressed root
            // behind (atomicity), then adopt it as `module@version`. If the final
            // root already exists (a prior/concurrent install of the same version
            // won the race) discard the temp and reuse it (dedup).
            const tempRoot = path.join(rootsDir, `.tmp-${makeInstallId()}`);
            ensureInstallRoot(tempRoot);
            let adopted = false;
            try {
                const userconfig = await writeTransientNpmAuth(
                    registry,
                    tokenRunner,
                );
                // Report the long step and, since `npm install` reports nothing
                // back until it exits, drive a heartbeat while it runs.
                onStatus?.(
                    `Downloading and installing ${moduleName}@${version}...`,
                );
                const installStart = now();
                const heartbeat =
                    onStatus !== undefined
                        ? setInterval(() => {
                              const elapsed = Math.round(
                                  (now() - installStart) / 1000,
                              );
                              onStatus(`Still working... (${elapsed}s elapsed)`);
                          }, 2500)
                        : undefined;
                heartbeat?.unref?.();
                try {
                    await npmInstall({
                        spec: installSpec,
                        cwd: tempRoot,
                        registry,
                        userconfig,
                    });
                } finally {
                    if (heartbeat !== undefined) {
                        clearInterval(heartbeat);
                    }
                    removeTransientNpmAuth(userconfig);
                }
                if (!fs.existsSync(installedPkgJsonUnder(tempRoot))) {
                    throw new Error(
                        `npm install of '${installSpec}' did not produce '${moduleName}' under ${path.join(tempRoot, "node_modules")}.`,
                    );
                }
                if (fs.existsSync(installedPkgJsonUnder(finalRoot))) {
                    // Dedup: an install of this exact version already exists;
                    // keep it and let the temp root be cleaned up below.
                    return buildRecord();
                }
                // Adopt the temp root as the content-addressed final root. Clear
                // any stale/partial directory first so the rename can't fail on
                // an existing incomplete root.
                onStatus?.("Finalizing...");
                fs.rmSync(finalRoot, { recursive: true, force: true });
                fs.renameSync(tempRoot, finalRoot);
                adopted = true;
                return buildRecord();
            } finally {
                if (!adopted) {
                    fs.rmSync(tempRoot, { recursive: true, force: true });
                }
            }
        },
        async listAgents(): Promise<string[]> {
            return getPackageList();
        },
    };
}

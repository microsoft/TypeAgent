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
    MaterializedInstallRecord,
    ResolvedCandidate,
    AGENT_INSTALL_ROOTS_SUBDIR,
} from "./config.js";
import {
    AzTokenRunner,
    getFeedAccessToken,
    writeTransientNpmAuth,
    removeTransientNpmAuth,
} from "./feedAuth.js";

const execFileAsync = promisify(execFile);

// The sentinel keyword an app agent declares in its package.json (design §4.1).
export const AGENT_KEYWORD = "typeagent-agent";

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // ~1h (design §12 Q3)

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
export function moduleNameFromSpec(spec: string): string {
    const at = spec.lastIndexOf("@");
    return at > 0 ? spec.slice(0, at) : spec;
}

// Sanitize an arbitrary label (dispatcher name / module name) into a filesystem-
// safe directory-name component so it can never escape the install root.
function sanitizeRootLabel(label: string): string {
    return label.replace(/[^A-Za-z0-9._-]/g, "_");
}

// A short, unique, filesystem-safe install-id (design §5.5 _Naming_). Used to
// name the TEMPORARY install root (`.tmp-<id>`) a slow-path materialize installs
// into before atomically adopting it as the content-addressed `module@version`
// root, so concurrent installs never collide on the temp dir.
function makeInstallId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface NpmInstallArgs {
    spec: string;
    cwd: string;
    registry: string;
    userconfig: string;
}

export interface FeedSourceDeps {
    // npm root all feed installs land in (design §4.1, §12 Q20). Holds a
    // private package.json marker; packages go under its node_modules/.
    installDir: string;
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
    await execFileAsync(
        "npm",
        [
            "install",
            args.spec,
            "--save=false",
            "--registry",
            args.registry,
            "--userconfig",
            args.userconfig,
        ],
        { cwd: args.cwd, shell: process.platform === "win32" },
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
// configured scopes (design §4.1 step 1).
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
        const data: any = await res.json();
        const page: any[] = data.value ?? [];
        for (const pkg of page) {
            const name: string = pkg.normalizedName ?? pkg.name;
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
// (design §4.1 step 2).
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
    const packument: any = await res.json();
    const keywords: unknown = packument.keywords;
    return Array.isArray(keywords) && keywords.includes(AGENT_KEYWORD);
}

// Fetch and parse a package's packument (design §4.1, §5.5). Returns undefined
// on any network / HTTP / parse failure so callers can fall back gracefully
// (offline -> resolve the version at install time instead).
async function fetchPackument(
    registry: string,
    packageName: string,
    token: string,
    fetchFn: typeof fetch,
): Promise<any | undefined> {
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
// a single concrete published version (design §5.5). Handles the three request
// shapes npm accepts: no version (the `latest` dist-tag), a dist-tag, an exact
// version, and a semver range (highest satisfying published version). Returns
// undefined when it cannot be pinned (no packument, unknown tag, unsatisfiable
// range) so the caller defers to npm's own resolution at install time.
function resolveConcreteVersion(
    spec: string,
    packument: any,
): string | undefined {
    const versions =
        packument && typeof packument.versions === "object"
            ? Object.keys(packument.versions)
            : [];
    const distTags: Record<string, string> =
        packument && typeof packument["dist-tags"] === "object"
            ? packument["dist-tags"]
            : {};
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

// Full enumeration: scoped package list narrowed to packages carrying the
// agent keyword.
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

// `feed` source (design §3, §4.1, §4.2, §12 Q3, Q16, Q20).
//   find        = membership check against a cached package list (~1h TTL;
//                 offline -> serve stale + skip in the walk)
//   materialize = npm install into the shared install root
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
    // path separator in config can't escape installDir (review M1-2).
    const safeName = config.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const cacheFilePath =
        deps.cacheFilePath ??
        path.join(deps.installDir, `.feed-cache-${safeName}.json`);

    let memoryCache: FeedCache | undefined;

    function readDiskCache(): FeedCache | undefined {
        try {
            return JSON.parse(
                fs.readFileSync(cacheFilePath, "utf8"),
            ) as FeedCache;
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
        // (design §12 Q3).
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

    return {
        name: config.name,
        kind: "feed",
        async find(ref: string): Promise<ResolvedCandidate | undefined> {
            const moduleName = moduleNameFromSpec(ref);
            const packages = await getPackageList();
            if (!packages.includes(moduleName)) {
                return undefined; // non-match (or skipped when offline+empty)
            }
            // Membership matched: resolve the concrete version up front (design
            // §5.5) so `materialize` can name the content-addressed install root
            // (`module@version`) and skip the npm install entirely when that root
            // already exists (dedup across agents / same-version update no-op).
            // Read-only and best-effort: when the packument is unavailable
            // (offline / auth failure) `version` stays undefined and resolution
            // is deferred to install time. But when the packument IS available
            // and lists a version catalog that no published version satisfies,
            // the requested tag/range/version is simply not installable, so we
            // fail the find (the host then reports the agent unresolved).
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
                        // The packument carries a version catalog (a `versions`
                        // map and/or `dist-tags`) but nothing matches the
                        // requested ref -> not installable at this ref.
                        if (
                            version === undefined &&
                            (typeof packument.versions === "object" ||
                                typeof packument["dist-tags"] === "object")
                        ) {
                            return undefined;
                        }
                    }
                } catch {
                    // offline / auth failure -> resolve at install time
                }
            }
            return {
                source: config.name,
                module: moduleName,
                // Retain the user-specified spec/range in `ref` so `reresolve`
                // can re-look-up against it; the concrete resolved version is
                // carried separately in `version`.
                ref,
                ...(version !== undefined ? { version } : {}),
                loaderConfig: { execMode: "separate" }, // §12 Q16
            };
        },
        async reresolve(
            candidate: ResolvedCandidate,
            opts?: { range?: string | undefined },
        ): Promise<ResolvedCandidate | undefined> {
            // The package name (`module`) is the handle; a version `range`
            // narrows the target, omitting it takes the latest available
            // version (design §5). A candidate without a module is corrupt.
            const moduleName = candidate.module;
            if (moduleName === undefined) {
                throw new Error(
                    `feed candidate is missing its 'module' (corrupt record).`,
                );
            }
            const ref =
                opts?.range !== undefined
                    ? `${moduleName}@${opts.range}`
                    : moduleName;
            // Re-run the membership check: a package pulled from the feed
            // returns undefined -> host reports it is no longer resolvable.
            return this.find(ref);
        },
        async materialize(
            candidate: ResolvedCandidate,
        ): Promise<MaterializedInstallRecord> {
            const registry = resolveFeedRegistry(config);
            if (registry === undefined) {
                throw new Error(
                    `feed source '${config.name}' has no registry configured (set source.registry or TYPEAGENT_FEED_REGISTRY)`,
                );
            }
            const moduleName = candidate.module;
            // The user-facing ref (tag/range/version) is retained for re-resolve;
            // fall back to the bare module name.
            const ref = candidate.ref ?? moduleName;
            if (moduleName === undefined || ref === undefined) {
                throw new Error(
                    `feed source '${config.name}' got a candidate without a module/ref`,
                );
            }
            // What we actually hand to npm: pin to the concrete version resolved
            // by `find` when known (reproducible, and matches the
            // content-addressed root), else install the ref/range and read the
            // installed version back from disk.
            const installSpec =
                candidate.version !== undefined
                    ? `${moduleName}@${candidate.version}`
                    : ref;
            // Content-addressed install roots (design §5.5): the install unit is
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
            const rootLabel = sanitizeRootLabel(moduleName);
            const installedPkgJsonUnder = (root: string): string =>
                path.join(
                    root,
                    "node_modules",
                    ...moduleName.split("/"),
                    "package.json",
                );
            const readInstalledVersion = (root: string): string | undefined => {
                try {
                    const pkg = JSON.parse(
                        fs.readFileSync(installedPkgJsonUnder(root), "utf8"),
                    );
                    return typeof pkg.version === "string"
                        ? pkg.version
                        : undefined;
                } catch {
                    return undefined;
                }
            };
            const buildRecord = (
                installRoot: string,
            ): MaterializedInstallRecord => ({
                kind: "npm",
                module: moduleName,
                source: config.name,
                ref,
                installRoot,
                loaderConfig: {
                    execMode: candidate.loaderConfig?.execMode ?? "separate",
                },
            });

            // FAST PATH: the version was resolved during `find` AND a completed
            // install already sits at the content-addressed root -> reuse it with
            // no npm install at all (dedup / same-version no-op, design §5.5).
            if (candidate.version !== undefined) {
                const installRoot = `${rootLabel}@${candidate.version}`;
                const finalRoot = path.join(rootsDir, installRoot);
                if (fs.existsSync(installedPkgJsonUnder(finalRoot))) {
                    return buildRecord(installRoot);
                }
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
                try {
                    await npmInstall({
                        spec: installSpec,
                        cwd: tempRoot,
                        registry,
                        userconfig,
                    });
                } finally {
                    removeTransientNpmAuth(userconfig);
                }
                if (!fs.existsSync(installedPkgJsonUnder(tempRoot))) {
                    throw new Error(
                        `npm install of '${installSpec}' did not produce '${moduleName}' under ${path.join(tempRoot, "node_modules")}.`,
                    );
                }
                // Name by the concrete version: prefer what `find` resolved, else
                // read it from the freshly installed package.json.
                const version =
                    candidate.version ?? readInstalledVersion(tempRoot);
                const installRoot =
                    version !== undefined
                        ? `${rootLabel}@${version}`
                        : `${rootLabel}@${makeInstallId()}`; // last-resort unique
                const finalRoot = path.join(rootsDir, installRoot);
                if (fs.existsSync(installedPkgJsonUnder(finalRoot))) {
                    // Dedup: an install of this exact version already exists;
                    // keep it and let the temp root be cleaned up below.
                    return buildRecord(installRoot);
                }
                // Adopt the temp root as the content-addressed final root. Clear
                // any stale/partial directory first so the rename can't fail on
                // an existing incomplete root.
                fs.rmSync(finalRoot, { recursive: true, force: true });
                fs.renameSync(tempRoot, finalRoot);
                adopted = true;
                return buildRecord(installRoot);
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

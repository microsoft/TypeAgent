// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    InstallSource,
    FeedSourceConfig,
    InstalledAgentRecord,
    ResolvedCandidate,
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
            return {
                source: config.name,
                module: moduleName,
                ref,
                loaderConfig: { execMode: "separate" }, // §12 Q16
            };
        },
        async materialize(
            candidate: ResolvedCandidate,
        ): Promise<InstalledAgentRecord> {
            const registry = resolveFeedRegistry(config);
            if (registry === undefined) {
                throw new Error(
                    `feed source '${config.name}' has no registry configured (set source.registry or TYPEAGENT_FEED_REGISTRY)`,
                );
            }
            const moduleName = candidate.module;
            const spec = candidate.ref ?? moduleName;
            if (moduleName === undefined || spec === undefined) {
                throw new Error(
                    `feed source '${config.name}' got a candidate without a module/ref`,
                );
            }
            ensureInstallRoot(deps.installDir);
            const userconfig = await writeTransientNpmAuth(
                registry,
                tokenRunner,
            );
            try {
                await npmInstall({
                    spec,
                    cwd: deps.installDir,
                    registry,
                    userconfig,
                });
            } finally {
                removeTransientNpmAuth(userconfig);
            }
            const installed = path.join(
                deps.installDir,
                "node_modules",
                ...moduleName.split("/"),
                "package.json",
            );
            if (!fs.existsSync(installed)) {
                throw new Error(
                    `npm install of '${spec}' did not produce '${moduleName}' under ${path.join(deps.installDir, "node_modules")}.`,
                );
            }
            return {
                name: moduleName.split("/").pop() ?? moduleName,
                kind: "npm",
                module: moduleName,
                source: config.name,
                ref: spec,
                loaderConfig: {
                    execMode: candidate.loaderConfig?.execMode ?? "separate",
                },
            };
        },
        async listAgents(): Promise<string[]> {
            return getPackageList();
        },
    };
}

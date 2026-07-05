// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    createFeedSource,
    enumerateFeedAgents,
    moduleNameFromSpec,
    parseAzureFeed,
} from "../src/installSources/feedSource.js";
import {
    clearTokenCacheForTest,
    FeedAuthError,
    getFeedAccessToken,
} from "../src/installSources/feedAuth.js";
import { FeedSourceConfig } from "../src/installSources/config.js";

const REGISTRY =
    "https://pkgs.dev.azure.com/myorg/myproject/_packaging/typeagent/npm/registry/";

const CONFIG: FeedSourceConfig = {
    kind: "feed",
    name: "typeagent",
    registry: REGISTRY,
    scopes: ["@typeagent"],
};

function okJson(body: unknown): any {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => body,
    };
}

// Build a fake fetch over the Azure DevOps packages + packument endpoints.
function fakeFetch(opts: {
    packages: string[];
    keywords: Record<string, string[]>;
}): typeof fetch {
    return (async (input: any) => {
        const url = String(input);
        if (url.includes("/_apis/packaging/feeds/")) {
            // Single page of packages.
            return okJson({
                value: opts.packages.map((name) => ({ normalizedName: name })),
            });
        }
        // packument: last path segment (decoded) is the package name.
        const decoded = decodeURIComponent(url.slice(REGISTRY.length));
        const keywords = opts.keywords[decoded] ?? [];
        return okJson({ keywords });
    }) as unknown as typeof fetch;
}

const goodToken = async () =>
    JSON.stringify({
        accessToken: "fake-token",
        expiresOn: new Date(Date.now() + 3600_000).toISOString(),
    });

// Fake fetch that answers the packument endpoint with a `versions` map +
// `dist-tags` so `feedSource.find` can resolve a concrete version up front
// (design §5.5). Defaults expose 1.0.0 + 2.0.0 with latest=2.0.0.
function packumentFetch(opts?: {
    versions?: string[];
    distTags?: Record<string, string>;
    keywords?: string[];
}): typeof fetch {
    const versions = opts?.versions ?? ["1.0.0", "2.0.0"];
    const versionsMap: Record<string, unknown> = {};
    for (const v of versions) {
        versionsMap[v] = { version: v };
    }
    const distTags =
        opts?.distTags ??
        (versions.length > 0 ? { latest: versions[versions.length - 1] } : {});
    const keywords = opts?.keywords ?? ["typeagent-agent"];
    return (async () =>
        okJson({
            keywords,
            versions: versionsMap,
            "dist-tags": distTags,
        })) as unknown as typeof fetch;
}

beforeEach(() => {
    clearTokenCacheForTest();
});

describe("parseAzureFeed", () => {
    it("parses a project-scoped registry URL", () => {
        expect(parseAzureFeed(REGISTRY)).toEqual({
            org: "myorg",
            project: "myproject",
            feed: "typeagent",
        });
    });
    it("parses an org-scoped registry URL", () => {
        expect(
            parseAzureFeed(
                "https://pkgs.dev.azure.com/myorg/_packaging/myfeed/npm/registry/",
            ),
        ).toEqual({ org: "myorg", feed: "myfeed" });
    });
    it("returns undefined for a non-Azure URL", () => {
        expect(parseAzureFeed("https://registry.npmjs.org/")).toBeUndefined();
    });
});

describe("moduleNameFromSpec", () => {
    it("strips a trailing version from a scoped spec", () => {
        expect(moduleNameFromSpec("@typeagent/foo-agent@1.2.3")).toBe(
            "@typeagent/foo-agent",
        );
    });
    it("keeps an unversioned scoped name intact", () => {
        expect(moduleNameFromSpec("@typeagent/foo-agent")).toBe(
            "@typeagent/foo-agent",
        );
    });
    it("strips a version from an unscoped spec", () => {
        expect(moduleNameFromSpec("foo@^1")).toBe("foo");
    });
});

describe("enumerateFeedAgents", () => {
    it("keeps packages with the agent keyword and drops libraries", async () => {
        const fetchFn = fakeFetch({
            packages: [
                "@typeagent/spelunker-agent",
                "@typeagent/agent-sdk", // library, no keyword
                "@other/thing-agent", // out of scope
            ],
            keywords: {
                "@typeagent/spelunker-agent": ["typeagent-agent"],
                "@typeagent/agent-sdk": ["library"],
                "@other/thing-agent": ["typeagent-agent"],
            },
        });
        const agents = await enumerateFeedAgents(CONFIG, "tok", fetchFn);
        expect(agents).toEqual(["@typeagent/spelunker-agent"]);
    });
});

describe("feedSource.find", () => {
    it("matches a package present in the cached list", async () => {
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const source = createFeedSource(CONFIG, {
            installDir,
            tokenRunner: goodToken,
            fetchFn: fakeFetch({
                packages: ["@typeagent/spelunker-agent"],
                keywords: {
                    "@typeagent/spelunker-agent": ["typeagent-agent"],
                },
            }),
        });
        const candidate = await source.find("@typeagent/spelunker-agent@1.4.0");
        expect(candidate).toBeDefined();
        expect(candidate!.module).toBe("@typeagent/spelunker-agent");
        expect(candidate!.ref).toBe("@typeagent/spelunker-agent@1.4.0");
        expect(candidate!.loaderConfig?.execMode).toBe("separate");
    });

    it("serves a fresh cache without calling the network", async () => {
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const cacheFilePath = path.join(installDir, "cache.json");
        fs.writeFileSync(
            cacheFilePath,
            JSON.stringify({
                fetchedAt: 1000,
                packages: ["@typeagent/foo-agent"],
            }),
        );
        const source = createFeedSource(CONFIG, {
            installDir,
            cacheFilePath,
            now: () => 1000, // fresh (age 0 < TTL)
            fetchFn: (() => {
                throw new Error("network should not be touched");
            }) as unknown as typeof fetch,
        });
        const candidate = await source.find("@typeagent/foo-agent");
        expect(candidate).toBeDefined();
    });

    it("serves a stale cache when offline (skips refresh failure)", async () => {
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const cacheFilePath = path.join(installDir, "cache.json");
        fs.writeFileSync(
            cacheFilePath,
            JSON.stringify({
                fetchedAt: 0,
                packages: ["@typeagent/foo-agent"],
            }),
        );
        const source = createFeedSource(CONFIG, {
            installDir,
            cacheFilePath,
            now: () => 10_000_000, // stale (age > 1h)
            tokenRunner: goodToken,
            fetchFn: (() => {
                throw new Error("offline");
            }) as unknown as typeof fetch,
        });
        // Stale cache still answers membership.
        expect(await source.find("@typeagent/foo-agent")).toBeDefined();
        expect(await source.find("@typeagent/missing")).toBeUndefined();
    });

    it("falls back to an empty list on REST error with no cache", async () => {
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const source = createFeedSource(CONFIG, {
            installDir,
            cacheFilePath: path.join(installDir, "cache.json"),
            tokenRunner: goodToken,
            fetchFn: (async () => ({
                ok: false,
                status: 500,
                statusText: "Server Error",
                json: async () => ({}),
            })) as unknown as typeof fetch,
        });
        // No cache + REST error => feed is skipped (non-match), not a failure.
        expect(await source.find("@typeagent/anything")).toBeUndefined();
    });
});

describe("feedSource.reresolve", () => {
    function sourceWith(packages: string[]) {
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        return createFeedSource(CONFIG, {
            installDir,
            tokenRunner: goodToken,
            fetchFn: fakeFetch({
                packages,
                keywords: Object.fromEntries(
                    packages.map((p) => [p, ["typeagent-agent"]]),
                ),
            }),
        });
    }

    it("re-resolves off the candidate's `module`, latest when no range", async () => {
        const source = sourceWith(["@typeagent/foo-agent"]);
        const candidate = await source.reresolve!({
            source: "typeagent",
            module: "@typeagent/foo-agent",
            ref: "@typeagent/foo-agent@1.0.0",
        });
        expect(candidate).toBeDefined();
        expect(candidate!.module).toBe("@typeagent/foo-agent");
        // No range -> target the bare module (latest).
        expect(candidate!.ref).toBe("@typeagent/foo-agent");
    });

    it("applies a version range to the module", async () => {
        const source = sourceWith(["@typeagent/foo-agent"]);
        const candidate = await source.reresolve!(
            {
                source: "typeagent",
                module: "@typeagent/foo-agent",
            },
            { range: "^2.0.0" },
        );
        expect(candidate!.ref).toBe("@typeagent/foo-agent@^2.0.0");
    });

    it("returns undefined when the package left the feed", async () => {
        const source = sourceWith(["@typeagent/other-agent"]);
        expect(
            await source.reresolve!({
                source: "typeagent",
                module: "@typeagent/foo-agent",
            }),
        ).toBeUndefined();
    });

    it("throws on a corrupt candidate with no module", async () => {
        const source = sourceWith(["@typeagent/foo-agent"]);
        await expect(
            source.reresolve!({ source: "typeagent" }),
        ).rejects.toThrow(/missing its 'module'/i);
    });
});

describe("feedAuth", () => {
    it("throws an actionable az login hint when az is unavailable", async () => {
        clearTokenCacheForTest();
        await expect(
            getFeedAccessToken(async () => {
                throw new FeedAuthError(
                    "Could not get an Azure DevOps access token from the Azure CLI. Run 'az login' and try again.",
                );
            }),
        ).rejects.toThrow(/az login/);
    });
});

describe("feedSource.listAgents", () => {
    it("returns the enumerated agent package list", async () => {
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const cacheFilePath = path.join(installDir, "cache.json");
        fs.writeFileSync(
            cacheFilePath,
            JSON.stringify({
                fetchedAt: 1000,
                packages: ["@typeagent/a-agent", "@typeagent/b-agent"],
            }),
        );
        const source = createFeedSource(CONFIG, {
            installDir,
            cacheFilePath,
            now: () => 1000,
            fetchFn: (() => {
                throw new Error("offline");
            }) as unknown as typeof fetch,
        });
        expect((await source.listAgents!()).sort()).toEqual([
            "@typeagent/a-agent",
            "@typeagent/b-agent",
        ]);
    });
});

describe("feedSource.materialize", () => {
    function freshCacheSource(deps: {
        installDir: string;
        npmInstall: (args: any) => Promise<void>;
        fetchFn?: typeof fetch;
    }) {
        const cacheFilePath = path.join(deps.installDir, "cache.json");
        fs.writeFileSync(
            cacheFilePath,
            JSON.stringify({
                fetchedAt: 1000,
                packages: ["@typeagent/a-agent"],
            }),
        );
        return createFeedSource(CONFIG, {
            installDir: deps.installDir,
            cacheFilePath,
            now: () => 1000,
            tokenRunner: goodToken,
            npmInstall: deps.npmInstall,
            fetchFn: deps.fetchFn ?? packumentFetch(),
        });
    }

    it("cleans up the transient .npmrc even when npm install throws", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        let seenUserconfig: string | undefined;
        const source = freshCacheSource({
            installDir,
            npmInstall: async ({ userconfig }: any) => {
                seenUserconfig = userconfig;
                expect(fs.existsSync(userconfig)).toBe(true);
                throw new Error("npm boom");
            },
        });
        const candidate = await source.find("@typeagent/a-agent@1.0.0");
        await expect(source.materialize(candidate!)).rejects.toThrow(
            /npm boom/,
        );
        // The transient auth file (and its dir) is removed on the error path.
        expect(seenUserconfig).toBeDefined();
        expect(fs.existsSync(seenUserconfig!)).toBe(false);
    });

    it("throws a clear error when the package does not land in node_modules", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const source = freshCacheSource({
            installDir,
            npmInstall: async () => {
                /* no-op: pretend install "succeeded" but produced nothing */
            },
        });
        const candidate = await source.find("@typeagent/a-agent@1.0.0");
        await expect(source.materialize(candidate!)).rejects.toThrow(
            /did not produce/,
        );
    });

    it("produces a record with module/ref/execMode on success", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const source = freshCacheSource({
            installDir,
            npmInstall: async ({ spec, cwd }: any) => {
                // The package now lands under the per-agent version-scoped root
                // (`cwd`), not the shared installDir (design §5.5).
                const mod = moduleNameFromSpec(spec);
                const dir = path.join(cwd, "node_modules", ...mod.split("/"));
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                    path.join(dir, "package.json"),
                    JSON.stringify({ name: mod, version: "1.0.0" }),
                );
            },
        });
        const record = await source.materialize(
            (await source.find("@typeagent/a-agent@1.0.0"))!,
        );
        expect(record.module).toBe("@typeagent/a-agent");
        expect(record.ref).toBe("@typeagent/a-agent@1.0.0");
        expect(record.loaderConfig?.execMode).toBe("separate");
        // The record carries the content-addressed install root (which encodes
        // the resolved version, design §5.5), and that root physically exists
        // under installDir/agents.
        expect(record.installRoot).toBe("_typeagent_a-agent@1.0.0");
        expect(
            fs.existsSync(path.join(installDir, "agents", record.installRoot!)),
        ).toBe(true);
    });

    it("installs into a per-agent version-scoped root, not the shared installDir", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        let seenCwd: string | undefined;
        const source = freshCacheSource({
            installDir,
            npmInstall: async ({ spec, cwd }: any) => {
                seenCwd = cwd;
                const mod = moduleNameFromSpec(spec);
                const dir = path.join(cwd, "node_modules", ...mod.split("/"));
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                    path.join(dir, "package.json"),
                    JSON.stringify({ name: mod, version: "2.3.4" }),
                );
            },
        });
        await source.materialize(
            (await source.find("@typeagent/a-agent@1.0.0"))!,
        );
        // npm ran with cwd under installDir/agents/<name>@<id>, never the shared
        // installDir itself (so a running version is never clobbered, §5.5).
        expect(seenCwd).toBeDefined();
        expect(
            seenCwd!.startsWith(path.join(installDir, "agents") + path.sep),
        ).toBe(true);
        expect(fs.existsSync(path.join(installDir, "node_modules"))).toBe(
            false,
        );
    });

    it("two materializes of the SAME version share one root (dedup, single install)", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        let installs = 0;
        const source = freshCacheSource({
            installDir,
            npmInstall: async ({ spec, cwd }: any) => {
                installs++;
                const mod = moduleNameFromSpec(spec);
                const dir = path.join(cwd, "node_modules", ...mod.split("/"));
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                    path.join(dir, "package.json"),
                    JSON.stringify({ name: mod, version: "1.0.0" }),
                );
            },
        });
        const first = await source.materialize(
            (await source.find("@typeagent/a-agent@1.0.0"))!,
        );
        const second = await source.materialize(
            (await source.find("@typeagent/a-agent@1.0.0"))!,
        );
        // Content-addressed by `module@version`: the same version resolves to
        // the SAME root, and the second materialize is an idempotent no-op that
        // skips npm entirely (design §5.5 dedup / idempotent install).
        expect(second.installRoot).toBe(first.installRoot);
        expect(installs).toBe(1);
        expect(
            fs.existsSync(path.join(installDir, "agents", first.installRoot!)),
        ).toBe(true);
    });

    it("different versions get distinct, coexisting roots (non-destructive)", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const source = freshCacheSource({
            installDir,
            npmInstall: async ({ spec, cwd }: any) => {
                const mod = moduleNameFromSpec(spec);
                const version = spec.slice(spec.lastIndexOf("@") + 1);
                const dir = path.join(cwd, "node_modules", ...mod.split("/"));
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                    path.join(dir, "package.json"),
                    JSON.stringify({ name: mod, version }),
                );
            },
        });
        const v1 = await source.materialize(
            (await source.find("@typeagent/a-agent@1.0.0"))!,
        );
        const v2 = await source.materialize(
            (await source.find("@typeagent/a-agent@2.0.0"))!,
        );
        expect(v1.installRoot).toBe("_typeagent_a-agent@1.0.0");
        expect(v2.installRoot).toBe("_typeagent_a-agent@2.0.0");
        // Both roots coexist: installing v2 never clobbered v1.
        expect(
            fs.existsSync(path.join(installDir, "agents", v1.installRoot!)),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(installDir, "agents", v2.installRoot!)),
        ).toBe(true);
    });

    it("find resolves an exact / dist-tag / range / latest to a concrete version", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const source = freshCacheSource({
            installDir,
            npmInstall: async () => {},
            fetchFn: packumentFetch({
                versions: ["1.0.0", "1.5.0", "2.0.0"],
                distTags: { latest: "2.0.0", beta: "1.5.0" },
            }),
        });
        expect((await source.find("@typeagent/a-agent@1.0.0"))!.version).toBe(
            "1.0.0",
        );
        expect((await source.find("@typeagent/a-agent@beta"))!.version).toBe(
            "1.5.0",
        );
        expect((await source.find("@typeagent/a-agent"))!.version).toBe(
            "2.0.0",
        );
        expect((await source.find("@typeagent/a-agent@^1"))!.version).toBe(
            "1.5.0",
        );
        // The resolved version is pinned into the candidate ref.
        expect((await source.find("@typeagent/a-agent"))!.ref).toBe(
            "@typeagent/a-agent@2.0.0",
        );
    });

    it("find falls back to no version when the packument is unavailable (offline)", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const source = freshCacheSource({
            installDir,
            npmInstall: async () => {},
            // packument endpoint 500s -> fetchPackument returns undefined.
            fetchFn: (async () => ({
                ok: false,
                status: 500,
                statusText: "err",
                json: async () => ({}),
            })) as unknown as typeof fetch,
        });
        const candidate = await source.find("@typeagent/a-agent@1.0.0");
        expect(candidate).toBeDefined();
        // Membership still matched (cached list), but version stays unresolved
        // and the ref is the original spec.
        expect(candidate!.version).toBeUndefined();
        expect(candidate!.ref).toBe("@typeagent/a-agent@1.0.0");
    });

    it("sanitizes a scoped moduleName into a single safe root leaf", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        let seenCwd: string | undefined;
        const source = freshCacheSource({
            installDir,
            npmInstall: async ({ spec, cwd }: any) => {
                seenCwd = cwd;
                const mod = moduleNameFromSpec(spec);
                const dir = path.join(cwd, "node_modules", ...mod.split("/"));
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                    path.join(dir, "package.json"),
                    JSON.stringify({ name: mod, version: "1.0.0" }),
                );
            },
        });
        // The scoped moduleName (@typeagent/a-agent) is the root label; it must
        // collapse to a single traversal-safe component.
        const record = await source.materialize(
            (await source.find("@typeagent/a-agent@1.0.0"))!,
        );
        expect(record.installRoot).toBeDefined();
        // The leaf carries no path separators or scope `@`/`/`, so it cannot
        // escape installDir/agents (path-traversal defense, §5.5).
        expect(record.installRoot).not.toMatch(/[\\/]/);
        expect(record.installRoot!.startsWith("@")).toBe(false);
        // And the created dir is a direct child of installDir/agents.
        expect(path.dirname(seenCwd!)).toBe(path.join(installDir, "agents"));
    });

    it("falls back to an install-id root when no version can be resolved", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const source = freshCacheSource({
            installDir,
            // Empty packument so find cannot pin a version; materialize then
            // tries the installed package.json (which also has none).
            fetchFn: packumentFetch({ versions: [], distTags: {} }),
            npmInstall: async ({ spec, cwd }: any) => {
                const mod = moduleNameFromSpec(spec);
                const dir = path.join(cwd, "node_modules", ...mod.split("/"));
                fs.mkdirSync(dir, { recursive: true });
                // package.json present (so the "did not produce" check passes)
                // but carries no version field.
                fs.writeFileSync(
                    path.join(dir, "package.json"),
                    JSON.stringify({ name: mod }),
                );
            },
        });
        const record = await source.materialize(
            (await source.find("@typeagent/a-agent@1.0.0"))!,
        );
        // With no resolvable version, the root falls back to a unique install-id
        // leaf (still labelled by the module) so the install is never lost.
        expect(record.installRoot).toBeDefined();
        expect(record.installRoot!.startsWith("_typeagent_a-agent@")).toBe(
            true,
        );
        expect(
            fs.existsSync(path.join(installDir, "agents", record.installRoot!)),
        ).toBe(true);
    });

    it("a failed materialize leaves a prior version-scoped root intact (clean abort)", async () => {
        clearTokenCacheForTest();
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        let fail = false;
        const source = freshCacheSource({
            installDir,
            npmInstall: async ({ spec, cwd }: any) => {
                if (fail) {
                    throw new Error("npm boom");
                }
                const mod = moduleNameFromSpec(spec);
                const dir = path.join(cwd, "node_modules", ...mod.split("/"));
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                    path.join(dir, "package.json"),
                    JSON.stringify({ name: mod, version: "1.0.0" }),
                );
            },
        });
        const first = await source.materialize(
            (await source.find("@typeagent/a-agent@1.0.0"))!,
        );
        const firstDir = path.join(installDir, "agents", first.installRoot!);
        expect(fs.existsSync(firstDir)).toBe(true);

        // A subsequent failed install of a DIFFERENT version targets its own new
        // root (via a temp dir) and must not touch the prior root or the shared
        // installDir (design §5.5 atomic materialize).
        fail = true;
        await expect(
            source.materialize(
                (await source.find("@typeagent/a-agent@2.0.0"))!,
            ),
        ).rejects.toThrow(/npm boom/);
        expect(fs.existsSync(firstDir)).toBe(true);
        expect(
            fs.existsSync(
                path.join(installDir, "agents", "_typeagent_a-agent@2.0.0"),
            ),
        ).toBe(false);
        expect(fs.existsSync(path.join(installDir, "node_modules"))).toBe(
            false,
        );
    });
});

describe("feedSource cache filename sanitization", () => {
    it("does not let a path-separator source name escape installDir", async () => {
        const installDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-feed-"));
        const source = createFeedSource(
            { ...CONFIG, name: "evil/../escape" },
            {
                installDir,
                tokenRunner: goodToken,
                fetchFn: fakeFetch({
                    packages: ["@typeagent/spelunker-agent"],
                    keywords: {
                        "@typeagent/spelunker-agent": ["typeagent-agent"],
                    },
                }),
            },
        );
        // Triggers a refresh which writes the disk cache.
        await source.listAgents!();
        const entries = fs.readdirSync(installDir);
        // The cache file stays directly under installDir (no traversal) and its
        // name contains no path separator, so it cannot escape the directory.
        const cacheFiles = entries.filter((e) => e.includes("feed-cache"));
        expect(cacheFiles.length).toBe(1);
        expect(cacheFiles[0]).not.toContain("/");
        expect(cacheFiles[0]).not.toContain("\\");
        expect(fs.existsSync(path.join(installDir, cacheFiles[0]))).toBe(true);
    });
});

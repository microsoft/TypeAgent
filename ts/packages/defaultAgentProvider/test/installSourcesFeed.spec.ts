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
import { FeedSourceConfig } from "agent-dispatcher";

const REGISTRY =
    "https://pkgs.dev.azure.com/msctoproj/AI_Systems/_packaging/typeagent/npm/registry/";

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

beforeEach(() => {
    clearTokenCacheForTest();
});

describe("parseAzureFeed", () => {
    it("parses a project-scoped registry URL", () => {
        expect(parseAzureFeed(REGISTRY)).toEqual({
            org: "msctoproj",
            project: "AI_Systems",
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
            npmInstall: async ({ spec }: any) => {
                const mod = moduleNameFromSpec(spec);
                const dir = path.join(
                    installDir,
                    "node_modules",
                    ...mod.split("/"),
                );
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, "package.json"), "{}");
            },
        });
        const record = await source.materialize(
            (await source.find("@typeagent/a-agent@1.0.0"))!,
        );
        expect(record.module).toBe("@typeagent/a-agent");
        expect(record.ref).toBe("@typeagent/a-agent@1.0.0");
        expect(record.loaderConfig?.execMode).toBe("separate");
        expect(record.name).toBe("a-agent");
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

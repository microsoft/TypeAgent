// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallSourceRegistry } from "../src/installSources/registry.js";
import {
    createFeedSource,
    moduleNameFromSpec,
} from "../src/installSources/feedSource.js";
import { clearTokenCacheForTest } from "../src/installSources/feedAuth.js";
import {
    FeedSourceConfig,
    InstallSourceConfig,
} from "../src/installSources/config.js";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeCatalog(name: string, agents: object): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ta-reg-${name}-`));
    const file = path.join(dir, "agents.catalog.json");
    fs.writeFileSync(file, JSON.stringify({ agents }));
    return file;
}

function tmpInstallDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ta-reg-install-"));
}

const goodToken = async () =>
    JSON.stringify({
        accessToken: "fake-token",
        expiresOn: new Date(Date.now() + 3600_000).toISOString(),
    });

beforeEach(() => clearTokenCacheForTest());

describe("InstallSourceRegistry resolution", () => {
    function twoCatalogRegistry(orderNames: string[] = ["a", "b"]) {
        const a = writeCatalog("a", { dup: { name: "module-a" } });
        const b = writeCatalog("b", {
            dup: { name: "module-b" },
            onlyb: { name: "module-onlyb" },
        });
        const byName: Record<string, InstallSourceConfig> = {
            a: { kind: "catalog", name: "a", catalog: a },
            b: { kind: "catalog", name: "b", catalog: b },
        };
        const configs = orderNames.map((name) => byName[name]);
        return createInstallSourceRegistry(configs, {
            installDir: tmpInstallDir(),
        });
    }

    it("resolves to the first source in order that matches", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const record = await registry.resolve("dup");
        expect(record.module).toBe("module-a");
        expect(record.source).toBe("a");
    });

    it("honors a changed order (first-match-wins)", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        registry.setOrder(["b", "a"]);
        const record = await registry.resolve("dup");
        expect(record.module).toBe("module-b");
    });

    it("falls through non-matching sources to a later match", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const record = await registry.resolve("onlyb");
        expect(record.module).toBe("module-onlyb");
        expect(record.source).toBe("b");
    });

    it("probes sources sequentially and stops at the first match", async () => {
        // "dup" exists in both catalogs; with order [a, b] the walk must match
        // 'a' and never probe 'b'.
        const registry = twoCatalogRegistry(["a", "b"]);
        const probed: string[] = [];
        const a = registry.get("a")!;
        const b = registry.get("b")!;
        const wrapFind = (source: typeof a) => {
            const original = source.find.bind(source);
            source.find = (ref, onWarn) => {
                probed.push(source.name);
                return original(ref, onWarn);
            };
        };
        wrapFind(a);
        wrapFind(b);
        await registry.resolve("dup");
        expect(probed).toEqual(["a"]);
    });

    it("reports each probed source to the status sink", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const status: string[] = [];
        // "onlyb" only matches 'b', so both sources are probed in order.
        await registry.resolve("onlyb", undefined, undefined, (m) =>
            status.push(m),
        );
        expect(status).toEqual([
            "Trying source 'a'...",
            "Trying source 'b'...",
        ]);
    });

    it("reports the named source to the status sink for an explicit --source", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const status: string[] = [];
        await registry.resolve("dup", "b", undefined, (m) => status.push(m));
        expect(status).toEqual(["Resolving 'dup' from source 'b'..."]);
    });

    it("explicit --source bypasses the order", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const record = await registry.resolve("dup", "b");
        expect(record.module).toBe("module-b");
    });

    it("explicit --source non-match is a hard error", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        await expect(registry.resolve("nope", "a")).rejects.toThrow(
            /not found in source 'a'/,
        );
    });

    it("unknown --source name is a hard error", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        await expect(registry.resolve("dup", "zzz")).rejects.toThrow(
            /unknown source 'zzz'/,
        );
    });

    it("errors listing the order when no source matches", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        await expect(registry.resolve("missing")).rejects.toThrow(
            /no source could resolve 'missing'/,
        );
    });

    it("reports a source degrade to the per-command sink every resolve but dedups the server log", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-reg-bad-"));
        const file = path.join(dir, "agents.catalog.json");
        fs.writeFileSync(file, "{ not valid json");
        const registry = createInstallSourceRegistry(
            [{ kind: "catalog", name: "bad", catalog: file }],
            { installDir: tmpInstallDir() },
        );
        const original = console.warn;
        let consoleWarnCount = 0;
        console.warn = () => {
            consoleWarnCount++;
        };
        try {
            const first: string[] = [];
            await expect(
                registry.resolve("x", undefined, (m) => first.push(m)),
            ).rejects.toThrow(/no source could resolve 'x'/);
            const second: string[] = [];
            await expect(
                registry.resolve("x", undefined, (m) => second.push(m)),
            ).rejects.toThrow(/no source could resolve 'x'/);
            // The per-command sink hears the degrade on BOTH resolves...
            expect(first).toHaveLength(1);
            expect(first[0]).toMatch(/catalog source 'bad'/);
            expect(second).toEqual(first);
            // ...but the process-lifetime server-log warning fires only once.
            expect(consoleWarnCount).toBe(1);
        } finally {
            console.warn = original;
        }
    });

    it("where reports the winning source without materializing", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const candidate = await registry.where("dup");
        expect(candidate).toBeDefined();
        expect(candidate!.source).toBe("a");
    });

    it("ignores unknown entries in the order (warn, not error)", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        registry.setOrder(["ghost", "b", "a"]);
        expect(registry.list().map((s) => s.name)).toEqual(["b", "a"]);
        const record = await registry.resolve("dup");
        expect(record.module).toBe("module-b");
    });
});

describe("InstallSourceRegistry add/remove/persist", () => {
    it("add/remove updates list and persists", () => {
        const persisted: { configs: InstallSourceConfig[] }[] = [];
        const registry = createInstallSourceRegistry([], {
            installDir: tmpInstallDir(),
            persist: (configs) => persisted.push({ configs }),
        });
        const cfg: InstallSourceConfig = {
            kind: "catalog",
            name: "a",
            catalog: writeCatalog("add", { x: { name: "mod-x" } }),
        };
        registry.add(cfg);
        expect(registry.list().map((c) => c.name)).toEqual(["a"]);
        expect(persisted.length).toBe(1);

        registry.remove("a");
        expect(registry.list()).toEqual([]);
        // remove also drops the name from the resolution order.
        expect(registry.list().map((s) => s.name)).toEqual([]);
        expect(persisted.length).toBe(2);
    });

    it("rejects duplicate source names on add", () => {
        const registry = createInstallSourceRegistry(
            [{ kind: "path", name: "path" }],
            { installDir: tmpInstallDir() },
        );
        expect(() => registry.add({ kind: "path", name: "path" })).toThrow(
            /already exists/,
        );
    });

    it("remove of an unknown source is an error", () => {
        const registry = createInstallSourceRegistry([], {
            installDir: tmpInstallDir(),
        });
        expect(() => registry.remove("ghost")).toThrow(/unknown source/);
    });

    it("get returns the source or undefined; list reflects add/remove", () => {
        const cfg: InstallSourceConfig = {
            kind: "catalog",
            name: "a",
            catalog: writeCatalog("getlist", { x: { name: "mod-x" } }),
        };
        const registry = createInstallSourceRegistry([], {
            installDir: tmpInstallDir(),
        });
        expect(registry.get("a")).toBeUndefined();
        registry.add(cfg);
        expect(registry.get("a")).toBeDefined();
        expect(registry.list().map((c) => c.name)).toEqual(["a"]);
        registry.remove("a");
        expect(registry.get("a")).toBeUndefined();
        expect(registry.list()).toEqual([]);
    });

    it("setOrder deduplicates repeated names (first wins)", () => {
        const a = writeCatalog("dedupa", { x: { name: "mod-a" } });
        const b = writeCatalog("dedupb", { x: { name: "mod-b" } });
        const registry = createInstallSourceRegistry(
            [
                { kind: "catalog", name: "a", catalog: a },
                { kind: "catalog", name: "b", catalog: b },
            ],
            { installDir: tmpInstallDir() },
        );
        registry.setOrder(["a", "b", "a"]);
        expect(registry.list().map((s) => s.name)).toEqual(["a", "b"]);
    });

    it("sources and order survive a reload from the persisted snapshot", () => {
        // Simulate a restart: capture what the first registry persists, then
        // build a fresh registry from that snapshot and confirm the configured
        // sources and their resolution order round-trip (design §6).
        let snapshot: { configs: InstallSourceConfig[] } = {
            configs: [],
        };
        const installDir = tmpInstallDir();
        const first = createInstallSourceRegistry(
            [{ kind: "path", name: "path" }],
            {
                installDir,
                persist: (configs) => {
                    snapshot = { configs };
                },
            },
        );
        first.add({
            kind: "catalog",
            name: "builtin",
            catalog: writeCatalog("reload", { x: { name: "mod-x" } }),
        });
        first.setOrder(["builtin", "path"]);

        const reloaded = createInstallSourceRegistry(snapshot.configs, {
            installDir,
        });
        expect(reloaded.list().map((s) => s.name)).toEqual(["builtin", "path"]);
    });
});

describe("InstallSourceRegistry serializes concurrent install ops", () => {
    it("never runs two materialize (npm install) ops at once", async () => {
        const installDir = tmpInstallDir();
        const cacheFilePath = path.join(installDir, "cache.json");
        fs.writeFileSync(
            cacheFilePath,
            JSON.stringify({
                fetchedAt: 1000,
                packages: ["@typeagent/a-agent", "@typeagent/b-agent"],
            }),
        );
        let concurrent = 0;
        let maxConcurrent = 0;
        const feedConfig: InstallSourceConfig = {
            kind: "feed",
            name: "typeagent",
            registry:
                "https://pkgs.dev.azure.com/myorg/myproject/_packaging/typeagent/npm/registry/",
            scopes: ["@typeagent"],
        };
        const registry = createInstallSourceRegistry(
            [feedConfig],
            { installDir },
            // Inject a feed source with a stubbed npm install via the builder
            // seam, so no test-only dependency field is needed on RegistryDeps.
            (config) =>
                createFeedSource(config as FeedSourceConfig, {
                    installDir,
                    tokenRunner: goodToken,
                    now: () => 1000,
                    cacheFilePath,
                    // find pins a concrete version from the packument before
                    // materialize runs; serve one for either requested agent.
                    fetchFn: (async () => ({
                        ok: true,
                        status: 200,
                        statusText: "OK",
                        json: async () => ({
                            versions: { "1.0.0": {} },
                            "dist-tags": { latest: "1.0.0" },
                        }),
                    })) as unknown as typeof fetch,
                    npmInstall: async ({ spec, cwd }) => {
                        concurrent++;
                        maxConcurrent = Math.max(maxConcurrent, concurrent);
                        await delay(40);
                        const mod = moduleNameFromSpec(spec);
                        const dir = path.join(
                            cwd,
                            "node_modules",
                            ...mod.split("/"),
                        );
                        fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(
                            path.join(dir, "package.json"),
                            JSON.stringify({ name: mod, version: "1.0.0" }),
                        );
                        concurrent--;
                    },
                }),
        );

        await Promise.all([
            registry.resolve("@typeagent/a-agent@1.0.0"),
            registry.resolve("@typeagent/b-agent@1.0.0"),
        ]);
        expect(maxConcurrent).toBe(1);
    });
});

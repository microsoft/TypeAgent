// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallSourceRegistry } from "../src/installSources/registry.js";
import {
    AGENT_KEYWORD,
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

function writeCatalogWithPackages(
    name: string,
    agents: object,
    packages: Record<string, { name?: string; defaultAgentName?: string }>,
): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ta-reg-${name}-`));
    const file = path.join(dir, "agents.catalog.json");
    fs.writeFileSync(file, JSON.stringify({ agents }));
    for (const [sub, meta] of Object.entries(packages)) {
        const pkgDir = path.join(dir, sub);
        fs.mkdirSync(pkgDir, { recursive: true });
        const pkg: Record<string, unknown> = {};
        if (meta.name !== undefined) {
            pkg.name = meta.name;
        }
        if (meta.defaultAgentName !== undefined) {
            pkg.typeagent = { defaultAgentName: meta.defaultAgentName };
        }
        fs.writeFileSync(
            path.join(pkgDir, "package.json"),
            JSON.stringify(pkg),
        );
    }
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
    // Catalog entries are matched by PACKAGE NAME (find), not the internal key.
    // Scoped package names are not legal agent names, so one-argument resolution
    // skips phase-1 (findName) and goes straight to the phase-2 ref (find) walk -
    // the same first-match-wins ordered walk the old key-based resolve used.
    function twoCatalogRegistry(orderNames: string[] = ["a", "b"]) {
        const a = writeCatalogWithPackages(
            "a",
            { entryA: { path: "shared" } },
            { shared: { name: "@scope/shared-pkg" } },
        );
        const b = writeCatalogWithPackages(
            "b",
            {
                entryB: { path: "shared" },
                onlyb: { path: "onlyb" },
            },
            {
                shared: { name: "@scope/shared-pkg" },
                onlyb: { name: "@scope/onlyb-pkg" },
            },
        );
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
        const { record } = await registry.resolve("x", "@scope/shared-pkg");
        expect(record.path).toBeDefined();
        expect(record.module).toBeUndefined();
        expect(record.source).toBe("a");
    });

    it("honors a changed order (first-match-wins)", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        registry.setOrder(["b", "a"]);
        const { record } = await registry.resolve("x", "@scope/shared-pkg");
        expect(record.source).toBe("b");
    });

    it("falls through non-matching sources to a later match", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const { record } = await registry.resolve("x", "@scope/onlyb-pkg");
        expect(record.path).toBeDefined();
        expect(record.module).toBeUndefined();
        expect(record.source).toBe("b");
    });

    it("probes sources sequentially and stops at the first match", async () => {
        // "@scope/shared-pkg" exists in both catalogs; with order [a, b] the
        // walk must match 'a' and never probe 'b'.
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
        await registry.resolve("x", "@scope/shared-pkg");
        expect(probed).toEqual(["a"]);
    });

    it("reports each probed source to the status sink", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const status: string[] = [];
        // Two-argument ref walk: both sources are probed once in order.
        await registry.resolve(
            "x",
            "@scope/onlyb-pkg",
            undefined,
            undefined,
            (m) => status.push(m),
        );
        expect(status).toEqual([
            "Trying source 'a'...",
            "Trying source 'b'...",
        ]);
    });

    it("reports the named source to the status sink for an explicit ref", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const status: string[] = [];
        // Two-argument form: resolve the ref from an explicit source, name it.
        await registry.resolve(
            "myname",
            "@scope/shared-pkg",
            "b",
            undefined,
            (m) => status.push(m),
        );
        expect(status).toEqual([
            "Resolving '@scope/shared-pkg' from source 'b'...",
        ]);
    });

    it("explicit --source bypasses the order", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const { record } = await registry.resolve(
            "x",
            "@scope/shared-pkg",
            "b",
        );
        expect(record.source).toBe("b");
    });

    it("explicit --source non-match is a hard error", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        await expect(registry.resolve("nope", undefined, "a")).rejects.toThrow(
            /not found in catalog source 'a'/,
        );
    });

    it("unknown --source name is a hard error", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        await expect(
            registry.resolve("@scope/shared-pkg", undefined, "zzz"),
        ).rejects.toThrow(/Unknown source 'zzz'/);
    });

    it("errors listing the order when no source matches", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        await expect(registry.resolve("missing")).rejects.toThrow(
            /No source could resolve 'missing'/,
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
                registry.resolve("x", undefined, undefined, (m) =>
                    first.push(m),
                ),
            ).rejects.toThrow(/No source could resolve 'x'/);
            const second: string[] = [];
            await expect(
                registry.resolve("x", undefined, undefined, (m) =>
                    second.push(m),
                ),
            ).rejects.toThrow(/No source could resolve 'x'/);
            // The per-command sink hears the degrade on BOTH resolves...
            expect(first.length).toBeGreaterThan(0);
            expect(first[0]).toMatch(/catalog source 'bad'/);
            expect(second).toEqual(first);
            // ...but the process-lifetime server-log warning fires only once.
            expect(consoleWarnCount).toBe(1);
        } finally {
            console.warn = original;
        }
    });

    it("preview reports the winning source without materializing", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const preview = await registry.preview("x", "@scope/shared-pkg");
        expect(preview).toBeDefined();
        expect(preview!.winner.source).toBe("a");
    });

    it("ignores unknown entries in the order (warn, not error)", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        registry.setOrder(["ghost", "b", "a"]);
        expect(registry.list().map((s) => s.name)).toEqual(["b", "a"]);
        const { record } = await registry.resolve("x", "@scope/shared-pkg");
        expect(record.source).toBe("b");
    });
});

describe("InstallSourceRegistry one-argument name resolution", () => {
    // A path source rooted at a temp dir plus a package subdir carrying a
    // package.json with a name and (optionally) a default agent name.
    function pathRegistryWithPackage(
        sub: string,
        meta: { name?: string; defaultAgentName?: string },
    ) {
        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-reg-path-"));
        const pkgDir = path.join(baseDir, sub);
        fs.mkdirSync(pkgDir, { recursive: true });
        const pkg: Record<string, unknown> = {};
        if (meta.name !== undefined) {
            pkg.name = meta.name;
        }
        if (meta.defaultAgentName !== undefined) {
            pkg.typeagent = { defaultAgentName: meta.defaultAgentName };
        }
        fs.writeFileSync(
            path.join(pkgDir, "package.json"),
            JSON.stringify(pkg),
        );
        const registry = createInstallSourceRegistry(
            [{ kind: "path", name: "path", baseDir }],
            { installDir: tmpInstallDir() },
        );
        return { registry, pkgDir };
    }

    // A catalog whose single path entry resolves to a package with a default
    // agent name (so the catalog can answer findName).
    function catalogWithDefaultName(
        name: string,
        opts: { catalogName?: string } = {},
    ): { catalogName: string; catalog: string } {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-reg-cat-"));
        const pkgDir = path.join(dir, "pkg");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
            path.join(pkgDir, "package.json"),
            JSON.stringify({
                name: `@x/${name}-agent`,
                typeagent: { defaultAgentName: name },
            }),
        );
        const catalog = path.join(dir, "agents.catalog.json");
        fs.writeFileSync(
            catalog,
            JSON.stringify({ agents: { entry: { path: "pkg" } } }),
        );
        return { catalogName: opts.catalogName ?? "catalog", catalog };
    }

    it("infers the installed name from a path package.json defaultAgentName", async () => {
        const { registry, pkgDir } = pathRegistryWithPackage("weather", {
            name: "@x/weather-agent",
            defaultAgentName: "weather",
        });
        // A path-shaped target skips phase 1 and matches the path source's find.
        const { record, matchedByName } = await registry.resolve("./weather");
        expect(record.name).toBe("weather");
        expect(record.path).toBe(pkgDir);
        expect(matchedByName).toBe(false); // path is a phase-2 ref match
    });

    it("fails a one-argument path install with no default name and suggests two-arg", async () => {
        const { registry } = pathRegistryWithPackage("bare", {
            name: "@x/bare",
        });
        await expect(registry.resolve("./bare")).rejects.toThrow(
            /Path '\.\/bare' from path source 'path' has no default agent name.*@package install \.\/bare <name>/s,
        );
    });

    it("a catalog package match with no default name errors with the package (not path) form", async () => {
        // A catalog `path` entry carries BOTH a resolved path and a package
        // name; matching it by package name with no default name must report
        // the package, not "resolved as a path" (regression: the `echo` entry).
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-reg-cat-"));
        const pkgDir = path.join(dir, "echo");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
            path.join(pkgDir, "package.json"),
            JSON.stringify({ name: "echo" }),
        );
        const catalog = path.join(dir, "agents.catalog.json");
        fs.writeFileSync(
            catalog,
            JSON.stringify({ agents: { echo: { path: "echo" } } }),
        );
        const registry = createInstallSourceRegistry(
            [{ kind: "catalog", name: "workspace", catalog }],
            { installDir: tmpInstallDir() },
        );
        await expect(registry.resolve("echo")).rejects.toThrow(
            "Package 'echo' from catalog source 'workspace' has no default agent name. Use '@package install echo <name>'.",
        );
    });

    it("a phase-1 findName match beats a higher-priority path find", async () => {
        // A 'weather' directory exists under the higher-priority path source AND
        // a catalog offers default name 'weather'; the catalog wins because
        // findName (phase 1) precedes the path find (phase 2).
        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-reg-path-"));
        fs.mkdirSync(path.join(baseDir, "weather"), { recursive: true });
        const { catalog } = catalogWithDefaultName("weather");
        const registry = createInstallSourceRegistry(
            [
                { kind: "path", name: "path", baseDir },
                { kind: "catalog", name: "catalog", catalog },
            ],
            { installDir: tmpInstallDir() },
        );
        const { record, matchedByName } = await registry.resolve("weather");
        expect(matchedByName).toBe(true);
        expect(record.source).toBe("catalog");
        expect(record.name).toBe("weather");
    });

    it("preview lists every matching source across both phases in priority order", async () => {
        // Two catalogs each declare default name 'weather'; phase-1 findName
        // matches both, first-in-order wins and the shadow is reported.
        const a = catalogWithDefaultName("weather", { catalogName: "cat1" });
        const b = catalogWithDefaultName("weather", { catalogName: "cat2" });
        const registry = createInstallSourceRegistry(
            [
                { kind: "catalog", name: "cat1", catalog: a.catalog },
                { kind: "catalog", name: "cat2", catalog: b.catalog },
            ],
            { installDir: tmpInstallDir() },
        );
        const preview = await registry.preview("weather");
        expect(preview).toBeDefined();
        expect(preview!.winner.source).toBe("cat1");
        expect(preview!.winner.matchedByName).toBe(true);
        expect(preview!.matches.map((m) => m.source)).toEqual(["cat1", "cat2"]);
    });

    it("preview succeeds when a lower-priority shadow has no default agent name", async () => {
        // The winner matches by default name (phase 1); a lower-priority source
        // shadows it by PACKAGE name (phase 2) but declares no default agent
        // name. The shadow's installed name is never shown, so requiring one for
        // it must not abort the whole preview (regression).
        const winner = catalogWithDefaultName("weather", {
            catalogName: "cat1",
        });
        // A path-backed package whose package name is 'weather' with no
        // default agent name: it matches phase-2 find but cannot infer a name.
        const shadowDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-reg-cat-"));
        const shadowPkgDir = path.join(shadowDir, "pkg");
        fs.mkdirSync(shadowPkgDir, { recursive: true });
        fs.writeFileSync(
            path.join(shadowPkgDir, "package.json"),
            JSON.stringify({ name: "weather" }),
        );
        const shadowCatalog = path.join(shadowDir, "agents.catalog.json");
        fs.writeFileSync(
            shadowCatalog,
            JSON.stringify({ agents: { entry: { path: "pkg" } } }),
        );
        const registry = createInstallSourceRegistry(
            [
                { kind: "catalog", name: "cat1", catalog: winner.catalog },
                { kind: "catalog", name: "cat2", catalog: shadowCatalog },
            ],
            { installDir: tmpInstallDir() },
        );
        const preview = await registry.preview("weather");
        expect(preview).toBeDefined();
        expect(preview!.winner.source).toBe("cat1");
        expect(preview!.winner.matchedByName).toBe(true);
        expect(preview!.winner.name).toBe("weather");
        // Both phases are reported; the nameless shadow does not abort the walk.
        expect(preview!.matches.map((m) => m.source)).toEqual(["cat1", "cat2"]);
        expect(preview!.matches[1].matchedByName).toBe(false);
    });

    it("source filter runs the two-phase walk over a one-source list", async () => {
        const { catalog } = catalogWithDefaultName("weather");
        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-reg-path-"));
        fs.mkdirSync(path.join(baseDir, "weather"), { recursive: true });
        const registry = createInstallSourceRegistry(
            [
                { kind: "path", name: "path", baseDir },
                { kind: "catalog", name: "catalog", catalog },
            ],
            { installDir: tmpInstallDir() },
        );
        // Restricting to the catalog resolves by default agent name there only.
        const { record } = await registry.resolve(
            "weather",
            undefined,
            "catalog",
        );
        expect(record.source).toBe("catalog");
        expect(record.name).toBe("weather");
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
        // sources and their resolution order round-trip (6).
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
                            versions: {
                                "1.0.0": {
                                    keywords: [AGENT_KEYWORD],
                                },
                            },
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
                            JSON.stringify({
                                name: mod,
                                version: "1.0.0",
                            }),
                        );
                        concurrent--;
                    },
                }),
        );

        await Promise.all([
            registry.resolve("a", "@typeagent/a-agent@1.0.0"),
            registry.resolve("b", "@typeagent/b-agent@1.0.0"),
        ]);
        expect(maxConcurrent).toBe(1);
    });
});

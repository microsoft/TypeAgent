// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallSourceRegistry } from "../src/installSources/registry.js";
import { moduleNameFromSpec } from "../src/installSources/feedSource.js";
import { clearTokenCacheForTest } from "../src/installSources/feedAuth.js";
import { InstallSourceConfig } from "agent-dispatcher";

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
    function twoCatalogRegistry(order: string[]) {
        const a = writeCatalog("a", { dup: { name: "module-a" } });
        const b = writeCatalog("b", {
            dup: { name: "module-b" },
            onlyb: { name: "module-onlyb" },
        });
        const configs: InstallSourceConfig[] = [
            { kind: "catalog", name: "a", catalog: a },
            { kind: "catalog", name: "b", catalog: b },
        ];
        return createInstallSourceRegistry(configs, order, {
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

    it("where reports the winning source without materializing", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        const candidate = await registry.where("dup");
        expect(candidate).toBeDefined();
        expect(candidate!.source).toBe("a");
    });

    it("ignores unknown entries in the order (warn, not error)", async () => {
        const registry = twoCatalogRegistry(["a", "b"]);
        registry.setOrder(["ghost", "b", "a"]);
        expect(registry.order().map((s) => s.name)).toEqual(["b", "a"]);
        const record = await registry.resolve("dup");
        expect(record.module).toBe("module-b");
    });
});

describe("InstallSourceRegistry add/remove/persist", () => {
    it("add/remove updates list and persists", () => {
        const persisted: { configs: InstallSourceConfig[]; order: string[] }[] =
            [];
        const registry = createInstallSourceRegistry([], ["a"], {
            installDir: tmpInstallDir(),
            persist: (configs, order) => persisted.push({ configs, order }),
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
        expect(persisted.length).toBe(2);
    });

    it("rejects duplicate source names on add", () => {
        const registry = createInstallSourceRegistry(
            [{ kind: "path", name: "path" }],
            [],
            { installDir: tmpInstallDir() },
        );
        expect(() => registry.add({ kind: "path", name: "path" })).toThrow(
            /already exists/,
        );
    });

    it("remove of an unknown source is an error", () => {
        const registry = createInstallSourceRegistry([], [], {
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
        const registry = createInstallSourceRegistry([], [], {
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
            [],
            { installDir: tmpInstallDir() },
        );
        registry.setOrder(["a", "b", "a"]);
        expect(registry.order().map((s) => s.name)).toEqual(["a", "b"]);
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
        const registry = createInstallSourceRegistry(
            [
                {
                    kind: "feed",
                    name: "typeagent",
                    registry:
                        "https://pkgs.dev.azure.com/msctoproj/AI_Systems/_packaging/typeagent/npm/registry/",
                    scopes: ["@typeagent"],
                },
            ],
            ["typeagent"],
            {
                installDir,
                feedDeps: {
                    tokenRunner: goodToken,
                    now: () => 1000,
                    cacheFilePath,
                    npmInstall: async ({ spec }) => {
                        concurrent++;
                        maxConcurrent = Math.max(maxConcurrent, concurrent);
                        await delay(40);
                        const mod = moduleNameFromSpec(spec);
                        const dir = path.join(
                            installDir,
                            "node_modules",
                            ...mod.split("/"),
                        );
                        fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(path.join(dir, "package.json"), "{}");
                        concurrent--;
                    },
                },
            },
        );

        await Promise.all([
            registry.resolve("@typeagent/a-agent@1.0.0"),
            registry.resolve("@typeagent/b-agent@1.0.0"),
        ]);
        expect(maxConcurrent).toBe(1);
    });
});

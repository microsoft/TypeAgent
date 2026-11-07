// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createMemoryViewPackageManager } from "../src/memoryViewPackages.js";
import { createInstallSourceRegistry } from "../src/installSources/registry.js";

let root: string;
let pack: string;
const sources = () => [{ name: "local", kind: "path" as const }];
const manager = () =>
    createMemoryViewPackageManager({
        directory: path.join(root, "installed"),
        sources: sources(),
    });

beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "memory-view-install-"));
    pack = path.join(root, "pack");
    await mkdir(pack);
    await writeFile(
        path.join(pack, "package.json"),
        JSON.stringify({
            name: "synthetic-pack",
            version: "1.0.0",
            type: "module",
            typeagent: {
                defaultMemoryViewName: "views",
                defaultAgentName: "agent",
            },
            exports: {
                "./memory/views/manifest": "./pack.json",
                "./memory/views/provider": "./provider.mjs",
            },
        }),
    );
    await writeFile(
        path.join(pack, "pack.json"),
        JSON.stringify({
            schemaVersion: 1,
            packId: "synthetic-pack",
            files: ["provider.mjs"],
            providers: [{ providerId: "synthetic", factory: "create" }],
        }),
    );
    await writeFile(
        path.join(pack, "provider.mjs"),
        "throw new Error('Installation must not import code')",
    );
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

test("path preview/install/restart/uninstall never activate executable pack code", async () => {
    expect((await manager().preview(pack))?.winner.name).toBe("views");
    expect(await manager().list()).toEqual([]);
    expect((await manager().install(pack)).name).toBe("views");
    expect((await manager().list())[0].installation.packageVersion).toBe(
        "1.0.0",
    );
    await manager().install(pack);
    await manager().uninstall("views");
    expect(await manager().list()).toEqual([]);
    expect(await readFile(path.join(pack, "provider.mjs"), "utf8")).toContain(
        "throw",
    );
});

test("changed assets require explicit update and failed updates preserve inventory", async () => {
    await manager().install(pack);
    await writeFile(path.join(pack, "provider.mjs"), "Changed");
    await expect(manager().list()).rejects.toThrow("changed");
    await manager().update("views");
    const stored = await readFile(
        path.join(root, "installed", "memory-views.json"),
        "utf8",
    );
    await rm(path.join(pack, "pack.json"));
    await expect(manager().update("views")).rejects.toThrow();
    expect(
        await readFile(
            path.join(root, "installed", "memory-views.json"),
            "utf8",
        ),
    ).toBe(stored);
    await manager().uninstall("views");
});

test("catalog memoryViews inventory is separate from agents", async () => {
    const catalog = path.join(root, "catalog.json");
    await writeFile(
        catalog,
        JSON.stringify({
            agents: { agent: { path: "./pack" } },
            memoryViews: { views: { path: "./pack" } },
        }),
    );
    const configs = [{ name: "catalog", kind: "catalog" as const, catalog }];
    const packs = createMemoryViewPackageManager({
        directory: path.join(root, "installed"),
        sources: configs,
    });
    expect((await packs.available())[0].extensionKind).toBe("memory-view");
    expect((await packs.install("views")).name).toBe("views");
    const agents = createInstallSourceRegistry(configs, {
        installDir: path.join(root, "agents"),
    });
    expect((await agents.preview("agent"))?.winner.name).toBe("agent");
});

test("concurrent manager writes retain both installs", async () => {
    const other = path.join(root, "other");
    await mkdir(other);
    for (const filename of ["package.json", "pack.json", "provider.mjs"])
        await writeFile(
            path.join(other, filename),
            (await readFile(path.join(pack, filename), "utf8")).replaceAll(
                '"views"',
                '"other"',
            ),
        );
    await Promise.all([manager().install(pack), manager().install(other)]);
    expect((await manager().list()).map((item) => item.name).sort()).toEqual([
        "other",
        "views",
    ]);
});

test("unknown sources, uninstalled selections and malformed stores fail explicitly", async () => {
    await expect(manager().install(pack, "missing")).rejects.toThrow("Unknown");
    await expect(manager().load("missing", [])).rejects.toThrow(
        "not installed",
    );
    await mkdir(path.join(root, "installed"), { recursive: true });
    await writeFile(
        path.join(root, "installed", "memory-views.json"),
        '{"schemaVersion":2,"packages":[]}',
    );
    await expect(manager().list()).rejects.toThrow("inventory");
});

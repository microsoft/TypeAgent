// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCatalogSource } from "../src/installSources/catalogSource.js";

function writeCatalog(agents: object): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-catalog-"));
    const file = path.join(dir, "agents.catalog.json");
    fs.writeFileSync(file, JSON.stringify({ agents }));
    return file;
}

// Write a catalog plus one or more sibling package directories (each with a
// package.json) that `path` entries can resolve against. `find` matches the
// package.json `name`; `findName` matches `typeagent.defaultAgentName`.
function writeCatalogWithPackages(
    agents: object,
    packages: Record<string, { name?: string; defaultAgentName?: string }>,
): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-catalog-"));
    const file = path.join(dir, "agents.catalog.json");
    fs.writeFileSync(file, JSON.stringify({ agents }));
    for (const [sub, meta] of Object.entries(packages)) {
        const pdir = path.join(dir, sub);
        fs.mkdirSync(pdir, { recursive: true });
        const pkg: Record<string, unknown> = {};
        if (meta.name !== undefined) {
            pkg.name = meta.name;
        }
        if (meta.defaultAgentName !== undefined) {
            pkg.typeagent = { defaultAgentName: meta.defaultAgentName };
        }
        fs.writeFileSync(path.join(pdir, "package.json"), JSON.stringify(pkg));
    }
    return file;
}

describe("catalogSource", () => {
    it("find matches a module-only entry by package name and records module", async () => {
        const file = writeCatalog({
            player: { name: "music" },
        });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        // Matched by PACKAGE NAME ("music"), not the internal key ("player").
        const candidate = await source.find("music");
        expect(candidate).toBeDefined();
        expect(candidate!.source).toBe("workspace");
        expect(candidate!.module).toBe("music");
        expect(candidate!.packageName).toBe("music");
        expect(candidate!.ref).toBe("player"); // key kept as the durable handle
        expect(candidate!.path).toBeUndefined();

        const record = await source.materialize(candidate!);
        expect(record.module).toBe("music");
        expect(record.path).toBeUndefined();
        expect(record.source).toBe("workspace");
    });

    it("does not match a catalog entry by its internal key", async () => {
        const file = writeCatalog({ player: { name: "music" } });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        // The key is internal: it is never a user-facing find target.
        expect(await source.find("player")).toBeUndefined();
    });

    it("find matches a path entry by its package.json name", async () => {
        const file = writeCatalogWithPackages(
            { montage: { path: "montage" } },
            { montage: { name: "montage-agent" } },
        );
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const candidate = await source.find("montage-agent");
        expect(candidate).toBeDefined();
        expect(candidate!.path).toBe(
            path.resolve(path.dirname(file), "montage"),
        );
        expect(candidate!.packageName).toBe("montage-agent");
        expect(candidate!.module).toBeUndefined();

        const record = await source.materialize(candidate!);
        expect(record.path).toBe(path.resolve(path.dirname(file), "montage"));
        expect(record.module).toBeUndefined();
    });

    it("findName matches a path entry by its default agent name", async () => {
        const file = writeCatalogWithPackages(
            { weatherKey: { path: "weather" } },
            {
                weather: {
                    name: "@x/weather-agent",
                    defaultAgentName: "weather",
                },
            },
        );
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const candidate = await source.findName!("weather");
        expect(candidate).toBeDefined();
        expect(candidate!.defaultAgentName).toBe("weather");
        expect(candidate!.packageName).toBe("@x/weather-agent");
        expect(candidate!.ref).toBe("weatherKey");
    });

    it("findName does not match a module-only entry (no local package.json)", async () => {
        const file = writeCatalog({ player: { name: "music" } });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        expect(await source.findName!("music")).toBeUndefined();
    });

    it("findName fails as ambiguous when two entries share a default agent name", async () => {
        const file = writeCatalogWithPackages(
            { a: { path: "a" }, b: { path: "b" } },
            {
                a: { name: "weather-agent", defaultAgentName: "weather" },
                b: {
                    name: "weather-preview-agent",
                    defaultAgentName: "weather",
                },
            },
        );
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        await expect(source.findName!("weather")).rejects.toThrow(
            /multiple packages with default agent name 'weather'/,
        );
    });

    it("find carries execMode from the catalog entry (Q6)", async () => {
        const file = writeCatalog({
            chat: { name: "chat-agent", execMode: "dispatcher" },
        });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const record = await source.materialize(
            (await source.find("chat-agent"))!,
        );
        expect(record.loaderConfig?.execMode).toBe("dispatcher");
    });

    it("find returns undefined for an unknown package name (non-match)", async () => {
        const file = writeCatalog({ player: { name: "music" } });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        expect(await source.find("nope")).toBeUndefined();
    });

    it("drops an entry with neither path nor name (non-match, Q17)", async () => {
        const file = writeCatalog({
            broken: {},
            player: { name: "music" },
        });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        // Malformed entry is dropped (non-match), not thrown, so the resolve
        // walk continues and the rest of the catalog stays usable.
        expect(await source.find("music")).toBeDefined();
        // The dropped entry is never advertised in the enumeration rows.
        const rows = await source.listAgents!();
        expect(rows.map((r) => r.packageName)).toEqual(["music"]);
    });

    it("listAgents enumerates install rows (name + package)", async () => {
        const file = writeCatalogWithPackages(
            { playerKey: { path: "player" }, calendar: { name: "calendar" } },
            { player: { name: "@x/music", defaultAgentName: "music" } },
        );
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const rows = (await source.listAgents!()).sort((a, b) =>
            (a.packageName ?? "").localeCompare(b.packageName ?? ""),
        );
        expect(rows).toEqual([
            {
                source: "workspace",
                ref: "playerKey",
                defaultAgentName: "music",
                packageName: "@x/music",
            },
            {
                source: "workspace",
                ref: "calendar",
                packageName: "calendar",
            },
        ]);
    });

    it("degrades a corrupt user catalog to no agents (non-match, logged)", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-catalog-bad-"));
        const file = path.join(dir, "agents.catalog.json");
        fs.writeFileSync(file, "{ not valid json");
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        // Resolve walk must continue (no throw): non-match + empty enumeration.
        expect(await source.find("anything")).toBeUndefined();
        expect(await source.listAgents!()).toEqual([]);
    });

    it("degrades a missing user catalog file to no agents", async () => {
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: path.join(os.tmpdir(), "ta-does-not-exist.catalog.json"),
        });
        expect(await source.find("anything")).toBeUndefined();
    });

    it("forwards a corrupt-catalog degrade to the per-command onWarn sink", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-catalog-bad-"));
        const file = path.join(dir, "agents.catalog.json");
        fs.writeFileSync(file, "{ not valid json");
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const warnings: string[] = [];
        expect(
            await source.find("anything", (m) => warnings.push(m)),
        ).toBeUndefined();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/catalog source 'workspace'/);
        expect(warnings[0]).toMatch(/not valid JSON/);
    });

    it("forwards a dropped malformed entry to the per-command onWarn sink during enumeration", async () => {
        const file = writeCatalog({ broken: {}, player: { name: "music" } });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const warnings: string[] = [];
        await source.listAgents!((m) => warnings.push(m));
        expect(warnings).toEqual([
            "catalog source 'workspace': entry 'broken' has neither 'path' nor 'name' - dropped",
        ]);
    });

    it("materialize persists the catalog key as `ref` (its re-resolution handle)", async () => {
        const file = writeCatalog({ music: { name: "music-agent" } });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const candidate = await source.find("music-agent");
        const record = await source.materialize(candidate!);
        expect(record.module).toBe("music-agent");
        expect(record.ref).toBe("music"); // key persisted for @update
    });

    it("does not provide update capability", async () => {
        const file = writeCatalog({ music: { name: "music-agent" } });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        expect(source.update).toBeUndefined();
    });

    it("reads the catalog once at startup and ignores later edits (no live reload)", async () => {
        const file = writeCatalog({ player: { name: "music" } });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        // Rewrite the catalog AFTER the source was built.
        fs.writeFileSync(
            file,
            JSON.stringify({ agents: { player: { name: "renamed" } } }),
        );
        // The snapshot taken at startup still wins: the old name resolves and
        // the edited name does not.
        expect(await source.find("music")).toBeDefined();
        expect(await source.find("renamed")).toBeUndefined();
    });
});

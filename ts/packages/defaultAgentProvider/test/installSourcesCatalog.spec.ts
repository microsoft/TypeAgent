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

describe("catalogSource", () => {
    it("find looks up a module-only entry and records module", async () => {
        const file = writeCatalog({
            player: { name: "music" },
        });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const candidate = await source.find("player");
        expect(candidate).toBeDefined();
        expect(candidate!.source).toBe("workspace");
        expect(candidate!.module).toBe("music");
        expect(candidate!.path).toBeUndefined();

        const record = await source.materialize(candidate!);
        expect(record.module).toBe("music");
        expect(record.path).toBeUndefined();
        expect(record.source).toBe("workspace");
    });

    it("find resolves a path entry against the catalog dir and omits module", async () => {
        const file = writeCatalog({
            montage: { name: "montage-agent", path: "montage" },
        });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const candidate = await source.find("montage");
        expect(candidate).toBeDefined();
        expect(candidate!.path).toBe(
            path.resolve(path.dirname(file), "montage"),
        );
        expect(candidate!.module).toBeUndefined();

        const record = await source.materialize(candidate!);
        expect(record.path).toBe(path.resolve(path.dirname(file), "montage"));
        expect(record.module).toBeUndefined();
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
        const record = await source.materialize((await source.find("chat"))!);
        expect(record.loaderConfig?.execMode).toBe("dispatcher");
    });

    it("find returns undefined for an unknown short name (non-match)", async () => {
        const file = writeCatalog({ player: { name: "music" } });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        expect(await source.find("nope")).toBeUndefined();
    });

    it("drops an entry with neither path nor name (warn + non-match, Q17)", async () => {
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
        expect(await source.find("broken")).toBeUndefined();
        expect(await source.find("player")).toBeDefined();
        // The dropped entry is never advertised.
        expect(await source.listAgents!()).toEqual(["player"]);
    });

    it("listAgents enumerates the catalog keys", async () => {
        const file = writeCatalog({
            player: { name: "music" },
            calendar: { name: "calendar" },
        });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const agents = await source.listAgents!();
        expect(agents.sort()).toEqual(["calendar", "player"]);
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
        expect(await source.find("anything", (m) => warnings.push(m)))
            .toBeUndefined();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/catalog source 'workspace'/);
        expect(warnings[0]).toMatch(/not valid JSON/);
    });

    it("forwards a dropped malformed entry to the per-command onWarn sink", async () => {
        const file = writeCatalog({ broken: {}, player: { name: "music" } });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        const warnings: string[] = [];
        expect(await source.find("broken", (m) => warnings.push(m)))
            .toBeUndefined();
        expect(await source.find("player", (m) => warnings.push(m)))
            .toBeDefined();
        expect(warnings).toEqual([
            "catalog source 'workspace': entry 'broken' has neither 'path' nor 'name' - dropped",
        ]);
    });
});

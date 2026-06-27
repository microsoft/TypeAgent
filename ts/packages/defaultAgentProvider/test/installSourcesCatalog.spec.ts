// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCatalogSource } from "../src/installSources/catalogSource.js";
import {
    BUNDLED_CATALOG,
    loadBundledCatalog,
} from "../src/installSources/catalog.js";
import { getProviderConfig } from "../src/utils/config.js";

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
        expect(record.name).toBe("player");
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
        expect(record.execMode).toBe("dispatcher");
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

    it("find fails fast for an entry with neither path nor name (Q17)", async () => {
        const file = writeCatalog({ broken: {} });
        const source = createCatalogSource({
            kind: "catalog",
            name: "workspace",
            catalog: file,
        });
        await expect(source.find("broken")).rejects.toThrow(
            /neither 'path' nor 'name'/,
        );
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

    it("resolves the bundled catalog ('<bundled>')", async () => {
        const source = createCatalogSource({
            kind: "catalog",
            name: "builtin",
            catalog: BUNDLED_CATALOG,
        });
        const candidate = await source.find("player");
        expect(candidate).toBeDefined();
        expect(candidate!.module).toBe("music");
        const record = await source.materialize(candidate!);
        expect(record.name).toBe("player");
        expect(record.source).toBe("builtin");
    });

    it("bundled catalog mirrors the default config.json agents (1.2 data move)", () => {
        const catalog = loadBundledCatalog();
        const configAgents = getProviderConfig().agents;
        // Same agent set.
        expect(Object.keys(catalog.agents).sort()).toEqual(
            Object.keys(configAgents).sort(),
        );
        // Same package name + execMode per agent; all flagged preinstall.
        for (const [name, info] of Object.entries(catalog.agents)) {
            expect(info.name).toBe(configAgents[name].name);
            expect(info.execMode).toBe(configAgents[name].execMode);
            expect(info.preinstall).toBe(true);
        }
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
});

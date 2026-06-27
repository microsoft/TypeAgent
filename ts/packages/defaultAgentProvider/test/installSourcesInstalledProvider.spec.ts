// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    createInstalledAppAgentProvider,
    getAppBundleRequirePath,
    readAgentsJson,
    loadInstalledRecords,
} from "../src/installSources/installedAgents.js";
import {
    getDefaultAppAgentInstaller,
    getDefaultAppAgentProviders,
} from "../src/defaultAgentProviders.js";
import { InstalledAgentRecord } from "agent-dispatcher";

function tmpDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Build a temp shared install root holding a resolvable agent package, so a
// `module` record can resolve from installDir (the feed-install case) rather
// than the app bundle.
function makeInstallDirWithAgent(moduleName: string): string {
    const installDir = tmpDir("ta-installdir-");
    fs.writeFileSync(
        path.join(installDir, "package.json"),
        JSON.stringify({ name: "ta-install-root", private: true }),
    );
    const pkgDir = path.join(installDir, "node_modules", moduleName);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
            name: moduleName,
            version: "1.0.0",
            exports: { "./agent/manifest": "./manifest.json" },
        }),
    );
    fs.writeFileSync(
        path.join(pkgDir, "manifest.json"),
        JSON.stringify({ emojiChar: "🧪" }),
    );
    return installDir;
}

// Seed an instance dir whose config.json restricts install sources to a single
// `path` source, so the registry the installer builds is hermetic (no feed /
// network / az).
function pathOnlyInstanceDir(): string {
    const dir = tmpDir("ta-installer-");
    fs.writeFileSync(
        path.join(dir, "config.json"),
        JSON.stringify({
            installSources: {
                order: ["path"],
                installDir: path.join(dir, "installedAgents"),
                sources: [{ kind: "path", name: "path" }],
            },
        }),
    );
    return dir;
}

describe("createInstalledAppAgentProvider", () => {
    it("loads a bundled module record against the app bundle root", async () => {
        const records: Record<string, InstalledAgentRecord> = {
            player: {
                name: "player",
                kind: "npm",
                module: "music",
                source: "builtin",
            },
        };
        const provider = createInstalledAppAgentProvider(records, {
            appBundleRequirePath: getAppBundleRequirePath(),
        });
        expect(provider.getAppAgentNames()).toEqual(["player"]);
        const manifest = await provider.getAppAgentManifest("player");
        expect(manifest).toBeDefined();
    });

    it("unions agent names across resolution roots and rejects unknown names", async () => {
        const records: Record<string, InstalledAgentRecord> = {
            player: {
                name: "player",
                kind: "npm",
                module: "music",
                source: "builtin",
            },
            mine: {
                name: "mine",
                kind: "npm",
                path: "/abs/mine",
                source: "path",
            },
        };
        const provider = createInstalledAppAgentProvider(records, {
            installDir: "/nonexistent/installDir",
            appBundleRequirePath: getAppBundleRequirePath(),
        });
        expect(provider.getAppAgentNames().sort()).toEqual(["mine", "player"]);
        await expect(provider.getAppAgentManifest("nope")).rejects.toThrow(
            /Invalid app agent/,
        );
    });

    it("is well-formed with no records", () => {
        const provider = createInstalledAppAgentProvider(
            {},
            { appBundleRequirePath: getAppBundleRequirePath() },
        );
        expect(provider.getAppAgentNames()).toEqual([]);
    });

    it("routes a feed module to installDir and a bundled module to the app bundle", async () => {
        const moduleName = "fake-feed-agent";
        const installDir = makeInstallDirWithAgent(moduleName);
        const records: Record<string, InstalledAgentRecord> = {
            feedy: {
                name: "feedy",
                kind: "npm",
                module: moduleName,
                source: "typeagent",
            },
            player: {
                name: "player",
                kind: "npm",
                module: "music",
                source: "builtin",
            },
        };
        const provider = createInstalledAppAgentProvider(records, {
            installDir,
            appBundleRequirePath: getAppBundleRequirePath(),
        });
        expect(provider.getAppAgentNames().sort()).toEqual(["feedy", "player"]);
        // feed module resolves ONLY from installDir (absent in app bundle)
        const feedManifest = await provider.getAppAgentManifest("feedy");
        expect(feedManifest.emojiChar).toBe("🧪");
        // bundled module still resolves from the app bundle root
        const bundledManifest = await provider.getAppAgentManifest("player");
        expect(bundledManifest).toBeDefined();
    });
});

describe("getDefaultAppAgentProviders", () => {
    it("returns the installed provider exposing the bundled builtins", () => {
        const providers = getDefaultAppAgentProviders(undefined);
        expect(providers.length).toBeGreaterThanOrEqual(1);
        expect(providers[0].getAppAgentNames()).toContain("player");
    });
});

describe("getDefaultAppAgentInstaller", () => {
    it("install resolves via the path source and persists the record with the requested name", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);

        const provider = await installer.install("myagent", agentDir);
        expect(provider.getAppAgentNames()).toEqual(["myagent"]);

        const onDisk = readAgentsJson(instanceDir);
        expect(onDisk).toBeDefined();
        const record = onDisk!.agents.myagent;
        // installer assigns the authoritative dispatcher name (not the dir base)
        expect(record.name).toBe("myagent");
        expect(record.path).toBe(path.resolve(agentDir));
        expect(record.source).toBe("path");
        expect(record.module).toBeUndefined();
    });

    it("rejects installing over an existing name", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await installer.install("dup", agentDir);
        await expect(installer.install("dup", agentDir)).rejects.toThrow(
            /already exists/,
        );
    });

    it("uninstall drops the record; unknown name rejects", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await installer.install("gone", agentDir);
        await installer.uninstall("gone");
        expect(readAgentsJson(instanceDir)!.agents.gone).toBeUndefined();
        await expect(installer.uninstall("missing")).rejects.toThrow(
            /not found/,
        );
    });

    it("serializes concurrent installs without losing writes", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const a = tmpDir("ta-agent-a-");
        const b = tmpDir("ta-agent-b-");
        const c = tmpDir("ta-agent-c-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await Promise.all([
            installer.install("a", a),
            installer.install("b", b),
            installer.install("c", c),
        ]);
        const onDisk = readAgentsJson(instanceDir)!;
        expect(Object.keys(onDisk.agents).sort()).toEqual(["a", "b", "c"]);
    });

    it("exposes the source registry via sources()", () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer = getDefaultAppAgentInstaller(instanceDir);
        const registry = installer.sources?.();
        expect(registry).toBeDefined();
        expect(registry!.get("path")).toBeDefined();
        expect(registry!.order().map((s) => s.name)).toEqual(["path"]);
    });

    it("rejects an explicit unknown source", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await expect(
            installer.install("x", agentDir, "nosuch"),
        ).rejects.toThrow(/unknown source/);
    });

    it("persists registry changes to the instance config (powers @source)", () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer = getDefaultAppAgentInstaller(instanceDir);
        const registry = installer.sources?.();
        registry!.add({ kind: "path", name: "extra" });
        registry!.setOrder(["extra", "path"]);
        const cfg = JSON.parse(
            fs.readFileSync(path.join(instanceDir, "config.json"), "utf8"),
        );
        expect(cfg.installSources.order).toEqual(["extra", "path"]);
        expect(
            cfg.installSources.sources.map((s: { name: string }) => s.name),
        ).toContain("extra");
    });

    it("named config never writes agents.json", () => {
        const instanceDir = tmpDir("ta-named-");
        const records = loadInstalledRecords(instanceDir, "test");
        expect(records.calendar).toBeDefined();
        expect(fs.existsSync(path.join(instanceDir, "agents.json"))).toBe(
            false,
        );
    });
});

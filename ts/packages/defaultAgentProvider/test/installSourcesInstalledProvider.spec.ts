// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    createBundledAppAgentProvider,
    createInstalledAppAgentProvider,
    combineAppAgentProviders,
    getAppBundleRequirePath,
    readAgentsJson,
} from "../src/installSources/installedAgents.js";
import {
    getDefaultAppAgentInstaller,
    getDefaultAppAgentProviders,
} from "../src/defaultAgentProviders.js";
import { InstalledAgentRecord } from "../src/installSources/config.js";
import { AppAgentProvider } from "agent-dispatcher";

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

// Build a standalone loadable agent directory (package.json exports +
// manifest.json) for the `path` source to install/refresh from.
function makePathAgentDir(emojiChar: string): string {
    const dir = tmpDir("ta-pathagent-");
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
            name: "ta-path-agent",
            version: "1.0.0",
            exports: { "./agent/manifest": "./manifest.json" },
        }),
    );
    fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify({ emojiChar }),
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
                source: "bundled",
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
                source: "bundled",
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
                source: "bundled",
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

describe("combineAppAgentProviders optional-surface forwarding", () => {
    // Minimal fake provider. The manifest/load paths are never exercised by
    // these routing tests, so they reject if called.
    function fakeProvider(
        names: string[],
        extra?: Partial<AppAgentProvider>,
    ): AppAgentProvider {
        return {
            getAppAgentNames: () => names,
            getAppAgentManifest: () => Promise.reject(new Error("unused")),
            loadAppAgent: () => Promise.reject(new Error("unused")),
            unloadAppAgent: () => Promise.resolve(),
            ...extra,
        };
    }

    it("omits onSchemaReady/getLoadingAgentNames when no grouped provider has them", () => {
        const combined = combineAppAgentProviders([
            fakeProvider(["a"]),
            fakeProvider(["b"]),
        ]);
        expect(combined.getAppAgentNames().sort()).toEqual(["a", "b"]);
        expect(combined.onSchemaReady).toBeUndefined();
        expect(combined.getLoadingAgentNames).toBeUndefined();
    });

    it("registers a single onSchemaReady callback with every async provider and unions getLoadingAgentNames", () => {
        const registeredWithA: unknown[] = [];
        const registeredWithB: unknown[] = [];
        const combined = combineAppAgentProviders([
            fakeProvider(["a"], {
                onSchemaReady: (cb) => registeredWithA.push(cb),
                getLoadingAgentNames: () => ["a"],
            }),
            fakeProvider(["b"], {
                onSchemaReady: (cb) => registeredWithB.push(cb),
                getLoadingAgentNames: () => ["b"],
            }),
        ]);
        expect(combined.getLoadingAgentNames?.().sort()).toEqual(["a", "b"]);
        const callback = () => undefined;
        combined.onSchemaReady?.(callback);
        // the one caller callback fans out to BOTH grouped providers
        expect(registeredWithA).toEqual([callback]);
        expect(registeredWithB).toEqual([callback]);
    });

    it("exposes the optional method when only some providers implement it", () => {
        const combined = combineAppAgentProviders([
            fakeProvider(["a"], { getLoadingAgentNames: () => ["a"] }),
            fakeProvider(["b"]),
        ]);
        expect(combined.getLoadingAgentNames?.()).toEqual(["a"]);
        expect(combined.onSchemaReady).toBeUndefined();
    });

    it("returns the sole provider unchanged (preserving its optional surface) for one input", () => {
        const only = fakeProvider(["a"], {
            onSchemaReady: () => undefined,
            getLoadingAgentNames: () => [],
        });
        expect(combineAppAgentProviders([only])).toBe(only);
    });
});

describe("getDefaultAppAgentProviders", () => {
    it("returns the bundled provider exposing the bundled agents", () => {
        const providers = getDefaultAppAgentProviders(undefined);
        expect(providers.length).toBeGreaterThanOrEqual(1);
        expect(providers[0].getAppAgentNames()).toContain("player");
    });

    it("loads installed agents for named configs by default", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer = getDefaultAppAgentInstaller(instanceDir);
        const agentDir = tmpDir("ta-agent-");
        await installer.install("namedOnly", agentDir);

        const providers = getDefaultAppAgentProviders(instanceDir, "agent");
        const allNames = new Set(providers.flatMap((p) => p.getAppAgentNames()));
        expect(allNames.has("namedOnly")).toBe(true);
    });

});

describe("getDefaultAppAgentInstaller", () => {
    it("install resolves via the path source and persists the record with the requested name", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);

        const result = await installer.install("myagent", agentDir);
        expect(result.provider.getAppAgentNames()).toEqual(["myagent"]);
        expect(result.source).toBe("path");

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

    it("rejects installing over a builtin (cannot shadow)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await expect(installer.install("player", agentDir)).rejects.toThrow(
            /built-in/,
        );
    });

    it("rejects uninstalling a builtin", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await expect(installer.uninstall("player")).rejects.toThrow(/built-in/);
    });

    it("rejects updating a builtin", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await expect(installer.update!("player")).rejects.toThrow(/built-in/);
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

    it("rejects an explicit unknown source", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await expect(
            installer.install("x", agentDir, "nosuch"),
        ).rejects.toThrow(/unknown source/);
    });

    it("named config exposes its fixed set via the bundled provider and writes no agents.json", () => {
        const instanceDir = tmpDir("ta-named-");
        const provider = createBundledAppAgentProvider("test");
        expect(provider.getAppAgentNames()).toContain("calendar");
        expect(fs.existsSync(path.join(instanceDir, "agents.json"))).toBe(
            false,
        );
    });

    it("update re-materializes a path agent and keeps the record", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await installer.install("p", agentDir);

        const provider = await installer.update!("p");
        expect(provider.getAppAgentNames()).toEqual(["p"]);
        const record = readAgentsJson(instanceDir)!.agents.p;
        expect(record.path).toBe(path.resolve(agentDir));
        expect(record.source).toBe("path");
    });

    it("preserves the re-resolution key (ref) across update", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await installer.install("p", agentDir);

        // A path install has no resolved `ref`; install fills it with the
        // supplied lookup key so a later @update can re-resolve.
        const afterInstall = readAgentsJson(instanceDir)!.agents.p;
        expect(afterInstall.ref).toBe(agentDir);

        await installer.update!("p");
        const afterUpdate = readAgentsJson(instanceDir)!.agents.p;
        // The fix under test: update must not drop the re-resolution key.
        expect(afterUpdate.ref).toBeDefined();
        expect(afterUpdate.ref).toBe(afterUpdate.path);
    });

    it("update picks up a changed manifest from the recorded path", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir("🧪");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await installer.install("p", agentDir);

        // Edit the on-disk agent, then update.
        fs.writeFileSync(
            path.join(agentDir, "manifest.json"),
            JSON.stringify({ emojiChar: "🚀" }),
        );
        const provider = await installer.update!("p");
        const manifest = await provider.getAppAgentManifest("p");
        expect(manifest.emojiChar).toBe("🚀");
    });

    it("a failed update leaves the old record intact (no-op)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await installer.install("p", agentDir);
        const before = readAgentsJson(instanceDir)!.agents.p;

        // Remove the on-disk target so re-resolution can no longer materialize.
        fs.rmSync(agentDir, { recursive: true, force: true });
        await expect(installer.update!("p")).rejects.toThrow();

        const after = readAgentsJson(instanceDir)!.agents.p;
        expect(after).toEqual(before);
    });

    it("update rejects an unknown agent", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await expect(installer.update!("missing")).rejects.toThrow(/not found/);
    });

    it("update fails when the recorded source is no longer configured", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = getDefaultAppAgentInstaller(instanceDir);
        await installer.install("p", agentDir);
        // Drop the only configured source out from under the record, then
        // rebuild the installer so it reloads its sources from the edited
        // config (the registry is now host-internal, reached only via config).
        const cfgPath = path.join(instanceDir, "config.json");
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        cfg.installSources.order = [];
        cfg.installSources.sources = [];
        fs.writeFileSync(cfgPath, JSON.stringify(cfg));
        const reloaded = getDefaultAppAgentInstaller(instanceDir);
        await expect(reloaded.update!("p")).rejects.toThrow(
            /no longer configured/,
        );
    });
});

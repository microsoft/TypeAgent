// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    createBundledAppAgentProvider,
    createInstalledAppAgentProvider,
    createInstalledAppAgentProviders,
    readAgentsJson,
    recordRequirePath,
} from "../src/installSources/installedAgents.js";
import {
    createDefaultInstalledAgentSource,
    getDefaultAppAgentProviders,
} from "../src/defaultAgentProviders.js";
import { InstalledAgentRecord } from "../src/installSources/config.js";
import { AppAgentProvider, AppAgentHost } from "agent-dispatcher";
import { createLimiter } from "@typeagent/common-utils";

// Compose a faithful `replaceProvider` for a test host from its own add/remove,
// modelling the applicator's single-lock section (5.7): remove the old
// version, quiesce (fill the barrier slot), await the shared `whenReady`, then
// add the new version (update) or settle (uninstall). This preserves both the
// recorded remove-then-add op order AND the barrier gating (a host that blocks
// its removeProvider keeps the barrier pending until released).
function withReplace(
    host: Pick<AppAgentHost, "addProvider" | "removeProvider">,
): AppAgentHost {
    return {
        addProvider: host.addProvider,
        removeProvider: host.removeProvider,
        replaceProvider: async (oldProvider, newProviderThunk, options) => {
            await host.removeProvider(
                oldProvider,
                options.notify ?? false,
                options.dropConfig ?? false,
            );
            options.onQuiesced();
            await options.whenReady;
            // The source decides post-barrier what to add: v2 (commit update), v1
            // (rollback), or nothing (commit uninstall / no thunk).
            if (newProviderThunk !== undefined) {
                const newProvider = newProviderThunk();
                if (newProvider !== undefined) {
                    await host.addProvider(
                        newProvider,
                        options.notify ?? false,
                    );
                }
            }
        },
    };
}

// A no-op issuing host used by tests that only exercise the record store or the
// vended provider set (fan-out behavior is covered by its own describe).
const noopHost: AppAgentHost = withReplace({
    addProvider: async () => {},
    removeProvider: async () => {},
});

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
// manifest.json) for the `path` source to install/refresh from. The default
// emoji makes it a drop-in "some valid path agent" fixture for tests that only
// need a resolvable install (the structural manifest check now validates every
// source, including `path`).
function makePathAgentDir(emojiChar = "🧪"): string {
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

// Seed an instance dir whose config.json restricts install sources to a single
// `catalog` source with one module-resolved entry (an npm-package-based source),
// so an install/update produces a `module` record whose manifest the structural
// check (5.3) reads. When `installModule` is true a resolvable agent
// package (readable manifest) is laid under the instance's installDir; omitting
// it leaves the module unresolvable, so the structural check fails.
function catalogModuleInstanceDir(
    key: string,
    moduleName: string,
    installModule: boolean,
): string {
    const dir = tmpDir("ta-catalog-");
    const installDir = path.join(dir, "installedAgents");
    fs.mkdirSync(installDir, { recursive: true });
    const catalogPath = path.join(dir, "catalog.json");
    fs.writeFileSync(
        catalogPath,
        JSON.stringify({ agents: { [key]: { name: moduleName } } }),
    );
    fs.writeFileSync(
        path.join(dir, "config.json"),
        JSON.stringify({
            installSources: {
                order: ["cat"],
                installDir,
                sources: [
                    { kind: "catalog", name: "cat", catalog: catalogPath },
                ],
            },
        }),
    );
    if (installModule) {
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
    }
    return dir;
}

describe("createInstalledAppAgentProvider(s)", () => {
    function allNames(providers: AppAgentProvider[]): string[] {
        return providers.flatMap((p) => p.getAppAgentNames()).sort();
    }

    it("resolves a feed module from installDir (runtime unit)", async () => {
        const moduleName = "fake-feed-agent";
        const installDir = makeInstallDirWithAgent(moduleName);
        const provider = createInstalledAppAgentProvider(
            "feedy",
            {
                name: "feedy",
                kind: "npm",
                module: moduleName,
                source: "typeagent",
            },
            installDir,
        );
        expect(provider.getAppAgentNames()).toEqual(["feedy"]);
        // The module resolves ONLY from installDir (it is absent from the bundle).
        const manifest = await provider.getAppAgentManifest("feedy");
        expect(manifest.emojiChar).toBe("🧪");
    });

    it("resolves a module from its per-agent version-scoped root (5.5)", async () => {
        // A record carrying an `installRoot` resolves from
        // installDir/agents/<installRoot>/node_modules, NOT the shared installDir.
        const moduleName = "scoped-feed-agent";
        const installDir = tmpDir("ta-installdir-");
        fs.writeFileSync(
            path.join(installDir, "package.json"),
            JSON.stringify({ name: "ta-install-root", private: true }),
        );
        const installRoot = "feedy@abc123";
        const rootDir = path.join(installDir, "agents", installRoot);
        const pkgDir = path.join(rootDir, "node_modules", moduleName);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
            path.join(rootDir, "package.json"),
            JSON.stringify({ name: "ta-agent-root", private: true }),
        );
        fs.writeFileSync(
            path.join(pkgDir, "package.json"),
            JSON.stringify({
                name: moduleName,
                version: "2.0.0",
                exports: { "./agent/manifest": "./manifest.json" },
            }),
        );
        fs.writeFileSync(
            path.join(pkgDir, "manifest.json"),
            JSON.stringify({ emojiChar: "📦" }),
        );
        // Deliberately DO NOT create installDir/node_modules, so a resolve from
        // the shared root would fail — proving the per-agent root is used.
        const provider = createInstalledAppAgentProvider(
            "feedy",
            {
                name: "feedy",
                kind: "npm",
                module: moduleName,
                source: "typeagent",
                installRoot,
            },
            installDir,
        );
        const manifest = await provider.getAppAgentManifest("feedy");
        expect(manifest.emojiChar).toBe("📦");
    });

    it("recordRequirePath derives per-agent root vs shared installDir", () => {
        const installDir = "/tmp/ta-install";
        const scoped: InstalledAgentRecord = {
            name: "s",
            kind: "npm",
            module: "s-mod",
            source: "typeagent",
            installRoot: "s@abc",
        };
        expect(recordRequirePath(scoped, installDir)).toBe(
            path.join(installDir, "agents", "s@abc", "package.json"),
        );
        const legacy: InstalledAgentRecord = {
            name: "l",
            kind: "npm",
            module: "l-mod",
            source: "typeagent",
        };
        expect(recordRequirePath(legacy, installDir)).toBe(
            path.join(installDir, "package.json"),
        );
    });

    it("builds one provider per record and unions their names", () => {
        const records: Record<string, InstalledAgentRecord> = {
            feedy: {
                name: "feedy",
                kind: "npm",
                module: "fake-feed-agent",
                source: "typeagent",
            },
            mine: {
                name: "mine",
                kind: "npm",
                path: "/abs/mine",
                source: "path",
            },
        };
        const providers = createInstalledAppAgentProviders(
            records,
            "/nonexistent/installDir",
        );
        expect(providers).toHaveLength(2);
        expect(allNames(providers)).toEqual(["feedy", "mine"]);
    });

    it("returns [] for no records", () => {
        expect(
            createInstalledAppAgentProviders({}, "/nonexistent/installDir"),
        ).toEqual([]);
    });
});

describe("getDefaultAppAgentProviders", () => {
    it("returns the bundled provider exposing the bundled agents", () => {
        const providers = getDefaultAppAgentProviders(undefined);
        expect(providers.length).toBeGreaterThanOrEqual(1);
        expect(providers[0].getAppAgentNames()).toContain("player");
    });

    it("no longer includes installed agents (they move to the AppAgentSource)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        const agentDir = makePathAgentDir();
        await installer.install("namedOnly", agentDir, undefined, noopHost);

        // Installed agents are vended by the source at connect(), NOT by the
        // static provider list (3.3).
        const providers = getDefaultAppAgentProviders(instanceDir, "agent");
        const allNames = new Set(
            providers.flatMap((p) => p.getAppAgentNames()),
        );
        expect(allNames.has("namedOnly")).toBe(false);
    });
});

describe("getDefaultAppAgentSource", () => {
    it("connect() vends the @package agent plus a per-agent provider per install", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        await built.testApi.install(
            "namedOnly",
            makePathAgentDir(),
            undefined,
            noopHost,
        );

        // A fresh connection sees the freshly installed agent (the shared
        // per-agent provider is added to the vended set on install).
        const fakeHost = withReplace({
            addProvider: async () => {},
            removeProvider: async () => {},
        });
        const connection = built.connect(fakeHost);
        const names = new Set(
            connection.providers.flatMap((p) => p.getAppAgentNames()),
        );
        // The host-owned @package agent is always vended.
        expect(names.has("package")).toBe(true);
        // Each installed agent is its own single-root provider.
        expect(names.has("namedOnly")).toBe(true);
        const installedProvider = connection.providers.find((p) =>
            p.getAppAgentNames().includes("namedOnly"),
        )!;
        expect(installedProvider.getAppAgentNames()).toEqual(["namedOnly"]);
        connection.dispose();
    });

    it("a later connect() sees an agent installed after an earlier connect", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const fakeHost = withReplace({
            addProvider: async () => {},
            removeProvider: async () => {},
        });
        // First connection: nothing installed yet.
        const first = built.connect(fakeHost);
        expect(
            new Set(first.providers.flatMap((p) => p.getAppAgentNames())).has(
                "later",
            ),
        ).toBe(false);
        // Install, then connect a second session — it must see the new agent
        // in its initial vended set (6 note).
        await built.testApi.install(
            "later",
            makePathAgentDir(),
            undefined,
            noopHost,
        );
        const second = built.connect(fakeHost);
        expect(
            new Set(second.providers.flatMap((p) => p.getAppAgentNames())).has(
                "later",
            ),
        ).toBe(true);
        first.dispose();
        second.dispose();
    });

    it("dispose() is idempotent and does NOT tear down the shared providers", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        await built.testApi.install(
            "shared",
            makePathAgentDir(),
            undefined,
            noopHost,
        );
        const hostA = withReplace({
            addProvider: async () => {},
            removeProvider: async () => {},
        });
        const hostB = withReplace({
            addProvider: async () => {},
            removeProvider: async () => {},
        });
        const connA = built.connect(hostA);
        connA.dispose();
        expect(() => connA.dispose()).not.toThrow();
        // A new connection still vends the shared installed provider — a single
        // session's dispose must not tear it down (6).
        const connB = built.connect(hostB);
        expect(
            new Set(connB.providers.flatMap((p) => p.getAppAgentNames())).has(
                "shared",
            ),
        ).toBe(true);
        connB.dispose();
    });

    it("uninstall drops the agent from subsequently-vended connections", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        await built.testApi.install(
            "temp",
            makePathAgentDir(),
            undefined,
            noopHost,
        );
        await built.testApi.uninstall("temp", noopHost);
        const host = withReplace({
            addProvider: async () => {},
            removeProvider: async () => {},
        });
        const conn = built.connect(host);
        expect(
            new Set(conn.providers.flatMap((p) => p.getAppAgentNames())).has(
                "temp",
            ),
        ).toBe(false);
        conn.dispose();
    });
});

describe("AppAgentSource fan-out (4, )", () => {
    type HostCall =
        | { op: "add"; name: string; notify: boolean }
        | { op: "remove"; name: string; notify: boolean };

    function recordingHost(onAdd?: () => void): {
        host: AppAgentHost;
        calls: HostCall[];
    } {
        const calls: HostCall[] = [];
        return {
            calls,
            host: withReplace({
                addProvider: async (p, notify) => {
                    onAdd?.();
                    calls.push({
                        op: "add",
                        name: p.getAppAgentNames()[0],
                        notify: notify ?? false,
                    });
                },
                removeProvider: async (p, notify) => {
                    calls.push({
                        op: "remove",
                        name: p.getAppAgentNames()[0],
                        notify: notify ?? false,
                    });
                },
            }),
        };
    }

    const flush = () => new Promise((r) => setTimeout(r, 0));

    it("install: fans the add out to every session (issuing + sibling), all notified", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        const sibling = recordingHost();
        built.connect(issuing.host);
        built.connect(sibling.host);

        await built.testApi.install(
            "foo",
            makePathAgentDir(),
            undefined,
            issuing.host,
        );
        await flush();

        // Uniform enqueue model (): the issuing session enqueues + is
        // notified just like a sibling (the inline path was removed).
        expect(issuing.calls).toEqual([
            { op: "add", name: "foo", notify: true },
        ]);
        // Sibling: notified.
        expect(sibling.calls).toEqual([
            { op: "add", name: "foo", notify: true },
        ]);
    });

    it("install: a sibling failure is isolated (install still succeeds)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        const badSibling = {
            host: withReplace({
                addProvider: async () => {
                    throw new Error("sibling boom");
                },
                removeProvider: async () => {},
            }),
        };
        const goodSibling = recordingHost();
        built.connect(issuing.host);
        built.connect(badSibling.host);
        built.connect(goodSibling.host);

        // Must not throw despite the bad sibling.
        await expect(
            built.testApi.install(
                "foo",
                makePathAgentDir(),
                undefined,
                issuing.host,
            ),
        ).resolves.toBeDefined();
        await flush();

        expect(issuing.calls).toHaveLength(1);
        expect(goodSibling.calls).toEqual([
            { op: "add", name: "foo", notify: true },
        ]);
        // The record is committed regardless of sibling failure.
        expect(readAgentsJson(instanceDir)!.agents.foo).toBeDefined();
    });

    it("uninstall fans removeProvider out to every session", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        const sibling = recordingHost();
        built.connect(issuing.host);
        built.connect(sibling.host);
        await built.testApi.install(
            "foo",
            makePathAgentDir(),
            undefined,
            issuing.host,
        );
        await flush();
        issuing.calls.length = 0;
        sibling.calls.length = 0;

        await built.testApi.uninstall("foo", issuing.host);
        await flush();

        expect(issuing.calls).toEqual([
            { op: "remove", name: "foo", notify: true },
        ]);
        expect(sibling.calls).toEqual([
            { op: "remove", name: "foo", notify: true },
        ]);
    });

    it("threads dropConfig=true for uninstall and false for update to every remove leg (Model B)", async () => {
        // Capture the dropConfig each remove leg receives (the shared
        // recordingHost drops the third arg; this dedicated host keeps it).
        const removeCalls: { dropConfig: boolean }[] = [];
        const rec = withReplace({
            addProvider: async () => {},
            removeProvider: async (_p, _notify, dropConfig) => {
                removeCalls.push({ dropConfig: dropConfig ?? false });
            },
        });
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        built.connect(rec);
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            rec,
        );
        await flush();

        // Update is a version bump: it must PRESERVE the enable preference
        // (dropConfig=false) across the remove leg of its swap.
        removeCalls.length = 0;
        await built.testApi.update("foo", undefined, rec);
        await flush();
        expect(removeCalls).toEqual([{ dropConfig: false }]);

        // Uninstall must CLEAR the enable preference (dropConfig=true) so a fresh
        // reinstall starts from the manifest default.
        removeCalls.length = 0;
        await built.testApi.uninstall("foo", rec);
        await flush();
        expect(removeCalls).toEqual([{ dropConfig: true }]);
    });

    it("does not fan out to a disposed (deregistered) session", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        const gone = recordingHost();
        built.connect(issuing.host);
        const goneConn = built.connect(gone.host);
        goneConn.dispose(); // deregisters `gone` from the client registry

        await built.testApi.install(
            "foo",
            makePathAgentDir(),
            undefined,
            issuing.host,
        );
        await flush();

        expect(issuing.calls).toHaveLength(1);
        expect(gone.calls).toHaveLength(0);
    });

    it("single client (web) degrades cleanly: issuing enqueues, no siblings", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const only = recordingHost();
        built.connect(only.host);
        await built.testApi.install(
            "foo",
            makePathAgentDir(),
            undefined,
            only.host,
        );
        await flush();
        // The single client is the issuing session: it enqueues + is notified
        // like any other session (uniform enqueue, ); no siblings to fan to.
        expect(only.calls).toEqual([{ op: "add", name: "foo", notify: true }]);
    });

    it("update fans out remove-then-add per client (issuing + sibling)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        const sibling = recordingHost();
        built.connect(issuing.host);
        built.connect(sibling.host);
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing.host,
        );
        await flush();
        issuing.calls.length = 0;
        sibling.calls.length = 0;

        await built.testApi.update("foo", undefined, issuing.host);
        await flush();

        // Every session sees remove BEFORE add (no coexistence); every session
        // — issuing included — enqueues + is notified (uniform enqueue, ).
        expect(issuing.calls).toEqual([
            { op: "remove", name: "foo", notify: true },
            { op: "add", name: "foo", notify: true },
        ]);
        expect(sibling.calls).toEqual([
            { op: "remove", name: "foo", notify: true },
            { op: "add", name: "foo", notify: true },
        ]);
    });

    it("vends installed agents honoring their manifest default (Model B, 5)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        built.connect(issuing.host);
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing.host,
        );
        const conn = built.connect(
            withReplace({
                addProvider: async () => {},
                removeProvider: async () => {},
            }),
        );
        const provider = conn.providers.find((p) =>
            p.getAppAgentNames().includes("foo"),
        )!;
        const manifest = await provider.getAppAgentManifest("foo");
        // The source no longer forces installed agents off: the manifest default
        // is passed through unchanged (Model B), so this test agent — which sets
        // no enable defaults — is left undefined rather than forced to false.
        expect(manifest.defaultEnabled).toBeUndefined();
        expect(manifest.schemaDefaultEnabled).toBeUndefined();
        expect(manifest.commandDefaultEnabled).toBeUndefined();
        expect(manifest.emojiChar).toBe("🧪");
        conn.dispose();
    });

    it("deadlock-free: install/uninstall/update return while the issuing session's command lock is held (idle-gated, not inline)", async () => {
        // Model the issuing session as a real idle-gated applicator: every op is
        // gated on the session's single-slot command lock — the SAME lock the
        // in-flight `@package` command holds while it runs (, ). If any
        // source method AWAITED the issuing host's enqueued op it would block on
        // that held lock forever (deadlock). The uniform-enqueue model must fan
        // out non-blocking, so each op RETURNS while the lock is held and the
        // apply lands only once the command releases it.
        const commandLock = createLimiter(1);
        const applied: HostCall[] = [];
        const issuing: AppAgentHost = withReplace({
            addProvider: (p, notify) =>
                commandLock(async () => {
                    applied.push({
                        op: "add",
                        name: p.getAppAgentNames()[0],
                        notify: notify ?? false,
                    });
                }),
            removeProvider: (p, notify) =>
                commandLock(async () => {
                    applied.push({
                        op: "remove",
                        name: p.getAppAgentNames()[0],
                        notify: notify ?? false,
                    });
                }),
        });

        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        built.connect(issuing);

        // Occupy the command lock's only slot to simulate the `@package` command
        // still running when it calls into the source. Each `hold()` returns a
        // release fn; nothing the source enqueues can apply until it is called.
        const hold = () => {
            let release!: () => void;
            const done = new Promise<void>((res) => {
                release = res;
            });
            void commandLock(() => done);
            return release;
        };

        // install: must RESOLVE with the lock held, add queued (not inline).
        let release = hold();
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing,
        );
        await flush();
        expect(applied).toHaveLength(0); // queued behind the held command
        release();
        await flush();
        expect(applied).toEqual([{ op: "add", name: "foo", notify: true }]);

        // update: remove-then-add, both queued behind a fresh held command.
        applied.length = 0;
        release = hold();
        await built.testApi.update("foo", undefined, issuing);
        await flush();
        expect(applied).toHaveLength(0);
        release();
        await flush();
        expect(applied).toEqual([
            { op: "remove", name: "foo", notify: true },
            { op: "add", name: "foo", notify: true },
        ]);

        // uninstall: likewise returns while a third command holds the lock.
        applied.length = 0;
        release = hold();
        await built.testApi.uninstall("foo", issuing);
        await flush();
        expect(applied).toHaveLength(0);
        release();
        await flush();
        expect(applied).toEqual([{ op: "remove", name: "foo", notify: true }]);
    });
});

describe("AppAgentSource lifecycle tracker (7)", () => {
    // An issuing host whose ops resolve immediately.
    function fastHost(): AppAgentHost {
        return withReplace({
            addProvider: async () => {},
            removeProvider: async () => {},
        });
    }

    // A sibling host whose removeProvider blocks until released, so a drain
    // stays in the `removing` window under test.
    function gatedHost() {
        let release!: () => void;
        const gate = new Promise<void>((res) => {
            release = res;
        });
        return {
            release,
            host: withReplace({
                addProvider: async () => {},
                removeProvider: async () => {
                    await gate;
                },
            }),
        };
    }

    const flush = () => new Promise((r) => setTimeout(r, 0));

    // Poll until `predicate` holds (or time out). Used instead of a fixed
    // `flush()` when a step involves an unknown number of async hops before the
    // observable state changes — e.g. `update` awaits `reresolve` + manifest
    // validation (fs reads) before it flips the entry to `removing` — so the
    // assertion is deterministic under load rather than racing a single
    // macrotask. Returns as soon as the predicate is true (no fixed delay).
    const waitFor = async (
        predicate: () => boolean,
        label = "condition",
    ): Promise<void> => {
        for (let i = 0; i < 200; i++) {
            if (predicate()) {
                return;
            }
            await new Promise((r) => setTimeout(r, 5));
        }
        throw new Error(`waitFor timed out waiting for ${label}`);
    };

    async function installFoo(
        built: ReturnType<typeof createDefaultInstalledAgentSource>,
        issuing: AppAgentHost,
    ) {
        await built.testApi.install(
            "foo",
            makePathAgentDir(),
            undefined,
            issuing,
        );
        await flush();
    }

    it("rejects install/update on a name still draining, allows it once drained", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        const gated = gatedHost();
        built.connect(issuing);
        built.connect(gated.host);
        await installFoo(built, issuing);

        // Uninstall starts a drain; the gated sibling keeps it `removing`.
        const uninstalling = built.testApi.uninstall("foo", issuing);
        await flush();

        // Reuse during removing is rejected (7.3).
        await expect(
            built.testApi.install(
                "foo",
                makePathAgentDir(),
                undefined,
                issuing,
            ),
        ).rejects.toThrow(/still being removed/i);
        await expect(
            built.testApi.update("foo", undefined, issuing),
        ).rejects.toThrow(/still being removed/i);

        // Release the drain; the name frees and can be reused.
        gated.release();
        await uninstalling;
        await flush();
        await expect(
            built.testApi.install(
                "foo",
                makePathAgentDir(),
                undefined,
                issuing,
            ),
        ).resolves.toBeDefined();
    });

    it("connect during removing skips the draining name", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        const gated = gatedHost();
        built.connect(issuing);
        built.connect(gated.host);
        await installFoo(built, issuing);
        const uninstalling = built.testApi.uninstall("foo", issuing);
        await flush();

        // A new session must NOT pick up the draining name (7.3).
        const late = built.connect(fastHost());
        expect(
            new Set(late.providers.flatMap((p) => p.getAppAgentNames())).has(
                "foo",
            ),
        ).toBe(false);
        late.dispose();

        gated.release();
        await uninstalling;
    });

    it("blocks a late joiner on whenReady until the barrier decides", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        const gated = gatedHost();
        built.connect(issuing);
        built.connect(gated.host);
        await installFoo(built, issuing);

        // An update starts a drain; the gated sibling keeps it `removing`.
        const updating = built.testApi.update("foo", undefined, issuing);
        await flush();

        // A session connecting now is excluded from the draining name in its
        // initial set, and its `whenReady` stays pending: the dispatcher blocks
        // on it (under the held command lock) instead of going live, so no
        // command runs with `foo` in an undecided state (7.3).
        const lateConn = built.connect(fastHost());
        expect(
            new Set(
                lateConn.providers.flatMap((p) => p.getAppAgentNames()),
            ).has("foo"),
        ).toBe(false);

        let ready = false;
        const readyProviders = lateConn.whenReady.then((ps) => {
            ready = true;
            return ps;
        });
        await flush();
        // The barrier is still `removing` (the gated sibling holds it), so the
        // late joiner is still blocked.
        expect(ready).toBe(false);

        // Commit the update: `whenReady` resolves with the decided v2 so the
        // dispatcher installs it inline and the late joiner converges on the same
        // version as the participants (7.3).
        gated.release();
        await updating;
        const decided = await readyProviders;
        expect(ready).toBe(true);
        expect(decided.flatMap((p) => p.getAppAgentNames())).toEqual(["foo"]);

        lateConn.dispose();
    });

    it("disconnect while pending completes the drain (auto-ack)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        const gated = gatedHost();
        built.connect(issuing);
        const gatedConn = built.connect(gated.host);
        await installFoo(built, issuing);
        await built.testApi.uninstall("foo", issuing);
        await flush();

        // The gated sibling still pends. Disposing its connection drops it from
        // the drain, which completes the drain and frees the name (7.3).
        gatedConn.dispose();
        await flush();
        await expect(
            built.testApi.install(
                "foo",
                makePathAgentDir(),
                undefined,
                issuing,
            ),
        ).resolves.toBeDefined();
    });

    it("@package list hides a draining agent (update in progress)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        const gated = gatedHost();
        built.connect(issuing);
        built.connect(gated.host);
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing,
        );
        await flush();

        // Update starts a drain of the old version; the record now points at the
        // new version but the entry is `removing`, so list must hide it.
        const updating = built.testApi.update("foo", undefined, issuing);
        // Wait until the drain actually begins (update's reresolve + manifest
        // validation complete and the entry flips to `removing`) rather than
        // racing a single macrotask. The gated sibling holds the barrier open, so
        // once hidden the name stays hidden until we release below.
        await waitFor(
            () =>
                !built.testApi
                    .listInstalled()
                    .map((i) => i.name)
                    .includes("foo"),
            "foo to enter the draining (removing) state",
        );
        expect(built.testApi.listInstalled().map((i) => i.name)).not.toContain(
            "foo",
        );

        gated.release();
        await updating;
        await flush();
        // After the drain + re-add, it is listed again.
        expect(built.testApi.listInstalled().map((i) => i.name)).toContain(
            "foo",
        );
    });

    it("update adds the new version only after the old drains everywhere (no coexistence)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHostForLifecycle();
        const gated = gatedHost();
        built.connect(issuing.host);
        built.connect(gated.host);
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing.host,
        );
        await flush();
        issuing.calls.length = 0;

        const updating = built.testApi.update("foo", undefined, issuing.host);
        await flush();
        // The old version has been removed on the issuing session, but the new
        // one is NOT added yet — the drain (gated sibling) has not completed.
        expect(issuing.calls).toEqual([{ op: "remove" }]);

        gated.release();
        await updating;
        await flush();
        // Once drained, the new version is added.
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);
    });

    it("update re-adds exactly once even when a sibling throws mid-drain", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHostForLifecycle();
        // A sibling whose removeProvider always rejects: its barrier slot must
        // still be filled (the per-host catch → quiesce, 5.7) so the
        // barrier completes and the re-add fires — exactly once, never twice.
        const throwingSibling: AppAgentHost = withReplace({
            addProvider: async () => {},
            removeProvider: async () => {
                throw new Error("sibling remove boom");
            },
        });
        built.connect(issuing.host);
        built.connect(throwingSibling);
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing.host,
        );
        await flush();
        issuing.calls.length = 0;

        await built.testApi.update("foo", undefined, issuing.host);
        await flush();

        // The throwing sibling did not wedge the drain: the swap completed with
        // exactly one remove followed by exactly one add on the issuing session.
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);
        // The name is free + active again (listed, and reusable).
        expect(built.testApi.listInstalled().map((i) => i.name)).toContain(
            "foo",
        );
    });

    it("update re-adds exactly once even when a sibling throws in its ADD leg (post-quiesce)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHostForLifecycle();
        // A sibling whose REMOVE succeeds (it quiesces, filling its barrier slot)
        // but whose ADD leg then throws. The source's per-host catch calls
        // `quiesce` a SECOND time; the barrier is already settled, so the double
        // quiesce must be a harmless no-op (no double onComplete / re-add).
        const throwingAddSibling: AppAgentHost = withReplace({
            addProvider: async () => {
                throw new Error("sibling add boom");
            },
            removeProvider: async () => {},
        });
        built.connect(issuing.host);
        built.connect(throwingAddSibling);
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing.host,
        );
        await flush();
        issuing.calls.length = 0;

        await built.testApi.update("foo", undefined, issuing.host);
        await flush();

        // The post-quiesce add failure did not corrupt the barrier: the issuing
        // session swapped exactly once and the name is active + listed.
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);
        expect(built.testApi.listInstalled().map((i) => i.name)).toContain(
            "foo",
        );
    });

    it("update adds v2 on every session only after the LAST session quiesces (staggered)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const fast = recordingHostForLifecycle();
        const gated = gatedRecordingHost();
        built.connect(fast.host);
        built.connect(gated.host);
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            fast.host,
        );
        await flush();
        fast.calls.length = 0;
        gated.calls.length = 0;

        const updating = built.testApi.update("foo", undefined, fast.host);
        await flush();
        // The fast session removed v1 and quiesced, but the barrier has not
        // completed (the gated session has not quiesced), so NEITHER session has
        // added v2 yet — no coexistence, no partial swap.
        expect(fast.calls).toEqual([{ op: "remove" }]);
        expect(gated.calls).toEqual([{ op: "remove" }]);

        gated.release();
        await updating;
        await flush();
        // Once the last session quiesces, v2 is added on BOTH sessions.
        expect(fast.calls).toEqual([{ op: "remove" }, { op: "add" }]);
        expect(gated.calls).toEqual([{ op: "remove" }, { op: "add" }]);
    });

    // A recording host that only tracks the op kind (for ordering assertions).
    function recordingHostForLifecycle() {
        const calls: { op: "add" | "remove" }[] = [];
        return {
            calls,
            host: withReplace({
                addProvider: async () => {
                    calls.push({ op: "add" });
                },
                removeProvider: async () => {
                    calls.push({ op: "remove" });
                },
            }),
        };
    }

    // A recording host whose removeProvider records then BLOCKS until released,
    // so its barrier slot stays pending (it is the "last to quiesce").
    function gatedRecordingHost() {
        let release!: () => void;
        const gate = new Promise<void>((res) => {
            release = res;
        });
        const calls: { op: "add" | "remove" }[] = [];
        return {
            release,
            calls,
            host: withReplace({
                addProvider: async () => {
                    calls.push({ op: "add" });
                },
                removeProvider: async () => {
                    calls.push({ op: "remove" });
                    await gate;
                },
            }),
        };
    }

    it("a failed update leaves the agent active + vended everywhere ()", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        built.connect(issuing);
        const agentDir = makePathAgentDir("🧪");
        await built.testApi.install("foo", agentDir, undefined, issuing);
        await flush();

        // Break re-resolution so the materialize fails.
        fs.rmSync(agentDir, { recursive: true, force: true });
        await expect(
            built.testApi.update("foo", undefined, issuing),
        ).rejects.toThrow();

        // The entry is still active (no drain started) and a new session vends
        // the old provider — the failed update is a true no-op.
        const conn = built.connect(fastHost());
        expect(
            new Set(conn.providers.flatMap((p) => p.getAppAgentNames())).has(
                "foo",
            ),
        ).toBe(true);
        conn.dispose();
    });

    it("a throwing sibling still drains (record committed, name freed)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        const throwingSibling: AppAgentHost = withReplace({
            addProvider: async () => {},
            removeProvider: async () => {
                throw new Error("sibling remove boom");
            },
        });
        built.connect(issuing);
        built.connect(throwingSibling);
        await installFoo(built, issuing);

        // The sibling throws on removeProvider, but its failure still drops it
        // from `pending` (7.4), so the drain completes and the record
        // stays committed.
        await built.testApi.uninstall("foo", issuing);
        await flush();
        expect(readAgentsJson(instanceDir)!.agents.foo).toBeUndefined();
        // Name is freed despite the sibling failure — reuse is allowed.
        await expect(
            built.testApi.install(
                "foo",
                makePathAgentDir(),
                undefined,
                issuing,
            ),
        ).resolves.toBeDefined();
    });
});

describe("Update Coordination — timeout & rollback (5.3)", () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const settle = async () => {
        // Drain the timer + microtask chain a few times so a phase-timeout
        // rollback (timer → decide → release → re-add → GC finalize)
        // completes before assertions.
        for (let i = 0; i < 4; i++) {
            await new Promise((r) => setTimeout(r, 5));
        }
    };

    // A recording host that tracks op kind. Its removeProvider optionally blocks
    // on a gate, so it can be held as the "straggler that won't idle" that drives
    // a quiesce-timeout rollback.
    function recordingHost(gate?: Promise<void>) {
        const calls: { op: "add" | "remove" }[] = [];
        return {
            calls,
            host: withReplace({
                addProvider: async () => {
                    calls.push({ op: "add" });
                },
                removeProvider: async () => {
                    calls.push({ op: "remove" });
                    if (gate !== undefined) {
                        await gate;
                    }
                },
            }),
        };
    }

    // Install foo (v1) from a path dir and retro-fit a version-scoped install
    // root onto its record (as if a feed had installed it), so a rollback
    // (record restored → installRoot kept) is distinguishable from a commit (path
    // re-resolve → installRoot dropped).
    async function installFooV1(
        built: ReturnType<typeof createDefaultInstalledAgentSource>,
        instanceDir: string,
        issuing: AppAgentHost,
    ): Promise<string> {
        await built.testApi.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing,
        );
        await flush();
        const v1Root = "foo@v1";
        fs.mkdirSync(
            path.join(instanceDir, "installedAgents", "agents", v1Root),
            { recursive: true },
        );
        const cur = readAgentsJson(instanceDir)!;
        cur.agents.foo.installRoot = v1Root;
        fs.writeFileSync(
            path.join(instanceDir, "agents.json"),
            JSON.stringify(cur),
        );
        return v1Root;
    }

    it("a straggler that won't idle hits the quiesce timeout and rolls back ()", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir, {
            updateCoordination: {
                quiesceTimeoutMs: 20,
            },
        });
        const issuing = recordingHost();
        let releaseStraggler!: () => void;
        const gate = new Promise<void>((r) => (releaseStraggler = r));
        const straggler = recordingHost(gate);
        built.connect(issuing.host);
        built.connect(straggler.host);
        const v1Root = await installFooV1(built, instanceDir, issuing.host);
        issuing.calls.length = 0;
        straggler.calls.length = 0;

        const outcomes: string[] = [];
        await built.testApi.update("foo", undefined, issuing.host, (o) =>
            outcomes.push(o),
        );
        // The straggler never quiesces → the phase-1 backstop fires → rollback.
        await settle();

        expect(outcomes).toEqual(["reverted"]);
        // v1 is restored everywhere: record kept (installRoot back), name active.
        expect(readAgentsJson(instanceDir)!.agents.foo.installRoot).toBe(
            v1Root,
        );
        expect(built.testApi.listInstalled().map((i) => i.name)).toContain(
            "foo",
        );
        // The issuing session removed v1 then re-added v1 (rolled back, no v2).
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);

        releaseStraggler();
        await flush();
    });

    it("a lingering verify-0 refcount parks the barrier until the quiesce timeout rolls back ()", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir, {
            updateCoordination: {
                quiesceTimeoutMs: 20,
                // The shared v1 provider never drops to 0 refs (a wedged loader):
                // every host quiesces but verify-0 keeps the barrier parked.
                isLoaded: () => true,
            },
        });
        const issuing = recordingHost();
        built.connect(issuing.host);
        const v1Root = await installFooV1(built, instanceDir, issuing.host);
        issuing.calls.length = 0;

        const outcomes: string[] = [];
        await built.testApi.update("foo", undefined, issuing.host, (o) =>
            outcomes.push(o),
        );
        // All hosts have quiesced, but verify-0 is non-zero → parked. Before the
        // timeout, v2 has NOT been added (no commit, no coexistence).
        await flush();
        expect(issuing.calls).toEqual([{ op: "remove" }]);
        expect(outcomes).toEqual([]);

        // The quiesce backstop resolves the park → rollback.
        await settle();
        expect(outcomes).toEqual(["reverted"]);
        expect(readAgentsJson(instanceDir)!.agents.foo.installRoot).toBe(
            v1Root,
        );
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);
    });

    it("a session disconnecting as the last barrier slot re-polls verify-0 and commits (no timeout stall)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        // The shared v1 ref is still held while the barrier fills its last slot,
        // then dropped by the disconnecting session's teardown.
        let refHeld = true;
        const built = createDefaultInstalledAgentSource(instanceDir, {
            updateCoordination: {
                // Long timeout: only a correct verify-0 RE-POLL (not the
                // backstop) can commit within the test window.
                quiesceTimeoutMs: 5_000,
                isLoaded: () => refHeld,
            },
        });
        const issuing = recordingHost();
        // A session whose `replaceProvider` auto-acks WITHOUT `onQuiesced`
        // (models its barrier op queued-not-started at close): it fills its
        // phase-1 slot from the success continuation, which can empty `pending`
        // BEFORE its teardown has dropped the shared v1 ref.
        const closingHost: AppAgentHost = {
            addProvider: async () => {},
            removeProvider: async () => {},
            replaceProvider: async () => {},
        };
        built.connect(issuing.host);
        const closingConn = built.connect(closingHost);
        const v1Root = await installFooV1(built, instanceDir, issuing.host);
        issuing.calls.length = 0;

        const outcomes: string[] = [];
        await built.testApi.update("foo", undefined, issuing.host, (o) =>
            outcomes.push(o),
        );
        // Every slot has quiesced, but v1's ref is still held → the barrier is
        // parked on verify-0 (no commit, no v2 added).
        await flush();
        expect(outcomes).toEqual([]);
        expect(issuing.calls).toEqual([{ op: "remove" }]);

        // The disconnecting session's teardown drops the shared ref, THEN its
        // source connection is disposed (the real dispatcher close order). The
        // disconnect must RE-POLL verify-0 so the barrier commits instead of
        // stalling to the quiesce-timeout rollback.
        refHeld = false;
        closingConn.dispose();
        await settle();

        expect(outcomes).toEqual(["updated"]);
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);
        expect(readAgentsJson(instanceDir)!.agents.foo).toBeDefined();
        expect(readAgentsJson(instanceDir)!.agents.foo.installRoot).not.toBe(
            v1Root,
        );
    });

    it("reports `updated` and drops the old install root on a clean commit ()", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        built.connect(issuing.host);
        await installFooV1(built, instanceDir, issuing.host);
        issuing.calls.length = 0;

        const outcomes: string[] = [];
        await built.testApi.update("foo", undefined, issuing.host, (o) =>
            outcomes.push(o),
        );
        await settle();

        expect(outcomes).toEqual(["updated"]);
        // Commit: the path re-resolve dropped installRoot (v2 record swapped in).
        expect(
            readAgentsJson(instanceDir)!.agents.foo.installRoot,
        ).toBeUndefined();
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);
    });

    it("a disconnect during a rollback is safe (name stays active on v1) ()", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir, {
            updateCoordination: {
                quiesceTimeoutMs: 20,
            },
        });
        const issuing = recordingHost();
        let releaseStraggler!: () => void;
        const gate = new Promise<void>((r) => (releaseStraggler = r));
        const straggler = recordingHost(gate);
        built.connect(issuing.host);
        const stragglerConn = built.connect(straggler.host);
        const v1Root = await installFooV1(built, instanceDir, issuing.host);

        const outcomes: string[] = [];
        await built.testApi.update("foo", undefined, issuing.host, (o) =>
            outcomes.push(o),
        );
        // The straggler never idles → the quiesce timeout drives the rollback.
        await settle();

        // Disconnect the straggler mid-rollback: must not throw, and the
        // name must remain active on v1.
        expect(() => stragglerConn.dispose()).not.toThrow();
        releaseStraggler();
        await settle();

        expect(outcomes).toEqual(["reverted"]);
        expect(readAgentsJson(instanceDir)!.agents.foo.installRoot).toBe(
            v1Root,
        );
        expect(built.testApi.listInstalled().map((i) => i.name)).toContain(
            "foo",
        );
    });

    it("a rolled-back update leaves v1 durable for an immediately-following op (record never overwritten)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir, {
            updateCoordination: {
                quiesceTimeoutMs: 20,
            },
        });
        const issuing = recordingHost();
        let releaseStraggler!: () => void;
        const gate = new Promise<void>((r) => (releaseStraggler = r));
        const straggler = recordingHost(gate);
        built.connect(issuing.host);
        built.connect(straggler.host);
        const v1Root = await installFooV1(built, instanceDir, issuing.host);

        const outcomes: string[] = [];
        await built.testApi.update("foo", undefined, issuing.host, (o) =>
            outcomes.push(o),
        );
        await settle();

        // v1 is committed to the store only at the barrier decision, so an update
        // that rolls back NEVER overwrote the v1 record — it is durable the
        // instant the rollback settles, with no async gap in which a follow-up op
        // could read a stale v2 baseline.
        expect(outcomes).toEqual(["reverted"]);
        expect(readAgentsJson(instanceDir)!.agents.foo.installRoot).toBe(
            v1Root,
        );
        expect(built.testApi.listInstalled().map((i) => i.name)).toContain(
            "foo",
        );
        // The rollback GC prunes the v2 root, NEVER v1's: v1's version-scoped
        // install-root directory must survive so v1 stays loadable (a regression
        // that pruned `oldRoot` on rollback would delete the restored version).
        expect(
            fs.existsSync(
                path.join(instanceDir, "installedAgents", "agents", v1Root),
            ),
        ).toBe(true);

        // A SECOND update issued right after the rollback re-resolves from the
        // RESTORED v1 record (never a stale v2). It also rolls back (the straggler
        // is still wedged) and must again land on v1.
        await built.testApi.update("foo", undefined, issuing.host);
        await settle();
        expect(readAgentsJson(instanceDir)!.agents.foo.installRoot).toBe(
            v1Root,
        );

        releaseStraggler();
        await flush();
    });

    it("a host closed before the swap fills its slot from the success path (no quiesce-timeout stall)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir, {
            // A long quiesce timeout: if the closed host stalled phase 1, the
            // update would (wrongly) roll back with `reverted` after 5 s.
            updateCoordination: {
                quiesceTimeoutMs: 5_000,
            },
        });
        const issuing = recordingHost();
        // A closed/disposed host: its `replaceProvider` auto-acks immediately
        // WITHOUT ever calling `onQuiesced` or awaiting `whenReady` (models an
        // applicator closed at enqueue time). The barrier must still fill its
        // phase-1 slot for it via the success continuation.
        const closedHost: AppAgentHost = {
            addProvider: async () => {},
            removeProvider: async () => {},
            replaceProvider: async () => {},
        };
        built.connect(issuing.host);
        built.connect(closedHost);
        await installFooV1(built, instanceDir, issuing.host);
        issuing.calls.length = 0;

        const outcomes: string[] = [];
        await built.testApi.update("foo", undefined, issuing.host, (o) =>
            outcomes.push(o),
        );
        // Commits within a few 5 ms ticks — far under the 5 s timeout — proving
        // the closed host filled its slot from the success path, not the timer.
        await settle();

        expect(outcomes).toEqual(["updated"]);
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);
        expect(built.testApi.listInstalled().map((i) => i.name)).toContain(
            "foo",
        );
    });

    it("an uninstall straggler that won't idle rolls back (record + agent restored, name reusable)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir, {
            updateCoordination: { quiesceTimeoutMs: 20 },
        });
        const issuing = recordingHost();
        let releaseStraggler!: () => void;
        const gate = new Promise<void>((r) => (releaseStraggler = r));
        const straggler = recordingHost(gate);
        built.connect(issuing.host);
        built.connect(straggler.host);
        const v1Root = await installFooV1(built, instanceDir, issuing.host);
        issuing.calls.length = 0;

        await built.testApi.uninstall("foo", issuing.host);
        // The straggler never idles → quiesce timeout → rollback: the agent is
        // NOT removed. Its record + version-scoped root are restored/kept and the
        // live agent is re-added everywhere.
        await settle();

        const record = readAgentsJson(instanceDir)!.agents.foo;
        expect(record).toBeDefined();
        expect(record.installRoot).toBe(v1Root);
        expect(
            fs.existsSync(
                path.join(instanceDir, "installedAgents", "agents", v1Root),
            ),
        ).toBe(true);
        expect(built.testApi.listInstalled().map((i) => i.name)).toContain(
            "foo",
        );
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);

        // The name was freed from `removing`: it is mutable again (a re-install
        // rejects with "already exists", NOT "still being removed").
        await expect(
            built.testApi.install(
                "foo",
                makePathAgentDir("🧪"),
                undefined,
                issuing.host,
            ),
        ).rejects.toThrow(/already exists/i);

        releaseStraggler();
        await flush();
    });

    it("a host closed before the swap does not trip a premature commit before the last live session quiesces", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir, {
            updateCoordination: {
                quiesceTimeoutMs: 5_000,
            },
        });
        const issuing = recordingHost();
        let releaseLive!: () => void;
        const gate = new Promise<void>((r) => (releaseLive = r));
        const liveStraggler = recordingHost(gate);
        // Closed host: auto-acks + fills its slot from the success path.
        const closedHost: AppAgentHost = {
            addProvider: async () => {},
            removeProvider: async () => {},
            replaceProvider: async () => {},
        };
        built.connect(issuing.host);
        built.connect(liveStraggler.host);
        built.connect(closedHost);
        await installFooV1(built, instanceDir, issuing.host);
        issuing.calls.length = 0;
        liveStraggler.calls.length = 0;

        const outcomes: string[] = [];
        await built.testApi.update("foo", undefined, issuing.host, (o) =>
            outcomes.push(o),
        );
        await flush();
        // The closed host filled its slot, but the LIVE straggler has not
        // quiesced — so NO host has added v2 yet (no premature commit, no
        // coexistence).
        expect(outcomes).toEqual([]);
        expect(issuing.calls).toEqual([{ op: "remove" }]);
        expect(liveStraggler.calls).toEqual([{ op: "remove" }]);

        releaseLive();
        await settle();
        // Only after the last live session quiesces does the swap commit.
        expect(outcomes).toEqual(["updated"]);
        expect(issuing.calls).toEqual([{ op: "remove" }, { op: "add" }]);
        expect(liveStraggler.calls).toEqual([{ op: "remove" }, { op: "add" }]);
    });
});

describe("installed agent source api (install/uninstall/update)", () => {
    // A no-op issuing host: the record-store logic is independent of the
    // fan-out, so these tests pass a host whose add/remove do nothing. Fan-out /
    // enable / notification behavior is covered by the "fan-out" describe below.
    const host: AppAgentHost = withReplace({
        addProvider: async () => {},
        removeProvider: async () => {},
    });

    it("install resolves via the path source and persists the record with the requested name", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;

        const result = await installer.install(
            "myagent",
            agentDir,
            undefined,
            host,
        );
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
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("dup", agentDir, undefined, host);
        await expect(
            installer.install("dup", agentDir, undefined, host),
        ).rejects.toThrow(/already exists/);
    });

    it("rejects installing over a builtin (cannot shadow)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await expect(
            installer.install("player", agentDir, undefined, host),
        ).rejects.toThrow(/built-in/);
    });

    it("rejects uninstalling a builtin", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await expect(installer.uninstall("player", host)).rejects.toThrow(
            /built-in/,
        );
    });

    it("rejects updating a builtin", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await expect(
            installer.update("player", undefined, host),
        ).rejects.toThrow(/built-in/);
    });

    it("uninstall drops the record; unknown name rejects", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("gone", agentDir, undefined, host);
        await installer.uninstall("gone", host);
        expect(readAgentsJson(instanceDir)!.agents.gone).toBeUndefined();
        await expect(installer.uninstall("missing", host)).rejects.toThrow(
            /not found/,
        );
    });

    it("serializes concurrent installs without losing writes", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const a = makePathAgentDir();
        const b = makePathAgentDir();
        const c = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await Promise.all([
            installer.install("a", a, undefined, host),
            installer.install("b", b, undefined, host),
            installer.install("c", c, undefined, host),
        ]);
        const onDisk = readAgentsJson(instanceDir)!;
        expect(Object.keys(onDisk.agents).sort()).toEqual(["a", "b", "c"]);
    });

    it("rejects an explicit unknown source", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await expect(
            installer.install("x", agentDir, "nosuch", host),
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
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("p", agentDir, undefined, host);

        await installer.update("p", undefined, host);
        const record = readAgentsJson(instanceDir)!.agents.p;
        expect(record.path).toBe(path.resolve(agentDir));
        expect(record.source).toBe("path");
    });

    // GC (5.5): a superseded version-scoped install root is pruned once
    // the swap completes. A path re-resolve produces a record with no
    // installRoot, so seeding the pre-update record with an installRoot + a real
    // on-disk root exercises the `oldRoot !== record.installRoot` prune branch.
    it("update prunes the old version's install root after the swap", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir();
        // The prune runs in the GC finalizer after every host has swapped.
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("p", agentDir, undefined, host);

        // Retro-fit a version-scoped root onto the freshly installed record and
        // create its directory, as if a feed had installed it.
        const installDir = path.join(instanceDir, "installedAgents");
        const oldRoot = "p@old1";
        const oldRootDir = path.join(installDir, "agents", oldRoot);
        fs.mkdirSync(path.join(oldRootDir, "node_modules"), {
            recursive: true,
        });
        const agentsJsonPath = path.join(instanceDir, "agents.json");
        const cur = readAgentsJson(instanceDir)!;
        cur.agents.p.installRoot = oldRoot;
        fs.writeFileSync(agentsJsonPath, JSON.stringify(cur));
        expect(fs.existsSync(oldRootDir)).toBe(true);

        await installer.update("p", undefined, host);
        // The swap drains + re-adds asynchronously (uniform enqueue, ); the
        // old-root prune runs in the GC finalizer once every host has swapped, so
        // let it settle.
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        // The swap dropped installRoot (path re-resolve), so the old root is a
        // genuine orphan and must have been pruned.
        expect(fs.existsSync(oldRootDir)).toBe(false);
    });

    // GC (5.5): uninstall prunes the agent's version-scoped root once the
    // agent is confirmed down everywhere.
    it("uninstall prunes the agent's install root once drained", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("p", agentDir, undefined, host);

        const installDir = path.join(instanceDir, "installedAgents");
        const root = "p@live1";
        const rootDir = path.join(installDir, "agents", root);
        fs.mkdirSync(path.join(rootDir, "node_modules"), { recursive: true });
        const agentsJsonPath = path.join(instanceDir, "agents.json");
        const cur = readAgentsJson(instanceDir)!;
        cur.agents.p.installRoot = root;
        fs.writeFileSync(agentsJsonPath, JSON.stringify(cur));
        expect(fs.existsSync(rootDir)).toBe(true);

        await installer.uninstall("p", host);
        // The drain (and its post-drain prune) settles asynchronously ().
        await new Promise((r) => setTimeout(r, 0));

        expect(fs.existsSync(rootDir)).toBe(false);
        expect(readAgentsJson(instanceDir)!.agents.p).toBeUndefined();
    });

    // Refcount GC (5.5): content-addressed roots (`module@version`) are
    // SHARED across agents that resolve to the same package+version, so a prune
    // must not delete a root a sibling still references.
    it("uninstall keeps a shared root until the LAST referencing agent goes", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("a", makePathAgentDir("🅰️"), undefined, host);
        await installer.install("b", makePathAgentDir("🅱️"), undefined, host);

        // Retro-fit BOTH agents onto one shared content-addressed root, as if a
        // feed had deduped the same package+version across them.
        const installDir = path.join(instanceDir, "installedAgents");
        const shared = "shared-mod@1.0.0";
        const sharedDir = path.join(installDir, "agents", shared);
        fs.mkdirSync(path.join(sharedDir, "node_modules"), { recursive: true });
        const cur = readAgentsJson(instanceDir)!;
        cur.agents.a.installRoot = shared;
        cur.agents.b.installRoot = shared;
        fs.writeFileSync(
            path.join(instanceDir, "agents.json"),
            JSON.stringify(cur),
        );
        expect(fs.existsSync(sharedDir)).toBe(true);

        // Uninstalling `a` must NOT prune the shared root — `b` still references
        // it.
        await installer.uninstall("a", host);
        await new Promise((r) => setTimeout(r, 0));
        expect(readAgentsJson(instanceDir)!.agents.a).toBeUndefined();
        expect(fs.existsSync(sharedDir)).toBe(true);

        // Uninstalling the last referencer (`b`) reclaims it.
        await installer.uninstall("b", host);
        await new Promise((r) => setTimeout(r, 0));
        expect(readAgentsJson(instanceDir)!.agents.b).toBeUndefined();
        expect(fs.existsSync(sharedDir)).toBe(false);
    });

    it("update does not prune the old root while a sibling still references it", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("a", makePathAgentDir("🅰️"), undefined, host);
        await installer.install("b", makePathAgentDir("🅱️"), undefined, host);

        const installDir = path.join(instanceDir, "installedAgents");
        const shared = "shared-mod@1.0.0";
        const sharedDir = path.join(installDir, "agents", shared);
        fs.mkdirSync(path.join(sharedDir, "node_modules"), { recursive: true });
        const cur = readAgentsJson(instanceDir)!;
        cur.agents.a.installRoot = shared;
        cur.agents.b.installRoot = shared;
        fs.writeFileSync(
            path.join(instanceDir, "agents.json"),
            JSON.stringify(cur),
        );

        // Updating `a` re-resolves via the path source (dropping a's installRoot),
        // so a's old shared root becomes a swap-superseded root — but `b` still
        // references it, so the refcount-guarded prune must leave it intact.
        await installer.update("a", undefined, host);
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        expect(fs.existsSync(sharedDir)).toBe(true);
        expect(readAgentsJson(instanceDir)!.agents.b.installRoot).toBe(shared);
    });

    it("path re-resolution uses the record's `path` handle (no `ref` needed)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("p", agentDir, undefined, host);

        // A path install has no re-resolution `ref`: the path source's handle
        // is `path` (its record field), so nothing is persisted in `ref` and
        // @update re-resolves straight off `path`.
        const afterInstall = readAgentsJson(instanceDir)!.agents.p;
        expect(afterInstall.ref).toBeUndefined();

        await installer.update("p", undefined, host);
        const afterUpdate = readAgentsJson(instanceDir)!.agents.p;
        expect(afterUpdate.path).toBe(path.resolve(agentDir));
        expect(afterUpdate.source).toBe("path");
    });

    it("update picks up a changed manifest from the recorded path", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir("🧪");
        const built = createDefaultInstalledAgentSource(instanceDir);
        await built.testApi.install("p", agentDir, undefined, host);

        // Edit the on-disk agent, then update.
        fs.writeFileSync(
            path.join(agentDir, "manifest.json"),
            JSON.stringify({ emojiChar: "🚀" }),
        );
        await built.testApi.update("p", undefined, host);
        // The swap drains + re-adds asynchronously (uniform enqueue, ); let
        // it settle so the new version is active before we vend a connection.
        await new Promise((r) => setTimeout(r, 0));
        // The freshly materialized provider is vended on the next connect.
        const conn = built.connect(host);
        const provider = conn.providers.find((p) =>
            p.getAppAgentNames().includes("p"),
        )!;
        const manifest = await provider.getAppAgentManifest("p");
        expect(manifest.emojiChar).toBe("🚀");
        conn.dispose();
    });

    it("a failed update leaves the old record intact (no-op)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("p", agentDir, undefined, host);
        const before = readAgentsJson(instanceDir)!.agents.p;

        // Remove the on-disk target so re-resolution can no longer materialize.
        fs.rmSync(agentDir, { recursive: true, force: true });
        await expect(installer.update("p", undefined, host)).rejects.toThrow();

        const after = readAgentsJson(instanceDir)!.agents.p;
        expect(after).toEqual(before);
    });

    it("update rejects an unknown agent", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await expect(
            installer.update("missing", undefined, host),
        ).rejects.toThrow(/not found/);
    });

    it("update fails when the recorded source is no longer configured", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir();
        const installer =
            createDefaultInstalledAgentSource(instanceDir).testApi;
        await installer.install("p", agentDir, undefined, host);
        // Drop the only configured source out from under the record, then
        // rebuild the installer so it reloads its sources from the edited
        // config (the registry is now host-internal, reached only via config).
        const cfgPath = path.join(instanceDir, "config.json");
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        cfg.installSources.order = [];
        cfg.installSources.sources = [];
        fs.writeFileSync(cfgPath, JSON.stringify(cfg));
        const reloaded = createDefaultInstalledAgentSource(instanceDir).testApi;
        await expect(reloaded.update("p", undefined, host)).rejects.toThrow(
            /no longer configured/,
        );
    });
});

describe("startup orphan sweep (5.5 GC)", () => {
    // Seed an instance dir with a path-only source config plus a hand-written
    // agents.json whose single record points at a version-scoped install root,
    // and populate installedAgents/agents with that recorded root plus a couple
    // of stray roots (a crashed-update v2, an un-pruned v1). Constructing the
    // source must sweep only the strays, keeping the recorded-current root.
    function seedInstanceWithRoots(
        records: Record<string, InstalledAgentRecord>,
        rootDirNames: string[],
    ): { instanceDir: string; agentsDir: string } {
        const dir = tmpDir("ta-sweep-");
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
        fs.writeFileSync(
            path.join(dir, "agents.json"),
            JSON.stringify({ agents: records }),
        );
        const agentsDir = path.join(dir, "installedAgents", "agents");
        for (const name of rootDirNames) {
            const rootDir = path.join(agentsDir, name);
            fs.mkdirSync(path.join(rootDir, "node_modules"), {
                recursive: true,
            });
            fs.writeFileSync(
                path.join(rootDir, "package.json"),
                JSON.stringify({ private: true }),
            );
        }
        return { instanceDir: dir, agentsDir };
    }

    it("removes stray roots but keeps each agent's recorded-current root", () => {
        const { instanceDir, agentsDir } = seedInstanceWithRoots(
            {
                keeper: {
                    name: "keeper",
                    kind: "npm",
                    module: "keeper-mod",
                    source: "typeagent",
                    installRoot: "keeper@current",
                },
            },
            // recorded-current + a crashed-update v2 + an un-pruned v1
            ["keeper@current", "keeper@crashedV2", "keeper@oldV1"],
        );
        // Construct the source — this runs the startup orphan sweep.
        createDefaultInstalledAgentSource(instanceDir);
        const remaining = fs.readdirSync(agentsDir).sort();
        expect(remaining).toEqual(["keeper@current"]);
    });

    it("keeps the current root of every agent (multi-agent keep-set)", () => {
        const { instanceDir, agentsDir } = seedInstanceWithRoots(
            {
                one: {
                    name: "one",
                    kind: "npm",
                    module: "one-mod",
                    source: "typeagent",
                    installRoot: "one@cur",
                },
                two: {
                    name: "two",
                    kind: "npm",
                    module: "two-mod",
                    source: "typeagent",
                    installRoot: "two@cur",
                },
            },
            // both currents + a stray for each
            ["one@cur", "two@cur", "one@stray", "two@stray"],
        );
        createDefaultInstalledAgentSource(instanceDir);
        // A regression that collapsed the keep-set to a single agent would drop
        // the other agent's current root.
        expect(fs.readdirSync(agentsDir).sort()).toEqual([
            "one@cur",
            "two@cur",
        ]);
    });

    it("leaves the agents dir empty when no record has an install root", () => {
        const { instanceDir, agentsDir } = seedInstanceWithRoots(
            {
                // A legacy record without installRoot references no version-
                // scoped root, so every stray root is an orphan.
                legacy: {
                    name: "legacy",
                    kind: "npm",
                    module: "legacy-mod",
                    source: "typeagent",
                },
            },
            ["legacy@stray1", "legacy@stray2"],
        );
        createDefaultInstalledAgentSource(instanceDir);
        expect(fs.readdirSync(agentsDir)).toEqual([]);
    });

    it("is a no-op when there is no agents directory yet", () => {
        const dir = tmpDir("ta-sweep-");
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
        // No agents.json, no installedAgents/agents dir.
        expect(() => createDefaultInstalledAgentSource(dir)).not.toThrow();
    });
});

// Structural manifest check (5.3): every install/update — feed, catalog
// `module`, AND local `path` — validates the freshly-materialized manifest at
// install/update time, so a corrupt/unreadable agent fails BEFORE anything is
// recorded (or, on update, before `v1` is torn down) rather than committing a
// broken agent.
describe("structural manifest check on install/update (5.3)", () => {
    it("install of an npm-package source fails and records nothing when the manifest is unreadable", async () => {
        const instanceDir = catalogModuleInstanceDir("cat", "cat-mod", false);
        const built = createDefaultInstalledAgentSource(instanceDir).testApi;
        await expect(
            built.install("x", "cat", "cat", noopHost),
        ).rejects.toThrow();
        // Nothing persisted: a broken agent is never recorded.
        expect(readAgentsJson(instanceDir)?.agents.x).toBeUndefined();
        expect(built.listInstalled().map((i) => i.name)).not.toContain("x");
    });

    it("install of an npm-package source succeeds when the manifest reads", async () => {
        const instanceDir = catalogModuleInstanceDir("cat", "cat-mod", true);
        const built = createDefaultInstalledAgentSource(instanceDir).testApi;
        await built.install("x", "cat", "cat", noopHost);
        expect(readAgentsJson(instanceDir)!.agents.x.module).toBe("cat-mod");
    });

    it("update rejects and leaves v1 intact when v2's manifest is unreadable", async () => {
        const instanceDir = catalogModuleInstanceDir("cat", "cat-mod", true);
        const built = createDefaultInstalledAgentSource(instanceDir).testApi;
        await built.install("x", "cat", "cat", noopHost);
        expect(readAgentsJson(instanceDir)!.agents.x.module).toBe("cat-mod");

        // Re-point the catalog key at a fresh, never-resolved (absent) module
        // so v2's manifest cannot be read; the update must reject WITHOUT
        // tearing v1 down (no barrier reached). A different module name avoids
        // Node's module-resolution cache from v1's successful load.
        fs.writeFileSync(
            path.join(instanceDir, "catalog.json"),
            JSON.stringify({ agents: { cat: { name: "cat-mod-absent" } } }),
        );
        await expect(built.update("x", undefined, noopHost)).rejects.toThrow();
        // v1's record is untouched and the name is still installed.
        expect(readAgentsJson(instanceDir)!.agents.x.module).toBe("cat-mod");
        expect(built.listInstalled().map((i) => i.name)).toContain("x");
    });

    it("a `path` install is validated too — a manifest-less directory fails and records nothing", async () => {
        // A bare directory (no package.json / manifest) installs via the path
        // source. The structural check is source-agnostic (5.3), so an
        // unreadable manifest fails the install BEFORE anything is recorded —
        // exactly like an npm-package source.
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir).testApi;
        const bareDir = tmpDir("ta-bare-");
        await expect(
            built.install("p", bareDir, undefined, noopHost),
        ).rejects.toThrow();
        expect(readAgentsJson(instanceDir)?.agents.p).toBeUndefined();
        expect(built.listInstalled().map((i) => i.name)).not.toContain("p");
    });
});

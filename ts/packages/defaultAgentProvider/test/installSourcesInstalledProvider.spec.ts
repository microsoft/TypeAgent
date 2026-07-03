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
} from "../src/installSources/installedAgents.js";
import {
    createDefaultInstalledAgentSource,
    getDefaultAppAgentProviders,
} from "../src/defaultAgentProviders.js";
import { InstalledAgentRecord } from "../src/installSources/config.js";
import { AppAgentProvider, AppAgentHost } from "agent-dispatcher";

// A no-op issuing host used by tests that only exercise the record store or the
// vended provider set (fan-out behavior is covered by its own describe).
const noopHost: AppAgentHost = {
    addProvider: async () => {},
    removeProvider: async () => {},
};

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

describe("createInstalledAppAgentProviders", () => {
    // Find the provider in a list that owns the given agent name.
    function providerFor(
        providers: AppAgentProvider[],
        name: string,
    ): AppAgentProvider {
        const provider = providers.find((p) =>
            p.getAppAgentNames().includes(name),
        );
        if (provider === undefined) {
            throw new Error(`no provider owns '${name}'`);
        }
        return provider;
    }
    function allNames(providers: AppAgentProvider[]): string[] {
        return providers.flatMap((p) => p.getAppAgentNames()).sort();
    }

    it("builds a single-agent provider for one record (runtime unit)", async () => {
        const provider = createInstalledAppAgentProvider("player", {
            name: "player",
            kind: "npm",
            module: "music",
            source: "bundled",
        });
        expect(provider.getAppAgentNames()).toEqual(["player"]);
        expect(await provider.getAppAgentManifest("player")).toBeDefined();
    });

    it("loads a bundled module record against the app bundle root", async () => {
        const records: Record<string, InstalledAgentRecord> = {
            player: {
                name: "player",
                kind: "npm",
                module: "music",
                source: "bundled",
            },
        };
        const providers = createInstalledAppAgentProviders(records);
        expect(allNames(providers)).toEqual(["player"]);
        const manifest = await providerFor(
            providers,
            "player",
        ).getAppAgentManifest("player");
        expect(manifest).toBeDefined();
    });

    it("unions agent names across records", async () => {
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
        const providers = createInstalledAppAgentProviders(
            records,
            "/nonexistent/installDir",
        );
        expect(allNames(providers)).toEqual(["mine", "player"]);
    });

    it("is well-formed with no records", () => {
        const providers = createInstalledAppAgentProviders({});
        expect(allNames(providers)).toEqual([]);
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
        const providers = createInstalledAppAgentProviders(records, installDir);
        expect(allNames(providers)).toEqual(["feedy", "player"]);
        // feed module resolves ONLY from installDir (absent in app bundle)
        const feedManifest = await providerFor(
            providers,
            "feedy",
        ).getAppAgentManifest("feedy");
        expect(feedManifest.emojiChar).toBe("🧪");
        // bundled module still resolves from the app bundle root
        const bundledManifest = await providerFor(
            providers,
            "player",
        ).getAppAgentManifest("player");
        expect(bundledManifest).toBeDefined();
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
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        const agentDir = tmpDir("ta-agent-");
        await installer.install("namedOnly", agentDir, undefined, noopHost);

        // Installed agents are vended by the source at connect(), NOT by the
        // static provider list (design §3.3).
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
        await built.api.install(
            "namedOnly",
            tmpDir("ta-agent-"),
            undefined,
            noopHost,
        );

        // A fresh connection sees the freshly installed agent (the shared
        // per-agent provider is added to the vended set on install).
        const fakeHost = {
            addProvider: async () => {},
            removeProvider: async () => {},
        };
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
        const fakeHost = {
            addProvider: async () => {},
            removeProvider: async () => {},
        };
        // First connection: nothing installed yet.
        const first = built.connect(fakeHost);
        expect(
            new Set(first.providers.flatMap((p) => p.getAppAgentNames())).has(
                "later",
            ),
        ).toBe(false);
        // Install, then connect a second session — it must see the new agent
        // in its initial vended set (design §6 note).
        await built.api.install(
            "later",
            tmpDir("ta-agent-"),
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
        await built.api.install(
            "shared",
            tmpDir("ta-agent-"),
            undefined,
            noopHost,
        );
        const hostA = {
            addProvider: async () => {},
            removeProvider: async () => {},
        };
        const hostB = {
            addProvider: async () => {},
            removeProvider: async () => {},
        };
        const connA = built.connect(hostA);
        connA.dispose();
        expect(() => connA.dispose()).not.toThrow();
        // A new connection still vends the shared installed provider — a single
        // session's dispose must not tear it down (design §6).
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
        await built.api.install(
            "temp",
            tmpDir("ta-agent-"),
            undefined,
            noopHost,
        );
        await built.api.uninstall("temp", noopHost);
        const host = {
            addProvider: async () => {},
            removeProvider: async () => {},
        };
        const conn = built.connect(host);
        expect(
            new Set(conn.providers.flatMap((p) => p.getAppAgentNames())).has(
                "temp",
            ),
        ).toBe(false);
        conn.dispose();
    });
});

describe("AppAgentSource fan-out (design §4, §5)", () => {
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
            host: {
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
            },
        };
    }

    const flush = () => new Promise((r) => setTimeout(r, 0));

    it("install: issuing awaited+inline, siblings notified", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        const sibling = recordingHost();
        built.connect(issuing.host);
        built.connect(sibling.host);

        await built.api.install(
            "foo",
            tmpDir("ta-agent-"),
            undefined,
            issuing.host,
        );
        await flush();

        // Issuing session: not notified (reports inline).
        expect(issuing.calls).toEqual([
            { op: "add", name: "foo", notify: false },
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
            host: {
                addProvider: async () => {
                    throw new Error("sibling boom");
                },
                removeProvider: async () => {},
            } as AppAgentHost,
        };
        const goodSibling = recordingHost();
        built.connect(issuing.host);
        built.connect(badSibling.host);
        built.connect(goodSibling.host);

        // Must not throw despite the bad sibling.
        await expect(
            built.api.install(
                "foo",
                tmpDir("ta-agent-"),
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
        await built.api.install(
            "foo",
            tmpDir("ta-agent-"),
            undefined,
            issuing.host,
        );
        await flush();
        issuing.calls.length = 0;
        sibling.calls.length = 0;

        await built.api.uninstall("foo", issuing.host);
        await flush();

        expect(issuing.calls).toEqual([
            { op: "remove", name: "foo", notify: false },
        ]);
        expect(sibling.calls).toEqual([
            { op: "remove", name: "foo", notify: true },
        ]);
    });

    it("does not fan out to a disposed (deregistered) session", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        const gone = recordingHost();
        built.connect(issuing.host);
        const goneConn = built.connect(gone.host);
        goneConn.dispose(); // deregisters `gone` from the client registry

        await built.api.install(
            "foo",
            tmpDir("ta-agent-"),
            undefined,
            issuing.host,
        );
        await flush();

        expect(issuing.calls).toHaveLength(1);
        expect(gone.calls).toHaveLength(0);
    });

    it("single client (web) degrades cleanly: issuing inline, no siblings", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const only = recordingHost();
        built.connect(only.host);
        await built.api.install(
            "foo",
            tmpDir("ta-agent-"),
            undefined,
            only.host,
        );
        await flush();
        // The single client is the issuing session: not notified (reports
        // inline), and there are no siblings to fan out to.
        expect(only.calls).toEqual([{ op: "add", name: "foo", notify: false }]);
    });

    it("update fans out remove-then-add per client (issuing + sibling)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        const sibling = recordingHost();
        built.connect(issuing.host);
        built.connect(sibling.host);
        await built.api.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing.host,
        );
        await flush();
        issuing.calls.length = 0;
        sibling.calls.length = 0;

        await built.api.update("foo", undefined, issuing.host);
        await flush();

        // Every session sees remove BEFORE add (no coexistence); issuing gets
        // no-notify (inline), sibling gets notify.
        expect(issuing.calls).toEqual([
            { op: "remove", name: "foo", notify: false },
            { op: "add", name: "foo", notify: false },
        ]);
        expect(sibling.calls).toEqual([
            { op: "remove", name: "foo", notify: true },
            { op: "add", name: "foo", notify: true },
        ]);
    });

    it("vends installed agents honoring their manifest default (Model B, design §5)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHost();
        built.connect(issuing.host);
        await built.api.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing.host,
        );
        const conn = built.connect({
            addProvider: async () => {},
            removeProvider: async () => {},
        });
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
});

describe("AppAgentSource lifecycle tracker (design §7)", () => {
    // An issuing host whose ops resolve immediately.
    function fastHost(): AppAgentHost {
        return {
            addProvider: async () => {},
            removeProvider: async () => {},
        };
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
            host: {
                addProvider: async () => {},
                removeProvider: async () => {
                    await gate;
                },
            } as AppAgentHost,
        };
    }

    const flush = () => new Promise((r) => setTimeout(r, 0));

    async function installFoo(
        built: ReturnType<typeof createDefaultInstalledAgentSource>,
        issuing: AppAgentHost,
    ) {
        await built.api.install("foo", tmpDir("ta-agent-"), undefined, issuing);
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
        const uninstalling = built.api.uninstall("foo", issuing);
        await flush();

        // Reuse during removing is rejected (design §7.3).
        await expect(
            built.api.install("foo", tmpDir("ta-agent-"), undefined, issuing),
        ).rejects.toThrow(/still being removed/i);
        await expect(
            built.api.update("foo", undefined, issuing),
        ).rejects.toThrow(/still being removed/i);

        // Release the drain; the name frees and can be reused.
        gated.release();
        await uninstalling;
        await flush();
        await expect(
            built.api.install("foo", tmpDir("ta-agent-"), undefined, issuing),
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
        const uninstalling = built.api.uninstall("foo", issuing);
        await flush();

        // A new session must NOT pick up the draining name (design §7.3).
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

    it("disconnect while pending completes the drain (auto-ack)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        const gated = gatedHost();
        built.connect(issuing);
        const gatedConn = built.connect(gated.host);
        await installFoo(built, issuing);
        await built.api.uninstall("foo", issuing);
        await flush();

        // The gated sibling still pends. Disposing its connection drops it from
        // the drain, which completes the drain and frees the name (design §7.3).
        gatedConn.dispose();
        await flush();
        await expect(
            built.api.install("foo", tmpDir("ta-agent-"), undefined, issuing),
        ).resolves.toBeDefined();
    });

    it("refuses to load a name while it is removing (tombstone)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        const gated = gatedHost();
        const holder = built.connect(issuing);
        built.connect(gated.host);
        await installFoo(built, issuing);
        // A session connected after install holds the shared provider.
        const holderConn = built.connect(fastHost());
        const provider = holderConn.providers.find((p) =>
            p.getAppAgentNames().includes("foo"),
        )!;

        const uninstalling = built.api.uninstall("foo", issuing);
        await flush();
        // Loading a draining name is refused even though the provider is cached.
        await expect(provider.loadAppAgent("foo")).rejects.toThrow(
            /being removed/i,
        );

        gated.release();
        await uninstalling;
        holder.dispose();
        holderConn.dispose();
    });

    it("@package list hides a draining agent (update in progress)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        const gated = gatedHost();
        built.connect(issuing);
        built.connect(gated.host);
        await built.api.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing,
        );
        await flush();

        // Update starts a drain of the old version; the record now points at the
        // new version but the entry is `removing`, so list must hide it.
        const updating = built.api.update("foo", undefined, issuing);
        await flush();
        expect(built.api.listInstalled().map((i) => i.name)).not.toContain(
            "foo",
        );

        gated.release();
        await updating;
        await flush();
        // After the drain + re-add, it is listed again.
        expect(built.api.listInstalled().map((i) => i.name)).toContain("foo");
    });

    it("update adds the new version only after the old drains everywhere (no coexistence)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = recordingHostForLifecycle();
        const gated = gatedHost();
        built.connect(issuing.host);
        built.connect(gated.host);
        await built.api.install(
            "foo",
            makePathAgentDir("🧪"),
            undefined,
            issuing.host,
        );
        await flush();
        issuing.calls.length = 0;

        const updating = built.api.update("foo", undefined, issuing.host);
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

    // A recording host that only tracks the op kind (for ordering assertions).
    function recordingHostForLifecycle() {
        const calls: { op: "add" | "remove" }[] = [];
        return {
            calls,
            host: {
                addProvider: async () => {
                    calls.push({ op: "add" });
                },
                removeProvider: async () => {
                    calls.push({ op: "remove" });
                },
            } as AppAgentHost,
        };
    }

    it("a failed update leaves the agent active + vended everywhere (§7.4)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const built = createDefaultInstalledAgentSource(instanceDir);
        const issuing = fastHost();
        built.connect(issuing);
        const agentDir = makePathAgentDir("🧪");
        await built.api.install("foo", agentDir, undefined, issuing);
        await flush();

        // Break re-resolution so the materialize fails.
        fs.rmSync(agentDir, { recursive: true, force: true });
        await expect(
            built.api.update("foo", undefined, issuing),
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
        const throwingSibling: AppAgentHost = {
            addProvider: async () => {},
            removeProvider: async () => {
                throw new Error("sibling remove boom");
            },
        };
        built.connect(issuing);
        built.connect(throwingSibling);
        await installFoo(built, issuing);

        // The sibling throws on removeProvider, but its failure still drops it
        // from `pending` (design §7.4), so the drain completes and the record
        // stays committed.
        await built.api.uninstall("foo", issuing);
        await flush();
        expect(readAgentsJson(instanceDir)!.agents.foo).toBeUndefined();
        // Name is freed despite the sibling failure — reuse is allowed.
        await expect(
            built.api.install("foo", tmpDir("ta-agent-"), undefined, issuing),
        ).resolves.toBeDefined();
    });
});

describe("installed agent source api (install/uninstall/update)", () => {
    // A no-op issuing host: the record-store logic is independent of the
    // fan-out, so these tests pass a host whose add/remove do nothing. Fan-out /
    // enable / notification behavior is covered by the "fan-out" describe below.
    const host: AppAgentHost = {
        addProvider: async () => {},
        removeProvider: async () => {},
    };

    it("install resolves via the path source and persists the record with the requested name", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;

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
        const agentDir = tmpDir("ta-agent-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        await installer.install("dup", agentDir, undefined, host);
        await expect(
            installer.install("dup", agentDir, undefined, host),
        ).rejects.toThrow(/already exists/);
    });

    it("rejects installing over a builtin (cannot shadow)", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        await expect(
            installer.install("player", agentDir, undefined, host),
        ).rejects.toThrow(/built-in/);
    });

    it("rejects uninstalling a builtin", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        await expect(installer.uninstall("player", host)).rejects.toThrow(
            /built-in/,
        );
    });

    it("rejects updating a builtin", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        await expect(
            installer.update("player", undefined, host),
        ).rejects.toThrow(/built-in/);
    });

    it("uninstall drops the record; unknown name rejects", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        await installer.install("gone", agentDir, undefined, host);
        await installer.uninstall("gone", host);
        expect(readAgentsJson(instanceDir)!.agents.gone).toBeUndefined();
        await expect(installer.uninstall("missing", host)).rejects.toThrow(
            /not found/,
        );
    });

    it("serializes concurrent installs without losing writes", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const a = tmpDir("ta-agent-a-");
        const b = tmpDir("ta-agent-b-");
        const c = tmpDir("ta-agent-c-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
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
        const agentDir = tmpDir("ta-agent-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
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
        const agentDir = tmpDir("ta-agent-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        await installer.install("p", agentDir, undefined, host);

        await installer.update("p", undefined, host);
        const record = readAgentsJson(instanceDir)!.agents.p;
        expect(record.path).toBe(path.resolve(agentDir));
        expect(record.source).toBe("path");
    });

    it("preserves the re-resolution key (ref) across update", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        await installer.install("p", agentDir, undefined, host);

        // A path install has no resolved `ref`; install fills it with the
        // supplied lookup key so a later @update can re-resolve.
        const afterInstall = readAgentsJson(instanceDir)!.agents.p;
        expect(afterInstall.ref).toBe(agentDir);

        await installer.update("p", undefined, host);
        const afterUpdate = readAgentsJson(instanceDir)!.agents.p;
        // The fix under test: update must not drop the re-resolution key.
        expect(afterUpdate.ref).toBeDefined();
        expect(afterUpdate.ref).toBe(afterUpdate.path);
    });

    it("update picks up a changed manifest from the recorded path", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = makePathAgentDir("🧪");
        const built = createDefaultInstalledAgentSource(instanceDir);
        await built.api.install("p", agentDir, undefined, host);

        // Edit the on-disk agent, then update.
        fs.writeFileSync(
            path.join(agentDir, "manifest.json"),
            JSON.stringify({ emojiChar: "🚀" }),
        );
        await built.api.update("p", undefined, host);
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
        const agentDir = tmpDir("ta-agent-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
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
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        await expect(
            installer.update("missing", undefined, host),
        ).rejects.toThrow(/not found/);
    });

    it("update fails when the recorded source is no longer configured", async () => {
        const instanceDir = pathOnlyInstanceDir();
        const agentDir = tmpDir("ta-agent-");
        const installer = createDefaultInstalledAgentSource(instanceDir).api;
        await installer.install("p", agentDir, undefined, host);
        // Drop the only configured source out from under the record, then
        // rebuild the installer so it reloads its sources from the edited
        // config (the registry is now host-internal, reached only via config).
        const cfgPath = path.join(instanceDir, "config.json");
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        cfg.installSources.order = [];
        cfg.installSources.sources = [];
        fs.writeFileSync(cfgPath, JSON.stringify(cfg));
        const reloaded = createDefaultInstalledAgentSource(instanceDir).api;
        await expect(reloaded.update("p", undefined, host)).rejects.toThrow(
            /no longer configured/,
        );
    });
});

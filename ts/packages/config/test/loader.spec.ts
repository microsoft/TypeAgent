// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    loadConfigSync,
    loadConfig,
    reloadConfigKeysSync,
    tryReloadConfigKeysSync,
    getConfigProblems,
} from "../src/loader.js";

function makeTempWorkspace(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-config-test-"));
}

function cleanProcessEnv(keys: string[]): void {
    for (const k of keys) {
        delete process.env[k];
    }
}

describe("loadConfigSync", () => {
    const trackedKeys = [
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_MAX_CONCURRENCY",
        "OPENAI_API_KEY",
        "BING_API_KEY",
        "TYPEAGENT_TEST_KEY",
    ];

    afterEach(() => cleanProcessEnv(trackedKeys));

    test("returns empty result when no files exist", () => {
        const root = makeTempWorkspace();
        try {
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env).toEqual({});
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("loads defaults YAML and populates process.env", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                [
                    "azure:",
                    "  openai:",
                    "    max_concurrency: 4",
                    "    response_format: true",
                ].join("\n"),
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({ workspaceRoot: root });
            expect(result.env.AZURE_OPENAI_MAX_CONCURRENCY).toBe("4");
            expect(result.env.AZURE_OPENAI_RESPONSE_FORMAT).toBe("1");
            expect(process.env.AZURE_OPENAI_MAX_CONCURRENCY).toBe("4");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("local YAML overrides defaults", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                ["azure:", "  openai:", "    max_concurrency: 4"].join("\n"),
            );
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                ["azure:", "  openai:", "    max_concurrency: 16"].join("\n"),
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env.AZURE_OPENAI_MAX_CONCURRENCY).toBe("16");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test(".env loads as lowest-precedence fallback", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, ".env"),
                [
                    "BING_API_KEY=from-dotenv",
                    "AZURE_OPENAI_API_KEY=from-dotenv",
                ].join("\n"),
            );
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                ["env:", "  AZURE_OPENAI_API_KEY: from-yaml"].join("\n"),
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            // Defaults wins over .env.
            expect(result.env.AZURE_OPENAI_API_KEY).toBe("from-yaml");
            // .env-only key still flows through.
            expect(result.env.BING_API_KEY).toBe("from-dotenv");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("local YAML overrides Key Vault would-be values (and .env)", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(path.join(root, ".env"), "BING_API_KEY=dotenv\n");
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "bing:\n  api_key: defaults\n",
            );
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "bing:\n  api_key: local\n",
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env.BING_API_KEY).toBe("local");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("preserves existing process.env (does not clobber overrides)", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: from-yaml\n",
            );
            cleanProcessEnv(trackedKeys);
            process.env.OPENAI_API_KEY = "from-shell";
            loadConfigSync({ workspaceRoot: root });
            expect(process.env.OPENAI_API_KEY).toBe("from-shell");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("idempotent: calling twice does not double-apply or change result", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: stable\n",
            );
            cleanProcessEnv(trackedKeys);
            const first = loadConfigSync({ workspaceRoot: root });
            const second = loadConfigSync({ workspaceRoot: root });
            expect(first.env).toEqual(second.env);
            expect(process.env.OPENAI_API_KEY).toBe("stable");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("trackSources records origin per key", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, ".env"),
                "TYPEAGENT_TEST_KEY=from-dotenv\n",
            );
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: from-defaults\n",
            );
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "openai:\n  api_key: from-local\n",
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
                trackSources: true,
            });
            expect(result.sources).toBeDefined();
            expect(result.sources!.OPENAI_API_KEY).toBe("local");
            expect(result.sources!.TYPEAGENT_TEST_KEY).toBe("dotenv");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("strict: invalid YAML throws", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "deployments:\n  - one\n  - two\n",
            );
            cleanProcessEnv(trackedKeys);
            expect(() =>
                loadConfigSync({
                    workspaceRoot: root,
                    populateProcessEnv: false,
                }),
            ).toThrow(/Invalid TypeAgent config/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("non-strict: invalid YAML is logged and skipped", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "deployments:\n  - one\n",
            );
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "openai:\n  api_key: ok\n",
            );
            cleanProcessEnv(trackedKeys);
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
                strict: false,
            });
            expect(result.env.OPENAI_API_KEY).toBe("ok");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("loadConfig (async)", () => {
    test("returns the same shape as loadConfigSync in Phase 1", async () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "openai:\n  api_key: hello\n",
            );
            delete process.env.OPENAI_API_KEY;
            const result = await loadConfig({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env.OPENAI_API_KEY).toBe("hello");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            delete process.env.OPENAI_API_KEY;
        }
    });
});

describe("invalid sections", () => {
    const trackedKeys = ["OPENAI_API_KEY", "SPOTIFY_APP_PORT"];
    afterEach(() => cleanProcessEnv(trackedKeys));

    test("skips only the bad section and reports it as a problem", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                [
                    "openai:",
                    "  api_key: good",
                    "spotify:",
                    "  port: <value>",
                ].join("\n"),
            );
            cleanProcessEnv(trackedKeys);
            const warn = console.warn;
            console.warn = () => {};
            try {
                const result = loadConfigSync({
                    workspaceRoot: root,
                    strict: true,
                    populateProcessEnv: false,
                });
                expect(result.env.OPENAI_API_KEY).toBe("good");
                expect(result.env.SPOTIFY_APP_CLI).toBeUndefined();
                expect(result.env.SPOTIFY_APP_PORT).toBeUndefined();
            } finally {
                console.warn = warn;
            }
            const problems = getConfigProblems();
            expect(problems.map((p) => p.section)).toContain("spotify");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("keeps valid leaves when a sibling contains a placeholder", () => {
        const root = makeTempWorkspace();
        const warn = console.warn;
        console.warn = () => {};
        try {
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                [
                    "spotify:",
                    "  clientId: good-id",
                    "  clientSecret: good-secret",
                    "  port: <value>",
                ].join("\n"),
            );
            const result = loadConfigSync({
                workspaceRoot: root,
                populateProcessEnv: false,
            });
            expect(result.env.SPOTIFY_APP_CLI).toBe("good-id");
            expect(result.env.SPOTIFY_APP_CLISEC).toBe("good-secret");
            expect(result.env.SPOTIFY_APP_PORT).toBeUndefined();
            expect(getConfigProblems()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        section: "spotify",
                        message: expect.stringContaining("spotify.port"),
                    }),
                ]),
            );
        } finally {
            console.warn = warn;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("reloadConfigKeysSync", () => {
    afterEach(() =>
        cleanProcessEnv([
            "OPENAI_API_KEY",
            "SPOTIFY_APP_CLI",
            "SPOTIFY_APP_CLISEC",
        ]),
    );

    test("tryReloadConfigKeysSync keeps startup values when the reload fails", () => {
        const root = makeTempWorkspace();
        try {
            const file = path.join(root, "config.local.yaml");
            fs.writeFileSync(file, "openai:\n  api_key: first\n");
            cleanProcessEnv(["OPENAI_API_KEY"]);
            loadConfigSync({ workspaceRoot: root });
            expect(process.env.OPENAI_API_KEY).toBe("first");

            // Unparseable YAML: the reload can't produce anything, and the
            // caller must not be turned into a hard failure by it.
            fs.writeFileSync(file, "openai:\n  api_key: [unclosed\n");
            expect(() =>
                tryReloadConfigKeysSync(["OPENAI_API_KEY"], {
                    workspaceRoot: root,
                }),
            ).not.toThrow();
            expect(process.env.OPENAI_API_KEY).toBe("first");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("overwrites an existing process.env value and reports the change", () => {
        const root = makeTempWorkspace();
        try {
            const file = path.join(root, "config.local.yaml");
            fs.writeFileSync(file, "openai:\n  api_key: first\n");
            cleanProcessEnv(["OPENAI_API_KEY"]);
            loadConfigSync({ workspaceRoot: root });
            expect(process.env.OPENAI_API_KEY).toBe("first");

            fs.writeFileSync(file, "openai:\n  api_key: second\n");
            const changed = reloadConfigKeysSync(["OPENAI_API_KEY"], {
                workspaceRoot: root,
            });
            expect(process.env.OPENAI_API_KEY).toBe("second");
            expect(changed).toContain("OPENAI_API_KEY");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("changes only keys in the requested scope", () => {
        const root = makeTempWorkspace();
        try {
            fs.writeFileSync(
                path.join(root, "config.local.yaml"),
                "spotify:\n  clientId: local\nopenai:\n  api_key: local-openai\n",
            );
            process.env.SPOTIFY_APP_CLI = "inherited-spotify";
            process.env.OPENAI_API_KEY = "inherited-openai";
            reloadConfigKeysSync(["SPOTIFY_APP_CLI"], {
                workspaceRoot: root,
            });
            expect(process.env.SPOTIFY_APP_CLI).toBe("local");
            expect(process.env.OPENAI_API_KEY).toBe("inherited-openai");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("applies added and changed local overrides", () => {
        const root = makeTempWorkspace();
        try {
            const file = path.join(root, "config.local.yaml");
            process.env.SPOTIFY_APP_CLI = "inherited";
            fs.writeFileSync(file, "spotify:\n  clientId: first\n");
            reloadConfigKeysSync(["SPOTIFY_APP_CLI"], {
                workspaceRoot: root,
            });
            expect(process.env.SPOTIFY_APP_CLI).toBe("first");
            fs.writeFileSync(file, "spotify:\n  clientId: second\n");
            reloadConfigKeysSync(["SPOTIFY_APP_CLI"], {
                workspaceRoot: root,
            });
            expect(process.env.SPOTIFY_APP_CLI).toBe("second");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("restores an inherited value when a local override is removed", () => {
        const root = makeTempWorkspace();
        try {
            const file = path.join(root, "config.local.yaml");
            process.env.SPOTIFY_APP_CLI = "vault-like-value";
            fs.writeFileSync(file, "spotify:\n  clientId: local\n");
            reloadConfigKeysSync(["SPOTIFY_APP_CLI"], {
                workspaceRoot: root,
            });

            test("deletes a startup local value after its override is removed", () => {
                const root = makeTempWorkspace();
                try {
                    const file = path.join(root, "config.local.yaml");
                    fs.writeFileSync(
                        file,
                        "spotify:\n  clientId: startup-local\n",
                    );
                    loadConfigSync({ workspaceRoot: root });
                    expect(process.env.SPOTIFY_APP_CLI).toBe("startup-local");
                    fs.writeFileSync(file, "{}\n");
                    reloadConfigKeysSync(["SPOTIFY_APP_CLI"], {
                        workspaceRoot: root,
                    });
                    expect(process.env.SPOTIFY_APP_CLI).toBeUndefined();
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            });

            test("restores a Key Vault value hidden by a startup local override", async () => {
                const root = makeTempWorkspace();
                try {
                    const file = path.join(root, "config.local.yaml");
                    fs.writeFileSync(file, "spotify:\n  clientId: local-id\n");
                    await loadConfig({
                        workspaceRoot: root,
                        keyVault: {
                            vaultName: "test",
                            fetcher: async () =>
                                "spotify:\n  clientId: vault-id\n",
                        },
                    });
                    expect(process.env.SPOTIFY_APP_CLI).toBe("local-id");
                    fs.writeFileSync(file, "{}\n");
                    reloadConfigKeysSync(["SPOTIFY_APP_CLI"], {
                        workspaceRoot: root,
                    });
                    expect(process.env.SPOTIFY_APP_CLI).toBe("vault-id");
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            });
            expect(process.env.SPOTIFY_APP_CLI).toBe("local");
            fs.writeFileSync(file, "{}\n");
            reloadConfigKeysSync(["SPOTIFY_APP_CLI"], {
                workspaceRoot: root,
            });
            expect(process.env.SPOTIFY_APP_CLI).toBe("vault-like-value");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("restores a default or deletes a removed override", () => {
        const root = makeTempWorkspace();
        try {
            const local = path.join(root, "config.local.yaml");
            fs.writeFileSync(
                path.join(root, "config.defaults.yaml"),
                "spotify:\n  clientId: default-id\n",
            );
            fs.writeFileSync(
                local,
                "spotify:\n  clientId: local-id\n  clientSecret: local-secret\n",
            );
            reloadConfigKeysSync(["SPOTIFY_APP_CLI", "SPOTIFY_APP_CLISEC"], {
                workspaceRoot: root,
            });
            fs.writeFileSync(local, "{}\n");
            reloadConfigKeysSync(["SPOTIFY_APP_CLI", "SPOTIFY_APP_CLISEC"], {
                workspaceRoot: root,
            });
            expect(process.env.SPOTIFY_APP_CLI).toBe("default-id");
            expect(process.env.SPOTIFY_APP_CLISEC).toBeUndefined();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("reports malformed scoped sections without retaining stale values", () => {
        const root = makeTempWorkspace();
        try {
            const local = path.join(root, "config.local.yaml");
            fs.writeFileSync(
                local,
                "spotify:\n  clientId: id\n  clientSecret: secret\n  port: 8080\n",
            );
            reloadConfigKeysSync(["SPOTIFY_APP_CLI"], {
                workspaceRoot: root,
            });
            fs.writeFileSync(local, "spotify:\n  port: <value>\n");
            reloadConfigKeysSync(["SPOTIFY_APP_CLI"], {
                workspaceRoot: root,
            });
            expect(process.env.SPOTIFY_APP_CLI).toBeUndefined();
            expect(
                getConfigProblems().some((p) => p.section === "spotify"),
            ).toBe(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
